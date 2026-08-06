"""Vocabulary counts over HTTP, against a real database.

The arithmetic is covered in `tests/test_vocabulary.py`. What is only testable
here is that the counts come from the right material: the person's own labels,
in their own week, with rejected readings left out.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import asyncpg
import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account

pytestmark = [pytest.mark.anyio, pytest.mark.integration]

MONDAY = "2026-03-02"
WEEK_START = datetime(2026, 3, 2, 9, 0, tzinfo=UTC)


async def felt(
    client: AsyncClient,
    pool: asyncpg.Pool,
    account: Account,
    label: str,
    *,
    day_offset: int = 0,
    kind: str = "Emotion",
) -> UUID:
    """An entry on a given day carrying one word for how it felt."""
    observation_id = uuid4()
    captured_at = WEEK_START + timedelta(days=day_offset)
    response = await client.post(
        "/v1/observations",
        headers=account.auth,
        json={
            "id": str(observation_id),
            "content": f"an entry from {captured_at.date()}",
            "source": "text",
            "captured_at": captured_at.isoformat(),
        },
    )
    assert response.status_code == 201, response.text

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


async def read(client: AsyncClient, account: Account, weeks: int = 2) -> list[dict]:
    response = await client.get(
        f"/v1/vocabulary/{MONDAY}", headers=account.auth, params={"weeks": weeks}
    )
    assert response.status_code == 200, response.text
    return response.json()["weeks"]


class TestCountingSomeonesOwnWords:
    async def test_it_counts_distinct_words_against_the_entries_they_came_from(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await felt(client, pool, account, "wired")
        await felt(client, pool, account, "flat", day_offset=1)
        await felt(client, pool, account, "wired", day_offset=2)

        this_week = (await read(client, account))[-1]

        assert this_week["distinct_words"] == 2
        assert this_week["entry_count"] == 3
        # The words themselves, because a count nobody can check is a score.
        assert this_week["words"] == ["flat", "wired"]

    async def test_a_rejected_reading_is_not_part_of_someones_vocabulary(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        node_id = await felt(client, pool, account, "wired")
        await felt(client, pool, account, "flat", day_offset=1)
        await pool.execute(
            "UPDATE graph_nodes SET epistemic_status = 'user_rejected' WHERE id = $1",
            node_id,
        )

        this_week = (await read(client, account))[-1]

        assert this_week["words"] == ["flat"]

    async def test_a_week_of_writing_without_feeling_words_is_not_a_quiet_week(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # Writing about work all week is not the same as not writing, and the
        # entry count is what keeps those apart.
        for offset in range(4):
            observation_id = uuid4()
            await client.post(
                "/v1/observations",
                headers=account.auth,
                json={
                    "id": str(observation_id),
                    "content": "notes about the release",
                    "source": "text",
                    "captured_at": (WEEK_START + timedelta(days=offset)).isoformat(),
                },
            )

        this_week = (await read(client, account))[-1]

        assert this_week["entry_count"] == 4
        assert this_week["distinct_words"] == 0
        assert this_week["description"] == "4 entries, none of them naming a feeling."

    async def test_a_word_first_used_this_week_is_named_as_new(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await felt(client, pool, account, "wired", day_offset=-7)
        await felt(client, pool, account, "wired")
        await felt(client, pool, account, "restless", day_offset=1)

        weeks = await read(client, account)

        assert weeks[0]["first_time"] == ["wired"]
        assert weeks[-1]["first_time"] == ["restless"]

    async def test_it_never_grades_the_person(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await felt(client, pool, account, "wired")

        for week in await read(client, account):
            text = week["description"].lower()
            for verdict in ("low", "high", "poor", "better", "worse", "should", "score"):
                assert verdict not in text


class TestBoundsAndAuth:
    async def test_a_window_longer_than_half_a_year_is_refused(
        self, client: AsyncClient, account: Account
    ):
        response = await client.get(
            f"/v1/vocabulary/{MONDAY}", headers=account.auth, params={"weeks": 40}
        )

        assert response.status_code == 422

    async def test_a_week_that_is_not_a_monday_is_refused(
        self, client: AsyncClient, account: Account
    ):
        response = await client.get("/v1/vocabulary/2026-03-04", headers=account.auth)

        assert response.status_code == 422

    async def test_one_persons_words_are_not_anothers(
        self,
        client: AsyncClient,
        pool: asyncpg.Pool,
        account: Account,
        other_account: Account,
    ):
        await felt(client, pool, account, "wired")

        assert (await read(client, other_account))[-1]["distinct_words"] == 0

    async def test_reading_requires_a_token(self, client: AsyncClient):
        assert (await client.get(f"/v1/vocabulary/{MONDAY}")).status_code == 401
