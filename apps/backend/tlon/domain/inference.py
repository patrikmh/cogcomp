"""The invariants that make an inference explainable.

Confidence and Provenance are constrained types rather than bare float and list.
An inference without calibrated confidence, or without a path back to the user's own
words, is not something we are willing to store — so the types refuse it at the
validation boundary, and the database refuses it again at the write.
"""

from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

#: Below this, the client renders a node as tentative rather than as knowledge.
TENTATIVE_THRESHOLD = 0.5

#: Never defaulted. A missing confidence is an error, not a 1.0.
Confidence = Annotated[float, Field(ge=0.0, le=1.0)]


def is_tentative(confidence: float) -> bool:
    return confidence < TENTATIVE_THRESHOLD


def derived_confidence(inputs: list[float]) -> float:
    """A node derived from other inferences cannot be more certain than the least
    certain thing it rests on. Confidence never multiplies upward."""
    if not inputs:
        raise ValueError("cannot derive confidence from an empty set of inputs")
    return min(inputs)


class EpistemicStatus(StrEnum):
    """Where every inference starts, and where it stays until the user says otherwise."""

    HYPOTHESIS = "hypothesis"
    USER_CONFIRMED = "user_confirmed"
    USER_REJECTED = "user_rejected"


class Inference(BaseModel):
    """Everything an inferred node or edge must carry to be storable."""

    confidence: Confidence
    epistemic_status: EpistemicStatus = EpistemicStatus.HYPOTHESIS
    #: Name and version of the producing model or rule, e.g.
    #: "extract-v0.1/anthropic/claude-opus-5". Makes a bad batch identifiable
    #: and revocable.
    extractor: str
    #: Observation ids this was derived from. Never empty.
    provenance: list[UUID]

    @field_validator("provenance")
    @classmethod
    def provenance_is_not_empty(cls, value: list[UUID]) -> list[UUID]:
        if not value:
            raise ValueError("an inference must cite at least one observation")
        # Deduplicate while keeping the set stable and comparable.
        return sorted(set(value))

    @field_validator("extractor")
    @classmethod
    def extractor_is_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("an inference must record which extractor produced it")
        return value
