#![allow(dead_code)] // Schema definition: kinds land here before the extractor consumes them.

//! Graph schema v0.1 kinds. Mirrors `packages/ontology/schema.json`.
//!
//! Deliberately absent: any diagnostic vocabulary. There is no `Disorder`,
//! `Symptom`, or `Diagnosis` variant, so extraction cannot emit one and the
//! API cannot return one. Tlön never diagnoses.

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeKind {
    /// The only observed kind. Raw user input, immutable, the root of all provenance.
    Observation,

    Thought,
    Emotion,
    Need,
    Value,
    Belief,
    Person,
    Place,
    Activity,
    Event,
    /// Recurring structure across observations. Nothing produces these in Milestone 1.
    Pattern,
}

impl NodeKind {
    pub fn is_observed(self) -> bool {
        matches!(self, NodeKind::Observation)
    }

    pub fn is_inferred(self) -> bool {
        !self.is_observed()
    }

    pub fn as_str(self) -> &'static str {
        match self {
            NodeKind::Observation => "Observation",
            NodeKind::Thought => "Thought",
            NodeKind::Emotion => "Emotion",
            NodeKind::Need => "Need",
            NodeKind::Value => "Value",
            NodeKind::Belief => "Belief",
            NodeKind::Person => "Person",
            NodeKind::Place => "Place",
            NodeKind::Activity => "Activity",
            NodeKind::Event => "Event",
            NodeKind::Pattern => "Pattern",
        }
    }
}

impl fmt::Display for NodeKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for NodeKind {
    type Err = UnknownKind;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "Observation" => Ok(NodeKind::Observation),
            "Thought" => Ok(NodeKind::Thought),
            "Emotion" => Ok(NodeKind::Emotion),
            "Need" => Ok(NodeKind::Need),
            "Value" => Ok(NodeKind::Value),
            "Belief" => Ok(NodeKind::Belief),
            "Person" => Ok(NodeKind::Person),
            "Place" => Ok(NodeKind::Place),
            "Activity" => Ok(NodeKind::Activity),
            "Event" => Ok(NodeKind::Event),
            "Pattern" => Ok(NodeKind::Pattern),
            other => Err(UnknownKind(other.to_owned())),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EdgeKind {
    /// Provenance backbone. Every inferred node has at least one.
    DerivedFrom,
    Expresses,
    About,
    FeltToward,
    /// A causal hypothesis drawn from correlational evidence. The most dangerous
    /// edge in the schema; never render it as established fact.
    TriggeredBy,
    Supports,
    Contradicts,
    Indicates,
    /// Statistical adjacency. No causal claim. Milestone 2.
    CoOccursWith,
    /// Escape hatch. Requires a note; the database enforces it.
    RelatesTo,
}

impl EdgeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EdgeKind::DerivedFrom => "DERIVED_FROM",
            EdgeKind::Expresses => "EXPRESSES",
            EdgeKind::About => "ABOUT",
            EdgeKind::FeltToward => "FELT_TOWARD",
            EdgeKind::TriggeredBy => "TRIGGERED_BY",
            EdgeKind::Supports => "SUPPORTS",
            EdgeKind::Contradicts => "CONTRADICTS",
            EdgeKind::Indicates => "INDICATES",
            EdgeKind::CoOccursWith => "CO_OCCURS_WITH",
            EdgeKind::RelatesTo => "RELATES_TO",
        }
    }

    pub fn requires_note(self) -> bool {
        matches!(self, EdgeKind::RelatesTo)
    }
}

impl fmt::Display for EdgeKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for EdgeKind {
    type Err = UnknownKind;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "DERIVED_FROM" => Ok(EdgeKind::DerivedFrom),
            "EXPRESSES" => Ok(EdgeKind::Expresses),
            "ABOUT" => Ok(EdgeKind::About),
            "FELT_TOWARD" => Ok(EdgeKind::FeltToward),
            "TRIGGERED_BY" => Ok(EdgeKind::TriggeredBy),
            "SUPPORTS" => Ok(EdgeKind::Supports),
            "CONTRADICTS" => Ok(EdgeKind::Contradicts),
            "INDICATES" => Ok(EdgeKind::Indicates),
            "CO_OCCURS_WITH" => Ok(EdgeKind::CoOccursWith),
            "RELATES_TO" => Ok(EdgeKind::RelatesTo),
            other => Err(UnknownKind(other.to_owned())),
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[error("unknown graph schema kind: {0}")]
pub struct UnknownKind(pub String);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observation_is_the_only_observed_kind() {
        assert!(NodeKind::Observation.is_observed());
        for kind in [
            NodeKind::Thought,
            NodeKind::Emotion,
            NodeKind::Need,
            NodeKind::Value,
            NodeKind::Belief,
            NodeKind::Person,
            NodeKind::Place,
            NodeKind::Activity,
            NodeKind::Event,
            NodeKind::Pattern,
        ] {
            assert!(kind.is_inferred(), "{kind} should be inferred");
        }
    }

    #[test]
    fn node_kinds_round_trip_through_strings() {
        for kind in [NodeKind::Observation, NodeKind::Thought, NodeKind::Pattern] {
            assert_eq!(NodeKind::from_str(kind.as_str()).unwrap(), kind);
        }
    }

    #[test]
    fn edge_kinds_round_trip_through_strings() {
        for kind in [
            EdgeKind::DerivedFrom,
            EdgeKind::FeltToward,
            EdgeKind::CoOccursWith,
            EdgeKind::RelatesTo,
        ] {
            assert_eq!(EdgeKind::from_str(kind.as_str()).unwrap(), kind);
        }
    }

    #[test]
    fn diagnostic_vocabulary_is_not_representable() {
        for forbidden in ["Disorder", "Symptom", "Diagnosis", "ScreeningScore"] {
            assert!(NodeKind::from_str(forbidden).is_err());
        }
    }

    #[test]
    fn only_relates_to_requires_a_note() {
        assert!(EdgeKind::RelatesTo.requires_note());
        assert!(!EdgeKind::About.requires_note());
    }
}
