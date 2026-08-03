"""Persistence for the user-curated identity projection."""

from uuid import UUID, uuid4

import asyncpg

from tlon.domain.identity import IdentitySelectionStatus

_NODE_COLUMNS = """
    n.id, n.kind, n.label, n.created_at, n.confidence,
    n.epistemic_status, n.extractor, s.status, s.created_at AS selected_at
"""


def _node(row: asyncpg.Record) -> dict:
    return {
        "id": str(row["id"]),
        "kind": row["kind"],
        "label": row["label"],
        "created_at": row["created_at"],
        "confidence": row["confidence"],
        "epistemic_status": row["epistemic_status"],
        "extractor": row["extractor"],
        "tentative": row["confidence"] is not None and row["confidence"] < 0.5,
        "status": row["status"],
        "selected_at": row["selected_at"],
    }


async def projection(pool: asyncpg.Pool, user_id: UUID) -> dict:
    rows = await pool.fetch(
        f"""
        SELECT {_NODE_COLUMNS}
        FROM identity_selections s
        JOIN graph_nodes n ON n.id = s.node_id AND n.user_id = s.user_id
        WHERE s.user_id = $1 AND s.status = 'selected' AND n.deleted_at IS NULL
          AND n.kind IN ('Value', 'Belief', 'Need', 'Activity')
        ORDER BY s.updated_at DESC, n.created_at DESC
        """,
        user_id,
    )
    ids = [row["id"] for row in rows]
    edges = (
        await pool.fetch(
            """
        SELECT id, kind, from_id, to_id, note, confidence, epistemic_status, extractor
        FROM graph_edges
        WHERE user_id = $1 AND deleted_at IS NULL
          AND from_id = ANY($2::uuid[]) AND to_id = ANY($2::uuid[])
        """,
            user_id,
            ids,
        )
        if ids
        else []
    )
    return {
        "nodes": [_node(row) for row in rows],
        "edges": [
            {
                "id": str(row["id"]),
                "kind": row["kind"],
                "from_id": str(row["from_id"]),
                "to_id": str(row["to_id"]),
                "note": row["note"],
                "confidence": row["confidence"],
                "epistemic_status": row["epistemic_status"],
                "extractor": row["extractor"],
                "tentative": row["confidence"] < 0.5,
            }
            for row in edges
        ],
    }


async def candidates(pool: asyncpg.Pool, user_id: UUID) -> list[dict]:
    rows = await pool.fetch(
        f"""
        SELECT {_NODE_COLUMNS}
        FROM graph_nodes n
        LEFT JOIN identity_selections s ON s.node_id = n.id AND s.user_id = n.user_id
        WHERE n.user_id = $1 AND n.deleted_at IS NULL
          AND n.kind IN ('Value', 'Belief', 'Need', 'Activity')
        ORDER BY n.created_at DESC
        """,
        user_id,
    )
    return [_node(row) for row in rows]


async def select_node(pool: asyncpg.Pool, user_id: UUID, node_id: UUID) -> dict | None:
    async with pool.acquire() as conn, conn.transaction():
        node = await conn.fetchrow(
            """
            SELECT id, kind, label, created_at, confidence, epistemic_status, extractor
            FROM graph_nodes
            WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
              AND kind IN ('Value', 'Belief', 'Need', 'Activity')
            FOR UPDATE
            """,
            node_id,
            user_id,
        )
        if node is None:
            return None
        row = await conn.fetchrow(
            """
            INSERT INTO identity_selections (id, user_id, node_id, status)
            VALUES ($1, $2, $3, 'selected')
            ON CONFLICT (user_id, node_id) DO UPDATE
              SET status = 'selected', updated_at = now()
            RETURNING id, user_id, node_id, status, created_at, updated_at
            """,
            uuid4(),
            user_id,
            node_id,
        )
    node_data = dict(node)
    node_data.update(status=row["status"], selected_at=row["created_at"])
    return {**_node(node_data), "selection_id": str(row["id"])}


async def update_selection(
    pool: asyncpg.Pool, user_id: UUID, node_id: UUID, status: IdentitySelectionStatus
) -> dict | None:
    async with pool.acquire() as conn, conn.transaction():
        if status is IdentitySelectionStatus.SELECTED:
            # Consolidation locks graph nodes before checking selections. Acquire
            # the same lock before reactivating a tombstone so consolidation sees
            # this transition atomically, and keep the lock order (graph node,
            # then selection) consistent with select_node and consolidation.
            node = await conn.fetchrow(
                """
                SELECT id, kind, label, created_at, confidence, epistemic_status, extractor
                FROM graph_nodes
                WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
                  AND kind IN ('Value', 'Belief', 'Need', 'Activity')
                FOR UPDATE
                """,
                node_id,
                user_id,
            )
            if node is None:
                return None

            row = await conn.fetchrow(
                """
                UPDATE identity_selections
                SET status = 'selected', updated_at = now()
                WHERE user_id = $1 AND node_id = $2
                RETURNING id AS selection_id, status, created_at AS selected_at
                """,
                user_id,
                node_id,
            )
            if row is None:
                return None
            node_data = dict(node)
            node_data.update(status=row["status"], selected_at=row["selected_at"])
            return {**_node(node_data), "selection_id": str(row["selection_id"])}

        row = await conn.fetchrow(
            """
            UPDATE identity_selections s
            SET status = $3, updated_at = now()
            FROM graph_nodes n
            WHERE s.user_id = $1 AND s.node_id = $2 AND n.id = s.node_id
              AND n.user_id = $1 AND n.deleted_at IS NULL
              AND n.kind IN ('Value', 'Belief', 'Need', 'Activity')
            RETURNING s.id AS selection_id, s.status, s.created_at AS selected_at,
                      n.id AS node_id, n.kind, n.label, n.created_at, n.confidence,
                      n.epistemic_status, n.extractor
            """,
            user_id,
            node_id,
            status.value,
        )
    if row is None:
        return None
    node_data = dict(row)
    node_data["id"] = node_data.pop("node_id")
    return {**_node(node_data), "selection_id": str(row["selection_id"])}
