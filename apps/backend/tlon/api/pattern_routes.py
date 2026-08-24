"""Patterns: what keeps coming back.

Mining is explicit rather than automatic. A system that quietly recomputes what
it thinks about you in the background is the thing this product is trying not to
be — the person asks, and then it looks.
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from tlon.auth import current_user
from tlon.db import patterns as patterns_db
from tlon.db import threads as threads_db

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


class ThreadMember(BaseModel):
    id: UUID
    label: str
    detector: str
    confidence: float
    tentative: bool
    occurrences: int
    distinct_days: int


class PatternThread(BaseModel):
    #: The words that connect the members — named, never summarised. A heading
    #: like "work stress" would be an interpretation; these are the labels the
    #: members' own evidence shares.
    subjects: list[str]
    members: list[ThreadMember]


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


class Written(BaseModel):
    """One entry, in the person's own words."""

    id: UUID
    content: str
    source: str
    captured_at: datetime


class Occasion(BaseModel):
    """One pair of writing days behind an ordered finding."""

    source_day: date
    target_day: date
    before: list[Written]
    after: list[Written]


class Ordering(BaseModel):
    #: Days, not hours: the detector works on calendar days and the response must
    #: not imply a precision it does not have.
    lag_days: int
    pattern_id: UUID
    label: str
    #: Whether these days were counted in UTC because an entry never recorded
    #: the zone it was written in.
    utc_fallback: bool
    occasions: list[Occasion]


@router.get("")
async def list_patterns(request: Request, user_id: UUID = Depends(current_user)) -> list[Pattern]:
    rows = await patterns_db.list_for_user(request.app.state.pool, user_id)
    return [Pattern(**row) for row in rows]


@router.get("/{pattern_id}/ordering")
async def pattern_ordering(
    request: Request,
    pattern_id: UUID,
    user_id: UUID = Depends(current_user),
) -> Ordering:
    """The entries an ordered finding rests on, oldest occasion first.

    404 for a pattern found by any other detector. Only this one claims that one
    thing was written before another, so only this one owes the evidence.
    """
    ordering = await patterns_db.ordering_for_pattern(request.app.state.pool, user_id, pattern_id)
    if ordering is None:
        raise HTTPException(status_code=404, detail="not found")
    return Ordering(**ordering)


@router.get("/threads")
async def list_threads(request: Request, user_id: UUID = Depends(current_user)) -> list[PatternThread]:
    """Findings that rest on the same thing, grouped for navigation.

    Grouping only, over what mining already stored: two findings share a thread
    when their supporting nodes include the same normalised label. No new claim
    is created, so there is nothing here to mine or confirm — recomputed on
    request, like every other view of the graph.
    """
    return [PatternThread(**row) for row in await threads_db.list_for_user(
        request.app.state.pool, user_id
    )]


@router.post("/mine")
async def mine_patterns(request: Request, user_id: UUID = Depends(current_user)) -> MineResponse:
    result = await patterns_db.remine(request.app.state.pool, user_id)
    return MineResponse(
        patterns=result["patterns"],
        added=result["added"],
        confirmed=result["confirmed"],
        considered=result["considered"],
    )
