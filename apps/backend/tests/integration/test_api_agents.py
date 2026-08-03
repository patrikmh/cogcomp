"""Background agents against a real database.

These agents change someone's graph without being asked, so most of what is worth
testing is not "does it work" but "can the person find out what it did", and "does
a failure leave a mess".
"""

import asyncio
from datetime import UTC, datetime, timedelta
from time import monotonic
from uuid import UUID, uuid4

import asyncpg
import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account
from tlon.agents.consolidation import ConsolidationAgent
from tlon.agents.runner import recent_runs, run_agent

pytestmark = [pytest.mark.anyio, pytest.mark.integration]

DAY_ONE = datetime(2026, 4, 1, 9, 0, tzinfo=UTC)


async def entry(client: AsyncClient, account: Account, at: datetime) -> UUID:
    observation_id = uuid4()
    response = await client.post(
        "/v1/observations",
        headers=account.auth,
        json={
            "id": str(observation_id),
            "content": f"an entry at {at.isoformat()}",
            "source": "text",
            "captured_at": at.isoformat(),
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
    confidence: float = 0.7,
) -> UUID:
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


class TestTheRunLog:
    """The transparency surface. This is the reason background work is defensible."""

    async def test_a_run_is_recorded(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await client.post("/v1/agents/patterns/run", headers=account.auth)
        runs = await recent_runs(pool, account.user_id)
        assert [r["agent"] for r in runs] == ["patterns"]

    async def test_it_records_what_the_person_can_check(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await client.post("/v1/agents/patterns/run", headers=account.auth)
        run = (await recent_runs(pool, account.user_id))[0]
        assert run["version"]
        assert run["trigger"] == "manual"
        assert run["finished_at"] is not None

    async def test_a_scheduled_run_is_distinguishable_from_one_you_asked_for(
        self, pool: asyncpg.Pool, account: Account
    ):
        # When someone is looking at a conclusion they do not recognise, whether
        # they asked for it is the first thing they need to know.
        await run_agent(pool, ConsolidationAgent(), account.user_id, trigger="scheduled")
        assert (await recent_runs(pool, account.user_id))[0]["trigger"] == "scheduled"

    async def test_doing_nothing_is_recorded_too(self, pool: asyncpg.Pool, account: Account):
        # Silently doing nothing is indistinguishable, from outside, from being
        # broken.
        await run_agent(pool, ConsolidationAgent(), account.user_id, trigger="scheduled")
        run = (await recent_runs(pool, account.user_id))[0]
        assert run["status"] == "skipped"
        assert run["summary"]["reason"]

    async def test_the_log_holds_counts_not_content(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # The run log must not become a second copy of someone's private writing.
        secret = "something I would not want duplicated into a log"
        observation_id = await entry(client, account, DAY_ONE)
        await pool.execute(
            "UPDATE observations SET content = $2 WHERE node_id = $1",
            observation_id,
            secret,
        )
        await inferred(pool, account, observation_id, secret)
        await client.post("/v1/agents/run", headers=account.auth)

        for run in await recent_runs(pool, account.user_id):
            assert secret not in str(run["summary"])

    async def test_a_failing_agent_is_recorded_with_its_reason(
        self, pool: asyncpg.Pool, account: Account
    ):
        class Broken:
            name = "broken"
            version = "v0"
            cadence_seconds = 60

            async def should_run(self, pool, user_id):
                return True

            async def run(self, pool, user_id):
                raise RuntimeError("deliberately broken")

        result = await run_agent(pool, Broken(), account.user_id)
        assert result["status"] == "failed"

        run = (await recent_runs(pool, account.user_id))[0]
        assert run["status"] == "failed"
        # A failure with no reason is not something anyone can act on — and the
        # CHECK constraint would have rejected the row without one.
        assert "deliberately broken" in run["error"]

    async def test_one_agent_failing_does_not_stop_the_others(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        from tlon.agents.runner import run_all

        class Broken:
            name = "broken"
            version = "v0"
            cadence_seconds = 60

            async def should_run(self, pool, user_id):
                return True

            async def run(self, pool, user_id):
                raise RuntimeError("nope")

        results = await run_all(
            pool, [Broken(), ConsolidationAgent()], account.user_id, trigger="scheduled"
        )
        assert results[0]["status"] == "failed"
        assert results[1]["status"] in {"skipped", "succeeded"}

    async def test_runs_are_private_to_their_user(
        self, client: AsyncClient, account: Account, other_account: Account
    ):
        await client.post("/v1/agents/patterns/run", headers=account.auth)
        theirs = await client.get("/v1/agents/runs", headers=other_account.auth)
        assert theirs.json() == []


class TestConsolidation:
    async def test_duplicates_are_merged(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        first = await entry(client, account, DAY_ONE)
        second = await entry(client, account, DAY_ONE + timedelta(days=1))
        await inferred(pool, account, first, "tired")
        await inferred(pool, account, second, "Tired.")

        result = await run_agent(pool, ConsolidationAgent(), account.user_id, force=True)
        assert result["summary"]["nodes_merged"] == 1

        alive = await pool.fetchval(
            "SELECT count(*) FROM graph_nodes "
            "WHERE user_id = $1 AND kind = 'Emotion' AND deleted_at IS NULL",
            account.user_id,
        )
        assert alive == 1

    async def test_the_survivor_inherits_every_observation(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # Nothing is lost. "Why does this say four mentions when I remember two
        # entries" has to have an answer.
        first = await entry(client, account, DAY_ONE)
        second = await entry(client, account, DAY_ONE + timedelta(days=1))
        await inferred(pool, account, first, "tired")
        await inferred(pool, account, second, "tired")

        await run_agent(pool, ConsolidationAgent(), account.user_id, force=True)
        cited = await pool.fetch(
            """
            SELECT p.observation_id FROM node_provenance p
            JOIN graph_nodes n ON n.id = p.node_id
            WHERE n.user_id = $1 AND n.kind = 'Emotion' AND n.deleted_at IS NULL
            """,
            account.user_id,
        )
        assert {row["observation_id"] for row in cited} == {first, second}

    async def test_concurrent_runs_record_one_merge(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        first = await entry(client, account, DAY_ONE)
        second = await entry(client, account, DAY_ONE + timedelta(days=1))
        await inferred(pool, account, first, "tired")
        await inferred(pool, account, second, "tired")

        entered = 0
        both_discovered = asyncio.Event()

        class Coordinated(ConsolidationAgent):
            async def _merge(self, pool, user_id, group):
                nonlocal entered
                entered += 1
                if entered == 2:
                    both_discovered.set()
                await both_discovered.wait()
                return await super()._merge(pool, user_id, group)

        agent = Coordinated()
        results = await asyncio.gather(
            run_agent(pool, agent, account.user_id, force=True),
            run_agent(pool, agent, account.user_id, force=True),
        )

        assert {result["summary"]["nodes_merged"] for result in results} == {0, 1}
        assert (
            await pool.fetchval(
                "SELECT count(*) FROM node_merges WHERE user_id = $1", account.user_id
            )
            == 1
        )
        assert (
            await pool.fetchval(
                "SELECT count(*) FROM graph_nodes "
                "WHERE user_id = $1 AND kind = 'Emotion' AND deleted_at IS NULL",
                account.user_id,
            )
            == 1
        )

    async def test_the_merge_is_recorded(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        first = await entry(client, account, DAY_ONE)
        second = await entry(client, account, DAY_ONE + timedelta(days=1))
        kept_or_merged = {
            await inferred(pool, account, first, "tired"),
            await inferred(pool, account, second, "tired"),
        }

        await run_agent(pool, ConsolidationAgent(), account.user_id, force=True)
        row = await pool.fetchrow(
            "SELECT kept_id, merged_id FROM node_merges WHERE user_id = $1",
            account.user_id,
        )
        assert {row["kept_id"], row["merged_id"]} == kept_or_merged

    async def test_the_absorbed_node_is_kept_as_a_tombstone(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # Someone asking what happened to a node deserves better than a missing row.
        first = await entry(client, account, DAY_ONE)
        second = await entry(client, account, DAY_ONE + timedelta(days=1))
        await inferred(pool, account, first, "tired")
        await inferred(pool, account, second, "tired")

        await run_agent(pool, ConsolidationAgent(), account.user_id, force=True)
        gone = await pool.fetchval(
            "SELECT count(*) FROM graph_nodes WHERE user_id = $1 AND deleted_at IS NOT NULL",
            account.user_id,
        )
        assert gone == 1

    async def test_merging_keeps_the_strongest_confidence(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # Merging does not derive a new claim — it recognises that two records
        # were always the same claim. The "never exceed your weakest input" rule
        # governs derivation, and this is not derivation.
        first = await entry(client, account, DAY_ONE)
        second = await entry(client, account, DAY_ONE + timedelta(days=1))
        await inferred(pool, account, first, "tired", confidence=0.4)
        await inferred(pool, account, second, "tired", confidence=0.9)

        await run_agent(pool, ConsolidationAgent(), account.user_id, force=True)
        confidence = await pool.fetchval(
            "SELECT confidence FROM graph_nodes "
            "WHERE user_id = $1 AND kind = 'Emotion' AND deleted_at IS NULL",
            account.user_id,
        )
        assert confidence == pytest.approx(0.9)

    async def test_different_kinds_are_not_merged(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        first = await entry(client, account, DAY_ONE)
        await inferred(pool, account, first, "rest", kind="Need")
        await inferred(pool, account, first, "rest", kind="Activity")

        await run_agent(pool, ConsolidationAgent(), account.user_id, force=True)
        alive = await pool.fetchval(
            "SELECT count(*) FROM graph_nodes "
            "WHERE user_id = $1 AND deleted_at IS NULL AND kind IN ('Need','Activity')",
            account.user_id,
        )
        assert alive == 2

    async def test_different_words_are_not_merged(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # Deciding that "tired" and "worn out" are the same thing is an
        # interpretation, and a wrong one rewrites what someone said.
        first = await entry(client, account, DAY_ONE)
        await inferred(pool, account, first, "tired")
        await inferred(pool, account, first, "worn out")

        await run_agent(pool, ConsolidationAgent(), account.user_id, force=True)
        alive = await pool.fetchval(
            "SELECT count(*) FROM graph_nodes "
            "WHERE user_id = $1 AND kind = 'Emotion' AND deleted_at IS NULL",
            account.user_id,
        )
        assert alive == 2

    async def test_observations_are_never_merged(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # Two entries with identical text are still two entries. Collapsing them
        # would erase the fact that the person said it twice, which is the very
        # thing pattern mining counts.
        for offset in range(3):
            observation_id = uuid4()
            await client.post(
                "/v1/observations",
                headers=account.auth,
                json={
                    "id": str(observation_id),
                    "content": "the same words",
                    "source": "text",
                    "captured_at": (DAY_ONE + timedelta(days=offset)).isoformat(),
                },
            )

        await run_agent(pool, ConsolidationAgent(), account.user_id, force=True)
        alive = await pool.fetchval(
            "SELECT count(*) FROM graph_nodes "
            "WHERE user_id = $1 AND kind = 'Observation' AND deleted_at IS NULL",
            account.user_id,
        )
        assert alive == 3

    async def test_it_never_leaves_a_self_loop(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # Repointing an edge from a duplicate onto its survivor would otherwise
        # create an edge from a node to itself, which the schema forbids — so this
        # would fail as a constraint violation rather than a wrong answer.
        first = await entry(client, account, DAY_ONE)
        a = await inferred(pool, account, first, "tired")
        b = await inferred(pool, account, first, "tired")
        await pool.execute(
            """
            INSERT INTO graph_edges
                (id, user_id, kind, from_id, to_id, note,
                 confidence, epistemic_status, extractor)
            VALUES ($1, $2, 'RELATES_TO', $3, $4, $5, 0.5, 'hypothesis', 'test')
            """,
            uuid4(),
            account.user_id,
            a,
            b,
            # RELATES_TO requires a note, and the CHECK fires on insert — there is
            # no writing it in afterwards.
            "a link between the duplicates",
        )

        result = await run_agent(pool, ConsolidationAgent(), account.user_id, force=True)
        assert result["status"] == "succeeded"

        loops = await pool.fetchval(
            "SELECT count(*) FROM graph_edges WHERE user_id = $1 AND from_id = to_id",
            account.user_id,
        )
        assert loops == 0

    async def test_selection_wins_when_it_races_consolidation(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        first = await entry(client, account, DAY_ONE)
        await inferred(pool, account, first, "a selected value", kind="Value")
        duplicate = await inferred(pool, account, first, "a selected value", kind="Value")

        # Hold the duplicate's row lock as a selection transaction would.
        # Consolidation must wait before its final selection check, rather than
        # checking first and allowing the selection to lose the race.
        conn = await pool.acquire()
        transaction = conn.transaction()
        await transaction.start()
        consolidation = None
        committed = False
        try:
            await conn.fetchrow("SELECT id FROM graph_nodes WHERE id = $1 FOR UPDATE", duplicate)

            consolidation = asyncio.create_task(ConsolidationAgent().run(pool, account.user_id))
            deadline = monotonic() + 2
            while monotonic() < deadline:
                waiting = await pool.fetchval(
                    """
                    SELECT count(*) FROM pg_stat_activity
                    WHERE datname = current_database() AND wait_event_type = 'Lock'
                    """
                )
                if waiting:
                    break
                await asyncio.sleep(0.01)
            else:
                raise AssertionError("consolidation did not wait for the selection lock")

            await conn.execute(
                """
                INSERT INTO identity_selections (id, user_id, node_id, status)
                VALUES ($1, $2, $3, 'selected')
                """,
                uuid4(),
                account.user_id,
                duplicate,
            )
            await transaction.commit()
            committed = True
            result = await consolidation
        finally:
            if consolidation is not None and not consolidation.done():
                consolidation.cancel()
                await consolidation
            if not committed:
                await transaction.rollback()
            await pool.release(conn)

        assert result.summary == {"groups": 1, "nodes_merged": 0}
        assert await pool.fetchval(
            "SELECT deleted_at IS NULL FROM graph_nodes WHERE id = $1", duplicate
        )

    async def test_reselection_wins_when_patch_races_consolidation(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        first = await entry(client, account, DAY_ONE)
        keeper = await inferred(pool, account, first, "a selected value", kind="Value")
        duplicate = await inferred(pool, account, first, "a selected value", kind="Value")

        selected = await client.post(
            "/v1/identity/selections",
            headers=account.auth,
            json={"node_id": str(duplicate)},
        )
        assert selected.status_code == 200
        removed = await client.patch(
            f"/v1/identity/selections/{duplicate}",
            headers=account.auth,
            json={"status": "removed"},
        )
        assert removed.status_code == 200

        # Hold the node lock, then queue the PATCH before consolidation. Once the
        # lock is released, the PATCH must reactivate the tombstone first; the
        # consolidation check then sees the selected membership and keeps it.
        conn = await pool.acquire()
        transaction = conn.transaction()
        await transaction.start()
        patch = None
        consolidation = None
        committed = False
        try:
            await conn.fetchrow("SELECT id FROM graph_nodes WHERE id = $1 FOR UPDATE", duplicate)
            patch = asyncio.create_task(
                client.patch(
                    f"/v1/identity/selections/{duplicate}",
                    headers=account.auth,
                    json={"status": "selected"},
                )
            )
            deadline = monotonic() + 2
            while monotonic() < deadline:
                waiting = await pool.fetchval(
                    """
                    SELECT count(*) FROM pg_stat_activity
                    WHERE datname = current_database() AND wait_event_type = 'Lock'
                    """
                )
                if waiting:
                    break
                await asyncio.sleep(0.01)
            else:
                raise AssertionError("PATCH did not wait for the node lock")

            consolidation = asyncio.create_task(ConsolidationAgent().run(pool, account.user_id))
            deadline = monotonic() + 2
            while monotonic() < deadline:
                waiting = await pool.fetchval(
                    """
                    SELECT count(*) FROM pg_stat_activity
                    WHERE datname = current_database() AND wait_event_type = 'Lock'
                    """
                )
                if waiting >= 2:
                    break
                await asyncio.sleep(0.01)
            else:
                raise AssertionError("consolidation did not wait behind the PATCH")

            await transaction.commit()
            committed = True
            patch_response, result = await asyncio.gather(patch, consolidation)
        finally:
            if patch is not None and not patch.done():
                patch.cancel()
                await patch
            if consolidation is not None and not consolidation.done():
                consolidation.cancel()
                await consolidation
            if not committed:
                await transaction.rollback()
            await pool.release(conn)

        assert patch_response.status_code == 200, patch_response.text
        assert result.summary == {"groups": 1, "nodes_merged": 0}
        assert await pool.fetchval(
            "SELECT deleted_at IS NULL FROM graph_nodes WHERE id = $1", duplicate
        )
        assert (
            await pool.fetchval(
                "SELECT status FROM identity_selections WHERE user_id = $1 AND node_id = $2",
                account.user_id,
                duplicate,
            )
            == "selected"
        )
        assert await pool.fetchval(
            "SELECT deleted_at IS NULL FROM graph_nodes WHERE id = $1", keeper
        )

    async def test_consolidation_never_crosses_users(
        self,
        client: AsyncClient,
        pool: asyncpg.Pool,
        account: Account,
        other_account: Account,
    ):
        mine = await entry(client, account, DAY_ONE)
        theirs = await entry(client, other_account, DAY_ONE)
        await inferred(pool, account, mine, "tired")
        await inferred(pool, other_account, theirs, "tired")

        await run_agent(pool, ConsolidationAgent(), account.user_id, force=True)
        alive = await pool.fetchval(
            "SELECT count(*) FROM graph_nodes "
            "WHERE user_id = $1 AND kind = 'Emotion' AND deleted_at IS NULL",
            other_account.user_id,
        )
        assert alive == 1


class TestOrdering:
    async def test_consolidation_runs_before_pattern_mining(self):
        # Mining first would count the same thing twice and report a pattern that
        # consolidation is about to dissolve.
        from tlon.agents import REGISTRY

        names = [agent.name for agent in REGISTRY]
        assert names.index("consolidation") < names.index("patterns")


class TestScheduling:
    async def test_an_agent_skips_when_there_is_nothing_new(
        self, pool: asyncpg.Pool, account: Account
    ):
        result = await run_agent(pool, ConsolidationAgent(), account.user_id, trigger="scheduled")
        assert result["status"] == "skipped"

    async def test_asking_directly_always_runs_it(self, client: AsyncClient, account: Account):
        # Two different skips live here and they must stay distinguishable. The
        # scheduler's skip means "I did not look". The agent's own means "I looked
        # and there was nothing". Pressing the button must always produce the
        # second — "I asked and it declined to check" is a baffling thing for a
        # button to do.
        response = await client.post("/v1/agents/consolidation/run", headers=account.auth)
        assert response.json()["summary"]["reason"] == "nothing was duplicated"

    async def test_running_everything_also_looks_rather_than_declining(
        self, client: AsyncClient, account: Account
    ):
        results = (await client.post("/v1/agents/run", headers=account.auth)).json()
        reasons = {r["summary"].get("reason") for r in results}
        assert "nothing new to work on" not in reasons

    async def test_the_scheduler_skip_says_it_did_not_look(
        self, pool: asyncpg.Pool, account: Account
    ):
        result = await run_agent(pool, ConsolidationAgent(), account.user_id, trigger="scheduled")
        assert result["summary"]["reason"] == "nothing new to work on"


class TestApi:
    async def test_the_registry_is_listed(self, client: AsyncClient, account: Account):
        names = {a["name"] for a in (await client.get("/v1/agents", headers=account.auth)).json()}
        assert names == {"consolidation", "patterns", "cooccurrence", "themes"}

    async def test_an_unknown_agent_is_a_404(self, client: AsyncClient, account: Account):
        response = await client.post("/v1/agents/nonsense/run", headers=account.auth)
        assert response.status_code == 404

    async def test_the_run_log_requires_a_token(self, client: AsyncClient):
        assert (await client.get("/v1/agents/runs")).status_code == 401

    async def test_running_requires_a_token(self, client: AsyncClient):
        assert (await client.post("/v1/agents/run")).status_code == 401
