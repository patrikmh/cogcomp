"""The scheduler, against a real database.

The unit under test is the decision of *whether* to run something, which is where
a background system does its damage: too eager and it rewrites the graph while
someone is mid-thought, too shy and the feature silently does nothing.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import asyncpg
import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account
from tlon.agents import REGISTRY
from tlon.agents.runner import recent_runs
from tlon.agents.scheduler import due_agents, due_users, tick

pytestmark = [pytest.mark.anyio, pytest.mark.integration]


async def entry_at(client: AsyncClient, account: Account, at: datetime) -> None:
    response = await client.post(
        "/v1/observations",
        headers=account.auth,
        json={
            "id": str(uuid4()),
            "content": "an entry",
            "source": "text",
            "captured_at": at.isoformat(),
        },
    )
    assert response.status_code == 201, response.text


def long_ago() -> datetime:
    return datetime.now(UTC) - timedelta(hours=3)


class TestWhoIsDue:
    async def test_a_user_who_has_written_is_due(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await entry_at(client, account, long_ago())
        assert account.user_id in await due_users(pool)

    async def test_a_user_who_has_written_nothing_is_not_due(
        self, pool: asyncpg.Pool, account: Account
    ):
        # No material means nothing to reason about, and a run that exists only to
        # record that there was nothing is noise in the log.
        assert account.user_id not in await due_users(pool)

    async def test_someone_still_writing_is_left_alone(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # Agents rewrite the graph. Merging nodes underneath a person who is
        # looking at them is disorienting in a way no log entry makes up for.
        await entry_at(client, account, datetime.now(UTC))
        assert account.user_id not in await due_users(pool)

    async def test_a_deleted_user_is_never_due(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await entry_at(client, account, long_ago())
        await pool.execute(
            "UPDATE users SET deleted_at = now() WHERE id = $1", account.user_id
        )
        assert account.user_id not in await due_users(pool)


class TestCadence:
    async def test_an_agent_that_has_never_run_is_due(
        self, pool: asyncpg.Pool, account: Account
    ):
        due = await due_agents(pool, account.user_id)
        assert {a.name for a in due} == {a.name for a in REGISTRY}

    async def test_an_agent_that_just_ran_is_not_due_again(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await client.post("/v1/agents/patterns/run", headers=account.auth)
        due = await due_agents(pool, account.user_id)
        assert "patterns" not in {a.name for a in due}

    async def test_cadence_is_measured_from_the_attempt_not_the_success(
        self, pool: asyncpg.Pool, account: Account
    ):
        # An agent that keeps failing must back off rather than retrying every
        # tick and filling the log with the same failure.
        await pool.execute(
            """
            INSERT INTO agent_runs
                (id, user_id, agent, version, trigger, status, finished_at, error)
            VALUES ($1, $2, 'patterns', 'v0', 'scheduled', 'failed', now(), 'broke')
            """,
            uuid4(),
            account.user_id,
        )
        due = await due_agents(pool, account.user_id)
        assert "patterns" not in {a.name for a in due}

    async def test_an_agent_becomes_due_again_once_its_cadence_elapses(
        self, pool: asyncpg.Pool, account: Account
    ):
        stale = datetime.now(UTC) - timedelta(days=2)
        await pool.execute(
            """
            INSERT INTO agent_runs
                (id, user_id, agent, version, trigger, status, started_at, finished_at)
            VALUES ($1, $2, 'patterns', 'v0', 'scheduled', 'succeeded', $3, $3)
            """,
            uuid4(),
            account.user_id,
            stale,
        )
        due = await due_agents(pool, account.user_id)
        assert "patterns" in {a.name for a in due}


class TestTick:
    async def test_a_tick_does_the_work_and_logs_it(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await entry_at(client, account, long_ago())
        attempted = await tick(pool)
        assert attempted == len(REGISTRY)

        runs = await recent_runs(pool, account.user_id)
        assert {r["agent"] for r in runs} == {a.name for a in REGISTRY}
        # Nothing the person asked for. That is the whole point, and it is why the
        # trigger has to be recorded.
        assert {r["trigger"] for r in runs} == {"scheduled"}

    async def test_a_second_tick_does_not_repeat_the_work(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # Re-deriving the same conclusions every tick is how a tool that notices
        # things becomes a tool that nags.
        await entry_at(client, account, long_ago())
        await tick(pool)
        assert await tick(pool) == 0

    async def test_an_idle_database_is_a_no_op(self, pool: asyncpg.Pool):
        assert await tick(pool) == 0

    async def test_a_tick_never_crosses_users(
        self,
        client: AsyncClient,
        pool: asyncpg.Pool,
        account: Account,
        other_account: Account,
    ):
        await entry_at(client, account, long_ago())
        await tick(pool)
        assert await recent_runs(pool, other_account.user_id) == []
