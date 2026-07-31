//! The extraction pipeline: one observation in, candidate graph nodes and edges out.
//!
//! Extraction is a trait so the transport is swappable — the Anthropic client and
//! the deterministic stub are interchangeable, which is what lets the persistence
//! path be tested without a network or an API key.

pub mod anthropic;
pub mod stub;

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::domain::inference::Confidence;
use crate::domain::observation::Observation;
use crate::error::AppResult;
use crate::graph::schema::{EdgeKind, NodeKind};

/// The ref reserved for the source observation. Edges use it to point at the
/// entry itself rather than at another extracted node.
pub const OBSERVATION_REF: &str = "observation";

pub const PROMPT_VERSION: &str = "extract-v0.1";

/// One candidate node. `ref_` is local to a single extraction and is replaced by a
/// real UUID at persist time — the model never sees or invents a database id.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedNode {
    #[serde(rename = "ref")]
    pub ref_: String,
    pub kind: NodeKind,
    pub label: String,
    pub confidence: Confidence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedEdge {
    pub kind: EdgeKind,
    pub from_ref: String,
    pub to_ref: String,
    pub note: Option<String>,
    pub confidence: Confidence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Extraction {
    pub nodes: Vec<ExtractedNode>,
    pub edges: Vec<ExtractedEdge>,
}

impl Extraction {
    pub fn empty() -> Self {
        Self {
            nodes: Vec::new(),
            edges: Vec::new(),
        }
    }

    /// Structural checks the JSON schema cannot express.
    ///
    /// The schema constrains shape; these constrain meaning. An edge pointing at a
    /// ref that was never defined, or a `RELATES_TO` with no note, is well-formed
    /// JSON and still not something we are willing to store.
    pub fn validate(&self) -> Result<(), ExtractionError> {
        for node in &self.nodes {
            if node.kind.is_observed() {
                return Err(ExtractionError::ObservedKindProduced);
            }
            if node.ref_ == OBSERVATION_REF {
                return Err(ExtractionError::ReservedRef);
            }
            if node.label.trim().is_empty() {
                return Err(ExtractionError::BlankLabel(node.ref_.clone()));
            }
        }

        let mut refs: Vec<&str> = self.nodes.iter().map(|n| n.ref_.as_str()).collect();
        refs.sort_unstable();
        let before = refs.len();
        refs.dedup();
        if refs.len() != before {
            return Err(ExtractionError::DuplicateRef);
        }

        let known = |r: &str| r == OBSERVATION_REF || refs.binary_search(&r).is_ok();

        for edge in &self.edges {
            if !known(&edge.from_ref) {
                return Err(ExtractionError::UnknownRef(edge.from_ref.clone()));
            }
            if !known(&edge.to_ref) {
                return Err(ExtractionError::UnknownRef(edge.to_ref.clone()));
            }
            if edge.from_ref == edge.to_ref {
                return Err(ExtractionError::SelfLoop(edge.from_ref.clone()));
            }
            if edge.kind.requires_note()
                && edge.note.as_deref().map(str::trim).unwrap_or("").is_empty()
            {
                return Err(ExtractionError::MissingNote(edge.kind));
            }
        }

        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ExtractionError {
    #[error("extraction produced an Observation node; observations are never inferred")]
    ObservedKindProduced,

    #[error("extraction used the reserved ref '{OBSERVATION_REF}' for a new node")]
    ReservedRef,

    #[error("node '{0}' has a blank label")]
    BlankLabel(String),

    #[error("extraction defined the same ref twice")]
    DuplicateRef,

    #[error("edge references unknown node ref '{0}'")]
    UnknownRef(String),

    #[error("edge points from '{0}' to itself")]
    SelfLoop(String),

    #[error("{0} edges require a note")]
    MissingNote(EdgeKind),

    #[error("the model declined this request ({0})")]
    Refused(String),

    #[error("extraction transport failed: {0}")]
    Transport(String),

    #[error("model returned output that does not match the schema: {0}")]
    Malformed(String),
}

/// Produces candidate nodes and edges from a single observation.
pub trait Extractor: Send + Sync {
    /// Identifies the prompt and model that produced a result, recorded on every
    /// node and edge so a bad batch can be found and revoked later.
    fn version(&self) -> String;

    fn extract(
        &self,
        observation: &Observation,
    ) -> impl std::future::Future<Output = AppResult<Extraction>> + Send;
}

/// The JSON schema sent with every request. Single source of truth — the prompt file
/// documents it but does not restate it.
///
/// Confidence bounds are deliberately absent: the accepted JSON Schema subset has no
/// numeric range support, so `Confidence` enforces them at the deserialization
/// boundary instead.
pub fn output_schema() -> serde_json::Value {
    let inferred_kinds = json!([
        "Thought", "Emotion", "Need", "Value", "Belief",
        "Person", "Place", "Activity", "Event"
    ]);

    let edge_kinds = json!([
        "EXPRESSES", "ABOUT", "FELT_TOWARD", "TRIGGERED_BY",
        "SUPPORTS", "CONTRADICTS", "INDICATES", "RELATES_TO"
    ]);

    json!({
        "type": "object",
        "properties": {
            "nodes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "ref": { "type": "string" },
                        "kind": { "type": "string", "enum": inferred_kinds },
                        "label": { "type": "string" },
                        "confidence": { "type": "number" }
                    },
                    "required": ["ref", "kind", "label", "confidence"],
                    "additionalProperties": false
                }
            },
            "edges": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "kind": { "type": "string", "enum": edge_kinds },
                        "from_ref": { "type": "string" },
                        "to_ref": { "type": "string" },
                        "note": { "type": ["string", "null"] },
                        "confidence": { "type": "number" }
                    },
                    "required": ["kind", "from_ref", "to_ref", "note", "confidence"],
                    "additionalProperties": false
                }
            }
        },
        "required": ["nodes", "edges"],
        "additionalProperties": false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(ref_: &str, kind: NodeKind) -> ExtractedNode {
        ExtractedNode {
            ref_: ref_.to_owned(),
            kind,
            label: format!("label for {ref_}"),
            confidence: Confidence::new(0.7).unwrap(),
        }
    }

    fn edge(kind: EdgeKind, from: &str, to: &str, note: Option<&str>) -> ExtractedEdge {
        ExtractedEdge {
            kind,
            from_ref: from.to_owned(),
            to_ref: to.to_owned(),
            note: note.map(str::to_owned),
            confidence: Confidence::new(0.6).unwrap(),
        }
    }

    #[test]
    fn an_empty_extraction_is_valid() {
        assert!(Extraction::empty().validate().is_ok());
    }

    #[test]
    fn edges_may_reference_the_source_observation() {
        let extraction = Extraction {
            nodes: vec![node("t1", NodeKind::Thought)],
            edges: vec![edge(EdgeKind::Expresses, OBSERVATION_REF, "t1", None)],
        };
        assert!(extraction.validate().is_ok());
    }

    #[test]
    fn edges_to_undefined_refs_are_rejected() {
        let extraction = Extraction {
            nodes: vec![node("t1", NodeKind::Thought)],
            edges: vec![edge(EdgeKind::About, "t1", "nonexistent", None)],
        };
        assert!(extraction.validate().is_err());
    }

    #[test]
    fn duplicate_refs_are_rejected() {
        let extraction = Extraction {
            nodes: vec![node("t1", NodeKind::Thought), node("t1", NodeKind::Emotion)],
            edges: vec![],
        };
        assert!(extraction.validate().is_err());
    }

    #[test]
    fn an_extraction_cannot_produce_an_observation_node() {
        let extraction = Extraction {
            nodes: vec![node("o1", NodeKind::Observation)],
            edges: vec![],
        };
        assert!(extraction.validate().is_err());
    }

    #[test]
    fn a_node_cannot_claim_the_reserved_observation_ref() {
        let extraction = Extraction {
            nodes: vec![node(OBSERVATION_REF, NodeKind::Thought)],
            edges: vec![],
        };
        assert!(extraction.validate().is_err());
    }

    #[test]
    fn relates_to_without_a_note_is_rejected() {
        let extraction = Extraction {
            nodes: vec![node("a", NodeKind::Thought), node("b", NodeKind::Belief)],
            edges: vec![edge(EdgeKind::RelatesTo, "a", "b", None)],
        };
        assert!(extraction.validate().is_err());

        let with_blank = Extraction {
            nodes: vec![node("a", NodeKind::Thought), node("b", NodeKind::Belief)],
            edges: vec![edge(EdgeKind::RelatesTo, "a", "b", Some("   "))],
        };
        assert!(with_blank.validate().is_err());
    }

    #[test]
    fn relates_to_with_a_note_is_accepted() {
        let extraction = Extraction {
            nodes: vec![node("a", NodeKind::Thought), node("b", NodeKind::Belief)],
            edges: vec![edge(
                EdgeKind::RelatesTo,
                "a",
                "b",
                Some("both concern the same deadline"),
            )],
        };
        assert!(extraction.validate().is_ok());
    }

    #[test]
    fn self_loops_are_rejected() {
        let extraction = Extraction {
            nodes: vec![node("a", NodeKind::Thought)],
            edges: vec![edge(EdgeKind::About, "a", "a", None)],
        };
        assert!(extraction.validate().is_err());
    }

    #[test]
    fn blank_labels_are_rejected() {
        let mut n = node("t1", NodeKind::Thought);
        n.label = "  ".to_owned();
        let extraction = Extraction {
            nodes: vec![n],
            edges: vec![],
        };
        assert!(extraction.validate().is_err());
    }

    #[test]
    fn the_schema_offers_no_diagnostic_node_kinds() {
        let schema = output_schema().to_string();
        for forbidden in ["Disorder", "Symptom", "Diagnosis", "ScreeningScore"] {
            assert!(!schema.contains(forbidden), "{forbidden} leaked into the schema");
        }
    }

    #[test]
    fn the_schema_does_not_offer_observation_as_an_extractable_kind() {
        let schema = output_schema();
        let kinds = &schema["properties"]["nodes"]["items"]["properties"]["kind"]["enum"];
        assert!(!kinds.to_string().contains("Observation"));
    }

    #[test]
    fn the_schema_does_not_offer_derived_from_as_an_extractable_edge() {
        // Provenance is generated, never modelled — the extractor cannot decline
        // to cite its source, because it is not asked to.
        let schema = output_schema();
        let kinds = &schema["properties"]["edges"]["items"]["properties"]["kind"]["enum"];
        assert!(!kinds.to_string().contains("DERIVED_FROM"));
    }

    #[test]
    fn a_confidence_outside_the_unit_interval_fails_to_deserialize() {
        let json = r#"{"nodes":[{"ref":"t1","kind":"Thought","label":"x","confidence":1.4}],"edges":[]}"#;
        assert!(serde_json::from_str::<Extraction>(json).is_err());
    }
}
