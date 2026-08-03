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
from tlon.patterns import DETECTOR, PROMPT_VERSION, Candidate, MinedPattern, mine
from tlon.periodicity import DETECTOR as WEEKDAY_DETECTOR
from tlon.periodicity import VERSION as PERIODICITY_VERSION
from tlon.periodicity import mine_weekdays


async def load_candidates(pool: asyncpg.Pool, user_id: UUID) -> list[Candidate]:
    """Every inferred node paired with the entry and day it came from.

    Joined through `node_provenance` rather than the node's own `created_at`, for
    the same reason the daily summary is: an inference belongs to the day of the
    entry that produced it, not the day the extractor happened to run.
    """
    rows = await pool.fetch(
        """
        SELECT n.id, n.kind, n.label, n.confidence,
               o.node_id AS observation_id, o.captured_at
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
            observed_on=row["captured_at"].date(),
        )
        for row in rows
    ]


async def load_observed_days(pool: asyncpg.Pool, user_id: UUID) -> set[date]:
    """Every day the person wrote something that is still in their graph."""
    rows = await pool.fetch(
        """
        SELECT DISTINCT o.captured_at::date AS observed_on
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

    # Both views describe the same graph at the same instant. Reconcile them in
    # one transaction so a failed weekday write cannot leave exact recurrence
    # refreshed while the calendar claims still describe the previous run.
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

    added = exact["added"] + weekday["added"]
    confirmed = exact["confirmed"] + weekday["confirmed"]
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


async def list_for_user(pool: asyncpg.Pool, user_id: UUID) -> list[dict]:
    rows = await pool.fetch(
        """
        SELECT n.id, n.label, n.confidence, n.epistemic_status, n.extractor,
               n.created_at, pat.detector, pat.first_seen_at, pat.distinct_days,
               count(DISTINCT p.observation_id) AS occurrences
        FROM graph_nodes n
        JOIN patterns pat ON pat.node_id = n.id
        LEFT JOIN node_provenance p ON p.node_id = n.id
        WHERE n.user_id = $1 AND n.kind = 'Pattern' AND n.deleted_at IS NULL
        GROUP BY n.id, pat.detector, pat.first_seen_at, pat.distinct_days
        ORDER BY count(DISTINCT p.observation_id) DESC, n.confidence DESC, n.label
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
