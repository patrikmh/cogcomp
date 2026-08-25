"""Threads over HTTP, against a real database.

The grouping arithmetic is covered in tests/test_threads.py. What is only
testable here is that the query reads the stored graph correctly — SUPPORTS
edges in both directions of deletion, rejected findings excluded, another user's
findings invisible — and that the endpoint returns threads, not errors dressed
as an empty list.
"""

from uuid import uuid4

import asyncpg
import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account

pytestmark = [pytest.mark.anyio, pytest.mark.integration]


async def stored_pattern(
    pool: asyncpg.Pool,
    user_id,
    label: str,
    *,
    detector: str = "exact-label",
    key: str | None = None,
    confidence: float = 0.8,
    supporting_labels: tuple[str, ...] = (),
) -> object:
    """A Pattern node with its identity row and its SUPPORTS edges.

    Inserted directly: the detectors are tested elsewhere, and what threads read
    is the persisted shape they leave behind.
    """
    pattern_id = uuid4()
    await pool.execute(
        """
        INSERT INTO graph_nodes
            (id, user_id, kind, label, confidence, epistemic_status, extractor)
        VALUES ($1, $2, 'Pattern', $3, $4, 'hypothesis', 'test')
        """,
        pattern_id,
        user_id,
        label,
        confidence,
    )
    await pool.execute(
        """
        INSERT INTO patterns (node_id, user_id, detector, pattern_key, occurrences, distinct_days)
        VALUES ($1, $2, $3, $4, 4, 3)
        """,
        pattern_id,
        user_id,
        detector,
        key or f"{detector}:{label}",
    )
    for subject in supporting_labels:
        evidence_id = uuid4()
        await pool.execute(
            """
            INSERT INTO graph_nodes
                (id, user_id, kind, label, confidence, epistemic_status, extractor)
            VALUES ($1, $2, 'Emotion', $3, 0.8, 'hypothesis', 'test')
            """,
            evidence_id,
            user_id,
            subject,
        )
        await pool.execute(
            """
            INSERT INTO graph_edges
                (id, user_id, kind, from_id, to_id, confidence, epistemic_status, extractor)
            VALUES ($1, $2, 'SUPPORTS', $3, $4, 0.8, 'hypothesis', 'test')
            """,
            uuid4(),
            user_id,
            evidence_id,
            pattern_id,
        )
    return pattern_id


async def test_two_findings_on_one_subject_arrive_as_a_thread(
    client: AsyncClient, pool: asyncpg.Pool, account: Account
) -> None:
    recurrence = await stored_pattern(pool, account.user_id, "dread", supporting_labels=("dread",))
    weekday = await stored_pattern(
        pool,
        account.user_id,
        "dread tends to turn up on Thursdays",
        detector="weekday",
        key="weekday:dread",
        supporting_labels=("dread",),
    )

    response = await client.get("/v1/patterns/threads", headers=account.auth)
    assert response.status_code == 200, response.text

    found = response.json()
    assert len(found) == 1
    thread = found[0]
    assert thread["subjects"] == ["dread"]
    assert {member["id"] for member in thread["members"]} == {
        str(recurrence),
        str(weekday),
    }


async def test_findings_sharing_nothing_are_not_grouped(
    client: AsyncClient, pool: asyncpg.Pool, account: Account
) -> None:
    await stored_pattern(pool, account.user_id, "dread", supporting_labels=("dread",))
    await stored_pattern(pool, account.user_id, "running", supporting_labels=("running",))

    response = await client.get("/v1/patterns/threads", headers=account.auth)
    assert response.status_code == 200
    assert response.json() == []


async def test_another_users_findings_never_appear(
    client: AsyncClient,
    pool: asyncpg.Pool,
    account: Account,
    other_account: Account,
) -> None:
    await stored_pattern(pool, other_account.user_id, "dread", supporting_labels=("dread",))
    await stored_pattern(pool, account.user_id, "running", supporting_labels=("running",))

    response = await client.get("/v1/patterns/threads", headers=account.auth)
    assert response.status_code == 200
    assert response.json() == []


async def test_a_rejected_finding_stops_grouping(
    client: AsyncClient, pool: asyncpg.Pool, account: Account
) -> None:
    await stored_pattern(pool, account.user_id, "dread", supporting_labels=("dread",))
    rejected = await stored_pattern(
        pool,
        account.user_id,
        "dread on Thursdays",
        detector="weekday",
        key="weekday:dread",
        supporting_labels=("dread",),
    )
    await pool.execute(
        "UPDATE graph_nodes SET epistemic_status = 'user_rejected' WHERE id = $1", rejected
    )

    response = await client.get("/v1/patterns/threads", headers=account.auth)
    assert response.status_code == 200
    assert response.json() == []

    # And it comes back if the person withdraws the rejection.
    await pool.execute(
        "UPDATE graph_nodes SET epistemic_status = 'hypothesis' WHERE id = $1", rejected
    )
    response = await client.get("/v1/patterns/threads", headers=account.auth)
    assert len(response.json()) == 1
