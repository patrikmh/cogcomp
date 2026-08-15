import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from tlon.agents.scheduler import loop as agent_loop
from tlon.api.agent_routes import router as agent_router
from tlon.api.auth_routes import router as auth_router
from tlon.api.conversation_routes import router as conversation_router
from tlon.api.conversation_routes import voice_router
from tlon.api.experiment_routes import router as experiment_router
from tlon.api.identity_routes import router as identity_router
from tlon.api.pattern_routes import router as pattern_router
from tlon.api.routes import router
from tlon.api.temporal_routes import router as temporal_router
from tlon.api.theme_routes import router as theme_router
from tlon.api.twin_routes import router as twin_router
from tlon.config import get_settings
from tlon.conversation import build_agent
from tlon.db.engine import create_pool, run_migrations
from tlon.extraction.pipeline import LangGraphExtractor
from tlon.extraction.stub import StubExtractor
from tlon.graph.schema import SCHEMA_VERSION
from tlon.speech import build_voice
from tlon.transcription import build_transcriber

logger = logging.getLogger(__name__)


def build_extractor(settings):
    """A real model when a key is present, the deterministic stub otherwise.

    This is what keeps the pipeline runnable in development without a key, and it
    keeps the choice visible: the extractor version is stamped onto every node it
    produces, so stub output can never be mistaken for model output later.
    """
    if settings.uses_real_model:
        logger.info("extraction via OpenRouter model %s", settings.openrouter_model)
        return LangGraphExtractor(settings.openrouter_api_key, settings.openrouter_model)
    if settings.require_real_model:
        # A stub deployment is not a degraded deployment. Every screen works,
        # every number adds up, and every reading is invented — which is
        # indistinguishable from the real thing until someone reads one closely.
        # Refusing to start is the only failure mode anybody would notice.
        raise RuntimeError(
            "REQUIRE_REAL_MODEL is set and OPENROUTER_API_KEY is not. Refusing to "
            "start with the stub extractor: it would produce readings nobody wrote."
        )
    logger.warning("OPENROUTER_API_KEY is unset — using the stub extractor")
    return StubExtractor()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)

    app.state.pool = await create_pool(settings.database_url)
    applied = await run_migrations(app.state.pool)
    logger.info("migrations applied: %s", applied or "none pending")

    app.state.extractor = build_extractor(settings)
    # Routes read settings off app state rather than re-reading the cache, so a
    # test overriding configuration overrides it everywhere.
    app.state.settings = settings
    app.state.conversation_agent = build_agent(
        settings.openrouter_api_key, settings.openrouter_model
    )
    app.state.transcriber = build_transcriber(
        settings.transcription_api_key,
        settings.transcription_provider,
        settings.transcription_base_url,
        settings.transcription_model,
    )
    app.state.voice = build_voice(
        settings.speech_api_key,
        settings.speech_voice_id,
        settings.speech_model,
    )
    scheduler = None
    if settings.agents_enabled:
        scheduler = asyncio.create_task(agent_loop(app.state.pool))
    else:
        logger.info("background agents are off (AGENTS_ENABLED=false)")

    logger.info("tlön backend ready (graph schema v%s)", SCHEMA_VERSION)

    yield

    if scheduler is not None:
        scheduler.cancel()
        # Awaited so the cancellation actually lands before the pool closes —
        # otherwise a tick can be mid-query when its connection disappears.
        with suppress(asyncio.CancelledError):
            await scheduler

    # Drain the pool on shutdown. A journal entry lost to a deploy is a thought the
    # user has to reconstruct.
    await app.state.pool.close()


app = FastAPI(title="Tlön", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    # Any origin unless one is named. Development serves the client from a
    # different port and wants that; a deployment names its own origin, so a page
    # somebody else hosts cannot drive this API with a token it phished.
    allow_origins=get_settings().allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(conversation_router)
app.include_router(voice_router)
app.include_router(pattern_router)
app.include_router(agent_router)
app.include_router(temporal_router)
app.include_router(twin_router)
app.include_router(identity_router)
app.include_router(experiment_router)
app.include_router(theme_router)
app.include_router(router)
