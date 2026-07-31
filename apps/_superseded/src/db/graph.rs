//! Graph reads.
//!
//! The explain query exists from day one on purpose. "Every inference must be
//! explainable" is only true if explanation is a first-class read path rather
//! than something reconstructed later from logs.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::domain::inference::EpistemicStatus;
use crate::error::{AppError, AppResult};

#[derive(Debug, Serialize)]
pub struct NodeSummary {
    pub id: Uuid,
    pub kind: String,
    pub label: String,
    pub created_at: DateTime<Utc>,
    /// Absent for observations, which make no claim and so carry no confidence.
    pub confidence: Option<f32>,
    pub epistemic_status: Option<String>,
    pub extractor: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SupportingObservation {
    pub id: Uuid,
    pub content: String,
    pub source: String,
    pub captured_at: DateTime<Utc>,
}

/// A node together with the user's own words that produced it.
#[derive(Debug, Serialize)]
pub struct Explanation {
    pub node: NodeSummary,
    pub derived_from: Vec<SupportingObservation>,
    /// True when the node is an observation — it explains itself.
    pub is_observed: bool,
}

pub async fn explain(pool: &PgPool, user_id: Uuid, node_id: Uuid) -> AppResult<Explanation> {
    let row = sqlx::query(
        "SELECT id, kind, label, created_at, confidence, epistemic_status, extractor
         FROM graph_nodes
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(node_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let kind: String = row.get("kind");
    let node = NodeSummary {
        id: row.get("id"),
        kind: kind.clone(),
        label: row.get("label"),
        created_at: row.get("created_at"),
        confidence: row.get("confidence"),
        epistemic_status: row.get("epistemic_status"),
        extractor: row.get("extractor"),
    };

    let is_observed = kind == "Observation";

    let supporting = sqlx::query(
        "SELECT o.node_id, o.content, o.source, o.captured_at
         FROM node_provenance p
         JOIN observations o ON o.node_id = p.observation_id
         JOIN graph_nodes n ON n.id = o.node_id
         WHERE p.node_id = $1 AND o.user_id = $2 AND n.deleted_at IS NULL
         ORDER BY o.captured_at DESC",
    )
    .bind(node_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let derived_from = supporting
        .iter()
        .map(|row| SupportingObservation {
            id: row.get("node_id"),
            content: row.get("content"),
            source: row.get("source"),
            captured_at: row.get("captured_at"),
        })
        .collect();

    Ok(Explanation {
        node,
        derived_from,
        is_observed,
    })
}

/// Counts by node kind, for the dashboard. Scoped to one user, always.
pub async fn kind_counts(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<(String, i64)>> {
    let rows = sqlx::query(
        "SELECT kind, count(*) AS total
         FROM graph_nodes
         WHERE user_id = $1 AND deleted_at IS NULL
         GROUP BY kind
         ORDER BY total DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(|row| (row.get("kind"), row.get("total")))
        .collect())
}

/// Reserved for the extraction pipeline: an inferred node may only be written
/// alongside a non-empty provenance set. Milestone 1 has no extractor yet, so
/// nothing calls this — but the invariant is expressed where it will be needed.
#[allow(dead_code)] // Called by the extraction pipeline once Milestone 1 gains an extractor.
pub fn assert_storable(
    kind: &str,
    confidence: Option<f32>,
    provenance: &[Uuid],
    epistemic_status: Option<EpistemicStatus>,
) -> AppResult<()> {
    if kind == "Observation" {
        return Ok(());
    }
    if confidence.is_none() {
        return Err(AppError::Validation(format!(
            "inferred node of kind {kind} requires a confidence"
        )));
    }
    if epistemic_status.is_none() {
        return Err(AppError::Validation(format!(
            "inferred node of kind {kind} requires an epistemic status"
        )));
    }
    if provenance.is_empty() {
        return Err(AppError::Validation(format!(
            "inferred node of kind {kind} must cite at least one observation"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observations_need_no_confidence_or_provenance() {
        assert!(assert_storable("Observation", None, &[], None).is_ok());
    }

    #[test]
    fn inferred_nodes_without_provenance_are_rejected() {
        let result = assert_storable(
            "Thought",
            Some(0.8),
            &[],
            Some(EpistemicStatus::Hypothesis),
        );
        assert!(result.is_err());
    }

    #[test]
    fn inferred_nodes_without_confidence_are_rejected() {
        let result = assert_storable(
            "Emotion",
            None,
            &[Uuid::now_v7()],
            Some(EpistemicStatus::Hypothesis),
        );
        assert!(result.is_err());
    }

    #[test]
    fn a_fully_specified_inferred_node_is_storable() {
        let result = assert_storable(
            "Belief",
            Some(0.6),
            &[Uuid::now_v7()],
            Some(EpistemicStatus::Hypothesis),
        );
        assert!(result.is_ok());
    }
}
