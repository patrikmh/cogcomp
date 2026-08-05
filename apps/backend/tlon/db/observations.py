"""Persistence for observations.

An observation occupies two rows: a graph_nodes row so edges can point at it, and an
observations row holding the raw content. They are written in one transaction — a
node with no content, or content with no node, would both be corruption.
"""

from datetime import datetime
from uuid import UUID

import asyncpg

from tlon.domain.observation import NewObservation, Observation, Source
from tlon.graph.schema import NodeKind

#: How much of the raw content becomes the node's label in graph views.
LABEL_PREVIEW_CHARS = 80


def label_for(content: str) -> str:
    preview = content[:LABEL_PREVIEW_CHARS]
    return f"{preview}…" if len(content) > LABEL_PREVIEW_CHARS else preview


def _to_observation(row: asyncpg.Record) -> Observation:
    return Observation(
        id=row["node_id"],
        user_id=row["user_id"],
        content=row["content"],
        source=Source(row["source"]),
        captured_at=row["captured_at"],
        created_at=row["created_at"],
        timezone=row["timezone"],
        deleted_at=row["deleted_at"],
    )


async def insert(pool: asyncpg.Pool, user_id: UUID, new: NewObservation) -> Observation:
    captured_at = new.captured_at or datetime.now().astimezone()

    async with pool.acquire() as conn, conn.transaction():
        exists = await conn.fetchval("SELECT 1 FROM graph_nodes WHERE id = $1", new.id)
        if exists:
            raise FileExistsError(f"observation {new.id} already exists")

        created_at = await conn.fetchval(
            """
            INSERT INTO graph_nodes (id, user_id, kind, label)
            VALUES ($1, $2, $3, $4)
            RETURNING created_at
            """,
            new.id,
            user_id,
            str(NodeKind.OBSERVATION),
            label_for(new.content),
        )
        await conn.execute(
            """
            INSERT INTO observations
                (node_id, user_id, content, source, captured_at, timezone)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            new.id,
            user_id,
            new.content,
            str(new.source),
            captured_at,
            new.timezone,
        )

    return Observation(
        id=new.id,
        user_id=user_id,
        content=new.content,
        source=new.source,
        captured_at=captured_at,
        created_at=created_at,
        timezone=new.timezone,
    )


_SELECT = """
    SELECT o.node_id, o.user_id, o.content, o.source, o.captured_at, o.timezone,
           n.created_at, n.deleted_at
    FROM observations o
    JOIN graph_nodes n ON n.id = o.node_id
"""


async def find(pool: asyncpg.Pool, user_id: UUID, observation_id: UUID) -> Observation | None:
    row = await pool.fetchrow(
        _SELECT + "WHERE o.node_id = $1 AND o.user_id = $2 AND n.deleted_at IS NULL",
        observation_id,
        user_id,
    )
    return _to_observation(row) if row else None


async def list_for_user(
    pool: asyncpg.Pool, user_id: UUID, limit: int, before: datetime | None
) -> list[Observation]:
    rows = await pool.fetch(
        _SELECT
        + """
        WHERE o.user_id = $1
          AND n.deleted_at IS NULL
          AND ($2::timestamptz IS NULL OR o.captured_at < $2)
        ORDER BY o.captured_at DESC
        LIMIT $3
        """,
        user_id,
        before,
        limit,
    )
    return [_to_observation(row) for row in rows]


async def soft_delete(pool: asyncpg.Pool, user_id: UUID, observation_id: UUID) -> bool:
    """Soft delete. The row stays so anything derived from it keeps a resolvable
    provenance trail, and so the deletion replicates as a tombstone."""
    result = await pool.execute(
        """
        UPDATE graph_nodes SET deleted_at = now()
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
        """,
        observation_id,
        user_id,
    )
    return result != "UPDATE 0"
