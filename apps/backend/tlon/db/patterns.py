"""Persisting mined patterns.

A pattern differs from every other inferred node in one way that matters: it
cites *many* observations rather than one. That is the case `node_provenance`
was built as a table for, and the reason a pattern's explain screen can show the
several entries it actually rests on rather than a single cherry-picked one.

Re-mining replaces a user's patterns rather than appending. Patterns are a
derived view of the graph — an old pattern that no longer holds should stop being
shown, not linger as a claim nobody can retract.
"""

from __future__ import annotations

from datetime import date
from uuid import UUID, uuid4

import asyncpg

from tlon.domain.inference import EpistemicStatus
from tlon.graph.schema import EdgeKind, NodeKind
from tlon.lag import DETECTOR as LAG_DETECTOR
from tlon.lag import VERSION as LAG_VERSION
from tlon.lag import LagFinding
from tlon.lag import mine as mine_lags
from tlon.lag import to_pattern as lag_to_pattern
from tlon.patterns import DETECTOR, PROMPT_VERSION, Candidate, MinedPattern, mine
from tlon.periodicity import DETECTOR as WEEKDAY_DETECTOR
from tlon.periodicity import VERSION as PERIODICITY_VERSION
from tlon.periodicity import mine_weekdays
from tlon.sameday import DETECTOR as SAMEDAY_DETECTOR
from tlon.sameday import VERSION as SAMEDAY_VERSION
from tlon.sameday import SameDayFinding
from tlon.sameday import mine as mine_samedays
from tlon.sameday import to_pattern as sameday_to_pattern
from tlon.tension import DETECTOR as TENSION_DETECTOR
from tlon.tension import VERSION as TENSION_VERSION
from tlon.tension import mine as mine_tensions
from tlon.tension import to_pattern as tension_to_pattern


async def load_candidates(pool: asyncpg.Pool, user_id: UUID) -> list[Candidate]:
    """Every inferred node paired with the entry and day it came from.

    Joined through `node_provenance` rather than the node's own `created_at`, for
    the same reason the daily summary is: an inference belongs to the day of the
    entry that produced it, not the day the extractor happened to run.
    """
    rows = await pool.fetch(
        """
        SELECT n.id, n.kind, n.label, n.confidence,
               o.node_id AS observation_id, o.timezone,
               -- The moment, in the same calendar as the day below, for the
               -- within-day detector. Naive on purpose: it is only ever
               -- compared with other moments from the same person's day.
               (o.captured_at AT TIME ZONE COALESCE(o.timezone, 'UTC')) AS observed_at,
               -- How long after the fact it was written: the server's clock at
               -- insert, minus the moment the client said it was about.
               -- Negative for a clock skewed forward, which `greatest` flattens
               -- to zero rather than treating as evidence of anything.
               greatest(obs.created_at - o.captured_at, interval '0') AS recall_delay,
               -- The day in the writer's own calendar, or UTC where they never
               -- recorded one. Computed here rather than in Python so every
               -- detector sees the same day for the same entry.
               (o.captured_at AT TIME ZONE COALESCE(o.timezone, 'UTC'))::date AS observed_on
        FROM graph_nodes n
        JOIN node_provenance p ON p.node_id = n.id
        JOIN observations o ON o.node_id = p.observation_id
        JOIN graph_nodes obs ON obs.id = o.node_id
        WHERE n.user_id = $1
          AND n.deleted_at IS NULL
          AND obs.deleted_at IS NULL
          AND n.kind NOT IN ('Observation', 'Pattern')
          -- A reading the person has rejected stops feeding anything derived
          -- from it. Otherwise correcting the system would change nothing: the
          -- thing you said was wrong would keep surfacing inside conclusions
          -- built on it.
          AND n.epistemic_status <> 'user_rejected'
        """,
        user_id,
    )
    return [
        Candidate(
            node_id=row["id"],
            kind=NodeKind(row["kind"]),
            label=row["label"],
            confidence=row["confidence"],
            observation_id=row["observation_id"],
            observed_on=row["observed_on"],
            # Entries written before the app recorded a zone are counted in UTC,
            # and the calendar detectors keep saying so rather than presenting a
            # server day as the person's own.
            zoned=row["timezone"] is not None,
            observed_at=row["observed_at"],
            recall_delay=row["recall_delay"],
        )
        for row in rows
    ]


async def load_observed_days(pool: asyncpg.Pool, user_id: UUID) -> set[date]:
    """Every day the person wrote something that is still in their graph."""
    rows = await pool.fetch(
        """
        SELECT DISTINCT
            (o.captured_at AT TIME ZONE COALESCE(o.timezone, 'UTC'))::date AS observed_on
        FROM observations o
        JOIN graph_nodes n ON n.id = o.node_id
        WHERE o.user_id = $1 AND n.deleted_at IS NULL
        """,
        user_id,
    )
    return {row["observed_on"] for row in rows}


async def persist(
    pool: asyncpg.Pool,
    user_id: UUID,
    patterns: list[MinedPattern],
    *,
    detector: str = DETECTOR,
    extractor: str = PROMPT_VERSION,
) -> dict:
    """Reconcile one detector's patterns against a freshly mined set.

    An upsert keyed on `(detector, pattern_key)`, not a replacement. Three things
    follow from that, and each is the point:

    **A pattern keeps its id.** So "this has held for five weeks" is a fact the
    system can state, rather than something re-discovered every six hours.

    **A rejection sticks.** Recreating the node wiped `epistemic_status` on every
    run, which meant rejecting a pattern did nothing — the next run brought it
    back as a fresh hypothesis. Updates deliberately leave that column alone.

    **A pattern that stops holding lapses rather than vanishing.** Its node is
    tombstoned but its identity row survives, so a recurrence that returns months
    later is recognised as the same one coming back.

    One transaction: a half-reconciled set would mix current and stale claims with
    no way to tell which was which.
    """
    async with pool.acquire() as conn, conn.transaction():
        return await _persist_detector(
            conn,
            user_id,
            patterns,
            detector=detector,
            extractor=extractor,
        )


async def _persist_detector(
    conn: asyncpg.Connection,
    user_id: UUID,
    patterns: list[MinedPattern],
    *,
    detector: str,
    extractor: str,
) -> dict:
    added: list[str] = []
    confirmed: list[str] = []

    existing = {
        row["pattern_key"]: row
        for row in await conn.fetch(
            "SELECT pattern_key, node_id FROM patterns WHERE user_id = $1 AND detector = $2",
            user_id,
            detector,
        )
    }

    for pattern in patterns:
        row = existing.get(pattern.key)
        if row is None:
            pattern_id = await _insert(
                conn,
                user_id,
                pattern,
                detector=detector,
                extractor=extractor,
            )
            added.append(str(pattern_id))
        else:
            pattern_id = row["node_id"]
            await _confirm(conn, pattern_id, pattern)
            confirmed.append(str(pattern_id))

        await _attach_evidence(
            conn,
            user_id,
            pattern_id,
            pattern,
            extractor=extractor,
        )

    await _lapse_absent(
        conn,
        user_id,
        {pattern.key for pattern in patterns},
        detector=detector,
    )

    return {"added": added, "confirmed": confirmed}


async def _insert(
    conn: asyncpg.Connection,
    user_id: UUID,
    pattern: MinedPattern,
    *,
    detector: str,
    extractor: str,
) -> UUID:
    pattern_id = uuid4()
    await conn.execute(
        """
        INSERT INTO graph_nodes
            (id, user_id, kind, label, confidence, epistemic_status, extractor)
        VALUES ($1, $2, 'Pattern', $3, $4, $5, $6)
        """,
        pattern_id,
        user_id,
        pattern.label.strip(),
        pattern.confidence,
        str(EpistemicStatus.HYPOTHESIS),
        extractor,
    )
    await conn.execute(
        """
        INSERT INTO patterns
            (node_id, user_id, detector, pattern_key, occurrences, distinct_days)
        VALUES ($1, $2, $3, $4, $5, $6)
        """,
        pattern_id,
        user_id,
        detector,
        pattern.key,
        pattern.occurrences,
        pattern.distinct_days,
    )
    return pattern_id


async def _confirm(conn: asyncpg.Connection, pattern_id: UUID, pattern: MinedPattern) -> None:
    """This pattern still holds. Refresh what was counted; leave the verdict alone."""
    # The label tracks the person's latest phrasing and the confidence tracks its
    # current evidence, but `epistemic_status` is theirs, not ours. A pattern they
    # rejected stays rejected however many more times it recurs — that is what
    # rejecting it meant. `deleted_at` is cleared because a lapsed pattern that
    # holds again is the same claim resuming.
    await conn.execute(
        """
        UPDATE graph_nodes
        SET label = $2, confidence = $3, deleted_at = NULL
        WHERE id = $1
        """,
        pattern_id,
        pattern.label.strip(),
        pattern.confidence,
    )
    await conn.execute(
        """
        UPDATE patterns
        SET last_confirmed_at = now(), lapsed_at = NULL,
            occurrences = $2, distinct_days = $3
        WHERE node_id = $1
        """,
        pattern_id,
        pattern.occurrences,
        pattern.distinct_days,
    )


async def _attach_evidence(
    conn: asyncpg.Connection,
    user_id: UUID,
    pattern_id: UUID,
    pattern: MinedPattern,
    *,
    extractor: str,
) -> None:
    """Point the pattern at every entry and node it currently rests on."""
    # Every contributing entry, not a representative one. A pattern citing only
    # its first observation would be unfalsifiable from the explain screen.
    # ON CONFLICT because a confirmed pattern already cites most of them.
    await conn.execute(
        """
        DELETE FROM node_provenance
        WHERE node_id = $1
          AND NOT (observation_id = ANY($2::uuid[]))
        """,
        pattern_id,
        list(pattern.observation_ids),
    )
    for observation_id in pattern.observation_ids:
        await conn.execute(
            """
            INSERT INTO node_provenance (node_id, observation_id) VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            """,
            pattern_id,
            observation_id,
        )

    # Rebuilt rather than reconciled edge by edge. These edges are internal wiring
    # of a single claim rather than anything a person links to, and consolidation
    # repoints their endpoints underneath us — so the cheap, always-correct move
    # is to derive them fresh. Hard delete, because tombstoning wiring that is
    # rewritten on every run would grow without bound.
    await conn.execute(
        "DELETE FROM graph_edges WHERE user_id = $1 AND kind = $2 AND to_id = $3",
        user_id,
        str(EdgeKind.SUPPORTS),
        pattern_id,
    )

    # SUPPORTS runs from the evidence to the claim, matching the ontology: the
    # recurring nodes support the pattern, not vice versa.
    for node_id in pattern.node_ids:
        edge_id = uuid4()
        await conn.execute(
            """
            INSERT INTO graph_edges
                (id, user_id, kind, from_id, to_id,
                 confidence, epistemic_status, extractor)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            edge_id,
            user_id,
            str(EdgeKind.SUPPORTS),
            node_id,
            pattern_id,
            pattern.confidence,
            str(EpistemicStatus.HYPOTHESIS),
            extractor,
        )
        for observation_id in pattern.observation_ids:
            await conn.execute(
                "INSERT INTO edge_provenance (edge_id, observation_id) VALUES ($1, $2)",
                edge_id,
                observation_id,
            )


async def _lapse_absent(
    conn: asyncpg.Connection,
    user_id: UUID,
    held: set[str],
    *,
    detector: str,
) -> None:
    """Retire the patterns this run no longer found.

    The node is tombstoned so it stops being shown; the identity row stays so its
    age survives. `lapsed_at` is only stamped on the transition, so a pattern that
    has been gone for a month does not keep reporting that it just stopped.
    """
    await conn.execute(
        """
        UPDATE patterns SET lapsed_at = now()
        WHERE user_id = $1 AND detector = $2
          AND lapsed_at IS NULL
          AND NOT (pattern_key = ANY($3::text[]))
        """,
        user_id,
        detector,
        list(held),
    )
    await conn.execute(
        """
        UPDATE graph_nodes SET deleted_at = now()
        WHERE user_id = $1 AND kind = 'Pattern' AND deleted_at IS NULL
          AND id IN (
              SELECT node_id FROM patterns
              WHERE user_id = $1 AND detector = $2 AND lapsed_at IS NOT NULL
          )
        """,
        user_id,
        detector,
    )


async def remine(pool: asyncpg.Pool, user_id: UUID) -> dict:
    candidates = await load_candidates(pool, user_id)
    observed_days = await load_observed_days(pool, user_id)
    exact_patterns = mine(candidates)
    weekday_patterns = mine_weekdays(candidates, observed_days)
    lag_findings = mine_lags(candidates, observed_days)
    lag_patterns = [lag_to_pattern(finding) for finding in lag_findings]
    tension_patterns = [
        tension_to_pattern(finding) for finding in mine_tensions(candidates, observed_days)
    ]
    sameday_findings = mine_samedays(candidates, observed_days)
    sameday_patterns = [sameday_to_pattern(finding) for finding in sameday_findings]

    # Every view describes the same graph at the same instant. Reconcile them in
    # one transaction so one failed detector cannot leave the others current
    # while its claims still describe the previous run.
    async with pool.acquire() as conn, conn.transaction():
        exact = await _persist_detector(
            conn,
            user_id,
            exact_patterns,
            detector=DETECTOR,
            extractor=PROMPT_VERSION,
        )
        weekday = await _persist_detector(
            conn,
            user_id,
            weekday_patterns,
            detector=WEEKDAY_DETECTOR,
            extractor=PERIODICITY_VERSION,
        )
        lag = await _persist_detector(
            conn,
            user_id,
            lag_patterns,
            detector=LAG_DETECTOR,
            extractor=LAG_VERSION,
        )
        await _replace_lag_matches(conn, user_id, lag_findings)
        tension = await _persist_detector(
            conn,
            user_id,
            tension_patterns,
            detector=TENSION_DETECTOR,
            extractor=TENSION_VERSION,
        )
        sameday = await _persist_detector(
            conn,
            user_id,
            sameday_patterns,
            detector=SAMEDAY_DETECTOR,
            extractor=SAMEDAY_VERSION,
        )
        await _replace_sameday_matches(conn, user_id, sameday_findings)

    runs = (exact, weekday, lag, tension, sameday)
    added = [pattern_id for run in runs for pattern_id in run["added"]]
    confirmed = [pattern_id for run in runs for pattern_id in run["confirmed"]]
    return {
        "patterns": len(added) + len(confirmed),
        # Reported separately because they mean different things to a reader: one
        # is "here is something new", the other is "the same things still hold".
        # A run that adds nothing is not a run that found nothing.
        "added": len(added),
        "confirmed": len(confirmed),
        "considered": len(candidates),
        "ids": added + confirmed,
    }


async def _replace_lag_matches(
    conn: asyncpg.Connection,
    user_id: UUID,
    findings: list[LagFinding],
) -> None:
    await conn.execute("DELETE FROM pattern_lag_matches WHERE user_id = $1", user_id)
    if not findings:
        return

    pattern_ids = {
        row["pattern_key"]: row["node_id"]
        for row in await conn.fetch(
            "SELECT pattern_key, node_id FROM patterns WHERE user_id = $1 AND detector = $2",
            user_id,
            LAG_DETECTOR,
        )
    }
    for finding in findings:
        pattern_id = pattern_ids[finding.key]
        for match in finding.pairs:
            for source_observation_id in match.source_observation_ids:
                for target_observation_id in match.target_observation_ids:
                    await conn.execute(
                        """
                        INSERT INTO pattern_lag_matches
                            (user_id, pattern_id,
                             source_observation_id, target_observation_id,
                             source_day, target_day, lag_days)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        """,
                        user_id,
                        pattern_id,
                        source_observation_id,
                        target_observation_id,
                        match.source_day,
                        match.target_day,
                        finding.lag_days,
                    )


async def _replace_sameday_matches(
    conn: asyncpg.Connection,
    user_id: UUID,
    findings: list[SameDayFinding],
) -> None:
    await conn.execute("DELETE FROM pattern_sameday_matches WHERE user_id = $1", user_id)
    if not findings:
        return

    pattern_ids = {
        row["pattern_key"]: row["node_id"]
        for row in await conn.fetch(
            "SELECT pattern_key, node_id FROM patterns WHERE user_id = $1 AND detector = $2",
            user_id,
            SAMEDAY_DETECTOR,
        )
    }
    for finding in findings:
        pattern_id = pattern_ids[finding.key]
        for match in finding.matches:
            await conn.execute(
                """
                INSERT INTO pattern_sameday_matches
                    (user_id, pattern_id,
                     source_observation_id, target_observation_id,
                     day, source_at, target_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                """,
                user_id,
                pattern_id,
                match.source_observation_id,
                match.target_observation_id,
                match.day,
                match.source_at,
                match.target_at,
            )


async def ordering_for_pattern(
    pool: asyncpg.Pool,
    user_id: UUID,
    pattern_id: UUID,
) -> dict | None:
    """The entries behind an ordered lag finding, grouped by occasion.

    One occasion is one pair of writing days: what was written first, and what
    was written `lag_days` later. Grouped rather than returned as stored pairs
    because two entries on the same day produce a cross-product of rows, and a
    reader should see one occasion, not four.

    `None` for anything that is not this user's ordered pattern — including a
    pattern found by a detector that makes no claim about order.
    """
    pattern = await pool.fetchrow(
        """
        SELECT n.label, p.detector
        FROM patterns p
        JOIN graph_nodes n ON n.id = p.node_id
        WHERE p.node_id = $1 AND p.user_id = $2 AND n.deleted_at IS NULL
        """,
        pattern_id,
        user_id,
    )
    if pattern is None or pattern["detector"] not in (LAG_DETECTOR, SAMEDAY_DETECTOR):
        return None

    if pattern["detector"] == SAMEDAY_DETECTOR:
        return await _sameday_ordering(pool, user_id, pattern_id, pattern["label"])

    rows = await pool.fetch(
        """
        SELECT m.source_day, m.target_day, m.lag_days,
               before.node_id AS before_id, before.content AS before_content,
               before.source AS before_source, before.captured_at AS before_captured_at,
               before.timezone AS before_timezone, after.timezone AS after_timezone,
               after.node_id AS after_id, after.content AS after_content,
               after.source AS after_source, after.captured_at AS after_captured_at
        FROM pattern_lag_matches m
        JOIN observations before ON before.node_id = m.source_observation_id
        JOIN observations after ON after.node_id = m.target_observation_id
        JOIN graph_nodes before_node ON before_node.id = before.node_id
        JOIN graph_nodes after_node ON after_node.id = after.node_id
        WHERE m.user_id = $1 AND m.pattern_id = $2
          AND before_node.deleted_at IS NULL
          AND after_node.deleted_at IS NULL
        ORDER BY m.source_day, before.captured_at, after.captured_at
        """,
        user_id,
        pattern_id,
    )
    if not rows:
        return None

    occasions: dict[tuple[date, date], dict] = {}
    for row in rows:
        occasion = occasions.setdefault(
            (row["source_day"], row["target_day"]),
            {
                "source_day": row["source_day"],
                "target_day": row["target_day"],
                "before": {},
                "after": {},
            },
        )
        occasion["before"].setdefault(row["before_id"], _written(row, "before"))
        occasion["after"].setdefault(row["after_id"], _written(row, "after"))

    return {
        "pattern_id": str(pattern_id),
        "label": pattern["label"],
        "lag_days": rows[0]["lag_days"],
        # True while any entry behind this predates timezone capture, so its
        # days were counted in UTC. The screen shows the caveat only then —
        # repeating it under evidence that does not need it teaches people to
        # skip it under evidence that does.
        "utc_fallback": any(
            row["before_timezone"] is None or row["after_timezone"] is None for row in rows
        ),
        "occasions": [
            {
                "source_day": occasion["source_day"],
                "target_day": occasion["target_day"],
                "before": list(occasion["before"].values()),
                "after": list(occasion["after"].values()),
            }
            for occasion in occasions.values()
        ],
    }


def _written(row: asyncpg.Record, side: str) -> dict:
    return {
        "id": str(row[f"{side}_id"]),
        "content": row[f"{side}_content"],
        "source": row[f"{side}_source"],
        "captured_at": row[f"{side}_captured_at"],
    }


async def _sameday_ordering(
    pool: asyncpg.Pool,
    user_id: UUID,
    pattern_id: UUID,
    label: str,
) -> dict | None:
    """The entries behind a same-day-order finding, one occasion per day.

    The shape matches the lag payload so one screen can read both: `lag_days`
    is 0 because both moments fell on the writing day itself, and each occasion
    is the two moments in the order they were written, not a claim about why.
    """
    rows = await pool.fetch(
        """
        SELECT m.day,
               before.node_id AS before_id, before.content AS before_content,
               before.source AS before_source, before.captured_at AS before_captured_at,
               before.timezone AS before_timezone, after.timezone AS after_timezone,
               after.node_id AS after_id, after.content AS after_content,
               after.source AS after_source, after.captured_at AS after_captured_at
        FROM pattern_sameday_matches m
        JOIN observations before ON before.node_id = m.source_observation_id
        JOIN observations after ON after.node_id = m.target_observation_id
        JOIN graph_nodes before_node ON before_node.id = before.node_id
        JOIN graph_nodes after_node ON after_node.id = after.node_id
        WHERE m.user_id = $1 AND m.pattern_id = $2
          AND before_node.deleted_at IS NULL
          AND after_node.deleted_at IS NULL
        ORDER BY m.day, m.source_at, m.target_at
        """,
        user_id,
        pattern_id,
    )
    if not rows:
        return None

    return {
        "pattern_id": str(pattern_id),
        "label": label,
        "lag_days": 0,
        "utc_fallback": any(
            row["before_timezone"] is None or row["after_timezone"] is None for row in rows
        ),
        "occasions": [
            {
                "source_day": row["day"],
                "target_day": row["day"],
                "before": [_written(row, "before")],
                "after": [_written(row, "after")],
            }
            for row in rows
        ],
    }


async def list_for_user(pool: asyncpg.Pool, user_id: UUID) -> list[dict]:
    rows = await pool.fetch(
        """
        SELECT n.id, n.label, n.confidence, n.epistemic_status, n.extractor,
               n.created_at, pat.detector, pat.first_seen_at, pat.distinct_days,
               pat.occurrences
        FROM graph_nodes n
        JOIN patterns pat ON pat.node_id = n.id
        WHERE n.user_id = $1 AND n.kind = 'Pattern' AND n.deleted_at IS NULL
        ORDER BY pat.occurrences DESC, n.confidence DESC, n.label
        """,
        user_id,
    )
    return [
        {
            "id": str(row["id"]),
            "label": row["label"],
            "confidence": row["confidence"],
            "epistemic_status": row["epistemic_status"],
            "extractor": row["extractor"],
            "occurrences": row["occurrences"],
            "distinct_days": row["distinct_days"],
            # Which method claimed this, so the client can render a statistic
            # differently from a count.
            "detector": row["detector"],
            # How long it has held. A pattern that has survived a month of
            # re-mining is a different proposition from one first seen today,
            # and until now the system had no way to say so.
            "first_seen_at": row["first_seen_at"],
            # A pattern is a hypothesis like any other inference, and the client
            # renders low-confidence ones as tentative.
            "tentative": row["confidence"] < 0.5,
            "created_at": row["created_at"],
        }
        for row in rows
    ]
