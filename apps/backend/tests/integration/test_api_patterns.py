"""Pattern mining over HTTP, against a real database.

The pure mining logic is covered in tests/test_patterns.py. What is only testable
here is everything the database enforces: that a Pattern satisfies the two-tier
rule, that it cites *every* observation it rests on rather than one, and that
re-mining replaces rather than accumulates.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import asyncpg
import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account

pytestmark = [pytest.mark.anyio, pytest.mark.integration]

DAY_ONE = datetime(2026, 3, 1, 9, 0, tzinfo=UTC)


async def entry(
    client: AsyncClient,
    account: Account,
    captured_at: datetime,
    *,
    timezone: str | None = None,
) -> UUID:
    observation_id = uuid4()
    response = await client.post(
        "/v1/observations",
        headers=account.auth,
        json={
            "id": str(observation_id),
            "content": f"an entry written at {captured_at.isoformat()}",
            "source": "text",
            "captured_at": captured_at.isoformat(),
            "timezone": timezone,
        },
    )
    assert response.status_code == 201, response.text
    return observation_id


async def written_in_the_moment(
    pool: asyncpg.Pool, observation_id: UUID, captured_at: datetime
) -> None:
    """Mark an entry as written when it happened rather than backfilled.

    Every fixture here backdates `captured_at` by months, so by default the
    server sees each entry as recalled long after the fact — which the within-day
    detector refuses, correctly. Tests about the shape of a day have to say that
    the day was written up as it happened, and the creation time is where that
    is recorded.
    """
    await pool.execute(
        "UPDATE graph_nodes SET created_at = $2 WHERE id = $1", observation_id, captured_at
    )


async def inferred(
    pool: asyncpg.Pool,
    account: Account,
    observation_id: UUID,
    label: str,
    *,
    kind: str = "Emotion",
    confidence: float = 0.8,
) -> UUID:
    """An inference hanging off an entry, inserted directly.

    Directly rather than through the extractor because the stub only ever emits
    Thoughts, which are deliberately unpatternable — so there is no way to set up
    a recurrence through the public API alone.
    """
    node_id = uuid4()
    await pool.execute(
        """
        INSERT INTO graph_nodes
            (id, user_id, kind, label, confidence, epistemic_status, extractor)
        VALUES ($1, $2, $3, $4, $5, 'hypothesis', 'test')
        """,
        node_id,
        account.user_id,
        kind,
        label,
        confidence,
    )
    await pool.execute(
        "INSERT INTO node_provenance (node_id, observation_id) VALUES ($1, $2)",
        node_id,
        observation_id,
    )
    return node_id


async def recurring(
    client: AsyncClient,
    pool: asyncpg.Pool,
    account: Account,
    label: str,
    *,
    days: tuple[int, ...] = (0, 1, 2),
    **kwargs,
) -> list[UUID]:
    """One entry per day, each carrying the same inference."""
    observations = []
    for offset in days:
        observation_id = await entry(client, account, DAY_ONE + timedelta(days=offset))
        await inferred(pool, account, observation_id, label, **kwargs)
        observations.append(observation_id)
    return observations


async def lag_journal(
    client: AsyncClient,
    pool: asyncpg.Pool,
    account: Account,
    *,
    source_offsets: tuple[int, ...] = (0, 8, 17, 27),
    span: int = 32,
) -> tuple[list[UUID], list[UUID], list[UUID], list[UUID]]:
    """A densely written journal where one thing precedes another by a day.

    Dense on purpose: the lag detector only counts a source day when the person
    also wrote on the comparison day, so a sparse journal would prove nothing.
    Returns the source and target observations followed by their inferred nodes.
    """
    source_observations: list[UUID] = []
    target_observations: list[UUID] = []
    source_nodes: list[UUID] = []
    target_nodes: list[UUID] = []

    for offset in range(span):
        observation_id = await entry(client, account, DAY_ONE + timedelta(days=offset))
        if offset in source_offsets:
            source_observations.append(observation_id)
            source_nodes.append(
                await inferred(pool, account, observation_id, "sleeping badly", kind="Activity")
            )
        if offset - 1 in source_offsets:
            target_observations.append(observation_id)
            target_nodes.append(
                await inferred(pool, account, observation_id, "foggy", kind="Emotion")
            )

    return source_observations, target_observations, source_nodes, target_nodes


async def mine(client: AsyncClient, account: Account) -> dict:
    response = await client.post("/v1/patterns/mine", headers=account.auth)
    assert response.status_code == 200, response.text
    return response.json()


async def listed(client: AsyncClient, account: Account) -> list[dict]:
    response = await client.get("/v1/patterns", headers=account.auth)
    assert response.status_code == 200, response.text
    return response.json()


async def thursday_recurrence(
    client: AsyncClient,
    pool: asyncpg.Pool,
    account: Account,
    label: str = "drained",
) -> list[UUID]:
    observations = await recurring(
        client,
        pool,
        account,
        label,
        days=(4, 11, 18, 25),
    )
    # The calendar shape is only meaningful if the person also wrote at other
    # times. Otherwise this would detect their journalling habit, not their life.
    for offset in (5, 6, 7):
        await entry(client, account, DAY_ONE + timedelta(days=offset))
    return observations


class TestMining:
    async def test_an_empty_graph_yields_no_patterns(self, client: AsyncClient, account: Account):
        assert await mine(client, account) == {
            "patterns": 0,
            "added": 0,
            "confirmed": 0,
            "considered": 0,
        }
        assert await listed(client, account) == []

    async def test_a_recurrence_becomes_a_pattern(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await recurring(client, pool, account, "dread")
        assert (await mine(client, account))["patterns"] == 1

        patterns = await listed(client, account)
        assert [p["label"] for p in patterns] == ["dread"]
        assert patterns[0]["occurrences"] == 3

    async def test_writing_entries_alone_produces_no_patterns(
        self, client: AsyncClient, account: Account
    ):
        # The stub extractor emits Thoughts, and a Thought recurring verbatim is a
        # phrasing coincidence rather than something to tell someone about.
        for offset in range(4):
            observation_id = await entry(client, account, DAY_ONE + timedelta(days=offset))
            extracted = await client.post(
                f"/v1/observations/{observation_id}/extract", headers=account.auth
            )
            assert extracted.status_code == 200, extracted.text
        result = await mine(client, account)
        assert result["patterns"] == 0
        # But it did look — "nothing found" and "nothing to look at" are different
        # answers, and the count is what tells them apart.
        assert result["considered"] > 0

    async def test_mining_is_not_automatic(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # Writing entries must not silently recompute what the system thinks about
        # you. The person asks, and then it looks.
        await recurring(client, pool, account, "dread")
        assert await listed(client, account) == []


class TestWeekdayPeriodicity:
    async def test_a_weekday_shape_is_a_separate_pattern_claim(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        observations = await thursday_recurrence(client, pool, account)

        assert await mine(client, account) == {
            "patterns": 2,
            "added": 2,
            "confirmed": 0,
            "considered": 4,
        }
        patterns = {pattern["detector"]: pattern for pattern in await listed(client, account)}

        assert patterns["exact-label"]["label"] == "drained"
        assert patterns["weekday"]["label"] == "drained · Thursdays (UTC)"
        assert patterns["weekday"]["occurrences"] == 4

        periodic_id = UUID(patterns["weekday"]["id"])
        assert (
            await pool.fetchval(
                "SELECT extractor FROM graph_nodes WHERE id = $1",
                periodic_id,
            )
            == "periodicity-v0.1"
        )
        cited = await pool.fetch(
            "SELECT observation_id FROM node_provenance WHERE node_id = $1",
            periodic_id,
        )
        assert {row["observation_id"] for row in cited} == set(observations)

    async def test_the_weekday_is_the_writers_own_not_the_servers(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        """Late-night entries belong to the day the person was having.

        Each of these was written at 23:30 UTC on a Wednesday, which in
        Stockholm is half past midnight on Thursday. Counting them in UTC would
        tell someone their week has a Wednesday shape it does not have.
        """
        stockholm = "Europe/Stockholm"
        # 2026-03-04, 11, 18, 25 — Wednesdays in UTC.
        for offset in (3, 10, 17, 24):
            late = (DAY_ONE + timedelta(days=offset)).replace(hour=23, minute=30)
            assert late.weekday() == 2, "the fixture must be a UTC Wednesday to prove anything"
            observation_id = await entry(client, account, late, timezone=stockholm)
            await inferred(pool, account, observation_id, "drained")
        for offset in (5, 6, 7):
            await entry(client, account, DAY_ONE + timedelta(days=offset), timezone=stockholm)

        await mine(client, account)
        patterns = {pattern["detector"]: pattern for pattern in await listed(client, account)}

        # Thursdays, and unhedged: every entry behind the claim recorded a zone,
        # so the app is no longer guessing at which day these belong to.
        assert patterns["weekday"]["label"] == "drained · Thursdays"
        assert (
            await pool.fetchval(
                "SELECT pattern_key FROM patterns WHERE node_id = $1",
                UUID(patterns["weekday"]["id"]),
            )
            == "Emotion:drained:weekday:3"
        )

    async def test_a_thursday_only_writer_gets_no_weekday_claim(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await recurring(client, pool, account, "drained", days=(4, 11, 18, 25))
        await mine(client, account)

        assert [pattern["detector"] for pattern in await listed(client, account)] == ["exact-label"]

    async def test_a_weekday_verdict_is_independent_of_generic_recurrence(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await thursday_recurrence(client, pool, account)
        await mine(client, account)
        first = {pattern["detector"]: pattern for pattern in await listed(client, account)}

        await pool.execute(
            "UPDATE graph_nodes SET epistemic_status = 'user_rejected' WHERE id = $1",
            UUID(first["weekday"]["id"]),
        )
        await mine(client, account)
        second = {pattern["detector"]: pattern for pattern in await listed(client, account)}

        assert second["weekday"]["id"] == first["weekday"]["id"]
        assert second["weekday"]["epistemic_status"] == "user_rejected"
        assert second["exact-label"]["epistemic_status"] == "hypothesis"

    async def test_an_off_weekday_occurrence_lapses_only_the_calendar_claim(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await thursday_recurrence(client, pool, account)
        await mine(client, account)

        friday = await entry(client, account, DAY_ONE + timedelta(days=26))
        await inferred(pool, account, friday, "drained")
        await mine(client, account)

        patterns = await listed(client, account)
        assert [(pattern["detector"], pattern["label"]) for pattern in patterns] == [
            ("exact-label", "drained")
        ]


class TestLagPersistence:
    async def test_a_lag_finding_persists_its_pairs_without_claiming_causation(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        source_offsets = (0, 8, 17, 27)
        (
            source_observations,
            target_observations,
            source_nodes,
            target_nodes,
        ) = await lag_journal(client, pool, account, source_offsets=source_offsets)

        await mine(client, account)
        lag_patterns = [
            pattern for pattern in await listed(client, account) if pattern["detector"] == "lag"
        ]

        assert len(lag_patterns) == 1
        pattern = lag_patterns[0]
        assert pattern["label"] == (
            "sleeping badly came up 1 day before foggy · 4 of 4 times (UTC)"
        )
        assert all(
            causal_term not in pattern["label"].lower()
            for causal_term in ("because", "cause", "trigger", "leads to", "makes", "due to")
        )
        assert pattern["occurrences"] == 4
        assert pattern["distinct_days"] == 4
        assert pattern["extractor"] == "lag-v0.1"

        pattern_id = UUID(pattern["id"])
        stored_pattern = await pool.fetchrow(
            """
            SELECT n.kind, n.extractor, p.occurrences, p.distinct_days
            FROM graph_nodes n
            JOIN patterns p ON p.node_id = n.id
            WHERE n.id = $1
            """,
            pattern_id,
        )
        assert dict(stored_pattern) == {
            "kind": "Pattern",
            "extractor": "lag-v0.1",
            "occurrences": 4,
            "distinct_days": 4,
        }

        cited = await pool.fetch(
            "SELECT observation_id FROM node_provenance WHERE node_id = $1",
            pattern_id,
        )
        assert {row["observation_id"] for row in cited} == {
            *source_observations,
            *target_observations,
        }

        matches = await pool.fetch(
            """
            SELECT source_observation_id, target_observation_id,
                   lag_days, source_day, target_day
            FROM pattern_lag_matches
            WHERE pattern_id = $1
            """,
            pattern_id,
        )
        expected_matches = {
            (
                source_observation,
                target_observation,
                1,
                (DAY_ONE + timedelta(days=offset)).date(),
                (DAY_ONE + timedelta(days=offset + 1)).date(),
            )
            for offset, source_observation, target_observation in zip(
                source_offsets,
                source_observations,
                target_observations,
                strict=True,
            )
        }
        assert {
            (
                row["source_observation_id"],
                row["target_observation_id"],
                row["lag_days"],
                row["source_day"],
                row["target_day"],
            )
            for row in matches
        } == expected_matches

        precedence_edges = await pool.fetch(
            """
            SELECT kind
            FROM graph_edges
            WHERE user_id = $1
              AND (
                (from_id = ANY($2::uuid[]) AND to_id = ANY($3::uuid[]))
                OR (from_id = ANY($3::uuid[]) AND to_id = ANY($2::uuid[]))
              )
            """,
            account.user_id,
            source_nodes,
            target_nodes,
        )
        assert precedence_edges == []

    async def test_remining_a_lag_replaces_stale_pair_evidence(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        source_observations, target_observations, source_nodes, _ = await lag_journal(
            client,
            pool,
            account,
            source_offsets=(0, 8, 17, 27, 38),
            span=43,
        )

        await mine(client, account)
        first_lag = next(
            pattern for pattern in await listed(client, account) if pattern["detector"] == "lag"
        )
        pattern_id = UUID(first_lag["id"])

        await pool.execute(
            "UPDATE graph_nodes SET epistemic_status = 'user_rejected' WHERE id = $1",
            source_nodes[0],
        )
        second_mine = await mine(client, account)
        second_lag = next(
            pattern for pattern in await listed(client, account) if pattern["detector"] == "lag"
        )

        current_pairs = set(zip(source_observations[1:], target_observations[1:], strict=True))
        stored_pairs = await pool.fetch(
            """
            SELECT source_observation_id, target_observation_id
            FROM pattern_lag_matches
            WHERE pattern_id = $1
            """,
            pattern_id,
        )
        cited = await pool.fetch(
            "SELECT observation_id FROM node_provenance WHERE node_id = $1",
            pattern_id,
        )

        assert second_lag["id"] == first_lag["id"]
        assert second_lag["occurrences"] == 4
        assert second_mine["added"] == 0
        assert second_mine["confirmed"] == 3
        assert {
            (row["source_observation_id"], row["target_observation_id"]) for row in stored_pairs
        } == current_pairs
        assert {row["observation_id"] for row in cited} == {
            *source_observations[1:],
            *target_observations[1:],
        }


class TestWithinDayOrder:
    """The finest-grained ordering claim, and the only one that reads the clock.

    Everything else here truncates to a day. This one needs the moment, so what
    matters over HTTP is that the timestamp survives capture, that the day it
    falls in is the writer's own, and that the claim still refuses to say why.
    """

    async def test_a_morning_thing_before_an_evening_thing(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        for week in range(4):
            day = DAY_ONE + timedelta(days=week * 7)
            morning_at = day.replace(hour=7, minute=30)
            morning = await entry(client, account, morning_at)
            await written_in_the_moment(pool, morning, morning_at)
            await inferred(pool, account, morning, "wired")
            evening_at = day.replace(hour=19, minute=0)
            evening = await entry(client, account, evening_at)
            await written_in_the_moment(pool, evening, evening_at)
            await inferred(pool, account, evening, "skipping dinner", kind="Activity")

        await mine(client, account)
        found = [
            pattern
            for pattern in await listed(client, account)
            if pattern["detector"] == "same-day-order"
        ]

        assert len(found) == 1
        assert found[0]["label"] == (
            "wired came up earlier in the day than skipping dinner · "
            "on 4 of the 4 days both came up, about 12 hours apart (UTC)"
        )
        assert found[0]["extractor"] == "sameday-v0.1"
        for causal in ("because", "cause", "trigger", "leads to", "due to"):
            assert causal not in found[0]["label"].lower()

    async def test_the_day_the_moments_belong_to_is_the_writers_own(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # An afternoon and a late evening in New York straddle UTC midnight, so
        # in UTC they are two different days and the pair never shares one.
        # Counting in the writer's calendar is what makes the ordering visible
        # at all — the detector is not merely more accurate here, it is the
        # difference between a finding and silence.
        new_york = "America/New_York"
        for week in range(4):
            day = DAY_ONE + timedelta(days=week * 7)
            afternoon_at = day.replace(hour=21, minute=0)
            afternoon = await entry(client, account, afternoon_at, timezone=new_york)
            await written_in_the_moment(pool, afternoon, afternoon_at)
            await inferred(pool, account, afternoon, "wired")
            evening_at = (day + timedelta(days=1)).replace(hour=2, minute=0)
            evening = await entry(client, account, evening_at, timezone=new_york)
            await written_in_the_moment(pool, evening, evening_at)
            await inferred(pool, account, evening, "skipping dinner", kind="Activity")

        await mine(client, account)
        found = [
            pattern
            for pattern in await listed(client, account)
            if pattern["detector"] == "same-day-order"
        ]

        assert len(found) == 1
        # Every entry recorded its zone, so the claim drops the hedge as well.
        assert found[0]["label"] == (
            "wired came up earlier in the day than skipping dinner · "
            "on 4 of the 4 days both came up, about 5 hours apart"
        )


class TestStatedVersusRecorded:
    """The detector that reports a gap rather than a repetition.

    It is the only claim here built on an absence, so what matters over HTTP is
    that it arrives as arithmetic — two counts and an overlap — carrying its own
    detector identity, its own evidence, and no verdict about the person.
    """

    async def test_something_named_and_something_done_that_stay_apart(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        stated = (0, 2, 4, 6, 8, 10, 12, 14, 16)
        recorded = (1, 3, 5, 7, 9, 11, 13, 15, 17)
        for offset in range(24):
            observation_id = await entry(client, account, DAY_ONE + timedelta(days=offset))
            if offset in stated:
                await inferred(pool, account, observation_id, "rest", kind="Value")
            if offset in recorded:
                await inferred(pool, account, observation_id, "working late", kind="Activity")

        await mine(client, account)
        found = [
            pattern
            for pattern in await listed(client, account)
            if pattern["detector"] == "stated-vs-recorded"
        ]

        assert len(found) == 1
        pattern = found[0]
        assert pattern["label"] == (
            "rest came up on 9 days, working late on 9 days, never in the same entry (UTC)"
        )
        assert pattern["extractor"] == "tension-v0.1"
        # `occurrences` means what it means everywhere else — the entries this
        # rests on. What happened zero times is the overlap, and that is in the
        # label rather than smuggled into a count the schema reserves for weight.
        assert pattern["occurrences"] == len(stated) + len(recorded)
        assert pattern["distinct_days"] == len(stated) + len(recorded)

        # It cites every entry behind both sides, like any other inference here.
        cited = await pool.fetchval(
            "SELECT count(*) FROM node_provenance WHERE node_id = $1",
            UUID(pattern["id"]),
        )
        assert cited == len(stated) + len(recorded)

    async def test_it_never_tells_someone_they_are_failing(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        stated = (0, 2, 4, 6, 8, 10, 12, 14, 16)
        recorded = (1, 3, 5, 7, 9, 11, 13, 15, 17)
        for offset in range(24):
            observation_id = await entry(client, account, DAY_ONE + timedelta(days=offset))
            if offset in stated:
                await inferred(pool, account, observation_id, "rest", kind="Value")
            if offset in recorded:
                await inferred(pool, account, observation_id, "working late", kind="Activity")

        await mine(client, account)
        label = next(
            pattern["label"]
            for pattern in await listed(client, account)
            if pattern["detector"] == "stated-vs-recorded"
        ).lower()

        for judgement in (
            "should",
            "but ",
            "despite",
            "even though",
            "fail",
            "neglect",
            "ignore",
            "avoid",
            "instead",
        ):
            assert judgement not in label

    async def test_a_rejected_reading_stops_feeding_the_gap(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # Disagreeing with a reading has to remove it from a claim built on its
        # absence too, not only from claims built on its presence.
        stated = (0, 2, 4, 6, 8, 10, 12, 14, 16)
        recorded = (1, 3, 5, 7, 9, 11, 13, 15, 17)
        value_nodes = []
        for offset in range(24):
            observation_id = await entry(client, account, DAY_ONE + timedelta(days=offset))
            if offset in stated:
                value_nodes.append(
                    await inferred(pool, account, observation_id, "rest", kind="Value")
                )
            if offset in recorded:
                await inferred(pool, account, observation_id, "working late", kind="Activity")

        await mine(client, account)
        assert any(p["detector"] == "stated-vs-recorded" for p in await listed(client, account))

        # Six of the nine "rest" readings were wrong, leaving too few to claim a
        # separation from.
        await pool.execute(
            "UPDATE graph_nodes SET epistemic_status = 'user_rejected' WHERE id = ANY($1::uuid[])",
            value_nodes[:6],
        )
        await mine(client, account)

        assert not any(p["detector"] == "stated-vs-recorded" for p in await listed(client, account))


class TestOrderedEvidence:
    """`GET /v1/patterns/{id}/ordering` — the entries behind an ordered finding.

    The pattern label states the ordering as a sentence. This endpoint is what
    lets someone check it: the actual entries, in the order they were written,
    with the gap between them. Without it, "came up a day before" is a claim
    about a person that they cannot audit.
    """

    async def test_it_returns_each_occasion_as_the_two_entries_it_rests_on(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        source_offsets = (0, 8, 17, 27)
        source_observations, target_observations, _, _ = await lag_journal(
            client, pool, account, source_offsets=source_offsets
        )
        await mine(client, account)
        pattern = next(p for p in await listed(client, account) if p["detector"] == "lag")

        response = await client.get(f"/v1/patterns/{pattern['id']}/ordering", headers=account.auth)

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["pattern_id"] == pattern["id"]
        assert body["label"] == pattern["label"]
        assert body["lag_days"] == 1
        # These entries never recorded a zone, so the days behind them are the
        # server's and the screen has to say so.
        assert body["utc_fallback"] is True
        # Oldest first: the point of the screen is to read the occasions as a
        # sequence, and a reverse-chronological list reads as a feed instead.
        assert [
            (occasion["source_day"], occasion["target_day"]) for occasion in body["occasions"]
        ] == [
            (
                (DAY_ONE + timedelta(days=offset)).date().isoformat(),
                (DAY_ONE + timedelta(days=offset + 1)).date().isoformat(),
            )
            for offset in source_offsets
        ]
        assert [
            [written["id"] for written in occasion["before"]] for occasion in body["occasions"]
        ] == [[str(observation_id)] for observation_id in source_observations]
        assert [
            [written["id"] for written in occasion["after"]] for occasion in body["occasions"]
        ] == [[str(observation_id)] for observation_id in target_observations]

        first = body["occasions"][0]["before"][0]
        assert first["content"] == f"an entry written at {DAY_ONE.isoformat()}"
        assert first["source"] == "text"

    async def test_zoned_evidence_drops_the_utc_caveat(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        source_offsets = (0, 8, 17, 27)
        for offset in range(32):
            observation_id = await entry(
                client,
                account,
                DAY_ONE + timedelta(days=offset),
                timezone="Europe/Stockholm",
            )
            if offset in source_offsets:
                await inferred(pool, account, observation_id, "sleeping badly", kind="Activity")
            if offset - 1 in source_offsets:
                await inferred(pool, account, observation_id, "foggy", kind="Emotion")

        await mine(client, account)
        pattern = next(p for p in await listed(client, account) if p["detector"] == "lag")
        body = (
            await client.get(f"/v1/patterns/{pattern['id']}/ordering", headers=account.auth)
        ).json()

        assert body["utc_fallback"] is False
        assert pattern["label"] == "sleeping badly came up 1 day before foggy · 4 of 4 times"

    async def test_a_pattern_from_another_detector_has_no_ordering(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # Exact-label recurrence makes no claim about order, so there is nothing
        # honest to show here — better a 404 than an empty list implying there
        # could have been ordered evidence.
        await recurring(client, pool, account, "dread")
        await mine(client, account)
        pattern = next(p for p in await listed(client, account) if p["detector"] == "exact-label")

        response = await client.get(f"/v1/patterns/{pattern['id']}/ordering", headers=account.auth)

        assert response.status_code == 404

    async def test_ordering_is_private_to_its_user(
        self,
        client: AsyncClient,
        pool: asyncpg.Pool,
        account: Account,
        other_account: Account,
    ):
        await lag_journal(client, pool, account)
        await mine(client, account)
        pattern = next(p for p in await listed(client, account) if p["detector"] == "lag")

        response = await client.get(
            f"/v1/patterns/{pattern['id']}/ordering", headers=other_account.auth
        )

        assert response.status_code == 404


class TestWhatTheDatabaseEnforces:
    async def test_a_pattern_is_stored_as_an_inference(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await recurring(client, pool, account, "dread", confidence=0.6)
        await mine(client, account)

        row = await pool.fetchrow(
            "SELECT * FROM graph_nodes WHERE user_id = $1 AND kind = 'Pattern'",
            account.user_id,
        )
        # The two-tier CHECK would have rejected the insert otherwise, but assert
        # it explicitly: a Pattern is a claim, and claims carry all three.
        assert row["confidence"] == pytest.approx(0.6)
        assert row["epistemic_status"] == "hypothesis"
        assert row["extractor"] == "patterns-v0.1"

    async def test_a_pattern_cites_every_observation_it_rests_on(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        observations = await recurring(client, pool, account, "dread")
        await mine(client, account)

        cited = await pool.fetch(
            """
            SELECT p.observation_id FROM node_provenance p
            JOIN graph_nodes n ON n.id = p.node_id
            WHERE n.user_id = $1 AND n.kind = 'Pattern'
            """,
            account.user_id,
        )
        # All three, not a representative one. A pattern citing a single entry
        # would be unfalsifiable from the explain screen.
        assert {row["observation_id"] for row in cited} == set(observations)

    async def test_the_contributing_nodes_support_the_pattern(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await recurring(client, pool, account, "dread")
        await mine(client, account)

        edges = await pool.fetch(
            """
            SELECT e.kind, e.to_id, n.kind AS target_kind
            FROM graph_edges e
            JOIN graph_nodes n ON n.id = e.to_id
            WHERE e.user_id = $1 AND e.kind = 'SUPPORTS'
            """,
            account.user_id,
        )
        assert len(edges) == 3
        # Evidence points at the claim, not the other way round.
        assert {row["target_kind"] for row in edges} == {"Pattern"}

    async def test_pattern_edges_carry_provenance_too(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await recurring(client, pool, account, "dread")
        await mine(client, account)

        orphans = await pool.fetchval(
            """
            SELECT count(*) FROM graph_edges e
            WHERE e.user_id = $1
              AND NOT EXISTS (SELECT 1 FROM edge_provenance p WHERE p.edge_id = e.id)
            """,
            account.user_id,
        )
        assert orphans == 0


class TestRemining:
    async def test_remining_replaces_rather_than_accumulates(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await recurring(client, pool, account, "dread")
        await mine(client, account)
        await mine(client, account)

        patterns = await listed(client, account)
        assert len(patterns) == 1
        assert patterns[0]["occurrences"] == 3

    async def test_a_pattern_that_no_longer_holds_disappears(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await recurring(client, pool, account, "dread")
        await mine(client, account)
        assert len(await listed(client, account)) == 1

        # The person deletes the entries the pattern rested on. It must stop being
        # claimed, not linger as something nobody can retract.
        await pool.execute(
            "UPDATE graph_nodes SET deleted_at = now() WHERE user_id = $1 AND kind = 'Observation'",
            account.user_id,
        )
        await mine(client, account)
        assert await listed(client, account) == []

    async def test_new_entries_strengthen_an_existing_pattern(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await recurring(client, pool, account, "dread")
        await mine(client, account)
        await recurring(client, pool, account, "dread", days=(5, 6))
        await mine(client, account)

        patterns = await listed(client, account)
        assert len(patterns) == 1
        assert patterns[0]["occurrences"] == 5


class TestDurableIdentity:
    """A pattern is the same claim from one run to the next.

    Re-mining used to tombstone every Pattern and insert new ones, which meant a
    pattern's id, its age, and any verdict the person had passed on it were all
    discarded every six hours. These tests pin down the three consequences of
    that having changed.
    """

    async def test_a_pattern_keeps_its_id_across_remining(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await recurring(client, pool, account, "dread")
        await mine(client, account)
        first = (await listed(client, account))[0]

        await mine(client, account)
        assert (await listed(client, account))[0]["id"] == first["id"]

    async def test_age_is_measured_from_first_sighting_not_last_run(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await recurring(client, pool, account, "dread")
        await mine(client, account)
        first_seen = (await listed(client, account))[0]["first_seen_at"]

        # More evidence arrives and the pattern is re-derived. It is still the
        # same pattern, so it does not get to be new again.
        await recurring(client, pool, account, "dread", days=(5, 6))
        await mine(client, account)

        patterns = await listed(client, account)
        assert patterns[0]["first_seen_at"] == first_seen
        assert patterns[0]["occurrences"] == 5

    async def test_a_rejected_pattern_stays_rejected(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await recurring(client, pool, account, "dread")
        await mine(client, account)
        pattern_id = (await listed(client, account))[0]["id"]

        # The person says this is not true of them.
        await pool.execute(
            "UPDATE graph_nodes SET epistemic_status = 'user_rejected' WHERE id = $1",
            UUID(pattern_id),
        )

        # Recurring again is not an argument. Re-mining must not launder the
        # rejection away by re-asserting the claim as a fresh hypothesis.
        await recurring(client, pool, account, "dread", days=(5, 6))
        await mine(client, account)

        status = await pool.fetchval(
            "SELECT epistemic_status FROM graph_nodes WHERE id = $1", UUID(pattern_id)
        )
        assert status == "user_rejected"

    async def test_a_pattern_that_returns_is_the_same_pattern(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        observations = await recurring(client, pool, account, "dread")
        await mine(client, account)
        original = (await listed(client, account))[0]

        # It stops holding: the entries behind it go away.
        await pool.execute(
            "UPDATE graph_nodes SET deleted_at = now() WHERE id = ANY($1::uuid[])",
            observations,
        )
        await mine(client, account)
        assert await listed(client, account) == []

        # Months later the same recurrence comes back. It is the thing returning,
        # not a discovery, and the record should say so.
        await pool.execute(
            "UPDATE graph_nodes SET deleted_at = NULL WHERE id = ANY($1::uuid[])",
            observations,
        )
        result = await mine(client, account)

        returned = (await listed(client, account))[0]
        assert returned["id"] == original["id"]
        assert returned["first_seen_at"] == original["first_seen_at"]
        assert result["added"] == 0
        assert result["confirmed"] == 1

    async def test_every_pattern_records_which_method_claimed_it(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await recurring(client, pool, account, "dread")
        await mine(client, account)
        assert (await listed(client, account))[0]["detector"] == "exact-label"

    async def test_a_new_pattern_is_reported_separately_from_a_standing_one(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await recurring(client, pool, account, "dread")
        assert await mine(client, account) == {
            "patterns": 1,
            "added": 1,
            "confirmed": 0,
            "considered": 3,
        }

        # Nothing new was found the second time, and saying "1 pattern" again
        # would read as a fresh finding rather than the same one still holding.
        await recurring(client, pool, account, "hollowed out")
        second = await mine(client, account)
        assert second["added"] == 1
        assert second["confirmed"] == 1


class TestConfidence:
    async def test_a_pattern_is_no_stronger_than_its_weakest_evidence(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        first = await entry(client, account, DAY_ONE)
        second = await entry(client, account, DAY_ONE + timedelta(days=1))
        third = await entry(client, account, DAY_ONE + timedelta(days=2))
        await inferred(pool, account, first, "dread", confidence=0.9)
        # Above MIN_CONFIDENCE, and not sitting on it: `confidence` is a REAL
        # column, so a value written exactly at the floor reads back a hair under
        # it. This test is about the arithmetic, not the reporting threshold.
        await inferred(pool, account, second, "dread", confidence=0.4)
        await inferred(pool, account, third, "dread", confidence=0.9)

        await mine(client, account)
        pattern = (await listed(client, account))[0]
        assert pattern["confidence"] == pytest.approx(0.4)
        # And it is rendered as the guess it is.
        assert pattern["tentative"] is True


class TestIsolation:
    async def test_patterns_are_private_to_their_user(
        self,
        client: AsyncClient,
        pool: asyncpg.Pool,
        account: Account,
        other_account: Account,
    ):
        await recurring(client, pool, account, "dread")
        await mine(client, account)
        assert await listed(client, other_account) == []

    async def test_mining_never_crosses_users(
        self,
        client: AsyncClient,
        pool: asyncpg.Pool,
        account: Account,
        other_account: Account,
    ):
        # Two entries each. Neither reaches the threshold alone, and they must not
        # be pooled into one.
        await recurring(client, pool, account, "dread", days=(0, 1))
        await recurring(client, pool, other_account, "dread", days=(2, 3))
        assert (await mine(client, account))["patterns"] == 0
        assert (await mine(client, other_account))["patterns"] == 0

    async def test_remining_does_not_clear_another_users_patterns(
        self,
        client: AsyncClient,
        pool: asyncpg.Pool,
        account: Account,
        other_account: Account,
    ):
        await recurring(client, pool, account, "dread")
        await recurring(client, pool, other_account, "rest")
        await mine(client, account)
        await mine(client, other_account)
        assert len(await listed(client, account)) == 1
        assert len(await listed(client, other_account)) == 1


class TestAuth:
    async def test_listing_requires_a_token(self, client: AsyncClient):
        assert (await client.get("/v1/patterns")).status_code == 401

    async def test_mining_requires_a_token(self, client: AsyncClient):
        assert (await client.post("/v1/patterns/mine")).status_code == 401

    async def test_ordering_requires_a_token(self, client: AsyncClient):
        assert (await client.get(f"/v1/patterns/{uuid4()}/ordering")).status_code == 401
