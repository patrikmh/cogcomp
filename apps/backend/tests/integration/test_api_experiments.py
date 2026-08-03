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
