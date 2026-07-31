"""Candidate nodes and edges produced by extraction, before they reach the graph.

Field-level rules (confidence range, known kinds) are Pydantic validators, so a
malformed model response fails to parse at all. Cross-field structural rules live in
`structural_errors` instead of a model validator, because the LangGraph validate node
needs to read those errors and feed them back to the model on a retry — a raised
exception would just end the run.
"""

from typing import Any

from pydantic import BaseModel, Field, field_validator

from tlon.domain.inference import Confidence
from tlon.graph.schema import (
    EXTRACTABLE_EDGE_KINDS,
    EXTRACTABLE_NODE_KINDS,
    EdgeKind,
    NodeKind,
)

#: JSON Schema keywords the structured-output APIs reject. Pydantic emits several
#: of them from ordinary field constraints, so the schema has to be sanitised on
#: the way out.
#:
#: This does not weaken anything: these are bounds on what the *model* returns, and
#: the model was never the thing enforcing them. Pydantic still validates the
#: response, and the database still refuses an out-of-range confidence. Dropping
#: them here only stops us asking the API for a guarantee it does not offer.
UNSUPPORTED_SCHEMA_KEYWORDS = frozenset(
    {
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
        "minLength",
        "maxLength",
        "pattern",
        "minItems",
        "maxItems",
        "uniqueItems",
        "format",
    }
)


def strip_unsupported(schema: Any) -> Any:
    """Recursively remove keywords the structured-output API will not accept."""
    if isinstance(schema, dict):
        return {
            key: strip_unsupported(value)
            for key, value in schema.items()
            if key not in UNSUPPORTED_SCHEMA_KEYWORDS
        }
    if isinstance(schema, list):
        return [strip_unsupported(item) for item in schema]
    return schema


#: The ref reserved for the source observation. Edges use it to point at the entry
#: itself rather than at another extracted node.
OBSERVATION_REF = "observation"


class ExtractedNode(BaseModel):
    """One candidate node.

    `ref` is local to a single extraction and is replaced by a real UUID at persist
    time — the model never sees or invents a database id.
    """

    ref: str = Field(description="Short identifier unique within this response.")
    kind: NodeKind
    label: str = Field(description="The person's own framing, wherever possible.")
    confidence: Confidence

    @field_validator("kind")
    @classmethod
    def kind_is_extractable(cls, value: NodeKind) -> NodeKind:
        """Observations are captured, never inferred. Patterns are recurrences
        across entries — asserting one from a single entry is the overreach the
        specification warns about, and Milestone 2 mines them properly."""
        if value not in EXTRACTABLE_NODE_KINDS:
            raise ValueError(f"{value} cannot be produced by single-entry extraction")
        return value


class ExtractedEdge(BaseModel):
    kind: EdgeKind
    from_ref: str
    to_ref: str
    note: str | None = Field(default=None, description="Required for RELATES_TO edges.")
    confidence: Confidence

    @field_validator("kind")
    @classmethod
    def kind_is_extractable(cls, value: EdgeKind) -> EdgeKind:
        """DERIVED_FROM is generated, never modelled — the extractor cannot decline
        to cite its source because it is never asked to. CO_OCCURS_WITH is a
        statistical claim that needs more than one entry to make."""
        if value not in EXTRACTABLE_EDGE_KINDS:
            raise ValueError(f"{value} is not produced by single-entry extraction")
        return value


class Extraction(BaseModel):
    nodes: list[ExtractedNode] = Field(default_factory=list)
    edges: list[ExtractedEdge] = Field(default_factory=list)

    def structural_errors(self) -> list[str]:
        """Checks the output schema cannot express.

        The schema constrains shape; these constrain meaning. An edge pointing at a
        ref that was never defined, or a RELATES_TO with no note, is well-formed and
        still not something we are willing to store.
        """
        errors: list[str] = []
        seen: set[str] = set()

        for node in self.nodes:
            if node.kind.is_observed:
                errors.append(
                    f"node '{node.ref}' has kind Observation; observations are never inferred"
                )
            if node.ref == OBSERVATION_REF:
                errors.append(f"'{OBSERVATION_REF}' is reserved and cannot name a new node")
            if not node.label.strip():
                errors.append(f"node '{node.ref}' has a blank label")
            if node.ref in seen:
                errors.append(f"ref '{node.ref}' is defined more than once")
            seen.add(node.ref)

        known = seen | {OBSERVATION_REF}

        for edge in self.edges:
            for ref in (edge.from_ref, edge.to_ref):
                if ref not in known:
                    errors.append(f"edge references unknown ref '{ref}'")
            if edge.from_ref == edge.to_ref:
                errors.append(f"edge points from '{edge.from_ref}' to itself")
            if edge.kind.requires_note and not (edge.note or "").strip():
                errors.append(f"{edge.kind} edges require a note explaining the relationship")

        return errors

    @property
    def is_empty(self) -> bool:
        return not self.nodes and not self.edges

    @classmethod
    def request_schema(cls) -> dict:
        """The schema sent to the model.

        Two narrowings from `model_json_schema()`, kept here so the difference
        between "what we ask for" and "what we accept" stays visible:

        1. Keywords the structured-output API rejects are stripped.
        2. The kind enums are narrowed to what single-entry extraction may
           produce. Offering `Pattern` or `DERIVED_FROM` in the schema is an
           invitation to use them, and a model given the option takes it.
        """
        schema = strip_unsupported(cls.model_json_schema())

        defs = schema.get("$defs", {})
        node_kind = defs.get("NodeKind")
        if node_kind is not None:
            node_kind["enum"] = [str(k) for k in EXTRACTABLE_NODE_KINDS]
        edge_kind = defs.get("EdgeKind")
        if edge_kind is not None:
            edge_kind["enum"] = [str(k) for k in EXTRACTABLE_EDGE_KINDS]

        return schema
