from uuid import uuid4

import pytest
from pydantic import ValidationError

from tlon.domain.inference import (
    EpistemicStatus,
    Inference,
    derived_confidence,
    is_tentative,
)
from tlon.domain.observation import MAX_CONTENT_CHARS, NewObservation, Source
from tlon.graph.schema import EXTRACTABLE_EDGE_KINDS, EXTRACTABLE_NODE_KINDS, EdgeKind, NodeKind


def inference(**overrides):
    payload = {
        "confidence": 0.8,
        "extractor": "extract-v0.1/test",
        "provenance": [uuid4()],
    }
    payload.update(overrides)
    return Inference(**payload)


class TestConfidence:
    def test_rejects_values_outside_the_unit_interval(self):
        with pytest.raises(ValidationError):
            inference(confidence=-0.1)
        with pytest.raises(ValidationError):
            inference(confidence=1.1)

    def test_accepts_the_bounds(self):
        assert inference(confidence=0.0).confidence == 0.0
        assert inference(confidence=1.0).confidence == 1.0

    def test_a_missing_confidence_is_an_error_not_a_default(self):
        with pytest.raises(ValidationError):
            Inference(extractor="x", provenance=[uuid4()])

    def test_below_half_is_tentative(self):
        assert is_tentative(0.49)
        assert not is_tentative(0.5)

    def test_derived_confidence_takes_the_weakest_input(self):
        assert derived_confidence([0.9, 0.4, 0.7]) == 0.4

    def test_derived_confidence_needs_at_least_one_input(self):
        with pytest.raises(ValueError):
            derived_confidence([])


class TestProvenance:
    def test_cannot_be_empty(self):
        with pytest.raises(ValidationError):
            inference(provenance=[])

    def test_deduplicates_repeated_observations(self):
        observation_id = uuid4()
        assert inference(provenance=[observation_id] * 3).provenance == [observation_id]

    def test_inferences_default_to_hypothesis(self):
        assert inference().epistemic_status is EpistemicStatus.HYPOTHESIS

    def test_a_blank_extractor_is_rejected(self):
        with pytest.raises(ValidationError):
            inference(extractor="   ")


class TestObservation:
    def test_blank_content_is_rejected(self):
        for blank in ("", "   \n\t "):
            with pytest.raises(ValidationError):
                NewObservation(id=uuid4(), content=blank, source=Source.TEXT)

    def test_content_is_trimmed_but_otherwise_kept_verbatim(self):
        observation = NewObservation(
            id=uuid4(), content="  I keep putting this off.  ", source=Source.TEXT
        )
        assert observation.content == "I keep putting this off."

    def test_overlong_content_is_rejected(self):
        with pytest.raises(ValidationError):
            NewObservation(id=uuid4(), content="a" * (MAX_CONTENT_CHARS + 1), source=Source.TEXT)

    def test_content_at_the_limit_is_accepted(self):
        observation = NewObservation(
            id=uuid4(), content="a" * MAX_CONTENT_CHARS, source=Source.TEXT
        )
        assert len(observation.content) == MAX_CONTENT_CHARS

    def test_an_unknown_source_is_rejected(self):
        with pytest.raises(ValidationError):
            NewObservation(id=uuid4(), content="hi", source="telepathy")

    def test_captured_at_is_optional(self):
        assert NewObservation(id=uuid4(), content="hi", source=Source.TEXT).captured_at is None


class TestSchema:
    def test_observation_is_the_only_observed_kind(self):
        assert NodeKind.OBSERVATION.is_observed
        for kind in NodeKind:
            if kind is not NodeKind.OBSERVATION:
                assert kind.is_inferred, f"{kind} should be inferred"

    def test_diagnostic_vocabulary_is_not_representable(self):
        for forbidden in ("Disorder", "Symptom", "Diagnosis", "ScreeningScore"):
            with pytest.raises(ValueError):
                NodeKind(forbidden)

    def test_extraction_cannot_target_observation_or_pattern(self):
        assert NodeKind.OBSERVATION not in EXTRACTABLE_NODE_KINDS
        assert NodeKind.PATTERN not in EXTRACTABLE_NODE_KINDS

    def test_provenance_is_generated_not_extractable(self):
        # The extractor cannot decline to cite its source because it is never asked to.
        assert EdgeKind.DERIVED_FROM not in EXTRACTABLE_EDGE_KINDS

    def test_only_relates_to_requires_a_note(self):
        assert EdgeKind.RELATES_TO.requires_note
        assert not EdgeKind.ABOUT.requires_note
