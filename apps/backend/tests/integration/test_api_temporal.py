"""Temporal changes over HTTP, against a real database.

The pure comparison is covered in tests/test_temporal.py. What is only testable
here is the part that decides *which day* something happened on — the join
through provenance and the timezone conversion — and the refusal to compare
windows nobody wrote in.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import asyncpg
import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account

pytestmark = [pytest.mark.anyio, pytest.mark.integration]


async def entry_on(
    client: AsyncClient, account: Account, days_ago: int, content: str = "an entry"
) -> UUID:
    observation_id = uuid4()
    at = datetime.now(UTC) - timedelta(days=days_ago, hours=1)
    response = await client.post(
        "/v1/observations",
        headers=account.auth,
        json={
            "id": str(observation_id),
            "content": f"{content} {days_ago}",
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
    confidence: float = 0.8,
) -> None:
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


async def changes(client: AsyncClient, account: Account) -> dict:
    response = await client.get("/v1/temporal/changes", headers=account.auth)
    assert response.status_code == 200, response.text
    return response.json()


class TestComparing:
    async def test_something_new_is_reported(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # Wrote on both weeks, but "dread" only appears in the recent one.
        for days_ago in range(14):
            observation = await entry_on(client, account, days_ago)
            if days_ago < 4:
                await inferred(pool, account, observation, "dread")

        body = await changes(client, account)
        assert [c["label"] for c in body["changes"]] == ["dread"]
        assert body["changes"][0]["shift"] == "new"

    async def test_it_reports_counts_rather_than_a_verdict(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        for days_ago in range(14):
            observation = await entry_on(client, account, days_ago)
            if days_ago < 4:
                await inferred(pool, account, observation, "dread")

        description = (await changes(client, account))["changes"][0]["description"]
        for verdict in ("better", "worse", "improve", "decline", "should"):
            assert verdict not in description.lower()
        assert "4 of the last 7 days" in description

    async def test_a_silent_week_is_refused_rather_than_compared(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # Everything in the recent week, nothing in the one before. A claim built
        # on that is a claim about the person's schedule, not about them.
        for days_ago in range(5):
            observation = await entry_on(client, account, days_ago)
            await inferred(pool, account, observation, "dread")

        body = await changes(client, account)
        assert body["changes"] == []
        assert body["not_enough_material"] is True

    async def test_looking_and_finding_nothing_is_distinguishable(
        self, client: AsyncClient, account: Account
    ):
        # Wrote across both weeks with no inferences: it could compare, and
        # nothing had moved. That is a different answer from "could not look".
        for days_ago in range(14):
            await entry_on(client, account, days_ago)

        body = await changes(client, account)
        assert body["changes"] == []
        assert body["not_enough_material"] is False


class TestWhichDayItCounts:
    async def test_an_inference_is_dated_by_its_entry(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # The node is created now; the entry it came from is ten days old. It has
        # to count as ten days old, or re-running extraction over old entries
        # would make last month look like this week.
        for days_ago in range(14):
            observation = await entry_on(client, account, days_ago)
            if 7 <= days_ago < 11:
                await inferred(pool, account, observation, "dread")

        body = await changes(client, account)
        assert body["changes"][0]["shift"] == "absent"

    async def test_a_deleted_entry_stops_counting(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        for days_ago in range(14):
            observation = await entry_on(client, account, days_ago)
            if days_ago < 4:
                await inferred(pool, account, observation, "dread")

        assert (await changes(client, account))["changes"]

        await pool.execute(
            "UPDATE graph_nodes SET deleted_at = now() WHERE user_id = $1 AND kind = 'Observation'",
            account.user_id,
        )
        assert (await changes(client, account))["changes"] == []


class TestTimezone:
    async def test_an_unknown_timezone_is_rejected(self, client: AsyncClient, account: Account):
        response = await client.get(
            "/v1/temporal/changes?timezone=Mars/Olympus", headers=account.auth
        )
        assert response.status_code == 400

    async def test_a_real_timezone_is_accepted(self, client: AsyncClient, account: Account):
        response = await client.get(
            "/v1/temporal/changes?timezone=Europe/Stockholm", headers=account.auth
        )
        assert response.status_code == 200


class TestIsolation:
    async def test_changes_are_private_to_their_user(
        self,
        client: AsyncClient,
        pool: asyncpg.Pool,
        account: Account,
        other_account: Account,
    ):
        for days_ago in range(14):
            observation = await entry_on(client, account, days_ago)
            if days_ago < 4:
                await inferred(pool, account, observation, "dread")

        assert (await changes(client, other_account))["changes"] == []

    async def test_it_requires_a_token(self, client: AsyncClient):
        assert (await client.get("/v1/temporal/changes")).status_code == 401
