"""Themes over HTTP.

The clustering agent has been finding regions of people's lives and writing them
to the database with nowhere to surface — the densest claim the system makes,
computed daily and unreadable. These two routes are the read path.

A theme is deliberately thinner over the wire than it could be. It carries its
members, the associations that formed it, and its age; it does not carry a
generated summary, because none is written. Naming a region of someone's life is
an interpretation, and until a model does that under the same provenance rules
as everything else, the honest name for a theme is the list of what is in it.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from tlon.auth import current_user
from tlon.graph import communities

router = APIRouter(prefix="/v1/themes", tags=["themes"])


class Theme(BaseModel):
    id: UUID
    label: str
    #: The member labels, which *are* the name. Sent as a list rather than a
    #: sentence so the client is never tempted to render one as a heading.
    members: list[str]
    member_count: int
    confidence: float
    epistemic_status: str
    detector: str
    #: When this region was first recognised, not when the node was last
    #: rewritten. A theme that has held for two months is a different claim from
    #: one the clustering found this morning.
    first_seen_at: datetime
    tentative: bool
    created_at: datetime


class Member(BaseModel):
    id: UUID
    kind: str
    label: str
    confidence: float
    epistemic_status: str


class Association(BaseModel):
    """One edge inside the region. Adjacency only — no direction is implied by
    `from`/`to`, which are storage order rather than a claim."""

    from_id: UUID
    to_id: UUID
    confidence: float


class ThemeDetail(Theme):
    members: list[Member]  # type: ignore[assignment]
    #: Why these things are one region. Without them the membership list is a
    #: claim with its working hidden.
    associations: list[Association]
    last_confirmed_at: datetime


@router.get("")
async def list_themes(request: Request, user_id: UUID = Depends(current_user)) -> list[Theme]:
    rows = await communities.list_for_user(request.app.state.pool, user_id)
    return [Theme(**row) for row in rows]


@router.get("/{theme_id}")
async def get_theme(
    request: Request, theme_id: UUID, user_id: UUID = Depends(current_user)
) -> ThemeDetail:
    theme = await communities.detail(request.app.state.pool, user_id, theme_id)
    if theme is None:
        raise HTTPException(status_code=404, detail="not found")
    return ThemeDetail(**theme)
