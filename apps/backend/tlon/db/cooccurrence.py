"""Persisting associations.

A co-occurrence is stored as a `CO_OCCURS_WITH` edge rather than a node, because
the finding *is* the adjacency. Giving it a node would mean inventing a label —
"dread with my sister" — and the one rule this record keeps everywhere else is
that it reads in the person's own words.

Edges are reconciled, not replaced, for the reason patterns are: an association
the person has rejected must stay rejected. Wiping and re-inserting on every run
would resurrect it as a fresh hypothesis, which makes rejecting it meaningless.

Direction is canonical rather than meaningful. `CO_OCCURS_WITH` is symmetric — it
says two things turn up together and deliberately cannot say which came first —
so the endpoints are stored in id order to give the pair one stable identity.
Reading direction into these edges is the mistake this whole module is written to
avoid.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import asyncpg

from tlon.cooccurrence import VERSION, CoOccurrence, mine
from tlon.db.patterns import load_candidates
from tlon.domain.inference import EpistemicStatus
from tlon.graph.schema import EdgeKind


async def persist(pool: asyncpg.Pool, user_id: UUID, pairs: list[CoOccurrence]) -> dict:
    """Reconcile this user's associations against a freshly mined set."""
    added: list[str] = []
    confirmed: list[str] = []

    async with pool.acquire() as conn, conn.transaction():
        existing = {
            (str(row["from_id"]), str(row["to_id"])): row["id"]
            for row in await conn.fetch(
                """
                SELECT id, from_id, to_id FROM graph_edges
                WHERE user_id = $1 AND kind = $2 AND extractor = $3
                """,
                user_id,
                str(EdgeKind.CO_OCCURS_WITH),
                VERSION,
            )
        }

        live: set[tuple[str, str]] = set()
        for pair in pairs:
            endpoints = tuple(sorted((pair.a_node_id, pair.b_node_id), key=str))
            identity = (str(endpoints[0]), str(endpoints[1]))
            live.add(identity)

            edge_id = existing.get(identity)
            if edge_id is None:
                edge_id = await _insert(conn, user_id, endpoints, pair)
                added.append(str(edge_id))
            else:
                # Confidence and the tombstone are refreshed; `epistemic_status`
                # is left alone because it is the person's verdict, not ours.
                await conn.execute(
                    "UPDATE graph_edges SET confidence = $2, deleted_at = NULL WHERE id = $1",
                    edge_id,
                    pair.confidence,
                )
                confirmed.append(str(edge_id))

            await _cite(conn, edge_id, pair)

        # An association that no longer holds stops being drawn. Tombstoned
        # rather than deleted: the edge may carry a verdict, and its provenance
        # is what makes "why did it ever say that" answerable.
        stale = [edge_id for identity, edge_id in existing.items() if identity not in live]
        if stale:
            await conn.execute(
                "UPDATE graph_edges SET deleted_at = now() WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL",
                stale,
            )

    return {"added": added, "confirmed": confirmed}


async def _insert(
    conn: asyncpg.Connection,
    user_id: UUID,
    endpoints: tuple[UUID, UUID],
    pair: CoOccurrence,
) -> UUID:
    edge_id = uuid4()
    await conn.execute(
        """
        INSERT INTO graph_edges
            (id, user_id, kind, from_id, to_id, confidence, epistemic_status, extractor)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        edge_id,
        user_id,
        str(EdgeKind.CO_OCCURS_WITH),
        endpoints[0],
        endpoints[1],
        pair.confidence,
        str(EpistemicStatus.HYPOTHESIS),
        VERSION,
    )
    return edge_id


async def _cite(conn: asyncpg.Connection, edge_id: UUID, pair: CoOccurrence) -> None:
    """Every entry containing both, so the person can check the arithmetic."""
    for observation_id in pair.observation_ids:
        await conn.execute(
            """
            INSERT INTO edge_provenance (edge_id, observation_id) VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            """,
            edge_id,
            observation_id,
        )


async def remine(pool: asyncpg.Pool, user_id: UUID) -> dict:
    candidates = await load_candidates(pool, user_id)
    pairs = mine(candidates)
    result = await persist(pool, user_id, pairs)
    return {
        "associations": len(result["added"]) + len(result["confirmed"]),
        "added": len(result["added"]),
        "confirmed": len(result["confirmed"]),
        "considered": len(candidates),
    }


async def list_for_user(pool: asyncpg.Pool, user_id: UUID) -> list[dict]:
    rows = await pool.fetch(
        """
        SELECT e.id, e.confidence, e.epistemic_status, e.created_at,
               a.label AS a_label, a.kind AS a_kind,
               b.label AS b_label, b.kind AS b_kind,
               count(DISTINCT p.observation_id) AS together
        FROM graph_edges e
        JOIN graph_nodes a ON a.id = e.from_id
        JOIN graph_nodes b ON b.id = e.to_id
        LEFT JOIN edge_provenance p ON p.edge_id = e.id
        WHERE e.user_id = $1 AND e.kind = $2 AND e.deleted_at IS NULL
          AND a.deleted_at IS NULL AND b.deleted_at IS NULL
        GROUP BY e.id, a.label, a.kind, b.label, b.kind
        ORDER BY count(DISTINCT p.observation_id) DESC, e.confidence DESC, a.label
        """,
        user_id,
        str(EdgeKind.CO_OCCURS_WITH),
    )
    return [
        {
            "id": str(row["id"]),
            "a_label": row["a_label"],
            "a_kind": row["a_kind"],
            "b_label": row["b_label"],
            "b_kind": row["b_kind"],
            "together": row["together"],
            "confidence": row["confidence"],
            "epistemic_status": row["epistemic_status"],
            "tentative": row["confidence"] < 0.5,
            "created_at": row["created_at"],
        }
        for row in rows
    ]
