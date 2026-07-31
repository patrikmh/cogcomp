"""A deterministic extractor for development and tests.

It exists so the persistence path, the API surface, and the explain endpoint can be
exercised end to end without a network call or an API key. It does no language
understanding whatsoever, and its low confidence says so.
"""

from tlon.extraction.models import OBSERVATION_REF, ExtractedEdge, ExtractedNode, Extraction
from tlon.extraction.pipeline import PROMPT_VERSION
from tlon.graph.schema import EdgeKind, NodeKind

#: Deliberately below the tentative threshold. A stub result is not knowledge, and
#: the UI should render it as the guess it is.
STUB_CONFIDENCE = 0.3

LABEL_CHARS = 60


class StubExtractor:
    @property
    def version(self) -> str:
        return f"{PROMPT_VERSION}/stub"

    async def extract(self, content: str) -> Extraction:
        return Extraction(
            nodes=[
                ExtractedNode(
                    ref="t1",
                    kind=NodeKind.THOUGHT,
                    label=content[:LABEL_CHARS],
                    confidence=STUB_CONFIDENCE,
                )
            ],
            edges=[
                ExtractedEdge(
                    kind=EdgeKind.EXPRESSES,
                    from_ref=OBSERVATION_REF,
                    to_ref="t1",
                    note=None,
                    confidence=STUB_CONFIDENCE,
                )
            ],
        )
