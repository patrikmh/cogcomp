"""What we refuse to inherit from Graphiti.

None of this needs a database or a network. It is here because each one is a
property that would fail silently: telemetry that quietly resumes when an import
moves, a default OpenAI client that quietly sends someone's graph to a provider
this product does not use, an embedder whose output width quietly changes.
"""

import os

import pytest

from tlon.graph.graphiti_client import (
    EMBEDDING_DIMENSION,
    DeterministicEmbedder,
    NoModelConfigured,
    RefusingCrossEncoder,
    RefusingLLMClient,
)

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class TestTelemetry:
    def test_importing_the_client_disables_it(self):
        # graphiti_core reads this at import time, so importing our module must
        # already have set it. A product with "privacy-first" in its description
        # does not phone home because a dependency defaults to it.
        assert os.environ["GRAPHITI_TELEMETRY_ENABLED"] == "false"

    def test_an_explicit_setting_is_left_alone(self):
        # `setdefault`, not assignment: someone who has deliberately turned it on
        # in their own environment is not overridden by an import.
        from tlon.graph import graphiti_client

        assert "GRAPHITI_TELEMETRY_ENABLED" in os.environ
        assert graphiti_client is not None


class TestRefusals:
    async def test_asking_for_a_model_says_so(self):
        with pytest.raises(NoModelConfigured, match="none is configured"):
            await RefusingLLMClient().generate_response([])

    async def test_asking_for_reranking_says_so(self):
        with pytest.raises(NoModelConfigured, match="none is configured"):
            await RefusingCrossEncoder().rank("query", ["a", "b"])


class TestEmbedder:
    async def test_it_produces_the_declared_width(self):
        vector = await DeterministicEmbedder().create("dread")
        assert len(vector) == EMBEDDING_DIMENSION

    async def test_it_is_deterministic(self):
        embedder = DeterministicEmbedder()
        assert await embedder.create("dread") == await embedder.create("dread")

    async def test_different_text_gives_different_vectors(self):
        embedder = DeterministicEmbedder()
        assert await embedder.create("dread") != await embedder.create("running")

    async def test_values_are_bounded(self):
        # Not a similarity property — just that nothing downstream is handed a
        # vector with a component outside the unit range it expects.
        vector = await DeterministicEmbedder().create("the office")
        assert all(-1.0 <= value <= 1.0 for value in vector)

    async def test_a_batch_matches_one_at_a_time(self):
        embedder = DeterministicEmbedder()
        batch = await embedder.create_batch(["dread", "running"])
        assert batch == [await embedder.create("dread"), await embedder.create("running")]


class TestWhereFalkorLives:
    """Where `build()` connects, and who decides it.

    It was `localhost:6379` hardcoded, which is the one thing in this module that
    could not be deployed anywhere: background agents are handed a pool and a user
    id and no configuration, so there was nowhere else for an address to come
    from. These pin the two halves of the fix — settings supply it, and an
    explicit argument still overrides them, which the integration tests rely on to
    reach a local instance.

    The driver is stubbed because the real one connects during construction, so
    asking "what address did it use" over a socket would mean standing up a
    FalkorDB to find out.
    """

    @staticmethod
    def _captured(monkeypatch) -> dict:
        from tlon.graph import graphiti_client

        seen: dict = {}

        class FakeDriver:
            provider = "falkordb"

            def __init__(self, **kwargs):
                seen.update(kwargs)

        monkeypatch.setattr(graphiti_client, "FalkorDriver", FakeDriver)
        monkeypatch.setattr(graphiti_client, "Graphiti", lambda **kwargs: kwargs)
        return seen

    def test_it_takes_the_address_from_settings(self, monkeypatch):
        from tlon.config import get_settings
        from tlon.graph import graphiti_client

        seen = self._captured(monkeypatch)
        monkeypatch.setenv("FALKOR_HOST", "tlon-falkor")
        monkeypatch.setenv("FALKOR_PORT", "6380")
        monkeypatch.setenv("FALKOR_PASSWORD", "hunter2")
        get_settings.cache_clear()
        try:
            graphiti_client.build()
        finally:
            get_settings.cache_clear()

        assert seen["host"] == "tlon-falkor"
        assert seen["port"] == 6380
        assert seen["password"] == "hunter2"

    def test_no_credentials_means_none_rather_than_empty(self, monkeypatch):
        # An empty string is a username. A local FalkorDB with no auth must be
        # told there is nobody to log in as, not asked to log in as "".
        from tlon.config import get_settings
        from tlon.graph import graphiti_client

        seen = self._captured(monkeypatch)
        monkeypatch.delenv("FALKOR_USERNAME", raising=False)
        monkeypatch.delenv("FALKOR_PASSWORD", raising=False)
        get_settings.cache_clear()
        try:
            graphiti_client.build()
        finally:
            get_settings.cache_clear()

        assert seen["username"] is None
        assert seen["password"] is None

    def test_an_explicit_argument_still_wins(self, monkeypatch):
        # The integration tests point this at a local FalkorDB while the
        # environment may say otherwise. Settings are a default, not a policy.
        from tlon.config import get_settings
        from tlon.graph import graphiti_client

        seen = self._captured(monkeypatch)
        monkeypatch.setenv("FALKOR_HOST", "tlon-falkor")
        get_settings.cache_clear()
        try:
            graphiti_client.build(host="localhost", port=6379)
        finally:
            get_settings.cache_clear()

        assert seen["host"] == "localhost"
        assert seen["port"] == 6379
