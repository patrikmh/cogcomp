"""Conversational journalling, and the voice transport it runs on."""

from __future__ import annotations

import base64
import json
import logging
from collections.abc import AsyncIterator
from datetime import datetime
from uuid import UUID

import httpx
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ValidationError, field_validator

from tlon.auth import current_user
from tlon.conversation import ConversationError, Delta, Done
from tlon.db import conversations as conversations_db
from tlon.db import inferences as inferences_db
from tlon.db import observations as observations_db
from tlon.domain.observation import MAX_CONTENT_CHARS
from tlon.domain.weekly import timezone_for
from tlon.speech import MAX_CHARS as MAX_SPOKEN_CHARS
from tlon.speech import SpeechError
from tlon.transcription import AudioTooLarge, TranscriptionError, transcribe_bounded_upload


async def _add_turn(*args, **kwargs):
    try:
        return await conversations_db.add_turn(*args, **kwargs)
    except conversations_db.ConversationClosedError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, "conversation is already closed") from exc
    except conversations_db.ConversationFlaggedError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, CRISIS_BLOCKED) from exc


async def _reconciled_response(
    request: Request, user_id: UUID, conversation_id: UUID, reply: str, conn=None
) -> TurnResponse:
    """Return a previously persisted reply without generating it again."""
    conversation = (await conversations_db.find_on_connection(conn, user_id, conversation_id)
                    if conn is not None else
                    await conversations_db.find(request.app.state.pool, user_id, conversation_id))
    flagged = conversation["flagged"]
    return TurnResponse(
        reply=reply,
        crisis=flagged,
        crisis_resources=request.app.state.settings.crisis_resources_list if flagged else [],
    )


async def _replay_completed(
    request: Request, pool, user_id: UUID, conversation_id: UUID, client_turn_id: UUID,
    reply: str,
) -> TurnResponse:
    async with conversations_db.turn_operation_lock(pool, user_id, conversation_id, client_turn_id) as lock_conn:
        status_result = await conversations_db.client_turn_status_on_connection(
            lock_conn, user_id, conversation_id, client_turn_id
        )
        if status_result and status_result[0] == "assistant":
            if await conversations_db.client_turn_is_ambiguous_on_connection(
                lock_conn, user_id, conversation_id, client_turn_id
            ):
                raise HTTPException(status.HTTP_409_CONFLICT, {"code": "turn_ambiguous", "message": "This turn already has later messages. Refresh the conversation before retrying."})
            return await _reconciled_response(request, user_id, conversation_id, status_result[1], lock_conn)
        return await _reconciled_response(request, user_id, conversation_id, reply, lock_conn)


async def _replay_completed_stream(
    request: Request, pool, user_id: UUID, conversation_id: UUID, client_turn_id: UUID,
    reply: str,
) -> StreamingResponse:
    async with conversations_db.turn_operation_lock(pool, user_id, conversation_id, client_turn_id) as lock_conn:
        status_result = await conversations_db.client_turn_status_on_connection(
            lock_conn, user_id, conversation_id, client_turn_id
        )
        if status_result and status_result[0] == "assistant":
            if await conversations_db.client_turn_is_ambiguous_on_connection(
                lock_conn, user_id, conversation_id, client_turn_id
            ):
                raise HTTPException(status.HTTP_409_CONFLICT, {"code": "turn_ambiguous", "message": "This turn already has later messages. Refresh the conversation before retrying."})
            conversation = await conversations_db.find_on_connection(lock_conn, user_id, conversation_id)
            return _replay_stream(request, status_result[1], conversation["flagged"])
        conversation = await conversations_db.find_on_connection(lock_conn, user_id, conversation_id)
        return _replay_stream(request, reply, conversation["flagged"])


async def _persist_assistant_turn(
    pool, user_id: UUID, conversation_id: UUID, content: str, client_turn_id: UUID,
    conn=None, crisis: bool = False,
) -> bool:
    try:
        if conn is None:
            await conversations_db.add_turn(
                pool, user_id, conversation_id, "assistant", content,
                client_turn_id=client_turn_id,
            )
        else:
            await conversations_db.add_assistant_turn_on_connection(
                conn, user_id, conversation_id, content, client_turn_id, crisis
            )
    except (conversations_db.ConversationClosedError, conversations_db.ConversationFlaggedError):
        # Closing or a crisis flag wins this lifecycle race. The user's turn is
        # authoritative; never reopen the conversation or retry the reply.
        logger.warning("conversation lifecycle changed before assistant turn was persisted")
        return False
    return True


logger = logging.getLogger(__name__)

AGENT_UNAVAILABLE = "The conversation could not be answered. Your turn was saved."
ASSISTANT_NOT_PERSISTED = {
    "code": "assistant_not_persisted",
    "message": "The reply could not be saved. Refresh the conversation to reconcile it.",
}
TRANSCRIPTION_FAILED = "We could not understand that recording. Please try again."
SPEECH_FAILED = "We could not generate audio. Please try again."
AUDIO_TOO_LARGE = "That recording is too large. Please try a shorter recording."
CRISIS_BLOCKED = "This conversation is paused after a crisis disclosure. Start a new conversation when you are ready."


def _reject_flagged(conversation: dict) -> None:
    if conversation["flagged"]:
        raise HTTPException(status.HTTP_409_CONFLICT, CRISIS_BLOCKED)

router = APIRouter(prefix="/v1/conversations", tags=["conversations"])

#: Mints the single-use token a browser opens the realtime transcription socket
#: with. The token type is part of the path, not the body, and the token it
#: returns expires in fifteen minutes and is consumed on use.
#:
#: This was `/v1/token` for as long as the endpoint has existed here, which is
#: not an address ElevenLabs has ever served — it 404s, the route turned that
#: into its own 502, and the feature has never worked. Nothing called it, so
#: nothing reported it.
ELEVENLABS_TOKEN_URL = "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe"

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
    #: The IANA zone this was said in. Kept on the turn because the turn is what
    #: becomes an entry, and an entry's day is a local fact.
    timezone: str | None = None
    client_turn_id: UUID

    @field_validator("timezone")
    @classmethod
    def timezone_is_known(cls, value: str | None) -> str | None:
        if value is not None:
            timezone_for(value)
        return value


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
    conversation["crisis_resources"] = request.app.state.settings.crisis_resources_list if conversation["flagged"] else []
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
    status_result = await conversations_db.client_turn_status(
        pool, user_id, conversation_id, payload.client_turn_id
    )
    if status_result is not None and status_result[0] == "assistant":
        if not await conversations_db.client_turn_payload_matches(
            pool, user_id, conversation_id, payload.client_turn_id,
            payload.source, payload.timezone, payload.content,
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, {"code": "turn_payload_mismatch", "message": "This turn ID was already used with a different payload."})
        return await _replay_completed(request, pool, user_id, conversation_id, payload.client_turn_id, status_result[1])
    _reject_flagged(conversation)
    if conversation["closed_at"] is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "conversation is already closed")

    if not payload.content.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "turn cannot be blank")

    turn = await _add_turn(pool, user_id, conversation_id, "user", payload.content,
                           payload.source, payload.timezone, payload.client_turn_id)
    if turn.get("ambiguous"):
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "turn_ambiguous", "message": "This turn already has later messages. Refresh the conversation before retrying."})
    if turn.get("payload_mismatch"):
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "turn_payload_mismatch", "message": "This turn ID was already used with a different payload."})

    async with conversations_db.turn_operation_lock(pool, user_id, conversation_id, payload.client_turn_id) as lock_conn:
        status_result = await conversations_db.client_turn_status_on_connection(lock_conn, user_id, conversation_id, payload.client_turn_id)
        if status_result and status_result[0] == "assistant":
            return await _reconciled_response(request, user_id, conversation_id, status_result[1], lock_conn)
        # A retry owns the same lock after a failed generation and may therefore
        # generate again. Only the terminal assistant row makes a turn complete.
        conversation = await conversations_db.find_on_connection(lock_conn, user_id, conversation_id)
        _reject_flagged(conversation)
        if conversation["closed_at"] is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "conversation is already closed")
        try:
            reply = await request.app.state.conversation_agent.reply(conversation["turns"])
        except ConversationError as exc:
            logger.warning("conversation reply failed: %s", exc)
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, AGENT_UNAVAILABLE) from exc

        persisted = await _persist_assistant_turn(
            pool, user_id, conversation_id, reply.content, payload.client_turn_id,
            lock_conn, reply.crisis,
        )
        if not persisted:
            raise HTTPException(status.HTTP_409_CONFLICT, ASSISTANT_NOT_PERSISTED)
        return TurnResponse(
            reply=reply.content,
            crisis=reply.crisis,
            crisis_resources=settings.crisis_resources_list if reply.crisis else [],
        )


def _event(payload: dict) -> str:
    """One server-sent event. The blank line is what ends it."""
    return f"data: {json.dumps(payload)}\n\n"


@router.post("/{conversation_id}/turns/stream")
async def add_turn_streaming(
    request: Request,
    conversation_id: UUID,
    payload: TurnRequest,
    user_id: UUID = Depends(current_user),
) -> StreamingResponse:
    """The same turn as `/turns`, sent as it is written.

    Both exist. This one is what makes a conversation feel like one — the client
    can send a sentence for synthesis while the model is still writing the next,
    so the wait for the model and the wait for the voice overlap instead of
    stacking. The plain endpoint stays because a stream is not always available
    to the caller: a React Native client has no readable response body, and
    anything that cannot read one needs an answer in a single piece.

    The person's turn is stored before the model is called, exactly as it is
    there, so a failure mid-stream never loses what they said.
    """
    pool = request.app.state.pool
    conversation = await conversations_db.find(pool, user_id, conversation_id)
    if conversation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    status_result = await conversations_db.client_turn_status(
        pool, user_id, conversation_id, payload.client_turn_id
    )
    if status_result is not None and status_result[0] == "assistant":
        if not await conversations_db.client_turn_payload_matches(
            pool, user_id, conversation_id, payload.client_turn_id,
            payload.source, payload.timezone, payload.content,
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, {"code": "turn_payload_mismatch", "message": "This turn ID was already used with a different payload."})
        return await _replay_completed_stream(request, pool, user_id, conversation_id, payload.client_turn_id, status_result[1])
    _reject_flagged(conversation)
    if conversation["closed_at"] is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "conversation is already closed")

    if not payload.content.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "turn cannot be blank")

    turn = await _add_turn(pool, user_id, conversation_id, "user", payload.content,
                           payload.source, payload.timezone, payload.client_turn_id)
    if turn.get("ambiguous"):
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "turn_ambiguous", "message": "This turn already has later messages. Refresh the conversation before retrying."})
    if turn.get("payload_mismatch"):
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "turn_payload_mismatch", "message": "This turn ID was already used with a different payload."})
    if turn.get("assistant_reply") is not None:
        return await _replay_completed_stream(request, pool, user_id, conversation_id, payload.client_turn_id, turn["assistant_reply"])
    if turn.get("pending"):
        conversation = await conversations_db.find(pool, user_id, conversation_id)
    # The stream acquires the conversation lock before taking its model snapshot.
    conversation = await conversations_db.find(pool, user_id, conversation_id)
    turns = conversation["turns"]

    return await _stream_agent_response(
        request, pool, user_id, conversation_id, turns, payload.client_turn_id,
        source=payload.source, timezone=payload.timezone, content=payload.content,
    )

def _replay_stream(request: Request, reply: str, crisis: bool) -> StreamingResponse:
    settings = request.app.state.settings

    async def events() -> AsyncIterator[str]:
        yield _event({
            "type": "done",
            "reply": reply,
            "crisis": crisis,
            "crisis_resources": settings.crisis_resources_list if crisis else [],
        })

    return StreamingResponse(events(), media_type="text/event-stream")


async def _stream_agent_response(
    request: Request,
    pool,
    user_id: UUID,
    conversation_id: UUID,
    turns: list[dict],
    client_turn_id: UUID,
    transcript: str | None = None,
    source: str = "text",
    timezone: str | None = None,
    content: str | None = None,
) -> StreamingResponse:
    """Stream an agent reply, optionally beginning with a voice transcript."""
    settings = request.app.state.settings

    async def events() -> AsyncIterator[str]:
        if transcript is not None:
            yield _event({"type": "transcript", "text": transcript})
        async with conversations_db.turn_operation_lock(pool, user_id, conversation_id, client_turn_id) as lock_conn:
            status_result = await conversations_db.client_turn_status_on_connection(lock_conn, user_id, conversation_id, client_turn_id)
            if status_result and status_result[0] == "assistant":
                if not await conversations_db.client_turn_payload_matches(
                    pool, user_id, conversation_id, client_turn_id, source, timezone, content,
                ):
                    yield _event({"type": "error", "code": "turn_payload_mismatch", "message": "This turn ID was already used with a different payload."})
                    return
                if await conversations_db.client_turn_is_ambiguous_on_connection(
                    lock_conn, user_id, conversation_id, client_turn_id
                ):
                    yield _event({"type": "error", "code": "turn_ambiguous", "message": "This turn already has later messages. Refresh the conversation before retrying."})
                    return
                reconciled = await conversations_db.find_on_connection(lock_conn, user_id, conversation_id)
                crisis = reconciled["flagged"]
                yield _event({
                    "type": "done", "reply": status_result[1],
                    "crisis": crisis,
                    "crisis_resources": settings.crisis_resources_list if crisis else [],
                })
                return
            # The conversation lock covers the complete generation and terminal persistence.
            current = await conversations_db.find_on_connection(lock_conn, user_id, conversation_id)
            if current["flagged"]:
                yield _event({"type": "error", "code": "crisis_blocked", "message": CRISIS_BLOCKED})
                return
            if current["closed_at"] is not None:
                yield _event({"type": "error", "code": "conversation_closed", "message": "conversation is already closed"})
                return
            written = ""
            crisis = False
            try:
                async for event in request.app.state.conversation_agent.stream(current["turns"]):
                    if isinstance(event, Delta):
                        written += event.text
                        yield _event({"type": "delta", "text": event.text})
                    elif isinstance(event, Done):
                        written = event.content
                        crisis = event.crisis
                        persisted = await _persist_assistant_turn(
                            pool, user_id, conversation_id, written, client_turn_id,
                            lock_conn, crisis,
                        )
                        if not persisted:
                            yield _event({"type": "error", **ASSISTANT_NOT_PERSISTED})
                            return
                        yield _event({
                            "type": "done", "reply": event.content,
                            "crisis": event.crisis,
                            "crisis_resources": settings.crisis_resources_list if event.crisis else [],
                        })
                        return
            except ConversationError as exc:
                logger.warning("conversation stream failed: %s", exc)
                yield _event({"type": "error", "message": AGENT_UNAVAILABLE})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.post("/{conversation_id}/turns/voice/stream")
async def add_voice_turn_streaming(
    request: Request,
    conversation_id: UUID,
    audio: UploadFile = File(...),
    timezone: str | None = Form(None),
    client_turn_id: UUID = Form(...),
    user_id: UUID = Depends(current_user),
) -> StreamingResponse:
    pool = request.app.state.pool
    conversation = await conversations_db.find(pool, user_id, conversation_id)
    if conversation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    status_result = await conversations_db.client_turn_status(
        pool, user_id, conversation_id, client_turn_id
    )
    if status_result is not None and status_result[0] == "assistant":
        if not await conversations_db.client_turn_payload_matches(
            pool, user_id, conversation_id, client_turn_id,
            "voice", timezone,
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, {"code": "turn_payload_mismatch", "message": "This turn ID was already used with a different payload."})
        return await _replay_completed_stream(request, pool, user_id, conversation_id, client_turn_id, status_result[1])
    _reject_flagged(conversation)
    if conversation["closed_at"] is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "conversation is already closed")

    try:
        transcript = await transcribe_bounded_upload(audio, request.app.state.transcriber)
    except AudioTooLarge as exc:
        logger.warning("audio upload too large: %s", exc)
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, AUDIO_TOO_LARGE) from exc
    except TranscriptionError as exc:
        logger.warning("transcription failed: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, TRANSCRIPTION_FAILED) from exc

    # Same contract as a typed turn: known timezone, non-blank, bounded length.
    # Skipping TurnRequest here used to let a bad zone persist and then fail
    # later, when closing the conversation tried to make an observation of it.
    try:
        turn = TurnRequest(content=transcript, source="voice", timezone=timezone, client_turn_id=client_turn_id)
    except ValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, exc.errors()[0]["msg"]) from exc
    if not turn.content.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "turn cannot be blank")
    turn_result = await _add_turn(
        pool, user_id, conversation_id, "user", turn.content, turn.source, turn.timezone,
        turn.client_turn_id,
    )
    if turn_result.get("ambiguous"):
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "turn_ambiguous", "message": "This turn already has later messages. Refresh the conversation before retrying."})
    if turn_result.get("payload_mismatch"):
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "turn_payload_mismatch", "message": "This turn ID was already used with a different payload."})
    if turn_result.get("assistant_reply") is not None:
        return await _replay_completed_stream(request, pool, user_id, conversation_id, client_turn_id, turn_result["assistant_reply"])
    # Read the committed conversation after the idempotent insert; a concurrent
    # turn must be part of the model snapshot as well.
    conversation = await conversations_db.find(pool, user_id, conversation_id)
    turns = conversation["turns"]
    return await _stream_agent_response(
        request, pool, user_id, conversation_id, turns, turn.client_turn_id,
        None if turn_result.get("duplicate") else turn.content,
        source="voice", timezone=turn.timezone, content=turn.content,
    )


@router.post("/{conversation_id}/turns/voice")
async def add_voice_turn(
    request: Request,
    conversation_id: UUID,
    audio: UploadFile = File(...),
    timezone: str | None = Form(None),
    client_turn_id: UUID = Form(...),
    user_id: UUID = Depends(current_user),
) -> TurnResponse:
    """Speak a turn instead of typing it.

    Transcribes and then takes exactly the same path as a typed turn, so a
    spoken conversation is not a separate feature with its own rules — it is the
    same conversation, entered differently. The recording is discarded once
    transcribed, as everywhere else.
    """
    conversation = await conversations_db.find(request.app.state.pool, user_id, conversation_id)
    if conversation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    status_result = await conversations_db.client_turn_status(
        request.app.state.pool, user_id, conversation_id, client_turn_id
    )
    if status_result is not None and status_result[0] == "assistant":
        if not await conversations_db.client_turn_payload_matches(
            request.app.state.pool, user_id, conversation_id, client_turn_id,
            "voice", timezone,
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, {"code": "turn_payload_mismatch", "message": "This turn ID was already used with a different payload."})
        return await _replay_completed(request, request.app.state.pool, user_id, conversation_id, client_turn_id, status_result[1])
    if conversation["closed_at"] is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "conversation is already closed")
    _reject_flagged(conversation)

    try:
        transcript = await transcribe_bounded_upload(audio, request.app.state.transcriber)
    except AudioTooLarge as exc:
        logger.warning("audio upload too large: %s", exc)
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, AUDIO_TOO_LARGE) from exc
    except TranscriptionError as exc:
        logger.warning("transcription failed: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, TRANSCRIPTION_FAILED) from exc

    return await add_turn(
        request,
        conversation_id,
        TurnRequest(content=transcript, source="voice", timezone=timezone, client_turn_id=client_turn_id),
        user_id,
    )


class CloseResponse(BaseModel):
    conversation_id: UUID
    observations: list[UUID]
    turns_converted: int


@router.post("/{conversation_id}/close")
async def close_conversation(
    request: Request,
    conversation_id: UUID,
    include_findings: bool = True,
    user_id: UUID = Depends(current_user),
) -> CloseResponse:
    """End the conversation and keep what the person said.

    Only their turns become an observation, and the conversation becomes one:
    someone works out what they mean over a few sentences, and kept apart those
    sentences are fragments that only read in order.

    The entry is extracted here rather than left for later. A conversation that
    ended and produced nothing visible is a conversation the person cannot tell
    worked, and the readings are the only evidence it did.
    """
    try:
        result = await conversations_db.close(request.app.state.pool, user_id, conversation_id)
    except LookupError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found") from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    # Extraction is best-effort: the entry is already saved and is the thing
    # that must not be lost. A model that is down or slow costs the person their
    # readings, not their words, and the entry can be extracted again later.
    if not include_findings:
        return CloseResponse(
            conversation_id=UUID(result["conversation_id"]),
            observations=[UUID(o) for o in result["observations"]],
            turns_converted=result["turns_converted"],
        )

    extractor = request.app.state.extractor
    for observation_id in result["observations"]:
        try:
            observation = await observations_db.find(
                request.app.state.pool, user_id, UUID(observation_id)
            )
            if observation is None:
                continue
            extraction = await extractor.extract(observation.content)
            counts = await inferences_db.persist(
                request.app.state.pool,
                user_id=user_id,
                observation_id=UUID(observation_id),
                extraction=extraction,
                extractor=extractor.version,
            )
            # Said out loud, because this is the one extraction nobody asked for
            # and so the one whose result nobody sees. The same text posted as an
            # ordinary entry draws five readings; closing a conversation drew
            # none, and with nothing logged there was no way to tell whether the
            # model returned nothing or the entry never reached it.
            logger.info(
                "extraction after close: conversation=%s observation=%s chars=%d nodes=%s",
                conversation_id,
                observation_id,
                len(observation.content or ""),
                counts.get("nodes"),
            )
        except Exception:
            logger.exception("extraction after closing conversation %s failed", conversation_id)

    return CloseResponse(
        conversation_id=UUID(result["conversation_id"]),
        observations=[UUID(o) for o in result["observations"]],
        turns_converted=result["turns_converted"],
    )


voice_router = APIRouter(prefix="/v1/voice", tags=["voice"])


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_SPOKEN_CHARS)


@voice_router.post("/token")
async def realtime_token(request: Request, user_id: UUID = Depends(current_user)) -> dict:
    """Mint a short-lived ElevenLabs token for realtime transcription.

    The client needs to open a websocket to ElevenLabs directly — streaming audio
    through this server would add a hop for no benefit. It does not need the
    account key to do that, and must never have it: a key in a mobile bundle or a
    browser tab is a key that has left your control.
    """
    settings = request.app.state.settings
    if settings.transcription_provider.strip().lower() != "elevenlabs":
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "realtime transcription requires the ElevenLabs provider",
        )
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
        # Logged with the upstream status, because without it every cause looks
        # the same from outside: a wrong path, an expired key, and a key with no
        # permission for this all arrive as one unexplained 502. The last time
        # this failed it was a 404 on an address that has never existed, and
        # nothing said so anywhere.
        logger.warning(
            "realtime token mint failed: %s returned %s",
            ELEVENLABS_TOKEN_URL,
            response.status_code,
        )
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "could not mint a realtime token")

    token = response.json().get("token")
    if not token:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "no token was returned")
    return {"token": token}


class SpeechResponse(BaseModel):
    """A spoken reply, and the shape of it.

    The audio is inlined as base64 rather than served from a URL. A clip is a few
    seconds of one person's private conversation; giving it an address means
    deciding how long that address lives and who may follow it, and the answer
    for this product is "it does not have one".
    """

    audio: str
    #: One 0–1 loudness value per `frame_ms`. The client interpolates between
    #: them by playback position, which is what puts the blob in time with the
    #: voice rather than merely animating while audio happens to be playing.
    envelope: list[float]
    frame_ms: int
    duration_ms: int


@voice_router.post("/speak")
async def synthesise(
    request: Request, payload: SpeakRequest, user_id: UUID = Depends(current_user)
) -> SpeechResponse:
    """Turn an agent reply into audio.

    Takes the text rather than a turn id on purpose: this synthesises what the
    client is already showing, so the spoken and written words cannot drift apart.
    """
    voice = request.app.state.voice
    if not voice.enabled:
        # 503 rather than a silent empty clip, so the client can fall back to
        # showing text rather than looking broken.
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "speech is not configured on this server",
        )

    try:
        clip = await voice.speak(payload.text)
    except SpeechError as exc:
        logger.warning("speech synthesis failed: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, SPEECH_FAILED) from exc

    return SpeechResponse(
        audio=base64.b64encode(clip.audio).decode(),
        envelope=clip.envelope,
        frame_ms=clip.frame_ms,
        duration_ms=clip.duration_ms,
    )
