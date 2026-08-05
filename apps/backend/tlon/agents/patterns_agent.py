"""Pattern mining, on a schedule.

A thin wrapper: recurrence, weekday, ordered-lag, within-day and
stated-vs-recorded mining live in pure modules, and their persistence lives in `tlon/db/patterns.py`; the
manual endpoint exercises the same path. This exists so patterns get noticed without the person
having to ask — which is the entire point of a background agent, and also the
thing that makes one risky.

The safeguard is `should_run`: patterns are only re-mined when there is new
material since the last run. Without that, the same conclusions would be
recomputed and re-announced on every tick, which is how a tool that is supposed
to notice things becomes a tool that nags.
"""

from __future__ import annotations

from uuid import UUID

import asyncpg

from tlon.agents.base import AgentResult
from tlon.db import patterns as patterns_db

#: Bumped whenever the set of detectors changes. `agent_runs` stores it, so a
#: person asking why a new kind of claim appeared can see which version first
#: produced it. v0.4 added stated-vs-recorded, v0.5 within-day ordering.
VERSION = "patterns-agent-v0.5"


class PatternAgent:
    @property
    def name(self) -> str:
        return "patterns"

    @property
    def version(self) -> str:
        return VERSION

    @property
    def cadence_seconds(self) -> int:
        # Six hours. A pattern is a claim about weeks, so re-deriving it more
        # often than a few times a day tells nobody anything new.
        return 6 * 3600

    async def should_run(self, pool: asyncpg.Pool, user_id: UUID) -> bool:
        """Only when something has been written since the last successful run."""
        last = await pool.fetchval(
            """
            SELECT max(finished_at) FROM agent_runs
            WHERE user_id = $1 AND agent = 'patterns' AND status = 'succeeded'
            """,
            user_id,
        )
        if last is None:
            return True

        newer = await pool.fetchval(
            """
            SELECT 1 FROM observations
            WHERE user_id = $1 AND captured_at > $2
            LIMIT 1
            """,
            user_id,
            last,
        )
        return newer is not None

    async def run(self, pool: asyncpg.Pool, user_id: UUID) -> AgentResult:
        result = await patterns_db.remine(pool, user_id)
        if result["considered"] == 0:
            # "Nothing to look at" is a different answer from "looked and found
            # nothing", and the person deserves the one that is true.
            return AgentResult(skipped=True, reason="no inferences to examine yet")

        return AgentResult(
            summary={
                "patterns": result["patterns"],
                "considered": result["considered"],
            }
        )
