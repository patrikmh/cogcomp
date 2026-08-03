"""Judging a reading, and the self-model built on those judgements.

The schema has allowed `user_confirmed` and `user_rejected` since the first
migration and nothing ever set them, so these are the first tests in the codebase
that exercise a person disagreeing with the system.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import asyncpg
import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account

pytestmark = [pytest.mark.anyio, pytest.mark.integration]


async def entry(client: AsyncClient, account: Account, days_ago: int = 0) -> UUID:
    observation_id = uuid4()
    at = datetime.now(UTC) - timedelta(days=days_ago, hours=1)
    response = await client.post(
        "/v1/observations",
        headers=account.auth,
        json={
            "id": str(observation_id),
            "content": f"an entry from {days_ago} days ago",
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
    label: str = "dread",
    *,
    kind: str = "Emotion",
) -> UUID:
    node_id = uuid4()
    await pool.execute(
        """
        INSERT INTO graph_nodes
            (id, user_id, kind, label, confidence, epistemic_status, extractor)
        VALUES ($1, $2, $3, $4, 0.8, 'hypothesis', 'test')
        """,
        node_id,
        account.user_id,
        kind,
        label,
    )
    await pool.execute(
        "INSERT INTO node_provenance (node_id, observation_id) VALUES ($1, $2)",
        node_id,
        observation_id,
    )
    return node_id


async def judge(client: AsyncClient, account: Account, node_id: UUID, status: str):
    return await client.post(
        f"/v1/nodes/{node_id}/judgement",
        headers=account.auth,
        json={"status": status},
    )


class TestJudging:
    async def test_a_reading_can_be_confirmed(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        node = await inferred(pool, account, await entry(client, account))
        response = await judge(client, account, node, "user_confirmed")
        assert response.status_code == 200
        assert response.json()["epistemic_status"] == "user_confirmed"

    async def test_a_reading_can_be_rejected(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        node = await inferred(pool, account, await entry(client, account))
        response = await judge(client, account, node, "user_rejected")
        assert response.json()["epistemic_status"] == "user_rejected"

    async def test_a_judgement_can_be_withdrawn(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # Someone who agreed with something in a bad week must not be held to it.
        node = await inferred(pool, account, await entry(client, account))
        await judge(client, account, node, "user_confirmed")
        response = await judge(client, account, node, "hypothesis")
        assert response.json()["epistemic_status"] == "hypothesis"

    async def test_rejecting_does_not_delete(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # The record that the system once believed this is the only way anyone can
        # later ask why, or notice it keeps making the same mistake.
        node = await inferred(pool, account, await entry(client, account))
        await judge(client, account, node, "user_rejected")

        row = await pool.fetchrow("SELECT deleted_at FROM graph_nodes WHERE id = $1", node)
        assert row["deleted_at"] is None

    async def test_rejecting_keeps_its_provenance(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        observation = await entry(client, account)
        node = await inferred(pool, account, observation)
        await judge(client, account, node, "user_rejected")

        cited = await pool.fetchval("SELECT count(*) FROM node_provenance WHERE node_id = $1", node)
        assert cited == 1

    async def test_an_entry_cannot_be_judged(self, client: AsyncClient, account: Account):
        # What someone wrote is not a proposition to agree with.
        observation = await entry(client, account)
        response = await judge(client, account, observation, "user_confirmed")
        assert response.status_code == 409

    async def test_an_unknown_judgement_is_rejected(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        node = await inferred(pool, account, await entry(client, account))
        assert (await judge(client, account, node, "definitely_true")).status_code == 422

    async def test_another_users_reading_cannot_be_judged(
        self,
        client: AsyncClient,
        pool: asyncpg.Pool,
        account: Account,
        other_account: Account,
    ):
        node = await inferred(pool, account, await entry(client, account))
        assert (await judge(client, other_account, node, "user_rejected")).status_code == 404

    async def test_judging_requires_a_token(self, client: AsyncClient):
        response = await client.post(
            f"/v1/nodes/{uuid4()}/judgement", json={"status": "user_confirmed"}
        )
        assert response.status_code == 401


class TestRejectionHasConsequences:
    """Otherwise correcting the system is a gesture."""

    async def test_a_rejected_reading_stops_feeding_patterns(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        nodes = []
        for days_ago in range(3):
            nodes.append(await inferred(pool, account, await entry(client, account, days_ago)))

        mined = (await client.post("/v1/patterns/mine", headers=account.auth)).json()
        assert mined["patterns"] == 1

        for node in nodes:
            await judge(client, account, node, "user_rejected")

        again = (await client.post("/v1/patterns/mine", headers=account.auth)).json()
        assert again["patterns"] == 0

    async def test_a_rejected_reading_stops_feeding_temporal_changes(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        nodes = []
        for days_ago in range(14):
            observation = await entry(client, account, days_ago)
            if days_ago < 4:
                nodes.append(await inferred(pool, account, observation))

        before = await client.get("/v1/temporal/changes", headers=account.auth)
        assert before.json()["changes"]

        for node in nodes:
            await judge(client, account, node, "user_rejected")

        after = await client.get("/v1/temporal/changes", headers=account.auth)
        assert after.json()["changes"] == []

    async def test_confirming_does_not_remove_it(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # Only rejection has consequences. Agreeing with something must not
        # quietly change what it contributes to.
        for days_ago in range(3):
            node = await inferred(pool, account, await entry(client, account, days_ago))
            await judge(client, account, node, "user_confirmed")

        mined = (await client.post("/v1/patterns/mine", headers=account.auth)).json()
        assert mined["patterns"] == 1


class TestSelfModel:
    async def test_an_empty_picture_is_not_fully_reviewed(
        self, client: AsyncClient, account: Account
    ):
        # Claiming 100% for a picture that does not exist would be the most
        # misleading number on the screen.
        body = (await client.get("/v1/self-model", headers=account.auth)).json()
        assert body["reviewed_fraction"] == 0.0
        assert body["unreviewed"] == 0

    async def test_it_counts_what_has_been_weighed(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        observation = await entry(client, account)
        confirmed = await inferred(pool, account, observation, "dread")
        rejected = await inferred(pool, account, observation, "restless")
        await inferred(pool, account, observation, "tired")

        await judge(client, account, confirmed, "user_confirmed")
        await judge(client, account, rejected, "user_rejected")

        body = (await client.get("/v1/self-model", headers=account.auth)).json()
        assert body["confirmed"] == 1
        assert body["rejected"] == 1
        assert body["unreviewed"] == 1
        assert body["reviewed_fraction"] == pytest.approx(0.667, abs=0.001)

    async def test_entries_are_not_part_of_the_picture(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # The self-model is what the system believes, not what you wrote.
        for _ in range(3):
            await entry(client, account)
        body = (await client.get("/v1/self-model", headers=account.auth)).json()
        assert body["confirmed"] + body["rejected"] + body["unreviewed"] == 0

    async def test_it_is_private_to_its_user(
        self,
        client: AsyncClient,
        pool: asyncpg.Pool,
        account: Account,
        other_account: Account,
    ):
        node = await inferred(pool, account, await entry(client, account))
        await judge(client, account, node, "user_confirmed")

        body = (await client.get("/v1/self-model", headers=other_account.auth)).json()
        assert body["confirmed"] == 0

    async def test_it_requires_a_token(self, client: AsyncClient):
        assert (await client.get("/v1/self-model")).status_code == 401
