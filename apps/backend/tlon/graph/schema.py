"""Graph schema v0.1 kinds. Mirrors packages/ontology/schema.json.

Deliberately absent: any diagnostic vocabulary. There is no Disorder, Symptom, or
Diagnosis member, so extraction cannot emit one and the API cannot return one.
Tlön never diagnoses.
"""

from enum import StrEnum

SCHEMA_VERSION = "0.1"


class NodeKind(StrEnum):
    # The only observed kind: raw user input, immutable, the root of all provenance.
    OBSERVATION = "Observation"

    THOUGHT = "Thought"
    EMOTION = "Emotion"
    NEED = "Need"
    VALUE = "Value"
    BELIEF = "Belief"
    PERSON = "Person"
    PLACE = "Place"
    ACTIVITY = "Activity"
    EVENT = "Event"
    # Recurring structure across observations. Nothing produces these in Milestone 1.
    PATTERN = "Pattern"

    @property
    def is_observed(self) -> bool:
        return self is NodeKind.OBSERVATION

    @property
    def is_inferred(self) -> bool:
        return not self.is_observed


class EdgeKind(StrEnum):
    # Provenance backbone. Every inferred node has at least one.
    DERIVED_FROM = "DERIVED_FROM"
    EXPRESSES = "EXPRESSES"
    ABOUT = "ABOUT"
    FELT_TOWARD = "FELT_TOWARD"
    # A causal hypothesis drawn from correlational evidence. The most dangerous edge
    # in the schema; never render it as established fact.
    TRIGGERED_BY = "TRIGGERED_BY"
    SUPPORTS = "SUPPORTS"
    CONTRADICTS = "CONTRADICTS"
    INDICATES = "INDICATES"
    # Statistical adjacency. No causal claim. Milestone 2.
    CO_OCCURS_WITH = "CO_OCCURS_WITH"
    # Escape hatch. Requires a note; the database enforces it.
    RELATES_TO = "RELATES_TO"

    @property
    def requires_note(self) -> bool:
        return self is EdgeKind.RELATES_TO


#: Kinds an extractor is allowed to produce. Observation is excluded because
#: observations are captured, never inferred; Pattern because nothing mines them yet.
EXTRACTABLE_NODE_KINDS = [
    NodeKind.THOUGHT,
    NodeKind.EMOTION,
    NodeKind.NEED,
    NodeKind.VALUE,
    NodeKind.BELIEF,
    NodeKind.PERSON,
    NodeKind.PLACE,
    NodeKind.ACTIVITY,
    NodeKind.EVENT,
]

#: Edge kinds an extractor may produce. DERIVED_FROM is excluded because provenance
#: is generated, never modelled — the extractor cannot decline to cite its source
#: because it is never asked to.
EXTRACTABLE_EDGE_KINDS = [
    EdgeKind.EXPRESSES,
    EdgeKind.ABOUT,
    EdgeKind.FELT_TOWARD,
    EdgeKind.TRIGGERED_BY,
    EdgeKind.SUPPORTS,
    EdgeKind.CONTRADICTS,
    EdgeKind.INDICATES,
    EdgeKind.RELATES_TO,
]
