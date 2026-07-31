"""Candidate nodes and edges produced by extraction, before they reach the graph.

Field-level rules (confidence range, known kinds) are Pydantic validators, so a
malformed model response fails to parse at all. Cross-field structural rules live in
`structural_errors` instead of a model validator, because the LangGraph validate node
needs to read those errors and feed them back to the model on a retry — a raised
exception would just end the run.
"""

from pydantic import BaseModel, Field

from tlon.domain.inference import Confidence
from tlon.graph.schema import EdgeKind, NodeKind

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


class ExtractedEdge(BaseModel):
    kind: EdgeKind
    from_ref: str
    to_ref: str
    note: str | None = Field(default=None, description="Required for RELATES_TO edges.")
    confidence: Confidence


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
