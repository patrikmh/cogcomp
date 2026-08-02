"""Persisting mined patterns.

A pattern differs from every other inferred node in one way that matters: it
cites *many* observations rather than one. That is the case `node_provenance`
was built as a table for, and the reason a pattern's explain screen can show the
several entries it actually rests on rather than a single cherry-picked one.

Re-mining replaces a user's patterns rather than appending. Patterns are a
derived view of the graph — an old pattern that no longer holds should stop being
shown, not linger as a claim nobody can retract.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import asyncpg

from tlon.domain.inference import EpistemicStatus
from tlon.graph.schema import EdgeKind, NodeKind
from tlon.patterns import PROMPT_VERSION, Candidate, MinedPattern, mine


async def load_candidates(pool: asyncpg.Pool, user_id: UUID) -> list[Candidate]:
    """Every inferred node paired with the entry and day it came from.

    Joined through `node_provenance` rather than the node's own `created_at`, for
    the same reason the daily summary is: an inference belongs to the day of the
    entry that produced it, not the day the extractor happened to run.
    """
    rows = await pool.fetch(
        """
        SELECT n.id, n.kind, n.label, n.confidence,
               o.node_id AS observation_id, o.captured_at
        FROM graph_nodes n
        JOIN node_provenance p ON p.node_id = n.id
        JOIN observations o ON o.node_id = p.observation_id
        JOIN graph_nodes obs ON obs.id = o.node_id
        WHERE n.user_id = $1
          AND n.deleted_at IS NULL
          AND obs.deleted_at IS NULL
          AND n.kind NOT IN ('Observation', 'Pattern')
        """,
        user_id,
    )
    return [
        Candidate(
            node_id=row["id"],
            kind=NodeKind(row["kind"]),
            label=row["label"],
            confidence=row["confidence"],
            observation_id=row["observation_id"],
            observed_on=row["captured_at"].date(),
        )
        for row in rows
    ]


async def persist(
    pool: asyncpg.Pool, user_id: UUID, patterns: list[MinedPattern]
) -> list[str]:
    """Replace this user's patterns with a freshly mined set.

    One transaction: a half-replaced set would show the user a mix of current and
    stale claims with no way to tell which was which.
    """
    created: list[str] = []

    async with pool.acquire() as conn, conn.transaction():
        # Hard delete rather than soft. A pattern is a derived view, not
        # something the person wrote, so there is nothing to keep a tombstone
        # for — and cascades clear its provenance and edges with it.
        await conn.execute(
            "DELETE FROM graph_nodes WHERE user_id = $1 AND kind = 'Pattern'", user_id
        )

        for pattern in patterns:
            pattern_id = uuid4()
            await conn.execute(
                """
                INSERT INTO graph_nodes
                    (id, user_id, kind, label, confidence, epistemic_status, extractor)
                VALUES ($1, $2, 'Pattern', $3, $4, $5, $6)
                """,
                pattern_id,
                user_id,
                pattern.label.strip(),
                pattern.confidence,
                str(EpistemicStatus.HYPOTHESIS),
                PROMPT_VERSION,
            )

            # Every contributing entry, not a representative one. A pattern that
            # cited only its first observation would be unfalsifiable from the
            # explain screen.
            for observation_id in pattern.observation_ids:
                await conn.execute(
                    "INSERT INTO node_provenance (node_id, observation_id) VALUES ($1, $2)",
                    pattern_id,
                    observation_id,
                )

            # SUPPORTS runs from the evidence to the claim, matching the
            # ontology: the recurring nodes support the pattern, not vice versa.
            for node_id in pattern.node_ids:
                edge_id = uuid4()
                await conn.execute(
                    """
                    INSERT INTO graph_edges
                        (id, user_id, kind, from_id, to_id,
                         confidence, epistemic_status, extractor)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    """,
                    edge_id,
                    user_id,
                    str(EdgeKind.SUPPORTS),
                    node_id,
                    pattern_id,
                    pattern.confidence,
                    str(EpistemicStatus.HYPOTHESIS),
                    PROMPT_VERSION,
                )
                for observation_id in pattern.observation_ids:
                    await conn.execute(
                        "INSERT INTO edge_provenance (edge_id, observation_id) "
                        "VALUES ($1, $2)",
                        edge_id,
                        observation_id,
                    )

            created.append(str(pattern_id))

    return created


async def remine(pool: asyncpg.Pool, user_id: UUID) -> dict:
    candidates = await load_candidates(pool, user_id)
    patterns = mine(candidates)
    created = await persist(pool, user_id, patterns)
    return {
        "patterns": len(created),
        "considered": len(candidates),
        "ids": created,
    }


async def list_for_user(pool: asyncpg.Pool, user_id: UUID) -> list[dict]:
    rows = await pool.fetch(
        """
        SELECT n.id, n.label, n.confidence, n.epistemic_status, n.extractor,
               n.created_at,
               count(DISTINCT p.observation_id) AS occurrences
        FROM graph_nodes n
        LEFT JOIN node_provenance p ON p.node_id = n.id
        WHERE n.user_id = $1 AND n.kind = 'Pattern' AND n.deleted_at IS NULL
        GROUP BY n.id
        ORDER BY count(DISTINCT p.observation_id) DESC, n.confidence DESC, n.label
        """,
        user_id,
    )
    return [
        {
            "id": str(row["id"]),
            "label": row["label"],
            "confidence": row["confidence"],
            "epistemic_status": row["epistemic_status"],
            "extractor": row["extractor"],
            "occurrences": row["occurrences"],
            # A pattern is a hypothesis like any other inference, and the client
            # renders low-confidence ones as tentative.
            "tentative": row["confidence"] < 0.5,
            "created_at": row["created_at"],
        }
        for row in rows
    ]
