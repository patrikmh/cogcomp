"""Patterns: what keeps coming back.

Mining is explicit rather than automatic. A system that quietly recomputes what
it thinks about you in the background is the thing this product is trying not to
be — the person asks, and then it looks.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from tlon.auth import current_user
from tlon.db import patterns as patterns_db

router = APIRouter(prefix="/v1/patterns", tags=["patterns"])


class Pattern(BaseModel):
    id: UUID
    label: str
    confidence: float
    epistemic_status: str
    extractor: str
    #: Distinct entries this rests on. Shown next to the label, because the count
    #: is the evidence — a pattern without it is just an assertion.
    occurrences: int
    #: Across how many distinct days. Three mentions in one evening is a mood;
    #: the same thing on three separate days is the claim being made.
    distinct_days: int
    #: Which method found this. Detectors differ in how much they are entitled to
    #: assert, and the client renders a statistic differently from a count.
    detector: str
    #: When this was first true, not when the node was last written. A pattern
    #: that has survived a month of re-mining is a stronger proposition than one
    #: first seen this morning, and this is what lets the client say so.
    first_seen_at: datetime
    tentative: bool
    created_at: datetime


class MineResponse(BaseModel):
    patterns: int
    #: Split out because they read differently: `added` is "here is something new
    #: about you", `confirmed` is "the same things still hold". Reporting only the
    #: total made every run look like a fresh discovery.
    added: int
    confirmed: int
    #: How many inferred nodes were examined, so "no patterns" can be told apart
    #: from "nothing to look at yet".
    considered: int


@router.get("")
async def list_patterns(request: Request, user_id: UUID = Depends(current_user)) -> list[Pattern]:
    rows = await patterns_db.list_for_user(request.app.state.pool, user_id)
    return [Pattern(**row) for row in rows]


@router.post("/mine")
async def mine_patterns(request: Request, user_id: UUID = Depends(current_user)) -> MineResponse:
    result = await patterns_db.remine(request.app.state.pool, user_id)
    return MineResponse(
        patterns=result["patterns"],
        added=result["added"],
        confirmed=result["confirmed"],
        considered=result["considered"],
    )
