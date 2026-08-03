"""Association mining, on a schedule.

Runs after pattern mining and for the same reason it runs after consolidation:
both read the same normalised labels, and mining associations over a graph that
is about to be merged would draw edges between nodes that are on their way to
being one node.

The cadence is slower than pattern mining. An association needs more entries
underneath it before the ratio means anything, so re-deriving it often produces
the same answer at more expense — and unlike a recurrence, a person cannot
sanity-check it against their own memory, which is a reason to say it less often
rather than more.
"""

from __future__ import annotations

from uuid import UUID

import asyncpg

from tlon.agents.base import AgentResult
from tlon.cooccurrence import VERSION
from tlon.db import cooccurrence as cooccurrence_db


class CoOccurrenceAgent:
    @property
    def name(self) -> str:
        return "cooccurrence"

    @property
    def version(self) -> str:
        return VERSION

    @property
    def cadence_seconds(self) -> int:
        # Daily. An association is a claim about months of entries; recomputing it
        # four times a day tells nobody anything they did not have yesterday.
        return 24 * 3600

    async def should_run(self, pool: asyncpg.Pool, user_id: UUID) -> bool:
        """Only when something has been written since the last successful run."""
        last = await pool.fetchval(
            """
            SELECT max(finished_at) FROM agent_runs
            WHERE user_id = $1 AND agent = 'cooccurrence' AND status = 'succeeded'
            """,
            user_id,
        )
        if last is None:
            return True

        newer = await pool.fetchval(
            "SELECT 1 FROM observations WHERE user_id = $1 AND captured_at > $2 LIMIT 1",
            user_id,
            last,
        )
        return newer is not None

    async def run(self, pool: asyncpg.Pool, user_id: UUID) -> AgentResult:
        result = await cooccurrence_db.remine(pool, user_id)
        if result["considered"] == 0:
            return AgentResult(skipped=True, reason="no inferences to examine yet")

        return AgentResult(
            summary={
                "associations": result["associations"],
                "added": result["added"],
                "confirmed": result["confirmed"],
                "considered": result["considered"],
            }
        )
