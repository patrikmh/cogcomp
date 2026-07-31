"""HTTP surface.

Handlers stay thin: validate, delegate, serialize. Business logic lives in the domain
and persistence layers where it can be tested without HTTP.
"""

from datetime import date as Date
from datetime import datetime
from uuid import UUID

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
from pydantic import BaseModel

from tlon.auth import current_user
from tlon.db import graph as graph_db
from tlon.db import inferences as inferences_db
from tlon.db import observations as observations_db
from tlon.db import summary as summary_db
from tlon.domain.observation import NewObservation, Observation, Source
from tlon.extraction.pipeline import ExtractionFailed
from tlon.graph.schema import SCHEMA_VERSION, NodeKind
from tlon.transcription import AudioTooLarge, TranscriptionError

router = APIRouter()

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


class ObservationResponse(BaseModel):
    id: UUID
    content: str
    source: Source
    captured_at: datetime
    created_at: datetime

    @classmethod
    def of(cls, observation: Observation) -> "ObservationResponse":
        return cls(**observation.model_dump(include=set(cls.model_fields)))


class ListResponse(BaseModel):
    observations: list[ObservationResponse]
    next_before: datetime | None = None


@router.get("/health")
async def health() -> dict:
    """Liveness: the process is up.

    Deliberately does not touch the database, so a database outage does not get the
    process restarted out from under us.
    """
    return {"status": "ok", "schema_version": SCHEMA_VERSION}


@router.get("/ready")
async def ready(request: Request) -> dict:
    """Readiness: we can actually serve traffic, which means the database answers."""
    try:
        await request.app.state.pool.fetchval("SELECT 1")
    except Exception:  # noqa: BLE001
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "database unreachable") from None
    return {
        "status": "ready",
        "schema_version": SCHEMA_VERSION,
        "extractor": request.app.state.extractor.version,
        "transcriber": request.app.state.transcriber.version,
    }


@router.post("/v1/observations", status_code=status.HTTP_201_CREATED)
async def create_observation(
    request: Request,
    payload: NewObservation,
    user_id: UUID = Depends(current_user),
) -> ObservationResponse:
    try:
        observation = await observations_db.insert(request.app.state.pool, user_id, payload)
    except FileExistsError as exc:
        # The client mints the id, so a retry after a flaky connection resolves to
        # the same observation rather than a second copy of the same thought.
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return ObservationResponse.of(observation)


@router.post("/v1/observations/voice", status_code=status.HTTP_201_CREATED)
async def create_voice_observation(
    request: Request,
    id: UUID = Form(..., description="Client-generated UUIDv7, as for text entries."),
    audio: UploadFile = File(...),
    captured_at: datetime | None = Form(None),
    user_id: UUID = Depends(current_user),
) -> ObservationResponse:
    """Transcribe a recording and store the transcript as an observation.

    The audio is discarded once transcribed. It is never written to the database
    and never becomes a node — the transcript is the observation, and keeping the
    recording would mean storing the user's voice alongside their most private
    thoughts for nothing the transcript does not already give us.

    Declared before the `/{observation_id}` routes so that "voice" is matched as a
    literal rather than swallowed as an id.
    """
    payload = await audio.read()

    try:
        transcript = await request.app.state.transcriber.transcribe(
            payload, audio.filename or "recording.m4a"
        )
    except AudioTooLarge as exc:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, str(exc)) from exc
    except TranscriptionError as exc:
        # The recording reached us and was rejected downstream, so this is not
        # something the client fixes by re-sending the same bytes.
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    try:
        new = NewObservation(
            id=id, content=transcript, source=Source.VOICE, captured_at=captured_at
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    try:
        observation = await observations_db.insert(request.app.state.pool, user_id, new)
    except FileExistsError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    return ObservationResponse.of(observation)


@router.get("/v1/observations")
async def list_observations(
    request: Request,
    limit: int = DEFAULT_LIMIT,
    before: datetime | None = None,
    user_id: UUID = Depends(current_user),
) -> ListResponse:
    if limit < 1:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "limit must be at least 1")
    limit = min(limit, MAX_LIMIT)

    observations = await observations_db.list_for_user(
        request.app.state.pool, user_id, limit, before
    )
    # Keyset pagination on captured_at, which is stable under concurrent writes in a
    # way that offset pagination is not.
    next_before = observations[-1].captured_at if len(observations) == limit else None
    return ListResponse(
        observations=[ObservationResponse.of(o) for o in observations],
        next_before=next_before,
    )


@router.get("/v1/observations/{observation_id}")
async def fetch_observation(
    request: Request,
    observation_id: UUID,
    user_id: UUID = Depends(current_user),
) -> ObservationResponse:
    observation = await observations_db.find(request.app.state.pool, user_id, observation_id)
    if observation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    return ObservationResponse.of(observation)


@router.delete("/v1/observations/{observation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_observation(
    request: Request,
    observation_id: UUID,
    user_id: UUID = Depends(current_user),
) -> None:
    deleted = await observations_db.soft_delete(request.app.state.pool, user_id, observation_id)
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")


class ExtractionResponse(BaseModel):
    observation_id: UUID
    extractor: str
    nodes: int
    edges: int


@router.post("/v1/observations/{observation_id}/extract")
async def extract_observation(
    request: Request,
    observation_id: UUID,
    user_id: UUID = Depends(current_user),
) -> ExtractionResponse:
    """Run the extraction pipeline over one observation and persist the result.

    Synchronous for Milestone 1. Temporal moves this off the request path once
    extraction is something the user should not have to wait for.
    """
    pool = request.app.state.pool
    extractor = request.app.state.extractor

    observation = await observations_db.find(pool, user_id, observation_id)
    if observation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")

    if await inferences_db.already_extracted(pool, observation_id):
        # Re-running would write a second set of nodes citing the same entry, which
        # inflates the graph and makes the dashboard lie.
        raise HTTPException(status.HTTP_409_CONFLICT, "observation already extracted")

    try:
        extraction = await extractor.extract(observation.content)
    except ExtractionFailed as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"extraction failed: {exc}") from exc

    counts = await inferences_db.persist(
        pool,
        user_id=user_id,
        observation_id=observation_id,
        extraction=extraction,
        extractor=extractor.version,
    )
    return ExtractionResponse(observation_id=observation_id, extractor=extractor.version, **counts)


@router.get("/v1/summary/{day}")
async def daily_summary(
    request: Request,
    day: Date,
    tz: str = "UTC",
    user_id: UUID = Depends(current_user),
) -> dict:
    """What a given day held.

    `tz` is an IANA timezone (e.g. `Europe/Stockholm`). A day is a local concept —
    an entry written at 11pm belongs to that day, and computing the boundary in UTC
    would file it under the next one for anyone east of Greenwich.

    The summary is assembled from the graph, so everything in it is either the
    user's own words or an inference already carrying confidence and provenance.
    """
    try:
        return await summary_db.daily_summary(request.app.state.pool, user_id, day, tz)
    except summary_db.UnknownTimezone as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.get("/v1/graph")
async def graph(
    request: Request,
    limit: int = graph_db.DEFAULT_SUBGRAPH_NODES,
    min_confidence: float | None = None,
    kinds: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    user_id: UUID = Depends(current_user),
) -> dict:
    """Nodes and edges for rendering.

    `kinds` is a comma-separated list of node kinds. `min_confidence` filters
    inferences but never observations — they are not claims and have no confidence
    to filter on.

    Edges are returned only when both endpoints survived the filters, so the client
    never has to draw a line to a node it was not given.
    """
    if min_confidence is not None and not 0.0 <= min_confidence <= 1.0:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "min_confidence must be between 0.0 and 1.0"
        )

    kind_list = [k.strip() for k in kinds.split(",") if k.strip()] if kinds else None
    if kind_list:
        unknown = [k for k in kind_list if k not in set(NodeKind)]
        if unknown:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, f"unknown node kinds: {unknown}"
            )

    return await graph_db.subgraph(
        request.app.state.pool,
        user_id,
        limit=limit,
        min_confidence=min_confidence,
        kinds=kind_list,
        since=since,
        until=until,
    )


@router.get("/v1/graph/nodes/{node_id}/neighbours")
async def node_neighbours(
    request: Request,
    node_id: UUID,
    user_id: UUID = Depends(current_user),
) -> dict:
    """One node and everything directly connected to it — what a tap needs."""
    result = await graph_db.neighbours(request.app.state.pool, user_id, node_id)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    return result


@router.get("/v1/graph/nodes/{node_id}/explain")
async def explain_node(
    request: Request,
    node_id: UUID,
    user_id: UUID = Depends(current_user),
) -> dict:
    """ "Why do you think this?" — answered by walking provenance back to the user's
    own words. Available for every node in the graph, not just some of them."""
    explanation = await graph_db.explain(request.app.state.pool, user_id, node_id)
    if explanation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    return explanation


@router.get("/v1/graph/summary")
async def graph_summary(
    request: Request,
    user_id: UUID = Depends(current_user),
) -> dict:
    counts = await graph_db.kind_counts(request.app.state.pool, user_id)
    return {"schema_version": SCHEMA_VERSION, "counts": counts}
