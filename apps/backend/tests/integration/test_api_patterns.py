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


async def entry(client: AsyncClient, account: Account, captured_at: datetime) -> UUID:
    observation_id = uuid4()
    response = await client.post(
        "/v1/observations",
        headers=account.auth,
        json={
            "id": str(observation_id),
            "content": f"an entry written at {captured_at.isoformat()}",
            "source": "text",
            "captured_at": captured_at.isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return observation_id


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
        assert patterns["weekday"]["label"] == "drained · Thursdays"
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
