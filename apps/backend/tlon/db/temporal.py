"""Reading the graph as a timeline.

Nothing here is persisted. A change is a comparison between two windows ending
today, so it is only true on the day it is computed — writing it into the graph
would leave yesterday's arithmetic sitting there looking like a finding. It is
derived on request and thrown away, which is also why `temporal.py` is pure.
"""

from __future__ import annotations

from datetime import date
from uuid import UUID

import asyncpg

from tlon.graph.schema import NodeKind
from tlon.temporal import WINDOW_DAYS, Change, Occurrence, compare


async def load_occurrences(
    pool: asyncpg.Pool, user_id: UUID, tz: str, days: int
) -> list[Occurrence]:
    """Every inferred node, dated by the entry that produced it.

    Dated through `node_provenance` rather than by the node's own `created_at`:
    an inference belongs to the day of the entry it came from, not the day the
    extractor happened to run. Re-running extraction over old entries must not
    make last month look like this week.

    The timezone is applied in the database so that "which day" agrees with the
    daily and weekly summaries, which do the same.
    """
    rows = await pool.fetch(
        """
        SELECT n.kind, n.label, n.confidence,
               (o.captured_at AT TIME ZONE $2)::date AS on_day
        FROM graph_nodes n
        JOIN node_provenance p ON p.node_id = n.id
        JOIN observations o ON o.node_id = p.observation_id
        JOIN graph_nodes obs ON obs.id = o.node_id
        WHERE n.user_id = $1
          AND n.deleted_at IS NULL
          AND obs.deleted_at IS NULL
          AND n.kind NOT IN ('Observation', 'Pattern')
          -- A reading the person has rejected stops feeding anything derived
          -- from it. Otherwise correcting the system would change nothing: the
          -- thing you said was wrong would keep surfacing inside conclusions
          -- built on it.
          AND n.epistemic_status <> 'user_rejected'
          AND o.captured_at >= now() - make_interval(days => $3)
        """,
        user_id,
        tz,
        days,
    )
    return [
        Occurrence(
            kind=NodeKind(row["kind"]),
            label=row["label"],
            on=row["on_day"],
            confidence=row["confidence"],
        )
        for row in rows
    ]


async def load_active_days(pool: asyncpg.Pool, user_id: UUID, tz: str, days: int) -> set[date]:
    """Days the person wrote anything at all.

    Fetched separately from the occurrences because it answers a different
    question: not "what did they feel" but "were they here". Without it a silent
    week reads as a week in which nothing happened.
    """
    rows = await pool.fetch(
        """
        SELECT DISTINCT (o.captured_at AT TIME ZONE $2)::date AS on_day
        FROM observations o
        JOIN graph_nodes n ON n.id = o.node_id
        WHERE o.user_id = $1
          AND n.deleted_at IS NULL
          AND o.captured_at >= now() - make_interval(days => $3)
        """,
        user_id,
        tz,
        days,
    )
    return {row["on_day"] for row in rows}


async def changes(pool: asyncpg.Pool, user_id: UUID, today: date, tz: str = "UTC") -> list[Change]:
    """What moved between the last window and the one before it."""
    # One extra day of slack so an entry written just before local midnight is
    # not cut off by the UTC-based interval.
    span = WINDOW_DAYS * 2 + 1
    occurrences = await load_occurrences(pool, user_id, tz, span)
    active = await load_active_days(pool, user_id, tz, span)
    return compare(occurrences, active, today)
