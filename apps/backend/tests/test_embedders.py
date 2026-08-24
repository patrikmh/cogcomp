"""The configured embedder is an explicit choice that fails loudly.

ADR-0007: `deterministic` keeps everything offline and semantics-free; `local`
opts into the ONNX model. An unknown provider name must stop the deploy rather
than degrade into a search that silently stopped being semantic.
"""

from tlon.config import Settings
from tlon.graph.embedders import (
    LOCAL_EMBEDDING_MODEL,
    DeterministicEmbedder,
    LocalOnnxEmbedder,
    build_embedder,
)

import pytest


def _settings(provider: str) -> Settings:
    return Settings(
        database_url="postgresql://irrelevant/test",
        embedding_provider=provider,
    )


def test_the_default_is_the_offline_stand_in():
    assert isinstance(build_embedder(_settings("deterministic")), DeterministicEmbedder)


def test_local_selects_the_onnx_embedder():
    embedder = build_embedder(_settings("local"))
    assert isinstance(embedder, LocalOnnxEmbedder)


def test_an_unknown_provider_is_a_configuration_error():
    with pytest.raises(ValueError, match="EMBEDDING_PROVIDER"):
        build_embedder(_settings("openai"))


def test_local_reports_which_model_it_hosts():
    assert LOCAL_EMBEDDING_MODEL == "BAAI/bge-small-en-v1.5"


def test_deterministic_carries_no_semantics_but_is_stable():
    import asyncio

    first = asyncio.run(DeterministicEmbedder().create("dread"))
    second = asyncio.run(DeterministicEmbedder().create("dread"))
    other = asyncio.run(DeterministicEmbedder().create("fear"))
    assert first == second
    assert first != other


def test_member_labels_are_capped_and_deduplicated():
    from tlon.graph.summaries import _member_labels

    members = [
        {"label": "dread", "confidence": 0.9},
        {"label": "Dread", "confidence": 0.8},
        {"label": "", "confidence": 0.7},
        {"label": "work", "confidence": 0.95},
        *({"label": f"word{i}", "confidence": 0.5 - i * 0.01} for i in range(20)),
    ]
    labels = _member_labels(members)
    assert labels[0] == "work"  # most confident first
    assert len([l for l in labels if l.lower() == "dread"]) == 1
    assert all(l for l in labels)
    assert len(labels) <= 12


def test_summary_prompt_forbids_diagnosis_and_names_the_person():
    from tlon.graph.summaries import SYSTEM_PROMPT

    lowered = SYSTEM_PROMPT.lower()
    assert "no diagnosis" in lowered or "no cause" in lowered
    assert "one sentence" in lowered


def test_cosine_ranks_alignment_over_noise():
    from tlon.graph.semantic_search import _cosine

    same = _cosine([1.0, 0.0], [1.0, 0.0])
    orthogonal = _cosine([1.0, 0.0], [0.0, 1.0])
    opposite = _cosine([1.0, 0.0], [-1.0, 0.0])
    assert same == 1.0
    assert orthogonal == 0.0
    assert opposite == -1.0
    # Mismatched widths can never score.
    assert _cosine([1.0], [1.0, 0.0]) == 0.0
