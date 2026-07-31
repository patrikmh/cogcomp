"""The database refuses to store an unexplainable inference.

These assert against Postgres directly rather than through the API. The application
should never attempt these writes — the point is that the schema stops them even if
a future service, migration, or bug tries.
"""

import pytest
from asyncpg.exceptions import CheckViolationError, ForeignKeyViolationError

from tests.integration.conftest import Account

pytestmark = [pytest.mark.anyio, pytest.mark.integration]

INFERRED = """
    INSERT INTO graph_nodes (id, user_id, kind, label, confidence, epistemic_status, extractor)
    VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
"""


class TestTwoTierRule:
    async def test_an_inferred_node_without_confidence_is_rejected(self, client, account: Account):
        with pytest.raises(CheckViolationError, match="two_tier"):
            await client._transport.app.state.pool.execute(
                "INSERT INTO graph_nodes (id, user_id, kind, label) "
                "VALUES (gen_random_uuid(), $1, 'Thought', 'x')",
                account.user_id,
            )

    async def test_an_inferred_node_without_an_extractor_is_rejected(
        self, client, account: Account
    ):
        with pytest.raises(CheckViolationError, match="two_tier"):
            await client._transport.app.state.pool.execute(
                INFERRED, account.user_id, "Thought", "x", 0.8, "hypothesis", None
            )

    async def test_an_observation_carrying_confidence_is_rejected(self, client, account: Account):
        # Observations are not claims; giving one a confidence would be a category error.
        with pytest.raises(CheckViolationError, match="two_tier"):
            await client._transport.app.state.pool.execute(
                INFERRED, account.user_id, "Observation", "x", 0.9, "hypothesis", "e"
            )

    @pytest.mark.parametrize("confidence", [-0.1, 1.4])
    async def test_confidence_outside_the_unit_interval_is_rejected(
        self, client, account: Account, confidence: float
    ):
        with pytest.raises(CheckViolationError, match="two_tier"):
            await client._transport.app.state.pool.execute(
                INFERRED, account.user_id, "Emotion", "dread", confidence, "hypothesis", "e"
            )

    async def test_a_fully_specified_inferred_node_is_accepted(self, client, account: Account):
        await client._transport.app.state.pool.execute(
            INFERRED, account.user_id, "Belief", "x", 0.6, "hypothesis", "extract-v0.1/test"
        )


class TestNeverDiagnose:
    @pytest.mark.parametrize(
        "kind", ["Disorder", "Symptom", "Diagnosis", "ScreeningScore", "Severity"]
    )
    async def test_diagnostic_kinds_cannot_be_stored(self, client, account: Account, kind: str):
        # The vocabulary is absent by construction, so no extractor, migration, or
        # future service can introduce one without changing this constraint.
        with pytest.raises(CheckViolationError, match="kind_known"):
            await client._transport.app.state.pool.execute(
                INFERRED, account.user_id, kind, "label", 0.9, "hypothesis", "e"
            )

    async def test_an_unknown_epistemic_status_is_rejected(self, client, account: Account):
        with pytest.raises(CheckViolationError, match="epistemic_status_known"):
            await client._transport.app.state.pool.execute(
                INFERRED, account.user_id, "Thought", "x", 0.5, "confirmed_fact", "e"
            )


class TestProvenanceIntegrity:
    async def test_provenance_cannot_point_at_a_non_observation(self, client, account: Account):
        pool = client._transport.app.state.pool
        node_id = await pool.fetchval(
            "INSERT INTO graph_nodes "
            "(id, user_id, kind, label, confidence, epistemic_status, extractor) "
            "VALUES (gen_random_uuid(), $1, 'Thought', 'x', 0.5, 'hypothesis', 'e') RETURNING id",
            account.user_id,
        )
        with pytest.raises(ForeignKeyViolationError):
            await pool.execute(
                "INSERT INTO node_provenance (node_id, observation_id) VALUES ($1, $2)",
                node_id,
                node_id,  # a Thought, not an Observation
            )

    async def test_deleting_an_observation_cascades_to_its_provenance(
        self, client, account: Account
    ):
        pool = client._transport.app.state.pool
        observation_id = await pool.fetchval(
            "INSERT INTO graph_nodes (id, user_id, kind, label) "
            "VALUES (gen_random_uuid(), $1, 'Observation', 'raw') RETURNING id",
            account.user_id,
        )
        await pool.execute(
            "INSERT INTO observations (node_id, user_id, content, source, captured_at) "
            "VALUES ($1, $2, 'raw', 'text', now())",
            observation_id,
            account.user_id,
        )
        node_id = await pool.fetchval(
            "INSERT INTO graph_nodes "
            "(id, user_id, kind, label, confidence, epistemic_status, extractor) "
            "VALUES (gen_random_uuid(), $1, 'Thought', 'x', 0.5, 'hypothesis', 'e') RETURNING id",
            account.user_id,
        )
        await pool.execute(
            "INSERT INTO node_provenance (node_id, observation_id) VALUES ($1, $2)",
            node_id,
            observation_id,
        )

        # A hard delete must not leave provenance pointing into nothing.
        await pool.execute("DELETE FROM graph_nodes WHERE id = $1", observation_id)
        assert await pool.fetchval("SELECT count(*) FROM node_provenance") == 0

    async def test_deleting_a_user_removes_their_entire_graph(self, client, account: Account):
        pool = client._transport.app.state.pool
        await pool.execute(INFERRED, account.user_id, "Thought", "x", 0.5, "hypothesis", "e")
        await pool.execute("DELETE FROM users WHERE id = $1", account.user_id)
        assert await pool.fetchval("SELECT count(*) FROM graph_nodes") == 0


class TestEdgeConstraints:
    async def _two_nodes(self, pool, user_id):
        return [
            await pool.fetchval(
                "INSERT INTO graph_nodes "
                "(id, user_id, kind, label, confidence, epistemic_status, extractor) "
                f"VALUES (gen_random_uuid(), $1, '{kind}', 'x', 0.5, 'hypothesis', 'e') "
                "RETURNING id",
                user_id,
            )
            for kind in ("Thought", "Belief")
        ]

    async def test_relates_to_without_a_note_is_rejected(self, client, account: Account):
        pool = client._transport.app.state.pool
        a, b = await self._two_nodes(pool, account.user_id)
        with pytest.raises(CheckViolationError, match="relates_to_needs_note"):
            await pool.execute(
                "INSERT INTO graph_edges "
                "(id, user_id, kind, from_id, to_id, confidence, epistemic_status, extractor) "
                "VALUES (gen_random_uuid(), $1, 'RELATES_TO', $2, $3, 0.5, 'hypothesis', 'e')",
                account.user_id,
                a,
                b,
            )

    async def test_relates_to_with_a_note_is_accepted(self, client, account: Account):
        pool = client._transport.app.state.pool
        a, b = await self._two_nodes(pool, account.user_id)
        await pool.execute(
            "INSERT INTO graph_edges "
            "(id, user_id, kind, from_id, to_id, note, confidence, epistemic_status, extractor) "
            "VALUES (gen_random_uuid(), $1, 'RELATES_TO', $2, $3, 'same deadline', 0.5, "
            "'hypothesis', 'e')",
            account.user_id,
            a,
            b,
        )

    async def test_a_self_loop_is_rejected(self, client, account: Account):
        pool = client._transport.app.state.pool
        a, _ = await self._two_nodes(pool, account.user_id)
        with pytest.raises(CheckViolationError, match="no_self_loop"):
            await pool.execute(
                "INSERT INTO graph_edges "
                "(id, user_id, kind, from_id, to_id, confidence, epistemic_status, extractor) "
                "VALUES (gen_random_uuid(), $1, 'ABOUT', $2, $2, 0.5, 'hypothesis', 'e')",
                account.user_id,
                a,
            )

    async def test_an_unknown_edge_kind_is_rejected(self, client, account: Account):
        pool = client._transport.app.state.pool
        a, b = await self._two_nodes(pool, account.user_id)
        with pytest.raises(CheckViolationError, match="kind_known"):
            await pool.execute(
                "INSERT INTO graph_edges "
                "(id, user_id, kind, from_id, to_id, confidence, epistemic_status, extractor) "
                "VALUES (gen_random_uuid(), $1, 'CAUSES', $2, $3, 0.5, 'hypothesis', 'e')",
                account.user_id,
                a,
                b,
            )


class TestEmailNormalization:
    async def test_a_non_normalized_email_is_rejected(self, client):
        with pytest.raises(CheckViolationError, match="email_normalized"):
            await client._transport.app.state.pool.execute(
                "INSERT INTO users (id, email) VALUES (gen_random_uuid(), 'Mixed@Case.com')"
            )
