"""Themes, against a real Postgres and a real FalkorDB.

Clustering is the one claim in this system that cannot be checked by reading the
code: it depends on what a graph database returns for a graph. So these run
against both stores, and are marked `graph` so a run without FalkorDB can skip
them rather than fail confusingly.

What is worth pinning down here is not that clustering works — that is Graphiti's
problem — but that the things around it hold: a theme is a region rather than a
pair, it keeps its identity as the region grows, a rejection survives re-running,
and one person's graph never contributes to another person's themes.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import asyncpg
import pytest

from tests.integration.conftest import Account
from tlon.graph import communities, graphiti_client, projection

pytestmark = [
    pytest.mark.anyio,
    pytest.mark.integration,
    pytest.mark.graph,
]

DAY_ONE = datetime(2026, 3, 1, 9, 0, tzinfo=UTC)


async def ring(
    pool: asyncpg.Pool,
    account: Account,
    labels: list[str],
    existing: dict[str, UUID] | None = None,
) -> dict[str, UUID]:
    """A set of nodes wired into a cycle of associations.

    A ring rather than a star: every member has two neighbours, so the community
    is unambiguous and the test is not really testing a clustering tie-break.

    `existing` names things the person already had. Without it a second call
    builds a *parallel* region out of new nodes that happen to share labels,
    which is a different claim from the one under test: a region gaining a
    member is the same region, and only reusing the ids says that.
    """
    nodes: dict[str, UUID] = dict(existing or {})
    for label in labels:
        if label in nodes:
            continue
        node_id = uuid4()
        await pool.execute(
            """
            INSERT INTO graph_nodes
                (id, user_id, kind, label, confidence, epistemic_status, extractor)
            VALUES ($1, $2, 'Emotion', $3, 0.8, 'hypothesis', 'test')
            """,
            node_id,
            account.user_id,
            label,
        )
        nodes[label] = node_id

    ids = [nodes[label] for label in labels]
    for index, from_id in enumerate(ids):
        to_id = ids[(index + 1) % len(ids)]
        await pool.execute(
            """
            INSERT INTO graph_edges
                (id, user_id, kind, from_id, to_id, confidence, epistemic_status, extractor)
            VALUES ($1, $2, 'CO_OCCURS_WITH', $3, $4, 0.8, 'hypothesis', 'cooccurrence-v0.1')
            """,
            uuid4(),
            account.user_id,
            from_id,
            to_id,
        )
    return nodes


async def run_clustering(pool, account: Account) -> list[list[UUID]]:
    """Project and cluster, opening the FalkorDB handle inside the caller's loop.

    Built per call rather than as a fixture on purpose. FalkorDB's async client
    binds its connection pool to whichever event loop first touches it, and a
    fixture shared across differently-scoped loops deadlocks rather than failing —
    which costs far more to diagnose than reconnecting costs to run.
    """
    node_ids = [
        row["id"]
        for row in await pool.fetch(
            "SELECT id FROM graph_nodes WHERE user_id = $1 AND kind NOT IN ('Observation','Theme') ORDER BY id",
            account.user_id,
        )
    ]
    graphiti = graphiti_client.build()
    try:
        await graphiti.build_indices_and_constraints()
        await projection.project(pool, account.user_id, graphiti)
        return await communities.cluster(graphiti, account.user_id, node_ids)
    finally:
        await graphiti.close()


class TestWhatCountsAsATheme:
    async def test_a_group_of_things_becomes_one(self, pool: asyncpg.Pool, account: Account):
        await ring(pool, account, ["dread", "the office", "sleeping badly", "my manager"])
        clusters = await run_clustering(pool, account)
        await communities.reconcile(pool, account.user_id, clusters)

        themes = await communities.list_for_user(pool, account.user_id)
        assert len(themes) == 1
        assert set(themes[0]["members"]) == {
            "dread",
            "the office",
            "sleeping badly",
            "my manager",
        }

    async def test_a_pair_is_not_a_theme(self, pool: asyncpg.Pool, account: Account):
        # Two adjacent things are an association, and the graph already says that
        # with an edge. Calling it a theme would dress up a finding it already had.
        await ring(pool, account, ["dread", "the office"])
        clusters = await run_clustering(pool, account)
        assert clusters == []

    async def test_a_theme_is_named_in_the_persons_own_words(self):
        # Listed, not summarised. An invented heading is an interpretation, and a
        # heading is the hardest kind of interpretation to argue with.
        assert communities.label_for(["dread", "the office", "my manager"]) == (
            "dread, the office, my manager"
        )

    async def test_a_long_theme_says_how_many_it_left_out(self):
        label = communities.label_for(["a", "b", "c", "d", "e"])
        assert label == "a, b, c and 2 more"


class TestDurableIdentity:
    async def test_a_theme_keeps_its_id_as_the_region_grows(
        self, pool: asyncpg.Pool, account: Account
    ):
        members = await ring(pool, account, ["dread", "the office", "sleeping badly", "my manager"])
        clusters = await run_clustering(pool, account)
        await communities.reconcile(pool, account.user_id, clusters)
        original = (await communities.list_for_user(pool, account.user_id))[0]

        # The region gains a member. It is the same region with one more thing in
        # it, not a different one that happens to look similar.
        await ring(
            pool,
            account,
            ["dread", "the office", "sleeping badly", "the commute"],
            existing=members,
        )
        clusters = await run_clustering(pool, account)
        result = await communities.reconcile(pool, account.user_id, clusters)

        current = (await communities.list_for_user(pool, account.user_id))[0]
        assert current["id"] == original["id"]
        assert current["first_seen_at"] == original["first_seen_at"]
        assert result["added"] == []

    async def test_a_rejected_theme_stays_rejected(self, pool: asyncpg.Pool, account: Account):
        await ring(pool, account, ["dread", "the office", "sleeping badly", "my manager"])
        clusters = await run_clustering(pool, account)
        await communities.reconcile(pool, account.user_id, clusters)
        theme_id = UUID((await communities.list_for_user(pool, account.user_id))[0]["id"])

        await pool.execute(
            "UPDATE graph_nodes SET epistemic_status = 'user_rejected' WHERE id = $1",
            theme_id,
        )

        clusters = await run_clustering(pool, account)
        await communities.reconcile(pool, account.user_id, clusters)

        status = await pool.fetchval(
            "SELECT epistemic_status FROM graph_nodes WHERE id = $1", theme_id
        )
        assert status == "user_rejected"


class TestTheProjectionCannotHangClustering:
    """One projected edge per pair, because clustering does not survive two.

    Graphiti clusters with label propagation, and that algorithm does not
    terminate when a node sees the same neighbour twice — the two communities
    swap places forever. It is not an exotic shape either: a pair, a path of
    three, a star and a four-cycle all hang on a doubled edge. The projection is
    where that is prevented, because it is the last place this codebase controls
    before the loop starts, and the caller is a background agent with no timeout.
    """

    async def test_a_doubled_association_reaches_the_graph_store_once(
        self, pool: asyncpg.Pool, account: Account
    ):
        members = await ring(pool, account, ["dread", "the office", "sleeping badly"])
        # The same three things associated again — a second run of the detector,
        # or a row left over from an older version of it.
        await ring(pool, account, ["dread", "the office", "sleeping badly"], existing=members)

        edges = await pool.fetchval(
            "SELECT count(*) FROM graph_edges WHERE user_id = $1 AND kind = 'CO_OCCURS_WITH'",
            account.user_id,
        )
        projected = await projection._live_edges(pool, account.user_id)

        assert edges == 6, "the fixture must actually duplicate the associations"
        assert len(projected) == 3
        # And it still terminates and still finds the region.
        clusters = await run_clustering(pool, account)
        assert len(clusters) == 1
        assert len(clusters[0]) == 3

    async def test_a_duplicated_association_lands_on_one_edge_in_the_graph_store(
        self, pool: asyncpg.Pool, account: Account
    ):
        # Deduplicating the read is not enough on its own: each run picks one row
        # and, if the projected edge were keyed on that row's id, a later run
        # picking a different duplicate would leave *two* edges between the same
        # pair in FalkorDB — which is the shape label propagation cannot finish.
        # Keying on the pair makes the second edge impossible to express.
        members = await ring(pool, account, ["dread", "the office", "sleeping badly"])
        await run_clustering(pool, account)
        await ring(pool, account, ["dread", "the office", "sleeping badly"], existing=members)
        await run_clustering(pool, account)

        graphiti = graphiti_client.build()
        try:
            records, _, _ = await graphiti.driver.execute_query(
                """
                MATCH (n:Entity {group_id: $group})-[e:RELATES_TO]-(m:Entity {group_id: $group})
                RETURN count(e) AS edges
                """,
                group=projection.group_id(account.user_id),
            )
        finally:
            await graphiti.close()

        # Three pairs, counted from both ends.
        assert records[0]["edges"] == 6

    async def test_the_same_duplicate_projects_the_same_edge_every_run(
        self, pool: asyncpg.Pool, account: Account
    ):
        # A theme's membership must not wobble between runs because the
        # projection picked a different duplicate to keep.
        members = await ring(pool, account, ["dread", "the office", "sleeping badly"])
        await ring(pool, account, ["dread", "the office", "sleeping badly"], existing=members)

        first = [row["id"] for row in await projection._live_edges(pool, account.user_id)]
        second = [row["id"] for row in await projection._live_edges(pool, account.user_id)]

        assert first == second


class TestWhatTheDatabaseEnforces:
    async def test_a_theme_is_stored_as_an_inference(self, pool: asyncpg.Pool, account: Account):
        await ring(pool, account, ["dread", "the office", "sleeping badly"])
        clusters = await run_clustering(pool, account)
        await communities.reconcile(pool, account.user_id, clusters)

        row = await pool.fetchrow(
            "SELECT confidence, epistemic_status, extractor FROM graph_nodes WHERE user_id = $1 AND kind = 'Theme'",
            account.user_id,
        )
        assert row["confidence"] is not None
        assert row["epistemic_status"] == "hypothesis"
        assert row["extractor"] == communities.VERSION

    async def test_a_two_member_theme_cannot_be_stored(self, pool: asyncpg.Pool, account: Account):
        # The floor is a CHECK constraint, not just a Python threshold, so no
        # future caller can quietly lower it.
        node_id = uuid4()
        await pool.execute(
            """
            INSERT INTO graph_nodes
                (id, user_id, kind, label, confidence, epistemic_status, extractor)
            VALUES ($1, $2, 'Theme', 'a, b', 0.8, 'hypothesis', 'test')
            """,
            node_id,
            account.user_id,
        )
        with pytest.raises(asyncpg.CheckViolationError):
            await pool.execute(
                "INSERT INTO themes (node_id, user_id, detector, member_count) VALUES ($1, $2, 'test', 2)",
                node_id,
                account.user_id,
            )


class TestIsolation:
    async def test_one_persons_graph_never_joins_anothers_theme(
        self, pool: asyncpg.Pool, account: Account, other_account: Account
    ):
        await ring(pool, account, ["dread", "the office", "sleeping badly"])
        await ring(pool, other_account, ["running", "the park", "the morning"])

        mine = await run_clustering(pool, account)
        theirs = await run_clustering(pool, other_account)

        await communities.reconcile(pool, account.user_id, mine)
        await communities.reconcile(pool, other_account.user_id, theirs)

        my_themes = await communities.list_for_user(pool, account.user_id)
        assert set(my_themes[0]["members"]) == {"dread", "the office", "sleeping badly"}
