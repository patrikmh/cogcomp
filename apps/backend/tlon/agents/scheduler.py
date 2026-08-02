"""The loop that runs agents without being asked.

An asyncio task inside the app process rather than Celery or a cron container.
That is a deliberate choice for this stage: the work is small, per-user, and
idempotent, so a queue would add a broker, a worker image, and a second place for
things to go wrong in exchange for capacity nobody needs yet. The seam is here if
that changes — `tick()` takes a pool and does one pass, so moving it behind a
queue later means calling it from somewhere else.

Two properties this has to get right:

**It must never fall over.** A scheduler that dies silently on one bad tick means
background work stops and nothing says so. Every tick is wrapped; failures are
logged and the loop continues.

**It must not run while someone is mid-thought.** Agents rewrite the graph, and
merging nodes underneath a person who is looking at them is disorienting. Users
active in the last few minutes are skipped.
"""

from __future__ import annotations

import asyncio
import logging
from uuid import UUID

import asyncpg

from tlon.agents import REGISTRY
from tlon.agents.runner import run_agent

logger = logging.getLogger(__name__)

#: How often the loop wakes. Each agent's own cadence decides whether it actually
#: runs, so this only needs to be finer than the shortest of those.
TICK_SECONDS = 300

#: Someone who wrote in the last few minutes is probably still writing. Agents
#: rewrite the graph, and doing that under a person who is looking at it is
#: disorienting in a way no log entry makes up for.
QUIET_MINUTES = 10

#: Per tick. A ceiling so a growing user base degrades into "some users waited a
#: tick" rather than "one tick took an hour".
MAX_USERS_PER_TICK = 50


async def due_users(pool: asyncpg.Pool) -> list[UUID]:
    """Users with material to work on who are not currently writing."""
    rows = await pool.fetch(
        f"""
        SELECT DISTINCT o.user_id
        FROM observations o
        JOIN users u ON u.id = o.user_id
        WHERE u.deleted_at IS NULL
        GROUP BY o.user_id
        HAVING max(o.captured_at) < now() - interval '{QUIET_MINUTES} minutes'
        LIMIT {MAX_USERS_PER_TICK}
        """
    )
    return [row["user_id"] for row in rows]


async def due_agents(pool: asyncpg.Pool, user_id: UUID) -> list:
    """Agents whose cadence has elapsed for this user.

    Measured from the last *attempt* rather than the last success, so an agent
    that keeps failing backs off instead of retrying every tick.
    """
    due = []
    for agent in REGISTRY:
        last = await pool.fetchval(
            """
            SELECT max(started_at) FROM agent_runs
            WHERE user_id = $1 AND agent = $2
            """,
            user_id,
            agent.name,
        )
        if last is None:
            due.append(agent)
            continue

        elapsed = await pool.fetchval("SELECT extract(epoch FROM now() - $1)", last)
        if elapsed >= agent.cadence_seconds:
            due.append(agent)
    return due


async def tick(pool: asyncpg.Pool) -> int:
    """One pass. Returns how many agent runs were attempted."""
    attempted = 0
    for user_id in await due_users(pool):
        for agent in await due_agents(pool, user_id):
            await run_agent(pool, agent, user_id, trigger="scheduled")
            attempted += 1
    return attempted


async def loop(pool: asyncpg.Pool, interval: int = TICK_SECONDS) -> None:
    """Run ticks forever. Cancelled on shutdown."""
    logger.info("agent scheduler started (every %ss)", interval)
    while True:
        try:
            attempted = await tick(pool)
            if attempted:
                logger.info("agent scheduler ran %s agents", attempted)
        except asyncio.CancelledError:
            logger.info("agent scheduler stopped")
            raise
        except Exception:
            # A scheduler that dies on one bad tick means background work stops
            # and nothing says so.
            logger.exception("agent scheduler tick failed")
        await asyncio.sleep(interval)
