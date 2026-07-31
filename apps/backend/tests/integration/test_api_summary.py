"""The daily summary over HTTP, against a real database."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account

pytestmark = [pytest.mark.anyio, pytest.mark.integration]

DAY = "2026-03-15"


async def entry_at(
    client: AsyncClient, account: Account, captured_at: str, content: str = "an entry"
) -> str:
    observation_id = str(uuid4())
    response = await client.post(
        "/v1/observations",
        headers=account.auth,
        json={
            "id": observation_id,
            "content": content,
            "source": "text",
            "captured_at": captured_at,
        },
    )
    assert response.status_code == 201, response.text
    return observation_id


class TestEmptyDay:
    async def test_a_day_with_no_entries_reports_nothing(
        self, client: AsyncClient, account: Account
    ):
        body = (await client.get(f"/v1/summary/{DAY}", headers=account.auth)).json()
        assert body["entry_count"] == 0
        assert body["observations"] == []
        assert body["inferred"] == []

    async def test_an_empty_day_does_not_prompt_the_user_to_write(
        self, client: AsyncClient, account: Account
    ):
        # The summary reports what a day held, including nothing. Nudging toward
        # engagement is explicitly out of scope for this product.
        body = (await client.get(f"/v1/summary/{DAY}", headers=account.auth)).json()
        # Only string values — field names legitimately contain fragments like the
        # "try" in "entry_count".
        prose = " ".join(v for v in body.values() if isinstance(v, str)).lower()
        for nudge in ["try", "why not", "streak", "keep going", "don't forget"]:
            assert nudge not in prose


class TestDayContents:
    async def test_entries_are_listed_in_capture_order(self, client: AsyncClient, account: Account):
        await entry_at(client, account, f"{DAY}T18:00:00+00:00", "evening")
        await entry_at(client, account, f"{DAY}T08:00:00+00:00", "morning")

        body = (await client.get(f"/v1/summary/{DAY}", headers=account.auth)).json()
        assert [o["content"] for o in body["observations"]] == ["morning", "evening"]
        assert body["entry_count"] == 2

    async def test_first_and_last_capture_bound_the_day(
        self, client: AsyncClient, account: Account
    ):
        await entry_at(client, account, f"{DAY}T08:00:00+00:00")
        await entry_at(client, account, f"{DAY}T18:00:00+00:00")

        body = (await client.get(f"/v1/summary/{DAY}", headers=account.auth)).json()
        assert body["first_capture"].startswith(f"{DAY}T08:00")
        assert body["last_capture"].startswith(f"{DAY}T18:00")

    async def test_entries_from_other_days_are_excluded(
        self, client: AsyncClient, account: Account
    ):
        await entry_at(client, account, f"{DAY}T12:00:00+00:00", "today")
        await entry_at(client, account, "2026-03-14T12:00:00+00:00", "yesterday")
        await entry_at(client, account, "2026-03-16T12:00:00+00:00", "tomorrow")

        body = (await client.get(f"/v1/summary/{DAY}", headers=account.auth)).json()
        assert [o["content"] for o in body["observations"]] == ["today"]

    async def test_a_deleted_entry_leaves_the_summary(self, client: AsyncClient, account: Account):
        observation_id = await entry_at(client, account, f"{DAY}T12:00:00+00:00")
        await client.delete(f"/v1/observations/{observation_id}", headers=account.auth)

        body = (await client.get(f"/v1/summary/{DAY}", headers=account.auth)).json()
        assert body["entry_count"] == 0


class TestTimezones:
    async def test_a_late_entry_belongs_to_the_local_day(
        self, client: AsyncClient, account: Account
    ):
        # 23:30 in Stockholm on the 15th is 22:30 UTC on the 15th. Both agree here.
        # The interesting case is the next test.
        await entry_at(client, account, f"{DAY}T22:30:00+00:00", "late")
        body = (
            await client.get(f"/v1/summary/{DAY}?tz=Europe/Stockholm", headers=account.auth)
        ).json()
        assert body["entry_count"] == 1

    async def test_an_entry_after_local_midnight_belongs_to_the_next_day(
        self, client: AsyncClient, account: Account
    ):
        # 23:30 UTC on the 15th is 00:30 on the 16th in Stockholm. Someone writing
        # then has written a 16th entry, and a UTC-only summary would misfile it.
        await entry_at(client, account, f"{DAY}T23:30:00+00:00", "just after midnight")

        same_day = (
            await client.get(f"/v1/summary/{DAY}?tz=Europe/Stockholm", headers=account.auth)
        ).json()
        next_day = (
            await client.get("/v1/summary/2026-03-16?tz=Europe/Stockholm", headers=account.auth)
        ).json()

        assert same_day["entry_count"] == 0
        assert next_day["entry_count"] == 1

    async def test_the_same_entry_files_differently_by_timezone(
        self, client: AsyncClient, account: Account
    ):
        await entry_at(client, account, f"{DAY}T23:30:00+00:00")

        utc = (await client.get(f"/v1/summary/{DAY}", headers=account.auth)).json()
        stockholm = (
            await client.get(f"/v1/summary/{DAY}?tz=Europe/Stockholm", headers=account.auth)
        ).json()
        assert utc["entry_count"] == 1
        assert stockholm["entry_count"] == 0

    async def test_an_unknown_timezone_is_rejected(self, client: AsyncClient, account: Account):
        response = await client.get(f"/v1/summary/{DAY}?tz=Mars/Olympus_Mons", headers=account.auth)
        assert response.status_code == 422

    async def test_a_malformed_date_is_rejected(self, client: AsyncClient, account: Account):
        assert (await client.get("/v1/summary/not-a-date", headers=account.auth)).status_code == 422


class TestInferences:
    async def test_inferences_appear_with_confidence_and_provenance_count(
        self, client: AsyncClient, account: Account
    ):
        observation_id = await entry_at(
            client, account, f"{DAY}T12:00:00+00:00", "I keep putting this off."
        )
        await client.post(f"/v1/observations/{observation_id}/extract", headers=account.auth)

        body = (await client.get(f"/v1/summary/{DAY}", headers=account.auth)).json()
        assert body["inferred"]
        for item in body["inferred"]:
            assert 0.0 <= item["confidence"] <= 1.0
            assert item["epistemic_status"] == "hypothesis"
            assert item["extractor"]
            assert item["cites_entries"] >= 1

    async def test_low_confidence_inferences_are_flagged_tentative(
        self, client: AsyncClient, account: Account
    ):
        # The stub emits 0.3. A guess must not be presented like something the
        # user said, so the client needs this flag to render it differently.
        observation_id = await entry_at(client, account, f"{DAY}T12:00:00+00:00")
        await client.post(f"/v1/observations/{observation_id}/extract", headers=account.auth)

        body = (await client.get(f"/v1/summary/{DAY}", headers=account.auth)).json()
        assert all(item["tentative"] for item in body["inferred"])

    async def test_inferences_are_ordered_by_confidence(
        self, client: AsyncClient, account: Account
    ):
        observation_id = await entry_at(client, account, f"{DAY}T12:00:00+00:00")
        await client.post(f"/v1/observations/{observation_id}/extract", headers=account.auth)

        # Add a stronger inference directly so ordering has something to sort.
        await client._transport.app.state.pool.execute(
            "INSERT INTO graph_nodes "
            "(id, user_id, kind, label, confidence, epistemic_status, extractor) "
            "VALUES (gen_random_uuid(), $1, 'Emotion', 'certain', 0.95, 'hypothesis', 'e')",
            account.user_id,
        )
        node_id = await client._transport.app.state.pool.fetchval(
            "SELECT id FROM graph_nodes WHERE label = 'certain'"
        )
        await client._transport.app.state.pool.execute(
            "INSERT INTO node_provenance (node_id, observation_id) VALUES ($1, $2)",
            node_id,
            observation_id,
        )

        body = (await client.get(f"/v1/summary/{DAY}", headers=account.auth)).json()
        confidences = [i["confidence"] for i in body["inferred"]]
        assert confidences == sorted(confidences, reverse=True)

    async def test_an_inference_extracted_later_still_belongs_to_the_entrys_day(
        self, client: AsyncClient, account: Account
    ):
        # Extraction can run long after capture. The inference belongs to the day
        # of the entry that produced it, not the day the extractor happened to run,
        # which is why the query joins through provenance rather than created_at.
        observation_id = await entry_at(client, account, f"{DAY}T12:00:00+00:00")
        await client.post(f"/v1/observations/{observation_id}/extract", headers=account.auth)

        await client._transport.app.state.pool.execute(
            "UPDATE graph_nodes SET created_at = $1 WHERE kind <> 'Observation'",
            datetime.now(UTC) + timedelta(days=30),
        )

        body = (await client.get(f"/v1/summary/{DAY}", headers=account.auth)).json()
        assert body["inferred"]


class TestNeverDiagnose:
    async def test_the_summary_reports_no_mood_score_or_trend(
        self, client: AsyncClient, account: Account
    ):
        observation_id = await entry_at(client, account, f"{DAY}T12:00:00+00:00")
        await client.post(f"/v1/observations/{observation_id}/extract", headers=account.auth)

        body = (await client.get(f"/v1/summary/{DAY}", headers=account.auth)).json()
        # Reducing a day to a score invites tracking it, and a number the user
        # cannot interrogate is the opposite of explainable.
        for banned in ["mood_score", "score", "trend", "severity", "rating", "streak"]:
            assert banned not in body


class TestIsolation:
    async def test_the_summary_does_not_include_another_users_day(
        self, client: AsyncClient, account: Account, other_account: Account
    ):
        await entry_at(client, account, f"{DAY}T12:00:00+00:00", "private")
        body = (await client.get(f"/v1/summary/{DAY}", headers=other_account.auth)).json()
        assert body["entry_count"] == 0

    async def test_the_summary_requires_authentication(self, client: AsyncClient):
        assert (await client.get(f"/v1/summary/{DAY}")).status_code == 401
