"""Which embedder turns words into vectors, chosen by configuration.

ADR-0007: semantic search runs on a local ONNX model (fastembed, bge-small),
so entry text embedded for search never leaves the server. The deterministic
hash stand-in remains the default because it keeps the whole pipeline
exercisable without the model weights installed — tests, CI, and deployments
that never opt in never touch fastembed.

The choice is deliberately explicit and fails loudly. A deployment that asks
for `local` and cannot have it must not fall back silently to the hash
embedder, because a search that quietly stopped being semantic looks healthy
in every other respect.
"""

from __future__ import annotations

import hashlib
import logging
import struct

from graphiti_core.embedder import EmbedderClient

from tlon.config import get_settings

#: Matches the small embedding models Graphiti expects, so a later switch to a
#: real embedder does not require rewriting what is already stored.
EMBEDDING_DIMENSION = 384


logger = logging.getLogger(__name__)

#: The local ONNX model. Small, 384-dimensional, and the default of fastembed —
#: named here rather than left implicit so the ADR and the code cannot drift.
LOCAL_EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"


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


class LocalOnnxEmbedder(EmbedderClient):
    """fastembed's ONNX runtime hosting bge-small inside this process.

    Words go into vectors here and nowhere else. The model loads lazily on
    first use — roughly one hundred megabytes read once from disk — because
    the process may be configured for `local` in an environment that never
    ends up projecting anything.
    """

    def __init__(self) -> None:
        self._model = None

    def _load(self):
        if self._model is None:
            try:
                from fastembed import TextEmbedding
            except ImportError as error:  # pragma: no cover - exercised via build_embedder
                raise RuntimeError(
                    "EMBEDDING_PROVIDER=local needs the 'embeddings' extra "
                    "(pip install '.[embeddings]') to provide fastembed"
                ) from error
            logger.info("loading local embedding model %s", LOCAL_EMBEDDING_MODEL)
            self._model = TextEmbedding(model_name=LOCAL_EMBEDDING_MODEL)
        return self._model

    def _dimensions(self) -> int:
        return EMBEDDING_DIMENSION

    def _embed_sync(self, texts: list[str]) -> list[list[float]]:
        model = self._load()
        vectors = [list(map(float, vector)) for vector in model.embed(texts)]
        for vector in vectors:
            if len(vector) != self._dimensions():
                raise RuntimeError(
                    f"local embedding model produced {len(vector)} dimensions, "
                    f"expected {self._dimensions()}"
                )
        return vectors

    async def create(self, input_data) -> list[float]:
        text = input_data if isinstance(input_data, str) else str(input_data)
        return self._embed_sync([text])[0]

    async def create_batch(self, input_data_list) -> list[list[float]]:
        texts = [item if isinstance(item, str) else str(item) for item in input_data_list]
        return self._embed_sync(texts)


def build_embedder(settings=None) -> EmbedderClient:
    """The configured embedder.

    `deterministic` (default) keeps everything offline and semantics-free;
    `local` opts into the ONNX model. Anything else is a configuration error:
    an unknown provider name should stop the deploy, not degrade the product.
    """
    settings = settings or get_settings()
    provider = settings.embedding_provider.strip().lower()
    if provider == "local":
        embedder: EmbedderClient = LocalOnnxEmbedder()
        logger.info("embeddings via local ONNX model %s", LOCAL_EMBEDDING_MODEL)
        return embedder
    if provider == "deterministic":
        return DeterministicEmbedder()
    raise ValueError(f"EMBEDDING_PROVIDER is {provider!r}; expected 'deterministic' or 'local'")
