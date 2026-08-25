"""Gathering hints over HTTP, against a real database.

The pure logic is covered in tests/test_gathering.py. What is only testable here
is the endpoint's honesty contract: a hint appears exactly one entry short of the
floor, disappears the moment mining earns the finding, and never shows for words
that already hold a pattern.
"""

from datetime import timedelta

import asyncpg
import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account
from tests.integration.test_api_patterns import DAY_ONE, entry, inferred

pytestmark = [pytest.mark.anyio, pytest.mark.integration]


async def twice(client: AsyncClient, pool: asyncpg.Pool, account: Account, label: str):
    """Two entries on separate days, each carrying one inference of `label`."""
    for offset in (0, 4):
        observation_id = await entry(client, account, DAY_ONE + timedelta(days=offset))
        await inferred(pool, account, observation_id, label)


async def gathering(client: AsyncClient, account: Account) -> list[dict]:
    response = await client.get("/v1/patterns/gathering", headers=account.auth)
    assert response.status_code == 200
    return response.json()["candidates"]


class TestGatheringEndpoint:
    async def test_two_entries_on_two_days_hint_at_three(self, client, pool, account):
        await twice(client, pool, account, "dread")
        found = await gathering(client, account)
        assert len(found) == 1
        assert found[0]["label"] == "dread"
        assert found[0]["observations"] == 2
        assert found[0]["observations_needed"] == 3

    async def test_nothing_close_is_an_empty_list_not_an_error(self, client, pool, account):
        assert await gathering(client, account) == []

    async def test_a_held_pattern_is_not_also_a_hint(self, client, pool, account):
        # Three entries cross the exact-label floor; mine stores the finding;
        # the same word must then stop hinting.
        for offset in (0, 1, 2):
            observation_id = await entry(client, account, DAY_ONE + timedelta(days=offset))
            await inferred(pool, account, observation_id, "dread")
        mined = await client.post("/v1/patterns/mine", headers=account.auth)
        assert mined.json()["added"] >= 1
        assert await gathering(client, account) == []

    async def test_another_users_words_never_leak(self, client, pool, account, other_account):
        await twice(client, pool, account, "dread")
        other = await gathering(client, other_account)
        assert other == []

    async def test_the_response_names_what_is_needed(self, client, pool, account):
        await twice(client, pool, account, "dread")
        found = await gathering(client, account)
        assert found[0]["days_needed"] == 2
        assert found[0]["distinct_days"] == 2
