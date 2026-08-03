from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account

pytestmark = [pytest.mark.anyio, pytest.mark.integration]


async def make_node(client: AsyncClient, account: Account, kind: str = "Value") -> str:
    node_id = uuid4()
    await client._transport.app.state.pool.execute(
        """
        INSERT INTO graph_nodes
          (id, user_id, kind, label, confidence, epistemic_status, extractor)
        VALUES ($1, $2, $3, $4, 0.4, 'hypothesis', 'test')
        """,
        node_id,
        account.user_id,
        kind,
        "a user-curated theme",
    )
    return str(node_id)


async def test_identity_selection_is_idempotent_and_user_scoped(
    client: AsyncClient, account: Account, other_account: Account
):
    node_id = await make_node(client, account)

    first = await client.post(
        "/v1/identity/selections", headers=account.auth, json={"node_id": node_id}
    )
    second = await client.post(
        "/v1/identity/selections", headers=account.auth, json={"node_id": node_id}
    )
    assert first.status_code == second.status_code == 200
    assert first.json()["id"] == node_id

    own = await client.get("/v1/identity", headers=account.auth)
    assert [node["id"] for node in own.json()["nodes"]] == [node_id]
    other = await client.get("/v1/identity", headers=other_account.auth)
    assert other.json()["nodes"] == []

    removed = await client.patch(
        f"/v1/identity/selections/{node_id}",
        headers=account.auth,
        json={"status": "removed"},
    )
    assert removed.status_code == 200
    assert (await client.get("/v1/identity", headers=account.auth)).json()["nodes"] == []

    reselected = await client.post(
        "/v1/identity/selections", headers=account.auth, json={"node_id": node_id}
    )
    assert reselected.status_code == 200
    count = await client._transport.app.state.pool.fetchval(
        "SELECT count(*) FROM identity_selections WHERE user_id = $1 AND node_id = $2",
        account.user_id,
        node_id,
    )
    assert count == 1
