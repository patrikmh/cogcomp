"""What changed lately, over HTTP.

Computed on request rather than stored. A change is a statement about two windows
ending today; cached, it would quietly become a statement about two windows
ending whenever the cache was written.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from tlon.auth import current_user
from tlon.db import temporal as temporal_db
from tlon.temporal import WINDOW_DAYS, comparable

router = APIRouter(prefix="/v1/temporal", tags=["temporal"])


class ChangeResponse(BaseModel):
    kind: str
    label: str
    #: One of new / more / less / absent. Arithmetic words only — see
    #: `tlon/temporal.py` for why there is no "improved".
    shift: str
    recent_days: int
    earlier_days: int
    confidence: float
    #: The counts as a sentence, so every client says it the same way and none of
    #: them gets to add a verdict of its own.
    description: str


class ChangesResponse(BaseModel):
    window_days: int
    changes: list[ChangeResponse]
    #: True when the windows were too quiet to compare. Distinct from an empty
    #: list, which means it looked and nothing had moved.
    not_enough_material: bool


@router.get("/changes")
async def list_changes(
    request: Request,
    timezone: str = "UTC",
    user_id: UUID = Depends(current_user),
) -> ChangesResponse:
    try:
        zone = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown timezone: {timezone}") from exc

    # "Today" is the person's today, not the server's. A change described as "the
    # last 7 days" has to mean their days. Always resolved through the zone —
    # `date.today()` would read the server's clock, which is only coincidentally
    # right when the two happen to agree.
    today = datetime.now(zone).date()

    found = await temporal_db.changes(request.app.state.pool, user_id, today, timezone)
    active = await temporal_db.load_active_days(
        request.app.state.pool, user_id, timezone, WINDOW_DAYS * 2 + 1
    )

    return ChangesResponse(
        window_days=WINDOW_DAYS,
        changes=[
            ChangeResponse(
                kind=str(change.kind),
                label=change.label,
                shift=str(change.shift),
                recent_days=change.recent_days,
                earlier_days=change.earlier_days,
                confidence=change.confidence,
                description=change.describe(),
            )
            for change in found
        ],
        # Asked of the module that owns the rule rather than guessed at from the
        # number of active days. "We could not look" and "we looked and nothing
        # moved" are different answers, and only one of them says anything about
        # the person.
        not_enough_material=not comparable(active, today),
    )
