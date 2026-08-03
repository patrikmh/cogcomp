"""Background agents over HTTP.

`GET /v1/agents/runs` is the one that matters. This system draws conclusions about
people without being asked, and the only thing that makes that acceptable is that
they can see exactly what ran, when, why, and what it produced. It is not a debug
endpoint.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from tlon.agents import BY_NAME, REGISTRY
from tlon.agents.runner import recent_runs, run_agent, run_all
from tlon.auth import current_user

router = APIRouter(prefix="/v1/agents", tags=["agents"])

MAX_RUNS = 200


class AgentInfo(BaseModel):
    name: str
    version: str
    cadence_seconds: int


class AgentRun(BaseModel):
    id: UUID
    agent: str
    version: str
    #: 'scheduled' or 'manual' — whether the person asked for this matters when
    #: they are looking at a conclusion they do not recognise.
    trigger: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    #: Counts, never content. The log records activity, not a second copy of
    #: someone's private writing.
    summary: dict[str, Any]
    error: str | None


@router.get("")
async def list_agents(_: UUID = Depends(current_user)) -> list[AgentInfo]:
    """Everything that may run in the background, named."""
    return [
        AgentInfo(
            name=agent.name,
            version=agent.version,
            cadence_seconds=agent.cadence_seconds,
        )
        for agent in REGISTRY
    ]


@router.get("/runs")
async def list_runs(
    request: Request, limit: int = 50, user_id: UUID = Depends(current_user)
) -> list[AgentRun]:
    rows = await recent_runs(request.app.state.pool, user_id, min(limit, MAX_RUNS))
    return [AgentRun(**row) for row in rows]


@router.post("/run")
async def run_everything(
    request: Request, user_id: UUID = Depends(current_user)
) -> list[dict]:
    """Run the whole registry now, in order.

    Forced, like the single-agent route: someone who pressed a button should get
    "I looked and there was nothing", not "I declined to look".
    """
    return await run_all(
        request.app.state.pool, REGISTRY, user_id, trigger="manual", force=True
    )


@router.post("/{name}/run")
async def run_one(
    request: Request, name: str, user_id: UUID = Depends(current_user)
) -> dict:
    agent = BY_NAME.get(name)
    if agent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no agent named {name!r}")

    # Forced: "I pressed the button and it decided not to" is a baffling thing for
    # a button to do. Scheduled runs are the ones that get to skip.
    return await run_agent(
        request.app.state.pool, agent, user_id, trigger="manual", force=True
    )
