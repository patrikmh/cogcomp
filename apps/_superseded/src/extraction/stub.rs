//! A deterministic extractor for development and tests.
//!
//! It exists so the persistence path, the API surface, and the explain endpoint can
//! be exercised end to end without a network call or an API key. It does no language
//! understanding whatsoever, and its low confidence says so.

use crate::domain::inference::Confidence;
use crate::domain::observation::Observation;
use crate::error::AppResult;
use crate::extraction::{
    ExtractedEdge, ExtractedNode, Extraction, Extractor, OBSERVATION_REF, PROMPT_VERSION,
};
use crate::graph::schema::{EdgeKind, NodeKind};

/// Deliberately below the tentative threshold. A stub result is not knowledge, and
/// the UI should render it as the guess it is.
const STUB_CONFIDENCE: f32 = 0.3;

const LABEL_CHARS: usize = 60;

#[derive(Debug, Default)]
pub struct StubExtractor;

impl Extractor for StubExtractor {
    fn version(&self) -> String {
        format!("{PROMPT_VERSION}/stub")
    }

    async fn extract(&self, observation: &Observation) -> AppResult<Extraction> {
        let confidence = Confidence::new(STUB_CONFIDENCE)?;

        let label: String = observation.content.chars().take(LABEL_CHARS).collect();

        let extraction = Extraction {
            nodes: vec![ExtractedNode {
                ref_: "t1".to_owned(),
                kind: NodeKind::Thought,
                label,
                confidence,
            }],
            edges: vec![ExtractedEdge {
                kind: EdgeKind::Expresses,
                from_ref: OBSERVATION_REF.to_owned(),
                to_ref: "t1".to_owned(),
                note: None,
                confidence,
            }],
        };

        extraction.validate()?;
        Ok(extraction)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::observation::Source;
    use chrono::Utc;
    use uuid::Uuid;

    fn observation(content: &str) -> Observation {
        Observation {
            id: Uuid::now_v7(),
            user_id: Uuid::now_v7(),
            content: content.to_owned(),
            source: Source::Text,
            captured_at: Utc::now(),
            created_at: Utc::now(),
            deleted_at: None,
        }
    }

    #[tokio::test]
    async fn it_produces_a_valid_extraction() {
        let result = StubExtractor.extract(&observation("I slept badly.")).await.unwrap();
        assert!(result.validate().is_ok());
        assert_eq!(result.nodes.len(), 1);
        assert_eq!(result.edges.len(), 1);
    }

    #[tokio::test]
    async fn its_output_is_marked_tentative() {
        let result = StubExtractor.extract(&observation("anything")).await.unwrap();
        assert!(result.nodes[0].confidence.is_tentative());
    }

    #[tokio::test]
    async fn its_version_is_distinguishable_from_a_real_model() {
        assert_eq!(StubExtractor.version(), "extract-v0.1/stub");
    }

    #[tokio::test]
    async fn the_edge_cites_the_source_observation() {
        let result = StubExtractor.extract(&observation("x")).await.unwrap();
        assert_eq!(result.edges[0].from_ref, OBSERVATION_REF);
    }
}
