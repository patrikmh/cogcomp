"""Reading threads out of the stored graph.

Grouping happens in `tlon.threads`, pure and tested. This module only answers
one question, in one query: which findings cite which supporting labels? Every
decision that could smuggle an interpretation into the grouping is made
elsewhere; here there is nothing to get wrong except the join.
"""

from __future__ import annotations

from uuid import UUID

import asyncpg

from tlon.threads import Link, threads


async def load_links(pool: asyncpg.Pool, user_id: UUID) -> list[Link]:
    """Every (stored finding, supporting label) pair this user currently has.

    Lapsed patterns are already hidden by their tombstoned node, rejected ones
    are filtered for the same reason they are filtered out of mining: something
    the person said was wrong should not keep shaping what they are shown.
    """
    rows = await pool.fetch(
        """
        SELECT pat.node_id AS pattern_id, pat.detector, pat.occurrences,
               pat.distinct_days,
               n.label AS pattern_label, n.confidence,
               src.label AS subject_label
        FROM patterns pat
        JOIN graph_nodes n ON n.id = pat.node_id
        JOIN graph_edges e
          ON e.to_id = pat.node_id AND e.kind = 'SUPPORTS' AND e.deleted_at IS NULL
        JOIN graph_nodes src ON src.id = e.from_id AND src.deleted_at IS NULL
        WHERE pat.user_id = $1
          AND n.deleted_at IS NULL
          AND n.epistemic_status <> 'user_rejected'
        """,
        user_id,
    )
    return [
        Link(
            pattern_id=row["pattern_id"],
            detector=row["detector"],
            label=row["pattern_label"],
            confidence=row["confidence"],
            # Same line the patterns list draws it from: confidence below a
            # half is shown as forming, everywhere, or the word means nothing.
            tentative=row["confidence"] < 0.5,
            occurrences=row["occurrences"],
            distinct_days=row["distinct_days"],
            subject_label=row["subject_label"],
        )
        for row in rows
    ]


async def list_for_user(pool: asyncpg.Pool, user_id: UUID) -> list[dict]:
    """Threads as plain dicts, ready for the API layer."""
    return [
        {
            "subjects": list(thread.subjects),
            "members": [
                {
                    "id": str(member.pattern_id),
                    "label": member.label,
                    "detector": member.detector,
                    "confidence": member.confidence,
                    "tentative": member.tentative,
                    "occurrences": member.occurrences,
                    "distinct_days": member.distinct_days,
                }
                for member in thread.members
            ],
        }
        for thread in threads(await load_links(pool, user_id))
    ]
