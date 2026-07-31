"""Conversational journalling, and the voice transport it runs on."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from tlon.auth import current_user
from tlon.conversation import ConversationError
from tlon.db import conversations as conversations_db
from tlon.domain.observation import MAX_CONTENT_CHARS

router = APIRouter(prefix="/v1/conversations", tags=["conversations"])

ELEVENLABS_TOKEN_URL = "https://api.elevenlabs.io/v1/token"

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


class StartResponse(BaseModel):
    id: UUID
    started_at: datetime
    agent: str


class TurnRequest(BaseModel):
    content: str = Field(min_length=1, max_length=MAX_CONTENT_CHARS)
    #: Whether this turn was spoken or typed. Carried through to the observation,
    #: because a spoken turn passed through transcription and a typed one did not.
    source: str = Field(default="text", pattern="^(text|voice)$")


class TurnResponse(BaseModel):
    reply: str
    #: True when the agent judged that someone is at risk of serious harm. The
    #: client shows the configured local services and stops prompting.
    crisis: bool = False
    crisis_resources: list[str] = Field(default_factory=list)


@router.post("", status_code=status.HTTP_201_CREATED)
async def start_conversation(
    request: Request, user_id: UUID = Depends(current_user)
) -> StartResponse:
    agent = request.app.state.conversation_agent
    conversation = await conversations_db.start(request.app.state.pool, user_id, agent.version)
    return StartResponse(**conversation | {"id": UUID(conversation["id"])})


@router.get("")
async def list_conversations(
    request: Request,
    limit: int = DEFAULT_LIMIT,
    before: datetime | None = None,
    user_id: UUID = Depends(current_user),
) -> dict:
    if limit < 1:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "limit must be at least 1")
    conversations = await conversations_db.list_for_user(
        request.app.state.pool, user_id, min(limit, MAX_LIMIT), before
    )
    return {"conversations": conversations}


@router.get("/{conversation_id}")
async def get_conversation(
    request: Request, conversation_id: UUID, user_id: UUID = Depends(current_user)
) -> dict:
    conversation = await conversations_db.find(request.app.state.pool, user_id, conversation_id)
    if conversation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    return conversation


@router.post("/{conversation_id}/turns")
async def add_turn(
    request: Request,
    conversation_id: UUID,
    payload: TurnRequest,
    user_id: UUID = Depends(current_user),
) -> TurnResponse:
    """Record what the person said and get the agent's reply.

    The user's turn is stored before the model is called, so a failure on the
    agent's side never loses what they said.
    """
    pool = request.app.state.pool
    settings = request.app.state.settings

    conversation = await conversations_db.find(pool, user_id, conversation_id)
    if conversation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    if conversation["closed_at"] is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "conversation is already closed")

    if not payload.content.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "turn cannot be blank")

    await conversations_db.add_turn(
        pool, user_id, conversation_id, "user", payload.content, payload.source
    )

    turns = conversation["turns"] + [{"speaker": "user", "content": payload.content}]

    try:
        reply = await request.app.state.conversation_agent.reply(turns)
    except ConversationError as exc:
        # The person's turn is already saved, so nothing they said is lost.
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"agent unavailable: {exc}") from exc

    await conversations_db.add_turn(pool, user_id, conversation_id, "assistant", reply.content)

    if reply.crisis:
        await conversations_db.flag(pool, conversation_id)

    return TurnResponse(
        reply=reply.content,
        crisis=reply.crisis,
        # Sent with the reply rather than looked up separately, so the client
        # cannot show the message without the services alongside it.
        crisis_resources=settings.crisis_resources_list if reply.crisis else [],
    )


class CloseResponse(BaseModel):
    conversation_id: UUID
    observations: list[UUID]
    turns_converted: int


@router.post("/{conversation_id}/close")
async def close_conversation(
    request: Request, conversation_id: UUID, user_id: UUID = Depends(current_user)
) -> CloseResponse:
    """End the conversation and keep what the person said.

    Only their turns become observations. Each becomes its own entry rather than
    one merged blob — they were said at different moments, often about different
    things, and joining them would produce an entry they never wrote.
    """
    try:
        result = await conversations_db.close(request.app.state.pool, user_id, conversation_id)
    except LookupError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found") from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    return CloseResponse(
        conversation_id=UUID(result["conversation_id"]),
        observations=[UUID(o) for o in result["observations"]],
        turns_converted=result["turns_converted"],
    )


voice_router = APIRouter(prefix="/v1/voice", tags=["voice"])


@voice_router.post("/token")
async def realtime_token(request: Request, user_id: UUID = Depends(current_user)) -> dict:
    """Mint a short-lived ElevenLabs token for realtime transcription.

    The client needs to open a websocket to ElevenLabs directly — streaming audio
    through this server would add a hop for no benefit. It does not need the
    account key to do that, and must never have it: a key in a mobile bundle or a
    browser tab is a key that has left your control.
    """
    settings = request.app.state.settings
    if not settings.uses_real_transcription:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "realtime transcription is not configured on this server",
        )

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            ELEVENLABS_TOKEN_URL,
            headers={"xi-api-key": settings.transcription_api_key},
        )

    if response.status_code >= 400:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "could not mint a realtime token")

    token = response.json().get("token")
    if not token:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "no token was returned")
    return {"token": token}
