"""The Graphiti handle, and the two things we refuse to inherit from it.

Graphiti is used here as a *projection* of the Postgres graph, never as a second
place where facts about a person are decided. Postgres stays authoritative — the
compose file has said so since FalkorDB was added — and this layer exists to do
the things a graph store is genuinely better at: clustering a person's graph into
communities, and later, searching it.

Two of Graphiti's defaults are wrong for this product and are turned off here
rather than in a deployment runbook, because a privacy property that depends on
somebody remembering to set an environment variable is not a property.

**Telemetry.** `graphiti_core` posts installation and usage events to PostHog
unless `GRAPHITI_TELEMETRY_ENABLED` says otherwise, and it reads that variable at
import time. It is anonymous counts rather than user content, and it is still not
something a product with "privacy-first" in its description gets to do because a
dependency defaults to it. Set before the import, and asserted in a test.

**LLM node resolution.** `add_triplet()` runs Graphiti's own dedup over anything
it has not seen before, which would merge nodes semantically. Tlön's consolidation
refuses to do that on purpose — deciding "tired" and "worn out" are one thing
destroys a distinction the person drew — so letting the projection quietly
re-merge what consolidation deliberately kept apart would undo that decision
somewhere nobody would look. Nodes are therefore written directly rather than
through `add_triplet`; see `projection.py`.
"""

from __future__ import annotations

import hashlib
import os
import struct

# Before importing graphiti_core: the telemetry client reads this at import time,
# so setting it afterwards would be too late.
os.environ.setdefault("GRAPHITI_TELEMETRY_ENABLED", "false")

from graphiti_core import Graphiti
from graphiti_core.cross_encoder.client import CrossEncoderClient
from graphiti_core.driver.falkordb_driver import FalkorDriver
from graphiti_core.embedder import EmbedderClient
from graphiti_core.llm_client import LLMClient

from tlon.config import get_settings

#: Matches the small embedding models Graphiti expects, so a later switch to a
#: real embedder does not require rewriting what is already stored.
EMBEDDING_DIMENSION = 384


class DeterministicEmbedder(EmbedderClient):
    """A local, offline stand-in for an embedding model.

    Hashed rather than learned, so it carries no semantics whatsoever. That is the
    point: it keeps the projection and community pipeline exercisable without a
    key or a network call — the same bargain the stub extractor and stub
    transcriber make elsewhere — while being obviously useless for similarity, so
    nobody mistakes a passing test for evidence that semantic search works.

    Communities are built from graph structure rather than from these vectors, so
    clustering is unaffected by the difference. Hybrid search would be, and is
    deliberately not wired up until a real embedder is configured.
    """

    async def create(self, input_data) -> list[float]:
        text = input_data if isinstance(input_data, str) else str(input_data)
        # SHAKE-256 rather than a fixed-width hash: it emits an arbitrary number
        # of bytes, so the vector width is a constant here rather than a property
        # of whichever digest was picked.
        digest = hashlib.shake_256(text.encode("utf-8")).digest(EMBEDDING_DIMENSION * 4)
        raw = struct.unpack(f"{EMBEDDING_DIMENSION}i", digest)
        scale = float(1 << 31)
        return [value / scale for value in raw]

    async def create_batch(self, input_data_list) -> list[list[float]]:
        return [await self.create(item) for item in input_data_list]


class NoModelConfigured(RuntimeError):
    """Raised where an unconfigured model would otherwise have been called."""


class RefusingLLMClient(LLMClient):
    """Stands in for a model that has not been configured, and says so.

    Graphiti builds an `OpenAIClient` by default, which reads `OPENAI_API_KEY` at
    construction and would send a person's graph to OpenAI — not the provider this
    product uses, and not a decision a default should be making. Passing this
    instead moves the failure from import time to the moment a model is genuinely
    needed, so projection and clustering work with no credentials at all while
    community summarisation fails with a sentence explaining why.
    """

    def __init__(self) -> None:
        super().__init__(config=None, cache=False)

    async def generate_response(self, *args, **kwargs) -> dict:
        raise NoModelConfigured(
            "This step needs a language model and none is configured. "
            "Projection and community clustering do not; summarising a community does."
        )

    async def _generate_response(self, *args, **kwargs) -> dict:
        return await self.generate_response(*args, **kwargs)


class RefusingCrossEncoder(CrossEncoderClient):
    """The same refusal, for reranking.

    Graphiti's default reranker is another OpenAI client constructed eagerly. Only
    search uses it, and search is not wired up yet, so it must not be the reason
    the app cannot start without an OpenAI key.
    """

    async def rank(self, query: str, passages: list[str]) -> list[tuple[str, float]]:
        raise NoModelConfigured(
            "Reranking needs a language model and none is configured. "
            "Search is not wired up yet; projection and clustering do not use this."
        )


def build(
    host: str | None = None,
    port: int | None = None,
    username: str | None = None,
    password: str | None = None,
    database: str | None = None,
) -> Graphiti:
    """A Graphiti handle against FalkorDB.

    Everything this module currently drives — projection and structural
    clustering — needs no model and no credentials. The parts that would
    (community summaries) fail loudly rather than silently producing a summary
    nobody can attribute, or quietly calling a provider this product does not use.

    Where FalkorDB lives comes from settings when it is not passed. It was
    `localhost:6379` hardcoded, which is the one thing in this file that could not
    be deployed: agents get a pool and a user id and no configuration, so the only
    place the address could come from was here. An argument still wins over
    settings, because the integration tests point it at a local instance.
    """
    settings = get_settings()
    return Graphiti(
        graph_driver=FalkorDriver(
            host=settings.falkor_host if host is None else host,
            port=settings.falkor_port if port is None else port,
            # FalkorDriver treats empty strings as credentials; None is how you
            # say "no auth", which is what a local instance wants.
            username=(settings.falkor_username or None) if username is None else username,
            password=(settings.falkor_password or None) if password is None else password,
            database=settings.falkor_database if database is None else database,
        ),
        embedder=DeterministicEmbedder(),
        llm_client=RefusingLLMClient(),
        cross_encoder=RefusingCrossEncoder(),
    )
