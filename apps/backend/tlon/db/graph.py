"""Graph reads.

The explain query exists from day one on purpose. "Every inference must be
explainable" is only true if explanation is a first-class read path rather than
something reconstructed later from logs.
"""

from datetime import datetime
from uuid import UUID

import asyncpg

from tlon.domain.inference import TENTATIVE_THRESHOLD
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
        SELECT o.node_id, o.content, o.source, o.captured_at,
               -- How long after the moment it describes this was written.
               -- Retrospective accounts are pulled toward peaks and endings, so
               -- an entry written days later is a different kind of evidence
               -- from one typed at the time — and the reader is the only one who
               -- can weigh that.
               greatest(n.created_at - o.captured_at, interval '0') AS recall_delay
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
                # Whole days, because that is the grain at which recall starts
                # to matter and the grain a person can act on. Zero for anything
                # written the same day.
                "recall_days": r["recall_delay"].days,
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


#: A phone renders a few hundred nodes before the layout becomes unreadable and the
#: frame rate suffers. The cap is a rendering constraint, not a database one.
MAX_SUBGRAPH_NODES = 500
DEFAULT_SUBGRAPH_NODES = 150


async def subgraph(
    pool: asyncpg.Pool,
    user_id: UUID,
    *,
    limit: int = DEFAULT_SUBGRAPH_NODES,
    min_confidence: float | None = None,
    kinds: list[str] | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
) -> dict:
    """Nodes and edges for rendering, scoped to one user.

    Observations are always included when they fall in the window, whatever the
    confidence filter says — they are not claims and have no confidence to filter
    on. Excluding them would strip the graph of the very things everything else
    cites, leaving inferences hanging off nothing.
    """
    limit = max(1, min(limit, MAX_SUBGRAPH_NODES))

    node_rows = await pool.fetch(
        """
        SELECT id, kind, label, created_at, confidence, epistemic_status, extractor
        FROM graph_nodes
        WHERE user_id = $1
          AND deleted_at IS NULL
          AND ($2::timestamptz IS NULL OR created_at >= $2)
          AND ($3::timestamptz IS NULL OR created_at < $3)
          AND ($4::text[] IS NULL OR kind = ANY($4))
          AND (
                $5::real IS NULL
                OR kind = 'Observation'
                OR confidence >= $5
              )
        ORDER BY created_at DESC
        LIMIT $6
        """,
        user_id,
        since,
        until,
        kinds,
        min_confidence,
        limit,
    )

    node_ids = [row["id"] for row in node_rows]

    # Only edges whose *both* endpoints survived the filters and the limit. An edge
    # pointing at a node that was cut renders as a line to nowhere, so the pruning
    # has to happen here rather than being left to the client.
    edge_rows = (
        await pool.fetch(
            """
            SELECT id, kind, from_id, to_id, note, confidence, epistemic_status, extractor
            FROM graph_edges
            WHERE user_id = $1
              AND deleted_at IS NULL
              AND from_id = ANY($2::uuid[])
              AND to_id = ANY($2::uuid[])
            """,
            user_id,
            node_ids,
        )
        if node_ids
        else []
    )

    total = await pool.fetchval(
        "SELECT count(*) FROM graph_nodes WHERE user_id = $1 AND deleted_at IS NULL",
        user_id,
    )

    return {
        "nodes": [_node_json(row) for row in node_rows],
        "edges": [_edge_json(row) for row in edge_rows],
        # So the client can say "showing 150 of 1,200" rather than implying the
        # graph is smaller than it is.
        "returned": len(node_rows),
        "total_nodes": total,
        "truncated": len(node_rows) < total,
    }


async def neighbours(pool: asyncpg.Pool, user_id: UUID, node_id: UUID) -> dict | None:
    """One node and everything directly connected to it.

    What a tap on a node in the explorer needs. Direction is preserved because an
    edge's meaning depends on it — TRIGGERED_BY one way round is a different claim
    from the other.
    """
    centre = await pool.fetchrow(
        """
        SELECT id, kind, label, created_at, confidence, epistemic_status, extractor
        FROM graph_nodes
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
        """,
        node_id,
        user_id,
    )
    if centre is None:
        return None

    edge_rows = await pool.fetch(
        """
        SELECT id, kind, from_id, to_id, note, confidence, epistemic_status, extractor
        FROM graph_edges
        WHERE user_id = $1 AND deleted_at IS NULL AND ($2 IN (from_id, to_id))
        """,
        user_id,
        node_id,
    )

    neighbour_ids = {r["from_id"] for r in edge_rows} | {r["to_id"] for r in edge_rows}
    neighbour_ids.discard(node_id)

    neighbour_rows = (
        await pool.fetch(
            """
            SELECT id, kind, label, created_at, confidence, epistemic_status, extractor
            FROM graph_nodes
            WHERE user_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])
            """,
            user_id,
            list(neighbour_ids),
        )
        if neighbour_ids
        else []
    )

    # A soft-deleted neighbour leaves its edge behind, which would again render as
    # a line to nowhere.
    live_ids = {row["id"] for row in neighbour_rows} | {node_id}

    return {
        "node": _node_json(centre),
        "neighbours": [_node_json(row) for row in neighbour_rows],
        "edges": [
            _edge_json(row)
            for row in edge_rows
            if row["from_id"] in live_ids and row["to_id"] in live_ids
        ],
    }


def _node_json(row: asyncpg.Record) -> dict:
    confidence = row["confidence"]
    return {
        "id": str(row["id"]),
        "kind": row["kind"],
        "label": row["label"],
        "created_at": row["created_at"],
        "confidence": confidence,
        "epistemic_status": row["epistemic_status"],
        "extractor": row["extractor"],
        # Observations are not claims, so they are never tentative.
        "tentative": confidence is not None and confidence < TENTATIVE_THRESHOLD,
    }


def _edge_json(row: asyncpg.Record) -> dict:
    return {
        "id": str(row["id"]),
        "kind": row["kind"],
        "from_id": str(row["from_id"]),
        "to_id": str(row["to_id"]),
        "note": row["note"],
        "confidence": row["confidence"],
        "epistemic_status": row["epistemic_status"],
        "extractor": row["extractor"],
        "tentative": row["confidence"] < TENTATIVE_THRESHOLD,
    }
