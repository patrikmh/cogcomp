"""Themes over HTTP, against a real database.

Clustering itself is covered in `test_themes.py`, which needs a live FalkorDB.
What is testable here without one is the read path: that a stored region can be
listed and opened, that it arrives with the associations that formed it, that it
never carries an invented name, and that one person's regions stay theirs.
"""

from uuid import UUID, uuid4

import asyncpg
import pytest
from httpx import AsyncClient

from tests.integration.conftest import Account
from tlon.graph import communities

pytestmark = [pytest.mark.anyio, pytest.mark.integration]


async def region(
    pool: asyncpg.Pool,
    account: Account,
    labels: tuple[str, ...] = ("dread", "the office", "my manager"),
    *,
    confidence: float = 0.8,
) -> tuple[UUID, list[UUID]]:
    """A stored theme over a ring of associated nodes.

    Written directly rather than mined, so these tests do not need a graph
    database to check what the API does with a region that already exists.
    """
    member_ids = []
    for label in labels:
        node_id = uuid4()
        await pool.execute(
            """
            INSERT INTO graph_nodes
                (id, user_id, kind, label, confidence, epistemic_status, extractor)
            VALUES ($1, $2, 'Emotion', $3, $4, 'hypothesis', 'test')
            """,
            node_id,
            account.user_id,
            label,
            confidence,
        )
        member_ids.append(node_id)

    for index, from_id in enumerate(member_ids):
        to_id = member_ids[(index + 1) % len(member_ids)]
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

    theme_id = uuid4()
    await pool.execute(
        """
        INSERT INTO graph_nodes
            (id, user_id, kind, label, confidence, epistemic_status, extractor)
        VALUES ($1, $2, 'Theme', $3, $4, 'hypothesis', $5)
        """,
        theme_id,
        account.user_id,
        communities.label_for(list(labels)),
        confidence,
        communities.VERSION,
    )
    await pool.execute(
        """
        INSERT INTO themes (node_id, user_id, detector, member_count)
        VALUES ($1, $2, $3, $4)
        """,
        theme_id,
        account.user_id,
        communities.DETECTOR,
        len(member_ids),
    )
    for node_id in member_ids:
        await pool.execute(
            "INSERT INTO theme_members (theme_id, node_id) VALUES ($1, $2)",
            theme_id,
            node_id,
        )
    return theme_id, member_ids


class TestReadingThemes:
    async def test_a_region_can_be_listed(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await region(pool, account)

        response = await client.get("/v1/themes", headers=account.auth)

        assert response.status_code == 200, response.text
        themes = response.json()
        assert len(themes) == 1
        assert themes[0]["members"] == ["dread", "my manager", "the office"]
        assert themes[0]["member_count"] == 3
        assert themes[0]["detector"] == communities.DETECTOR

    async def test_a_region_is_named_by_what_is_in_it(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        # No summary, no heading, no invented phrase. A name for a region of
        # someone's life is an interpretation, and an interpretation presented
        # as a title is the hardest kind to argue with.
        await region(pool, account)

        theme = (await client.get("/v1/themes", headers=account.auth)).json()[0]

        assert theme["label"] == "dread, the office, my manager"
        assert set(theme["label"].split(", ")) == set(theme["members"])

    async def test_opening_a_region_shows_the_associations_that_formed_it(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        theme_id, member_ids = await region(pool, account)

        response = await client.get(f"/v1/themes/{theme_id}", headers=account.auth)

        assert response.status_code == 200, response.text
        detail = response.json()
        # Every member arrives with its node id, which is what makes the claim
        # checkable: any of them can be opened and followed back to entries.
        assert {UUID(member["id"]) for member in detail["members"]} == set(member_ids)
        assert all(member["kind"] == "Emotion" for member in detail["members"])
        # The ring, and only the ring — three edges among three members.
        assert len(detail["associations"]) == 3
        for association in detail["associations"]:
            assert UUID(association["from_id"]) in set(member_ids)
            assert UUID(association["to_id"]) in set(member_ids)

    async def test_an_association_leaving_the_region_is_not_part_of_it(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        theme_id, member_ids = await region(pool, account)
        outsider = uuid4()
        await pool.execute(
            """
            INSERT INTO graph_nodes
                (id, user_id, kind, label, confidence, epistemic_status, extractor)
            VALUES ($1, $2, 'Activity', 'cycling', 0.8, 'hypothesis', 'test')
            """,
            outsider,
            account.user_id,
        )
        await pool.execute(
            """
            INSERT INTO graph_edges
                (id, user_id, kind, from_id, to_id, confidence, epistemic_status, extractor)
            VALUES ($1, $2, 'CO_OCCURS_WITH', $3, $4, 0.8, 'hypothesis', 'cooccurrence-v0.1')
            """,
            uuid4(),
            account.user_id,
            member_ids[0],
            outsider,
        )

        detail = (await client.get(f"/v1/themes/{theme_id}", headers=account.auth)).json()

        # True, but not why these three are one region.
        assert len(detail["associations"]) == 3
        assert all(
            UUID(a["to_id"]) != outsider and UUID(a["from_id"]) != outsider
            for a in detail["associations"]
        )

    async def test_a_low_confidence_region_is_marked_tentative(
        self, client: AsyncClient, pool: asyncpg.Pool, account: Account
    ):
        await region(pool, account, confidence=0.3)

        assert (await client.get("/v1/themes", headers=account.auth)).json()[0]["tentative"] is True


class TestIsolationAndAuth:
    async def test_regions_are_private_to_their_user(
        self,
        client: AsyncClient,
        pool: asyncpg.Pool,
        account: Account,
        other_account: Account,
    ):
        theme_id, _ = await region(pool, account)

        assert (await client.get("/v1/themes", headers=other_account.auth)).json() == []
        assert (
            await client.get(f"/v1/themes/{theme_id}", headers=other_account.auth)
        ).status_code == 404

    async def test_an_unknown_region_is_a_not_found(self, client: AsyncClient, account: Account):
        assert (await client.get(f"/v1/themes/{uuid4()}", headers=account.auth)).status_code == 404

    async def test_reading_regions_requires_a_token(self, client: AsyncClient):
        assert (await client.get("/v1/themes")).status_code == 401
        assert (await client.get(f"/v1/themes/{uuid4()}")).status_code == 401
