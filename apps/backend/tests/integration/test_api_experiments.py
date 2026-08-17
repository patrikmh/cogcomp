from datetime import date
from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account

pytestmark = [pytest.mark.anyio, pytest.mark.integration]


def experiment(experiment_id=None, **overrides):
    value = {
        "id": str(experiment_id or uuid4()),
        "title": "Morning walk",
        "hypothesis": "A walk improves focus",
        "action": "Walk for ten minutes",
        "success_criterion": "Focus feels better",
        "start_date": date(2026, 3, 1).isoformat(),
        "duration_days": 7,
        "timezone": "Europe/Stockholm",
        "cadence": "daily",
    }
    value.update(overrides)
    return value


async def a_reading_drawn_from_an_entry(client: AsyncClient, pool, account: Account):
    """A reading with real provenance.

    Only a reading that came from something the person wrote can be linked to an
    experiment, so the fixture has to build the whole chain: the entry, the node
    drawn from it, and the provenance between them.
    """
    entry_id = uuid4()
    written = await client.post(
        "/v1/observations",
        headers=account.auth,
        json={
            "id": str(entry_id),
            "content": "Slept badly again.",
            "captured_at": "2026-03-01T08:00:00Z",
            "timezone": "Europe/Stockholm",
            "source": "text",
        },
    )
    assert written.status_code in (200, 201), written.text
    node_id = uuid4()
    await pool.execute(
        "INSERT INTO graph_nodes(id,user_id,kind,label,confidence,epistemic_status,extractor)"
        " VALUES($1,$2,'Need','rest',0.8,'hypothesis','test-v0')",
        node_id,
        account.user_id,
    )
    await pool.execute(
        "INSERT INTO node_provenance(node_id,observation_id) VALUES($1,$2)",
        node_id,
        entry_id,
    )
    return node_id


async def create(client: AsyncClient, account: Account, **overrides):
    response = await client.post(
        "/v1/experiments", headers=account.auth, json=experiment(**overrides)
    )
    assert response.status_code == 201, response.text
    return response.json()


class TestExperimentAPI:
    async def test_experiments_require_authentication(self, client: AsyncClient):
        assert (await client.get("/v1/experiments")).status_code == 401
        assert (await client.post("/v1/experiments", json=experiment())).status_code == 401

    async def test_create_is_idempotent_by_client_uuid(self, client, account: Account):
        experiment_id = uuid4()
        first = await create(client, account, experiment_id=experiment_id)
        retry = await create(client, account, experiment_id=experiment_id)
        assert retry["id"] == first["id"]
        assert retry["revision"] == first["revision"]

        conflict = await client.post(
            "/v1/experiments",
            headers=account.auth,
            json=experiment(experiment_id, title="Different"),
        )
        assert conflict.status_code == 409

    async def test_different_uuids_allow_identical_payload(self, client, account: Account):
        first = await create(client, account)
        second = await create(client, account)
        assert first["id"] != second["id"]

    async def test_server_rejects_unvalidated_client_fingerprint(self, client, account: Account):
        response = await client.post(
            "/v1/experiments",
            headers={**account.auth, "X-Request-Fingerprint": "client-chosen"},
            json=experiment(),
        )
        assert response.status_code == 409

    async def test_lifecycle_and_revision_conflict(self, client, account: Account):
        created = await create(client, account)
        experiment_id = created["id"]
        response = await client.post(
            f"/v1/experiments/{experiment_id}/start",
            headers=account.auth,
            json={"revision": 0},
        )
        assert response.status_code == 200
        assert response.json()["state"] == "active"
        retry = await client.post(
            f"/v1/experiments/{experiment_id}/start",
            headers=account.auth,
            json={"revision": 0},
        )
        assert retry.status_code == 200
        stale = await client.post(
            f"/v1/experiments/{experiment_id}/pause",
            headers=account.auth,
            json={"revision": 0},
        )
        assert stale.status_code == 409

    async def test_a_transition_answers_with_the_whole_experiment(self, client, account: Account):
        """A transition returns what `GET` returns, not a thinner object.

        The client writes this response straight into its cache, so a reply
        missing `outcome`, `links` or `checkins` does not just omit them — it
        erases them from the screen the person is looking at. Completing an
        experiment appeared to do nothing at all until they navigated away and
        back, because the outcome they had just recorded was not in the answer.
        """
        created = await create(client, account)
        experiment_id = created["id"]
        observation_id = str(uuid4())
        assert (
            await client.post(
                "/v1/observations",
                headers=account.auth,
                json={"id": observation_id, "content": "walked today", "source": "text"},
            )
        ).status_code == 201

        started = await client.post(
            f"/v1/experiments/{experiment_id}/start",
            headers=account.auth,
            json={"revision": 0},
        )
        assert started.status_code == 200
        attached = await client.post(
            f"/v1/experiments/{experiment_id}/checkins",
            headers=account.auth,
            json={"observation_id": observation_id, "revision": started.json()["revision"]},
        )
        assert attached.status_code == 200, attached.text
        assert len(attached.json()["checkins"]) == 1

        paused = await client.post(
            f"/v1/experiments/{experiment_id}/pause",
            headers=account.auth,
            json={"revision": attached.json()["revision"]},
        )
        assert paused.status_code == 200
        # The check-in did not go anywhere just because the state changed.
        assert len(paused.json()["checkins"]) == 1

        resumed = await client.post(
            f"/v1/experiments/{experiment_id}/resume",
            headers=account.auth,
            json={"revision": paused.json()["revision"]},
        )
        completed = await client.post(
            f"/v1/experiments/{experiment_id}/complete",
            headers=account.auth,
            json={
                "revision": resumed.json()["revision"],
                "assessment": "met",
                "final_checkin_observation_id": observation_id,
            },
        )

        assert completed.status_code == 200, completed.text
        body = completed.json()
        assert body["state"] == "completed"
        assert body["outcome"]["assessment"] == "met"
        assert body["outcome"]["final_checkin_observation_id"] == observation_id
        assert len(body["checkins"]) == 1
        # And it is the same object a fresh read gives.
        fresh = await client.get(f"/v1/experiments/{experiment_id}", headers=account.auth)
        assert fresh.json() == body

    async def test_other_user_cannot_read_or_mutate(
        self, client, account: Account, other_account: Account
    ):
        created = await create(client, account)
        experiment_id = created["id"]
        assert (
            await client.get(f"/v1/experiments/{experiment_id}", headers=other_account.auth)
        ).status_code == 404
        response = await client.post(
            f"/v1/experiments/{experiment_id}/start",
            headers=other_account.auth,
            json={"revision": 0},
        )
        assert response.status_code == 404
        listing = await client.get("/v1/experiments", headers=other_account.auth)
        assert listing.json()["experiments"] == []

    async def test_soft_delete_removes_experiment_from_reads(self, client, account: Account):
        created = await create(client, account)
        response = await client.delete(
            f"/v1/experiments/{created['id']}",
            headers=account.auth,
            params={"revision": created["revision"]},
        )
        assert response.status_code == 204
        assert (
            await client.get(f"/v1/experiments/{created['id']}", headers=account.auth)
        ).status_code == 404
        assert (await client.get("/v1/experiments", headers=account.auth)).json()[
            "experiments"
        ] == []


class TestTheListNamesWhatEachTrialTests:
    """The list screen names the reading a trial was set against.

    An experiment with nothing behind it is a task; which belief it tests is the
    reason it exists. The detail read has always carried its links, and the list
    read did not, so the screen that shows every trial at once was the one
    screen that could not say what any of them were for.
    """

    async def test_the_listing_carries_each_experiment_s_links(
        self, client: AsyncClient, account: Account, pool
    ):
        created = await create(client, account)
        node_id = await a_reading_drawn_from_an_entry(client, pool, account)
        response = await client.post(
            f"/v1/experiments/{created['id']}/links",
            headers=account.auth,
            json={"revision": created["revision"], "node_id": str(node_id)},
        )
        assert response.status_code == 200

        listing = await client.get("/v1/experiments", headers=account.auth)
        [item] = listing.json()["experiments"]
        assert [link["label"] for link in item["links"]] == ["rest"]

    async def test_findings_off_link_and_unlink_mutations_omit_links(
        self, client: AsyncClient, account: Account, pool
    ):
        created = await create(client, account)
        node_id = await a_reading_drawn_from_an_entry(client, pool, account)
        linked = await client.post(
            f"/v1/experiments/{created['id']}/links",
            headers=account.auth,
            json={
                "revision": created["revision"],
                "node_id": str(node_id),
                "include_links": False,
            },
        )
        assert linked.status_code == 200
        assert "links" not in linked.json()

        unlinked = await client.delete(
            f"/v1/experiments/{created['id']}/links/{node_id}",
            headers=account.auth,
            params={"revision": linked.json()["revision"], "include_links": "false"},
        )
        assert unlinked.status_code == 200
        assert "links" not in unlinked.json()

    async def test_findings_off_listing_omits_links(self, client: AsyncClient, account: Account, pool):
        created = await create(client, account)
        node_id = await a_reading_drawn_from_an_entry(client, pool, account)
        await client.post(
            f"/v1/experiments/{created['id']}/links",
            headers=account.auth,
            json={"revision": created["revision"], "node_id": str(node_id)},
        )
        response = await client.get("/v1/experiments?include_links=false", headers=account.auth)
        assert "links" not in response.json()["experiments"][0]

    async def test_findings_off_detail_omits_links(self, client: AsyncClient, account: Account, pool):
        created = await create(client, account)
        node_id = await a_reading_drawn_from_an_entry(client, pool, account)
        await client.post(
            f"/v1/experiments/{created['id']}/links",
            headers=account.auth,
            json={"revision": created["revision"], "node_id": str(node_id)},
        )
        response = await client.get(
            f"/v1/experiments/{created['id']}?include_links=false", headers=account.auth
        )
        assert "links" not in response.json()
        assert response.json()["title"] == created["title"]

    async def test_an_experiment_with_no_links_carries_an_empty_list(
        self, client: AsyncClient, account: Account
    ):
        # Not a missing key: the client should never have to tell "none" from
        # "the server did not say".
        await create(client, account)
        listing = await client.get("/v1/experiments", headers=account.auth)
        assert listing.json()["experiments"][0]["links"] == []

    async def test_links_do_not_leak_between_accounts(
        self, client: AsyncClient, account: Account, other_account: Account, pool
    ):
        created = await create(client, account)
        node_id = await a_reading_drawn_from_an_entry(client, pool, account)
        await client.post(
            f"/v1/experiments/{created['id']}/links",
            headers=account.auth,
            json={"revision": created["revision"], "node_id": str(node_id)},
        )
        await create(client, other_account)
        listing = await client.get("/v1/experiments", headers=other_account.auth)
        assert listing.json()["experiments"][0]["links"] == []
