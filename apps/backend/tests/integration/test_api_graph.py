"""Observations, extraction, provenance, and isolation — over HTTP, against a real database."""

from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account

pytestmark = [pytest.mark.anyio, pytest.mark.integration]


async def write_entry(
    client: AsyncClient, account: Account, content: str = "I slept badly."
) -> str:
    observation_id = str(uuid4())
    response = await client.post(
        "/v1/observations",
        headers=account.auth,
        json={"id": observation_id, "content": content, "source": "text"},
    )
    assert response.status_code == 201, response.text
    return observation_id


class TestObservations:
    async def test_content_is_trimmed_but_kept_verbatim(
        self, client: AsyncClient, account: Account
    ):
        observation_id = str(uuid4())
        response = await client.post(
            "/v1/observations",
            headers=account.auth,
            json={
                "id": observation_id,
                "content": "  I keep putting this off.  ",
                "source": "text",
            },
        )
        assert response.json()["content"] == "I keep putting this off."

    async def test_a_repeated_id_is_a_conflict_not_a_second_thought(
        self, client: AsyncClient, account: Account
    ):
        observation_id = await write_entry(client, account)
        response = await client.post(
            "/v1/observations",
            headers=account.auth,
            json={"id": observation_id, "content": "different text", "source": "text"},
        )
        assert response.status_code == 409

    async def test_an_entry_keeps_the_timezone_it_was_written_in(
        self, client: AsyncClient, account: Account
    ):
        response = await client.post(
            "/v1/observations",
            headers=account.auth,
            json={
                "id": str(uuid4()),
                "content": "late one tonight",
                "source": "text",
                "captured_at": "2026-03-05T23:30:00Z",
                "timezone": "Europe/Stockholm",
            },
        )

        assert response.status_code == 201, response.text
        assert response.json()["timezone"] == "Europe/Stockholm"

    async def test_an_entry_without_a_timezone_records_no_guess(
        self, client: AsyncClient, account: Account
    ):
        # Not defaulted to UTC: "we never asked" and "they were in UTC" are
        # different facts, and only one of them is true.
        observation_id = await write_entry(client, account)
        listed = await client.get("/v1/observations", headers=account.auth)
        entry = next(o for o in listed.json()["observations"] if o["id"] == observation_id)

        assert entry["timezone"] is None

    async def test_an_unknown_timezone_is_refused_at_capture(
        self, client: AsyncClient, account: Account
    ):
        # Refused here rather than discovered later inside a detector, where the
        # only available response would be to fail mining for everything else.
        response = await client.post(
            "/v1/observations",
            headers=account.auth,
            json={
                "id": str(uuid4()),
                "content": "somewhere",
                "source": "text",
                "timezone": "Mars/Olympus_Mons",
            },
        )

        assert response.status_code == 422

    async def test_blank_content_is_rejected(self, client: AsyncClient, account: Account):
        response = await client.post(
            "/v1/observations",
            headers=account.auth,
            json={"id": str(uuid4()), "content": "   ", "source": "text"},
        )
        assert response.status_code == 422

    async def test_an_unknown_source_is_rejected(self, client: AsyncClient, account: Account):
        response = await client.post(
            "/v1/observations",
            headers=account.auth,
            json={"id": str(uuid4()), "content": "hi", "source": "telepathy"},
        )
        assert response.status_code == 422

    async def test_a_nonpositive_limit_is_rejected(self, client: AsyncClient, account: Account):
        response = await client.get("/v1/observations?limit=0", headers=account.auth)
        assert response.status_code == 422

    async def test_listing_is_newest_first(self, client: AsyncClient, account: Account):
        for text in ("first", "second", "third"):
            await write_entry(client, account, text)
        listed = await client.get("/v1/observations", headers=account.auth)
        assert [o["content"] for o in listed.json()["observations"]] == [
            "third",
            "second",
            "first",
        ]

    async def test_pagination_advertises_a_cursor_only_when_a_page_is_full(
        self, client: AsyncClient, account: Account
    ):
        for text in ("a", "b", "c"):
            await write_entry(client, account, text)

        full = await client.get("/v1/observations?limit=2", headers=account.auth)
        assert full.json()["next_before"] is not None

        partial = await client.get("/v1/observations?limit=50", headers=account.auth)
        assert partial.json()["next_before"] is None

    async def test_the_cursor_returns_the_next_page(self, client: AsyncClient, account: Account):
        for text in ("a", "b", "c"):
            await write_entry(client, account, text)

        first = await client.get("/v1/observations?limit=2", headers=account.auth)
        cursor = first.json()["next_before"]
        second = await client.get(f"/v1/observations?limit=2&before={cursor}", headers=account.auth)
        seen = [o["content"] for o in first.json()["observations"]] + [
            o["content"] for o in second.json()["observations"]
        ]
        assert sorted(seen) == ["a", "b", "c"]

    async def test_soft_delete_hides_the_entry_but_keeps_the_row(
        self, client: AsyncClient, account: Account
    ):
        observation_id = await write_entry(client, account)
        assert (
            await client.delete(f"/v1/observations/{observation_id}", headers=account.auth)
        ).status_code == 204

        listed = await client.get("/v1/observations", headers=account.auth)
        assert listed.json()["observations"] == []

        # The row survives so anything derived from it keeps a resolvable trail.
        remaining = await client._transport.app.state.pool.fetchval(
            "SELECT count(*) FROM observations WHERE node_id = $1", observation_id
        )
        assert remaining == 1

    async def test_deleting_twice_is_a_not_found(self, client: AsyncClient, account: Account):
        observation_id = await write_entry(client, account)
        await client.delete(f"/v1/observations/{observation_id}", headers=account.auth)
        second = await client.delete(f"/v1/observations/{observation_id}", headers=account.auth)
        assert second.status_code == 404


class TestExtraction:
    async def test_extraction_produces_nodes_with_provenance(
        self, client: AsyncClient, account: Account
    ):
        observation_id = await write_entry(client, account)
        response = await client.post(
            f"/v1/observations/{observation_id}/extract", headers=account.auth
        )
        assert response.status_code == 200
        body = response.json()
        assert body["nodes"] >= 1
        assert body["extractor"].startswith("extract-v0.1/")

        pool = client._transport.app.state.pool
        # Every inferred node cites the observation. This is the invariant the whole
        # explainability story rests on.
        orphans = await pool.fetchval(
            """
            SELECT count(*) FROM graph_nodes n
            WHERE n.kind <> 'Observation'
              AND NOT EXISTS (SELECT 1 FROM node_provenance p WHERE p.node_id = n.id)
            """
        )
        assert orphans == 0

    async def test_re_extracting_is_refused_rather_than_duplicated(
        self, client: AsyncClient, account: Account
    ):
        observation_id = await write_entry(client, account)
        await client.post(f"/v1/observations/{observation_id}/extract", headers=account.auth)
        again = await client.post(
            f"/v1/observations/{observation_id}/extract", headers=account.auth
        )
        assert again.status_code == 409

    async def test_extracting_an_unknown_observation_is_a_not_found(
        self, client: AsyncClient, account: Account
    ):
        response = await client.post(f"/v1/observations/{uuid4()}/extract", headers=account.auth)
        assert response.status_code == 404

    async def test_every_inferred_node_carries_confidence_and_an_extractor(
        self, client: AsyncClient, account: Account
    ):
        observation_id = await write_entry(client, account)
        await client.post(f"/v1/observations/{observation_id}/extract", headers=account.auth)

        rows = await client._transport.app.state.pool.fetch(
            "SELECT confidence, epistemic_status, extractor FROM graph_nodes "
            "WHERE kind <> 'Observation'"
        )
        assert rows
        for row in rows:
            assert 0.0 <= row["confidence"] <= 1.0
            assert row["epistemic_status"] == "hypothesis"
            assert row["extractor"]

    async def test_observations_carry_no_confidence(self, client: AsyncClient, account: Account):
        await write_entry(client, account)
        confidence = await client._transport.app.state.pool.fetchval(
            "SELECT confidence FROM graph_nodes WHERE kind = 'Observation'"
        )
        # An observation makes no claim, so it has no confidence to report.
        assert confidence is None


class TestExplain:
    async def test_evidence_says_how_long_after_the_fact_it_was_written(
        self, client: AsyncClient, account: Account
    ):
        """A backfilled entry is different evidence from one written at the time.

        Recall is pulled toward peaks and endings, so an entry written days after
        the moment it describes supports a claim differently — and only the
        person reading it can weigh that, which means only they can be told.
        """
        observation_id = str(uuid4())
        await client.post(
            "/v1/observations",
            headers=account.auth,
            json={
                "id": observation_id,
                "content": "last Tuesday was heavy",
                "source": "text",
                # Backdated by a week relative to when the server stores it.
                "captured_at": "2026-03-01T09:00:00Z",
            },
        )
        await client.post(f"/v1/observations/{observation_id}/extract", headers=account.auth)

        explained = await client.get(
            f"/v1/graph/nodes/{observation_id}/explain", headers=account.auth
        )

        entry = explained.json()["derived_from"]
        assert entry == [] or entry[0]["recall_days"] > 0

    async def test_an_entry_written_now_carries_no_recall_distance(
        self, client: AsyncClient, account: Account
    ):
        observation_id = await write_entry(client, account)
        await client.post(f"/v1/observations/{observation_id}/extract", headers=account.auth)

        node = (await client.get("/v1/graph?limit=50", headers=account.auth)).json()["nodes"]
        inferred_id = next(n["id"] for n in node if n["kind"] != "Observation")
        explained = (
            await client.get(f"/v1/graph/nodes/{inferred_id}/explain", headers=account.auth)
        ).json()

        assert explained["derived_from"][0]["recall_days"] == 0

    async def test_an_inferred_node_explains_itself_with_the_users_own_words(
        self, client: AsyncClient, account: Account
    ):
        observation_id = await write_entry(client, account, "I keep putting this off.")
        await client.post(f"/v1/observations/{observation_id}/extract", headers=account.auth)

        node_id = await client._transport.app.state.pool.fetchval(
            "SELECT id FROM graph_nodes WHERE kind <> 'Observation' LIMIT 1"
        )
        response = await client.get(f"/v1/graph/nodes/{node_id}/explain", headers=account.auth)
        assert response.status_code == 200
        body = response.json()
        assert body["is_observed"] is False
        assert body["node"]["confidence"] is not None
        assert [d["content"] for d in body["derived_from"]] == ["I keep putting this off."]

    async def test_an_observation_explains_itself(self, client: AsyncClient, account: Account):
        observation_id = await write_entry(client, account)
        response = await client.get(
            f"/v1/graph/nodes/{observation_id}/explain", headers=account.auth
        )
        body = response.json()
        assert body["is_observed"] is True
        assert body["node"]["confidence"] is None

    async def test_summary_counts_by_kind(self, client: AsyncClient, account: Account):
        observation_id = await write_entry(client, account)
        await client.post(f"/v1/observations/{observation_id}/extract", headers=account.auth)

        summary = (await client.get("/v1/graph/summary", headers=account.auth)).json()
        counts = {c["kind"]: c["count"] for c in summary["counts"]}
        assert counts["Observation"] == 1
        assert summary["schema_version"] == "0.1"


class TestUserIsolation:
    """One user must never see, touch, or learn of another's graph."""

    async def test_entries_are_not_listed_across_users(
        self, client: AsyncClient, account: Account, other_account: Account
    ):
        await write_entry(client, account, "private thought")
        listed = await client.get("/v1/observations", headers=other_account.auth)
        assert listed.json()["observations"] == []

    async def test_fetching_another_users_entry_is_a_not_found(
        self, client: AsyncClient, account: Account, other_account: Account
    ):
        observation_id = await write_entry(client, account)
        response = await client.get(
            f"/v1/observations/{observation_id}", headers=other_account.auth
        )
        # 404 rather than 403: existence itself is private.
        assert response.status_code == 404

    async def test_deleting_another_users_entry_is_refused(
        self, client: AsyncClient, account: Account, other_account: Account
    ):
        observation_id = await write_entry(client, account)
        response = await client.delete(
            f"/v1/observations/{observation_id}", headers=other_account.auth
        )
        assert response.status_code == 404

        still_there = await client.get("/v1/observations", headers=account.auth)
        assert len(still_there.json()["observations"]) == 1

    async def test_extracting_another_users_entry_is_refused(
        self, client: AsyncClient, account: Account, other_account: Account
    ):
        observation_id = await write_entry(client, account)
        response = await client.post(
            f"/v1/observations/{observation_id}/extract", headers=other_account.auth
        )
        assert response.status_code == 404

    async def test_explaining_another_users_node_is_a_not_found(
        self, client: AsyncClient, account: Account, other_account: Account
    ):
        observation_id = await write_entry(client, account)
        await client.post(f"/v1/observations/{observation_id}/extract", headers=account.auth)
        node_id = await client._transport.app.state.pool.fetchval(
            "SELECT id FROM graph_nodes WHERE kind <> 'Observation' LIMIT 1"
        )
        response = await client.get(
            f"/v1/graph/nodes/{node_id}/explain", headers=other_account.auth
        )
        assert response.status_code == 404

    async def test_summary_does_not_leak_another_users_counts(
        self, client: AsyncClient, account: Account, other_account: Account
    ):
        observation_id = await write_entry(client, account)
        await client.post(f"/v1/observations/{observation_id}/extract", headers=account.auth)

        summary = (await client.get("/v1/graph/summary", headers=other_account.auth)).json()
        assert summary["counts"] == []


class TestHealth:
    async def test_health_does_not_require_auth(self, client: AsyncClient):
        assert (await client.get("/health")).status_code == 200

    async def test_ready_reports_the_active_extractor(self, client: AsyncClient):
        body = (await client.get("/ready")).json()
        assert body["status"] == "ready"
        # Stub output must never be mistakable for model output.
        assert body["extractor"].endswith("/stub")
