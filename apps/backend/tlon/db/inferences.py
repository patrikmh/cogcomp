"""Persisting extraction results.

Everything for one observation is written in a single transaction. A partial write —
nodes without their provenance rows, edges pointing at nodes that rolled back — would
be exactly the corruption the schema exists to prevent.

Provenance is written to `node_provenance` / `edge_provenance` rather than as
DERIVED_FROM edges. One storage location, enforced by foreign keys; the DERIVED_FROM
edge kind is reserved for the graph projection, which is generated from these tables.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import asyncpg

from tlon.domain.inference import EpistemicStatus
from tlon.extraction.models import OBSERVATION_REF, Extraction


def _uuid7_like() -> UUID:
    """Server-generated id for an inferred node.

    Observations carry client-minted UUIDv7s for offline capture; inferred nodes are
    born server-side, so ordering comes from created_at and a v4 is sufficient.
    """
    return uuid4()


async def persist(
    pool: asyncpg.Pool,
    *,
    user_id: UUID,
    observation_id: UUID,
    extraction: Extraction,
    extractor: str,
) -> dict[str, int]:
    """Write an extraction's nodes and edges, each linked back to the observation.

    Returns counts rather than the rows themselves — callers that want the graph read
    it back through the explain endpoint, which is the path users see.
    """
    errors = extraction.structural_errors()
    if errors:
        raise ValueError("; ".join(errors))

    async with pool.acquire() as conn, conn.transaction():
        # Confirm the observation exists, belongs to this user, and is live.
        # Doing this inside the transaction means a concurrent delete cannot
        # slip an orphaned inference in behind us.
        owner = await conn.fetchval(
            """
            SELECT o.user_id
            FROM observations o
            JOIN graph_nodes n ON n.id = o.node_id
            WHERE o.node_id = $1 AND o.user_id = $2 AND n.deleted_at IS NULL
            """,
            observation_id,
            user_id,
        )
        if owner is None:
            raise LookupError("observation not found")

        ref_to_id: dict[str, UUID] = {OBSERVATION_REF: observation_id}

        for node in extraction.nodes:
            node_id = _uuid7_like()
            ref_to_id[node.ref] = node_id
            await conn.execute(
                """
                INSERT INTO graph_nodes
                    (id, user_id, kind, label, confidence, epistemic_status, extractor)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                """,
                node_id,
                user_id,
                str(node.kind),
                node.label.strip(),
                node.confidence,
                str(EpistemicStatus.HYPOTHESIS),
                extractor,
            )
            # Provenance is written in the same breath as the node. There is no
            # window in which an inferred node exists without a citation.
            await conn.execute(
                "INSERT INTO node_provenance (node_id, observation_id) VALUES ($1, $2)",
                node_id,
                observation_id,
            )

        for edge in extraction.edges:
            edge_id = _uuid7_like()
            await conn.execute(
                """
                INSERT INTO graph_edges
                    (id, user_id, kind, from_id, to_id, note,
                     confidence, epistemic_status, extractor)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """,
                edge_id,
                user_id,
                str(edge.kind),
                ref_to_id[edge.from_ref],
                ref_to_id[edge.to_ref],
                edge.note,
                edge.confidence,
                str(EpistemicStatus.HYPOTHESIS),
                extractor,
            )
            await conn.execute(
                "INSERT INTO edge_provenance (edge_id, observation_id) VALUES ($1, $2)",
                edge_id,
                observation_id,
            )

    return {"nodes": len(extraction.nodes), "edges": len(extraction.edges)}


async def already_extracted(pool: asyncpg.Pool, observation_id: UUID) -> bool:
    """True when this observation has already produced inferences.

    Extraction is not idempotent — running it twice writes a second set of nodes
    citing the same entry. The API uses this to refuse rather than duplicate.
    """
    count = await pool.fetchval(
        "SELECT count(*) FROM node_provenance WHERE observation_id = $1", observation_id
    )
    return bool(count)
