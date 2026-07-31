"""The graph read API — what the explorer and dashboard render from."""

from uuid import uuid4

import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account

pytestmark = [pytest.mark.anyio, pytest.mark.integration]


async def entry(client: AsyncClient, account: Account, content: str = "an entry") -> str:
    observation_id = str(uuid4())
    response = await client.post(
        "/v1/observations",
        headers=account.auth,
        json={"id": observation_id, "content": content, "source": "text"},
    )
    assert response.status_code == 201
    return observation_id


async def extracted_entry(client: AsyncClient, account: Account, content: str = "x") -> str:
    observation_id = await entry(client, account, content)
    await client.post(f"/v1/observations/{observation_id}/extract", headers=account.auth)
    return observation_id


class TestSubgraph:
    async def test_an_empty_graph_returns_empty_lists(self, client: AsyncClient, account: Account):
        body = (await client.get("/v1/graph", headers=account.auth)).json()
        assert body["nodes"] == []
        assert body["edges"] == []
        assert body["total_nodes"] == 0
        assert body["truncated"] is False

    async def test_nodes_and_edges_are_returned_together(
        self, client: AsyncClient, account: Account
    ):
        await extracted_entry(client, account)
        body = (await client.get("/v1/graph", headers=account.auth)).json()
        assert len(body["nodes"]) >= 2  # the observation and its inference
        assert len(body["edges"]) >= 1

    async def test_every_edge_endpoint_is_present_in_the_returned_nodes(
        self, client: AsyncClient, account: Account
    ):
        # The invariant the client depends on: it should never be handed an edge
        # pointing at a node it was not given, which would render as a line to
        # nowhere.
        for i in range(3):
            await extracted_entry(client, account, f"entry {i}")

        body = (await client.get("/v1/graph", headers=account.auth)).json()
        node_ids = {n["id"] for n in body["nodes"]}
        for edge in body["edges"]:
            assert edge["from_id"] in node_ids
            assert edge["to_id"] in node_ids

    async def test_the_invariant_holds_when_the_limit_cuts_the_graph(
        self, client: AsyncClient, account: Account
    ):
        # The case that actually breaks naive implementations: a low limit slices
        # through the middle of the graph, orphaning edges.
        for i in range(5):
            await extracted_entry(client, account, f"entry {i}")

        body = (await client.get("/v1/graph?limit=3", headers=account.auth)).json()
        assert len(body["nodes"]) == 3
        node_ids = {n["id"] for n in body["nodes"]}
        for edge in body["edges"]:
            assert edge["from_id"] in node_ids
            assert edge["to_id"] in node_ids

    async def test_truncation_is_reported_honestly(self, client: AsyncClient, account: Account):
        for i in range(4):
            await entry(client, account, f"entry {i}")

        body = (await client.get("/v1/graph?limit=2", headers=account.auth)).json()
        assert body["returned"] == 2
        assert body["total_nodes"] == 4
        # So the client can say "showing 2 of 4" rather than implying the graph is
        # smaller than it is.
        assert body["truncated"] is True

    async def test_the_limit_is_capped(self, client: AsyncClient, account: Account):
        await entry(client, account)
        body = (await client.get("/v1/graph?limit=100000", headers=account.auth)).json()
        assert body["returned"] <= 500

    async def test_observations_survive_a_confidence_filter(
        self, client: AsyncClient, account: Account
    ):
        # The stub emits 0.3, so a 0.5 floor removes every inference. The
        # observation must remain: it is not a claim, and dropping it would leave
        # the graph without the thing everything else cites.
        await extracted_entry(client, account)
        body = (await client.get("/v1/graph?min_confidence=0.5", headers=account.auth)).json()
        kinds = [n["kind"] for n in body["nodes"]]
        assert "Observation" in kinds
        assert all(k == "Observation" for k in kinds)

    async def test_a_low_floor_keeps_the_inferences(self, client: AsyncClient, account: Account):
        await extracted_entry(client, account)
        body = (await client.get("/v1/graph?min_confidence=0.1", headers=account.auth)).json()
        assert any(n["kind"] != "Observation" for n in body["nodes"])

    async def test_filtering_by_kind(self, client: AsyncClient, account: Account):
        await extracted_entry(client, account)
        body = (await client.get("/v1/graph?kinds=Observation", headers=account.auth)).json()
        assert {n["kind"] for n in body["nodes"]} == {"Observation"}

    async def test_an_unknown_kind_is_rejected(self, client: AsyncClient, account: Account):
        response = await client.get("/v1/graph?kinds=Disorder", headers=account.auth)
        assert response.status_code == 422

    @pytest.mark.parametrize("value", [-0.1, 1.5])
    async def test_an_out_of_range_confidence_is_rejected(
        self, client: AsyncClient, account: Account, value: float
    ):
        response = await client.get(f"/v1/graph?min_confidence={value}", headers=account.auth)
        assert response.status_code == 422

    async def test_nodes_carry_the_tentative_flag(self, client: AsyncClient, account: Account):
        await extracted_entry(client, account)
        body = (await client.get("/v1/graph", headers=account.auth)).json()
        inferred = [n for n in body["nodes"] if n["kind"] != "Observation"]
        assert inferred and all(n["tentative"] for n in inferred)

    async def test_observations_are_never_tentative(self, client: AsyncClient, account: Account):
        await entry(client, account)
        body = (await client.get("/v1/graph", headers=account.auth)).json()
        observation = next(n for n in body["nodes"] if n["kind"] == "Observation")
        assert observation["tentative"] is False
        assert observation["confidence"] is None

    async def test_a_deleted_node_leaves_the_graph(self, client: AsyncClient, account: Account):
        observation_id = await entry(client, account)
        await client.delete(f"/v1/observations/{observation_id}", headers=account.auth)
        body = (await client.get("/v1/graph", headers=account.auth)).json()
        assert observation_id not in {n["id"] for n in body["nodes"]}


class TestNeighbours:
    async def test_a_node_returns_its_direct_connections(
        self, client: AsyncClient, account: Account
    ):
        observation_id = await extracted_entry(client, account)
        body = (
            await client.get(f"/v1/graph/nodes/{observation_id}/neighbours", headers=account.auth)
        ).json()
        assert body["node"]["id"] == observation_id
        assert body["neighbours"]
        assert body["edges"]

    async def test_edges_only_reference_the_node_or_its_neighbours(
        self, client: AsyncClient, account: Account
    ):
        observation_id = await extracted_entry(client, account)
        body = (
            await client.get(f"/v1/graph/nodes/{observation_id}/neighbours", headers=account.auth)
        ).json()
        known = {body["node"]["id"]} | {n["id"] for n in body["neighbours"]}
        for edge in body["edges"]:
            assert edge["from_id"] in known
            assert edge["to_id"] in known

    async def test_an_edge_to_a_deleted_neighbour_is_dropped(
        self, client: AsyncClient, account: Account
    ):
        # Soft-deleting a node leaves its edges behind. Returning them would again
        # give the client a line to nowhere.
        observation_id = await extracted_entry(client, account)
        pool = client._transport.app.state.pool
        inferred_id = await pool.fetchval(
            "SELECT id FROM graph_nodes WHERE kind <> 'Observation' LIMIT 1"
        )
        await pool.execute("UPDATE graph_nodes SET deleted_at = now() WHERE id = $1", inferred_id)

        body = (
            await client.get(f"/v1/graph/nodes/{observation_id}/neighbours", headers=account.auth)
        ).json()
        assert body["neighbours"] == []
        assert body["edges"] == []

    async def test_an_unknown_node_is_a_not_found(self, client: AsyncClient, account: Account):
        response = await client.get(f"/v1/graph/nodes/{uuid4()}/neighbours", headers=account.auth)
        assert response.status_code == 404


class TestIsolation:
    async def test_the_graph_excludes_another_users_nodes(
        self, client: AsyncClient, account: Account, other_account: Account
    ):
        await extracted_entry(client, account, "private")
        body = (await client.get("/v1/graph", headers=other_account.auth)).json()
        assert body["nodes"] == []
        assert body["total_nodes"] == 0

    async def test_neighbours_of_another_users_node_is_a_not_found(
        self, client: AsyncClient, account: Account, other_account: Account
    ):
        observation_id = await extracted_entry(client, account)
        response = await client.get(
            f"/v1/graph/nodes/{observation_id}/neighbours", headers=other_account.auth
        )
        assert response.status_code == 404

    async def test_both_endpoints_require_authentication(self, client: AsyncClient):
        assert (await client.get("/v1/graph")).status_code == 401
        assert (await client.get(f"/v1/graph/nodes/{uuid4()}/neighbours")).status_code == 401
