"""Semantic search: find readings close in meaning to a question.

ADR-0007. The literal search screens match substrings and say so — "Nothing
was ranked or guessed." This is the other kind of looking: the query becomes a
vector through the same local embedder that projected the graph, and readings
are ranked by how close their meaning sits. Because ranking *is* the point
here, the result carries its score, and the client says plainly that these
results were ranked.

The vectors live only in FalkorDB as derived data; entry text never leaves the
server on this path. With the deterministic embedder configured there is no
semantics to rank by, so the endpoint refuses rather than return confident
nonsense.
"""

from __future__ import annotations

import math
from uuid import UUID

import asyncpg
from graphiti_core import Graphiti

from tlon.graph.projection import graphiti_uuid, group_id

VERSION = "semantic-search-v0.1"

#: Below this the reading is not "close in meaning" and pretending otherwise
#: would dress up noise as insight.
MIN_SCORE = 0.35


def _cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


async def search(
    pool: asyncpg.Pool,
    graphiti: Graphiti,
    user_id: UUID,
    query: str,
    embedder,
    limit: int = 8,
) -> list[dict]:
    """The readings closest in meaning to `query`, strongest first.

    Embeddings come from FalkorDB's projection; identity and provenance come
    from Postgres, which remains the source of truth. A node that has lapsed
    from Postgres is not returned even if its vector still sits in the store —
    the rebuild cycle will clear it soon enough.
    """
    query_vector = await embedder.create(query)

    group = group_id(user_id)
    result = await graphiti.driver.execute_query(
        """
        MATCH (n:Entity)
        WHERE n.group_id = $group AND n.name_embedding IS NOT NULL
        RETURN n.uuid AS uuid, n.name AS name, n.name_embedding AS embedding
        """,
        group=group,
    )
    # The FalkorDB driver answers with (records, header, stats).
    records = result[0] if isinstance(result, tuple) else result

    # Postgres decides what may be shown: only live inferred nodes, with their
    # kinds and confidences, keyed by the same derived uuid projection uses.
    rows = await pool.fetch(
        """
        SELECT id, label, kind, confidence
        FROM graph_nodes
        WHERE user_id = $1 AND deleted_at IS NULL
          AND kind NOT IN ('Observation', 'Pattern', 'Theme')
        """,
        user_id,
    )
    known = {graphiti_uuid(row["id"]): row for row in rows}

    scored: list[dict] = []
    for record in records:
        node_uuid = record.get("uuid")
        row = known.get(node_uuid)
        if row is None:
            continue
        embedding = record.get("embedding") or []
        score = _cosine([float(x) for x in embedding], [float(x) for x in query_vector])
        if score < MIN_SCORE:
            continue
        scored.append(
            {
                "node_id": str(row["id"]),
                "label": row["label"],
                "kind": row["kind"],
                "confidence": float(row["confidence"]),
                "score": round(score, 4),
            }
        )

    scored.sort(key=lambda item: (-item["score"], item["label"]))
    return scored[:limit]
