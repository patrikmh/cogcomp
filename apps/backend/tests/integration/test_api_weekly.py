from datetime import UTC, datetime
from uuid import UUID, uuid4

import asyncpg
import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account

pytestmark = [pytest.mark.anyio, pytest.mark.integration]


async def observation(
    pool: asyncpg.Pool, account: Account, captured_at: datetime, content: str
) -> UUID:
    node_id = uuid4()
    await pool.execute(
        "INSERT INTO graph_nodes (id, user_id, kind, label) VALUES ($1, $2, 'Observation', $3)",
        node_id,
        account.user_id,
        content,
    )
    await pool.execute(
        """INSERT INTO observations (node_id, user_id, content, source, captured_at)
        VALUES ($1, $2, $3, 'text', $4)""",
        node_id,
        account.user_id,
        content,
        captured_at,
    )
    return node_id


async def inference(
    pool: asyncpg.Pool,
    account: Account,
    label: str,
    observation_ids: list[UUID],
    confidence: float = 0.7,
) -> UUID:
    node_id = uuid4()
    await pool.execute(
        """INSERT INTO graph_nodes
        (id, user_id, kind, label, confidence, epistemic_status, extractor)
        VALUES ($1, $2, 'Place', $3, $4, 'hypothesis', 'test')""",
        node_id,
        account.user_id,
        label,
        confidence,
    )
    for observation_id in observation_ids:
        await pool.execute(
            "INSERT INTO node_provenance (node_id, observation_id) VALUES ($1, $2)",
            node_id,
            observation_id,
        )
    return node_id


async def test_weekly_contract_and_provenance(
    client: AsyncClient,
    pool: asyncpg.Pool,
    account: Account,
    other_account: Account,
):
    first = await observation(pool, account, datetime(2026, 3, 16, 23, tzinfo=UTC), "late Monday")
    second = await observation(pool, account, datetime(2026, 3, 22, 23, tzinfo=UTC), "Sunday")
    outside = await observation(pool, account, datetime(2026, 3, 23, tzinfo=UTC), "next Monday")
    other = await observation(pool, other_account, datetime(2026, 3, 17, tzinfo=UTC), "other user")
    recurring_id = await inference(pool, account, " Cafe ", [first])
    second_id = await inference(pool, account, "cafe", [second])
    await inference(pool, account, "guess", [first], confidence=0.4)
    await inference(pool, other_account, "Cafe", [other])

    response = await client.get(
        "/v1/summary/week/2026-03-16?tz=UTC",
        headers=account.auth,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["week_end"] == "2026-03-22"
    assert body["entry_count"] == 2
    assert [day["date"] for day in body["days"]] == [
        "2026-03-16",
        "2026-03-17",
        "2026-03-18",
        "2026-03-19",
        "2026-03-20",
        "2026-03-21",
        "2026-03-22",
    ]
    assert outside not in [UUID(item["id"]) for item in body["observations"]]
    inferred = {item["id"]: item for item in body["inferred"]}
    assert inferred[str(recurring_id)]["source_observation_ids"] == [str(first)]
    assert inferred[str(recurring_id)]["cites_days"] == 1
    assert inferred[str(second_id)]["source_observation_ids"] == [str(second)]
    recurring = body["recurring"]
    assert recurring == [
        {
            "kind": "Place",
            "label": " Cafe ",
            "entries": 2,
            "days": 2,
            "inference_ids": sorted([str(recurring_id), str(second_id)]),
        }
    ]
    assert all(str(other) not in item["source_observation_ids"] for item in body["inferred"])


@pytest.mark.parametrize(
    "path", ["/v1/summary/week/2026-03-17?tz=UTC", "/v1/summary/week/2026-03-16?tz=Invalid/Zone"]
)
async def test_weekly_rejects_invalid_calendar_arguments(
    client: AsyncClient, account: Account, path: str
):
    response = await client.get(path, headers=account.auth)
    assert response.status_code == 422


async def test_weekly_uses_local_filing_and_excludes_deleted_nodes(
    client: AsyncClient,
    pool: asyncpg.Pool,
    account: Account,
):
    before_local_monday = await observation(
        pool,
        account,
        datetime(2026, 3, 16, 6, 30, tzinfo=UTC),
        "Sunday in Los Angeles",
    )
    monday_local = await observation(
        pool,
        account,
        datetime(2026, 3, 16, 7, 30, tzinfo=UTC),
        "Monday in Los Angeles",
    )
    deleted = await observation(pool, account, datetime(2026, 3, 17, tzinfo=UTC), "deleted")
    await pool.execute("UPDATE graph_nodes SET deleted_at = now() WHERE id = $1", deleted)

    response = await client.get(
        "/v1/summary/week/2026-03-16?tz=America/Los_Angeles",
        headers=account.auth,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["entry_count"] == 1
    assert body["days"][0]["entry_count"] == 1
    assert body["days"][0]["observations"][0]["id"] == str(monday_local)
    assert body["days"][1]["entry_count"] == 0
    assert str(before_local_monday) not in [item["id"] for item in body["observations"]]
    assert str(deleted) not in [item["id"] for item in body["observations"]]


async def test_weekly_empty_report_has_all_calendar_days(client: AsyncClient, account: Account):
    response = await client.get("/v1/summary/week/2026-03-16?tz=UTC", headers=account.auth)
    assert response.status_code == 200
    body = response.json()
    assert body["entry_count"] == 0
    assert len(body["days"]) == 7
    assert body["inferred"] == []
    assert body["recurring"] == []
