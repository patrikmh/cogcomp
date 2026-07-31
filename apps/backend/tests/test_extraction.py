import json

import pytest
from pydantic import ValidationError

from tlon.extraction.models import (
    OBSERVATION_REF,
    ExtractedEdge,
    ExtractedNode,
    Extraction,
)
from tlon.extraction.pipeline import PROMPT_VERSION, load_system_prompt
from tlon.extraction.stub import StubExtractor
from tlon.graph.schema import EdgeKind, NodeKind


def node(ref: str, kind: NodeKind = NodeKind.THOUGHT, label: str | None = None) -> ExtractedNode:
    return ExtractedNode(ref=ref, kind=kind, label=label or f"label for {ref}", confidence=0.7)


def edge(kind: EdgeKind, from_ref: str, to_ref: str, note: str | None = None) -> ExtractedEdge:
    return ExtractedEdge(kind=kind, from_ref=from_ref, to_ref=to_ref, note=note, confidence=0.6)


class TestStructuralValidation:
    def test_an_empty_extraction_is_valid(self):
        assert Extraction().structural_errors() == []

    def test_edges_may_reference_the_source_observation(self):
        extraction = Extraction(
            nodes=[node("t1")],
            edges=[edge(EdgeKind.EXPRESSES, OBSERVATION_REF, "t1")],
        )
        assert extraction.structural_errors() == []

    def test_edges_to_undefined_refs_are_rejected(self):
        extraction = Extraction(
            nodes=[node("t1")], edges=[edge(EdgeKind.ABOUT, "t1", "nonexistent")]
        )
        assert any("nonexistent" in e for e in extraction.structural_errors())

    def test_duplicate_refs_are_rejected(self):
        extraction = Extraction(nodes=[node("t1"), node("t1", NodeKind.EMOTION)])
        assert any("more than once" in e for e in extraction.structural_errors())

    def test_a_node_cannot_claim_the_reserved_observation_ref(self):
        extraction = Extraction(nodes=[node(OBSERVATION_REF)])
        assert any("reserved" in e for e in extraction.structural_errors())

    def test_blank_labels_are_rejected(self):
        extraction = Extraction(nodes=[node("t1", label="   ")])
        assert any("blank label" in e for e in extraction.structural_errors())

    def test_self_loops_are_rejected(self):
        extraction = Extraction(nodes=[node("a")], edges=[edge(EdgeKind.ABOUT, "a", "a")])
        assert any("to itself" in e for e in extraction.structural_errors())

    def test_relates_to_without_a_note_is_rejected(self):
        for note in (None, "   "):
            extraction = Extraction(
                nodes=[node("a"), node("b", NodeKind.BELIEF)],
                edges=[edge(EdgeKind.RELATES_TO, "a", "b", note)],
            )
            assert any("require a note" in e for e in extraction.structural_errors())

    def test_relates_to_with_a_note_is_accepted(self):
        extraction = Extraction(
            nodes=[node("a"), node("b", NodeKind.BELIEF)],
            edges=[edge(EdgeKind.RELATES_TO, "a", "b", "both concern the same deadline")],
        )
        assert extraction.structural_errors() == []

    def test_errors_accumulate_rather_than_short_circuiting(self):
        # The retry edge feeds these back to the model, so it should see every
        # problem at once rather than one per round trip.
        extraction = Extraction(
            nodes=[node("a"), node("a")],
            edges=[edge(EdgeKind.ABOUT, "a", "ghost")],
        )
        assert len(extraction.structural_errors()) >= 2


class TestExtractableKinds:
    """These constraints were once constants nobody enforced, and a live model
    happily produced Pattern nodes from a single entry. The tests here assert the
    behaviour rather than the contents of a list."""

    def test_pattern_cannot_be_produced_from_one_entry(self):
        # A Pattern is a recurrence across entries. Asserting one from a single
        # entry is exactly the overreach the specification warns about.
        with pytest.raises(ValidationError):
            ExtractedNode(ref="p1", kind=NodeKind.PATTERN, label="x", confidence=0.8)

    def test_observation_cannot_be_produced(self):
        with pytest.raises(ValidationError):
            ExtractedNode(ref="o1", kind=NodeKind.OBSERVATION, label="x", confidence=0.8)

    def test_ordinary_kinds_are_accepted(self):
        for kind in (NodeKind.THOUGHT, NodeKind.EMOTION, NodeKind.BELIEF):
            assert ExtractedNode(ref="n", kind=kind, label="x", confidence=0.5)

    def test_derived_from_cannot_be_produced(self):
        # Provenance is generated, so the extractor is never in a position to
        # decline to cite its source.
        with pytest.raises(ValidationError):
            ExtractedEdge(kind=EdgeKind.DERIVED_FROM, from_ref="a", to_ref="b", confidence=0.5)

    def test_co_occurs_with_cannot_be_produced(self):
        with pytest.raises(ValidationError):
            ExtractedEdge(kind=EdgeKind.CO_OCCURS_WITH, from_ref="a", to_ref="b", confidence=0.5)


class TestRequestSchema:
    """What the model is actually shown. Offering a kind is an invitation to use
    it, so the schema must not advertise what we would reject."""

    def test_unsupported_keywords_are_stripped(self):
        # The structured-output API rejects numeric bounds outright:
        # "For 'number' type, properties maximum, minimum are not supported".
        blob = json.dumps(Extraction.request_schema())
        for keyword in ("minimum", "maximum", "minLength", "pattern", "multipleOf"):
            assert keyword not in blob, keyword

    def test_the_bounds_are_still_enforced_on_the_way_back_in(self):
        # Stripping them from the request does not weaken anything — the model
        # was never what enforced them.
        with pytest.raises(ValidationError):
            ExtractedNode(ref="n", kind=NodeKind.THOUGHT, label="x", confidence=1.4)

    def test_the_schema_does_not_offer_pattern_or_observation(self):
        kinds = Extraction.request_schema()["$defs"]["NodeKind"]["enum"]
        assert "Pattern" not in kinds
        assert "Observation" not in kinds

    def test_the_schema_does_not_offer_derived_from(self):
        kinds = Extraction.request_schema()["$defs"]["EdgeKind"]["enum"]
        assert "DERIVED_FROM" not in kinds
        assert "CO_OCCURS_WITH" not in kinds

    def test_the_schema_offers_no_diagnostic_vocabulary(self):
        blob = json.dumps(Extraction.request_schema())
        for forbidden in ("Disorder", "Symptom", "Diagnosis", "ScreeningScore"):
            assert forbidden not in blob, forbidden


class TestFieldValidation:
    def test_a_confidence_outside_the_unit_interval_fails_to_parse(self):
        with pytest.raises(ValidationError):
            ExtractedNode(ref="t1", kind=NodeKind.THOUGHT, label="x", confidence=1.4)

    def test_an_unknown_node_kind_fails_to_parse(self):
        with pytest.raises(ValidationError):
            ExtractedNode(ref="t1", kind="Disorder", label="x", confidence=0.5)

    def test_an_unknown_edge_kind_fails_to_parse(self):
        with pytest.raises(ValidationError):
            ExtractedEdge(kind="CAUSES", from_ref="a", to_ref="b", confidence=0.5)


class TestPrompt:
    def test_the_system_prompt_is_the_file_on_disk(self):
        prompt = load_system_prompt()
        assert "You extract structured observations" in prompt
        assert "Never produce a diagnosis" in prompt

    def test_the_prompt_forbids_diagnostic_output(self):
        prompt = load_system_prompt().lower()
        assert "diagnos" in prompt
        assert "severity rating" in prompt


@pytest.mark.anyio
class TestStubExtractor:
    async def test_it_produces_a_structurally_valid_extraction(self):
        result = await StubExtractor().extract("I slept badly.")
        assert result.structural_errors() == []
        assert len(result.nodes) == 1
        assert len(result.edges) == 1

    async def test_its_output_is_marked_tentative(self):
        result = await StubExtractor().extract("anything")
        assert result.nodes[0].confidence < 0.5

    async def test_its_version_is_distinguishable_from_a_real_model(self):
        assert StubExtractor().version == f"{PROMPT_VERSION}/stub"

    async def test_the_edge_cites_the_source_observation(self):
        result = await StubExtractor().extract("x")
        assert result.edges[0].from_ref == OBSERVATION_REF
