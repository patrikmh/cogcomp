"""Running agents, and recording that they ran.

The record is the point. Every attempt opens a row before the work starts and
closes it afterwards — including failures, including skips. A crash mid-run leaves
a row stuck in `running`, which is the correct thing to see: it says something
started and did not finish, rather than quietly leaving no trace at all.

Failures are contained per agent. One agent throwing must not stop the rest, and
must not take down the request or the scheduler tick that invoked it.
"""

from __future__ import annotations

import json
import logging
from uuid import UUID, uuid4

import asyncpg

from tlon.agents.base import Agent

logger = logging.getLogger(__name__)


async def run_agent(
    pool: asyncpg.Pool,
    agent: Agent,
    user_id: UUID,
    *,
    trigger: str = "manual",
    force: bool = False,
) -> dict:
    """Run one agent for one user, logging the attempt either way.

    `force` bypasses `should_run`. Scheduled runs never force; a person asking
    directly always does, because "I asked and it decided not to" is a baffling
    thing for a button to do.
    """
    if not force and not await agent.should_run(pool, user_id):
        return await _record_skip(
            pool, agent, user_id, trigger, "nothing new to work on"
        )

    run_id = uuid4()
    await pool.execute(
        """
        INSERT INTO agent_runs (id, user_id, agent, version, trigger, status)
        VALUES ($1, $2, $3, $4, $5, 'running')
        """,
        run_id,
        user_id,
        agent.name,
        agent.version,
        trigger,
    )

    try:
        result = await agent.run(pool, user_id)
    except Exception as exc:
        logger.exception("agent %s failed for user %s", agent.name, user_id)
        await pool.execute(
            """
            UPDATE agent_runs
            SET status = 'failed', finished_at = now(), error = $2
            WHERE id = $1
            """,
            run_id,
            # Truncated: the log holds the traceback, this field holds the gist.
            f"{type(exc).__name__}: {exc}"[:500],
        )
        return {"agent": agent.name, "status": "failed", "error": str(exc)}

    status = "skipped" if result.skipped else "succeeded"
    summary = dict(result.summary)
    if result.reason:
        summary["reason"] = result.reason

    await pool.execute(
        """
        UPDATE agent_runs
        SET status = $2, finished_at = now(), summary = $3::jsonb
        WHERE id = $1
        """,
        run_id,
        status,
        json.dumps(summary),
    )
    return {"agent": agent.name, "status": status, "summary": summary}


async def _record_skip(
    pool: asyncpg.Pool, agent: Agent, user_id: UUID, trigger: str, reason: str
) -> dict:
    """A skip is logged like anything else.

    Silently doing nothing is indistinguishable, from the outside, from being
    broken — and this is a system whose whole claim is that you can find out what
    it did.
    """
    summary = {"reason": reason}
    await pool.execute(
        """
        INSERT INTO agent_runs
            (id, user_id, agent, version, trigger, status, finished_at, summary)
        VALUES ($1, $2, $3, $4, $5, 'skipped', now(), $6::jsonb)
        """,
        uuid4(),
        user_id,
        agent.name,
        agent.version,
        trigger,
        json.dumps(summary),
    )
    return {"agent": agent.name, "status": "skipped", "summary": summary}


async def run_all(
    pool: asyncpg.Pool,
    agents: list[Agent],
    user_id: UUID,
    *,
    trigger: str = "scheduled",
    force: bool = False,
) -> list[dict]:
    """Run every agent for one user, in order, containing failures individually."""
    results = []
    for agent in agents:
        results.append(
            await run_agent(pool, agent, user_id, trigger=trigger, force=force)
        )
    return results


async def recent_runs(pool: asyncpg.Pool, user_id: UUID, limit: int = 50) -> list[dict]:
    rows = await pool.fetch(
        """
        SELECT id, agent, version, trigger, status, started_at, finished_at,
               summary, error
        FROM agent_runs
        WHERE user_id = $1
        ORDER BY started_at DESC
        LIMIT $2
        """,
        user_id,
        limit,
    )
    return [
        {
            "id": str(row["id"]),
            "agent": row["agent"],
            "version": row["version"],
            "trigger": row["trigger"],
            "status": row["status"],
            "started_at": row["started_at"],
            "finished_at": row["finished_at"],
            "summary": json.loads(row["summary"])
            if isinstance(row["summary"], str)
            else row["summary"],
            "error": row["error"],
        }
        for row in rows
    ]
