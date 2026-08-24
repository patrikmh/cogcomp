"""Semantic search over HTTP.

`GET /v1/search/semantic?q=` — the readings closest in meaning to a question,
ranked by the local embedding model (ADR-0007). Deliberately separate from the
literal matching the clients do themselves: that path says "Nothing was ranked
or guessed", and this one exists precisely because here something *was*.

Unavailable, not empty, when the deployment has no real embedder: returning an
empty list would read as "nothing matches" when the truth is "this instance
cannot look for meaning at all".
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from tlon.auth import current_user
from tlon.config import get_settings
from tlon.graph.embedders import build_embedder
from tlon.graph import graphiti_client, semantic_search

router = APIRouter(prefix="/v1/search", tags=["search"])


class SemanticHit(BaseModel):
    node_id: UUID
    label: str
    kind: str
    confidence: float
    #: Cosine similarity between the query and the reading's own words. Sent so
    #: the client can show how close "close" actually is.
    score: float


class SemanticSearchResponse(BaseModel):
    embedder: str
    hits: list[SemanticHit]


@router.get("/semantic")
async def search_semantic(
    request: Request,
    q: str = Query(min_length=2, max_length=400),
    user_id: UUID = Depends(current_user),
) -> SemanticSearchResponse:
    settings = get_settings()
    if settings.embedding_provider.strip().lower() != "local":
        raise HTTPException(
            status_code=503,
            detail="semantic search needs EMBEDDING_PROVIDER=local on this server",
        )

    embedder = build_embedder(settings)
    graphiti = graphiti_client.build()
    try:
        hits = await semantic_search.search(
            request.app.state.pool,
            graphiti,
            user_id,
            q,
            embedder,
        )
    finally:
        await graphiti.close()
    return SemanticSearchResponse(embedder=semantic_search.VERSION, hits=hits)
