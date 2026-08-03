"""Projecting the Postgres graph into Graphiti.

One direction only, always. Postgres is where a claim about a person is decided
and where its provenance lives; this is a derived view that exists so structural
questions — which parts of someone's life cluster together — can be asked of
something built to answer them. Nothing here ever writes back, and the projection
is disposable by construction: if FalkorDB were deleted, a rebuild would restore
it exactly, which is the property the compose file already claims for it.

**Identity is derived, not allocated.** A Tlön node's id determines its Graphiti
uuid, so re-projecting updates in place rather than accumulating a second copy of
someone's graph every time it runs.

**Nodes are written directly.** `Graphiti.add_triplet()` would route them through
`resolve_extracted_nodes`, which is LLM dedup — and consolidation refuses
semantic merging deliberately, because over-merging rewrites what someone said.
Saving nodes ourselves keeps the projection a faithful copy of the graph rather
than a quietly reinterpreted one.

**Only what recurs is projected.** Patterns and observations are left out:
observations are content rather than structure, and a Pattern is already a
derived claim, so clustering over it would be clustering over conclusions instead
of over the material they came from.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import NAMESPACE_URL, UUID, uuid5

import asyncpg
from graphiti_core import Graphiti
from graphiti_core.edges import EntityEdge
from graphiti_core.nodes import EntityNode

from tlon.graph.schema import EdgeKind

#: Namespaced so a Tlön id and its Graphiti uuid are never confused for each
#: other, and so the mapping is reproducible from the Tlön id alone.
_NAMESPACE = uuid5(NAMESPACE_URL, "https://tlon.local/graphiti")


def graphiti_uuid(node_id: UUID) -> str:
    """The Graphiti uuid for a Tlön node. Pure, so re-projection is idempotent."""
    return str(uuid5(_NAMESPACE, str(node_id)))


def group_id(user_id: UUID) -> str:
    """Graphiti's isolation unit, one per person.

    Everything projected carries it, and every query filters on it. One person's
    graph must never contribute a node to another person's communities, and this
    is the mechanism that prevents it.
    """
    return str(user_id)


async def _live_nodes(pool: asyncpg.Pool, user_id: UUID) -> list[asyncpg.Record]:
    return await pool.fetch(
        """
        SELECT id, kind, label
        FROM graph_nodes
        WHERE user_id = $1 AND deleted_at IS NULL
          AND kind NOT IN ('Observation', 'Pattern')
          -- A reading the person rejected does not get to shape the structure of
          -- the graph either. Correcting the system has to mean something
          -- everywhere, not only on the screen where the correction was made.
          AND epistemic_status <> 'user_rejected'
        """,
        user_id,
    )


async def _live_edges(pool: asyncpg.Pool, user_id: UUID) -> list[asyncpg.Record]:
    """The association edges, which are what clustering actually runs on.

    `CO_OCCURS_WITH` carries no causal claim and no direction, which makes it the
    right and only sound basis for community structure: a community built partly
    from causal hypotheses would launder them into something that looks like an
    established region of someone's life.
    """
    return await pool.fetch(
        """
        SELECT e.id, e.from_id, e.to_id, e.confidence, a.label AS a_label, b.label AS b_label
        FROM graph_edges e
        JOIN graph_nodes a ON a.id = e.from_id
        JOIN graph_nodes b ON b.id = e.to_id
        WHERE e.user_id = $1 AND e.kind = $2 AND e.deleted_at IS NULL
          AND a.deleted_at IS NULL AND b.deleted_at IS NULL
          AND e.epistemic_status <> 'user_rejected'
        """,
        user_id,
        str(EdgeKind.CO_OCCURS_WITH),
    )


async def project(pool: asyncpg.Pool, user_id: UUID, graphiti: Graphiti) -> dict:
    """Rebuild this user's Graphiti projection from Postgres. Returns what moved."""
    group = group_id(user_id)
    now = datetime.now(UTC)

    node_rows = await _live_nodes(pool, user_id)
    edge_rows = await _live_edges(pool, user_id)

    # Only nodes that an association actually touches. An isolated node cannot
    # belong to a community, and projecting the whole graph to cluster a fraction
    # of it wastes the work on every run.
    connected = {row["from_id"] for row in edge_rows} | {row["to_id"] for row in edge_rows}

    projected = 0
    for row in node_rows:
        if row["id"] not in connected:
            continue
        node = EntityNode(
            uuid=graphiti_uuid(row["id"]),
            name=row["label"],
            group_id=group,
            labels=["Entity", row["kind"]],
            created_at=now,
        )
        await node.generate_name_embedding(graphiti.embedder)
        await node.save(graphiti.driver)
        projected += 1

    for row in edge_rows:
        edge = EntityEdge(
            uuid=graphiti_uuid(row["id"]),
            group_id=group,
            source_node_uuid=graphiti_uuid(row["from_id"]),
            target_node_uuid=graphiti_uuid(row["to_id"]),
            created_at=now,
            name=str(EdgeKind.CO_OCCURS_WITH),
            # Stated as adjacency, in the same words the detector uses. Graphiti
            # will show this string to an LLM when it summarises a community, and
            # a fact phrased causally there would come back as a causal theme.
            fact=f"{row['a_label']} and {row['b_label']} come up in the same entries",
        )
        await edge.generate_embedding(graphiti.embedder)
        await edge.save(graphiti.driver)

    return {"nodes": projected, "edges": len(edge_rows)}
