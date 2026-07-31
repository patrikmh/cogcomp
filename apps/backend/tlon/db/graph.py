"""Graph reads.

The explain query exists from day one on purpose. "Every inference must be
explainable" is only true if explanation is a first-class read path rather than
something reconstructed later from logs.
"""

from uuid import UUID

import asyncpg

from tlon.graph.schema import NodeKind


async def explain(pool: asyncpg.Pool, user_id: UUID, node_id: UUID) -> dict | None:
    """A node together with the user's own words that produced it."""
    row = await pool.fetchrow(
        """
        SELECT id, kind, label, created_at, confidence, epistemic_status, extractor
        FROM graph_nodes
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
        """,
        node_id,
        user_id,
    )
    if row is None:
        return None

    supporting = await pool.fetch(
        """
        SELECT o.node_id, o.content, o.source, o.captured_at
        FROM node_provenance p
        JOIN observations o ON o.node_id = p.observation_id
        JOIN graph_nodes n ON n.id = o.node_id
        WHERE p.node_id = $1 AND o.user_id = $2 AND n.deleted_at IS NULL
        ORDER BY o.captured_at DESC
        """,
        node_id,
        user_id,
    )

    return {
        "node": {
            "id": str(row["id"]),
            "kind": row["kind"],
            "label": row["label"],
            "created_at": row["created_at"],
            # Absent for observations, which make no claim and so carry no confidence.
            "confidence": row["confidence"],
            "epistemic_status": row["epistemic_status"],
            "extractor": row["extractor"],
        },
        "derived_from": [
            {
                "id": str(r["node_id"]),
                "content": r["content"],
                "source": r["source"],
                "captured_at": r["captured_at"],
            }
            for r in supporting
        ],
        # An observation explains itself.
        "is_observed": row["kind"] == NodeKind.OBSERVATION,
    }


async def kind_counts(pool: asyncpg.Pool, user_id: UUID) -> list[dict]:
    """Counts by node kind, for the dashboard. Scoped to one user, always."""
    rows = await pool.fetch(
        """
        SELECT kind, count(*) AS total
        FROM graph_nodes
        WHERE user_id = $1 AND deleted_at IS NULL
        GROUP BY kind
        ORDER BY total DESC
        """,
        user_id,
    )
    return [{"kind": r["kind"], "count": r["total"]} for r in rows]
