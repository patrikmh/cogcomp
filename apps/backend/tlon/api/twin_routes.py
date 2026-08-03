"""The self-model, and the means to argue with it.

A "digital twin" that speaks for you would be a diagnosis with a friendly face.
This is the other thing the phrase can mean: an account of what the system
currently believes about you, assembled in one place, every claim carrying its
confidence and its evidence — and every claim rejectable.

The judgement endpoint is what makes the portrait honest. Until now every
inference was permanently a `hypothesis`, a word the app used about itself while
giving nobody any way to disagree. A model you cannot correct is not a model of
you; it is a verdict about you.

The portrait deliberately reports how much of itself you have actually reviewed.
An unexamined twin is a rumour, and it should say so rather than presenting
guesses with the same face as things you confirmed.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from tlon.auth import current_user
from tlon.db import judgement as judgement_db

router = APIRouter(prefix="/v1", tags=["twin"])


class Judgement(BaseModel):
    #: hypothesis | user_confirmed | user_rejected. `hypothesis` is allowed so a
    #: judgement can be withdrawn — someone who agreed with something in a bad
    #: week must be able to return it to undecided.
    status: str


class JudgedNode(BaseModel):
    id: UUID
    kind: str
    label: str
    confidence: float
    epistemic_status: str
    extractor: str


class SelfModel(BaseModel):
    """What the system currently believes, and how much of it you have weighed."""

    confirmed: int
    rejected: int
    unreviewed: int
    #: 0–1. How much of the picture has been looked at, so an unexamined portrait
    #: cannot be mistaken for an agreed one.
    reviewed_fraction: float
    generated_at: datetime


@router.post("/nodes/{node_id}/judgement")
async def judge_node(
    request: Request,
    node_id: UUID,
    payload: Judgement,
    user_id: UUID = Depends(current_user),
) -> JudgedNode:
    try:
        updated = await judgement_db.judge(request.app.state.pool, user_id, node_id, payload.status)
    except judgement_db.UnknownJudgement as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"unknown judgement: {payload.status}",
        ) from exc
    except judgement_db.NotJudgeable as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "an entry is not a claim — there is nothing here to agree or disagree with",
        ) from exc

    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such node")
    return JudgedNode(**updated)


@router.get("/self-model")
async def self_model(request: Request, user_id: UUID = Depends(current_user)) -> SelfModel:
    tally = await judgement_db.counts(request.app.state.pool, user_id)
    confirmed = tally["user_confirmed"]
    rejected = tally["user_rejected"]
    unreviewed = tally["hypothesis"]
    total = confirmed + rejected + unreviewed

    return SelfModel(
        confirmed=confirmed,
        rejected=rejected,
        unreviewed=unreviewed,
        # Zero rather than one when there is nothing: an empty picture has not
        # been reviewed, it simply is not there yet, and claiming 100% would be
        # the most misleading number on the screen.
        reviewed_fraction=0.0 if total == 0 else round((confirmed + rejected) / total, 3),
        generated_at=datetime.now(UTC),
    )
