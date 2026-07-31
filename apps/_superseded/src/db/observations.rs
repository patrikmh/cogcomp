//! Persistence for observations.
//!
//! An observation occupies two rows: a `graph_nodes` row so that edges can point
//! at it, and an `observations` row holding the raw content. They are written in
//! one transaction — a node with no content, or content with no node, would both
//! be corruption.

use chrono::{DateTime, Utc};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::domain::observation::{NewObservation, Observation, Source};
use crate::error::{AppError, AppResult};
use crate::graph::schema::NodeKind;

/// How much of the raw content becomes the node's label in graph views.
const LABEL_PREVIEW_CHARS: usize = 80;

pub async fn insert(pool: &PgPool, new: &NewObservation) -> AppResult<Observation> {
    let mut tx = pool.begin().await?;

    let exists: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM graph_nodes WHERE id = $1")
        .bind(new.id)
        .fetch_optional(&mut *tx)
        .await?;

    if exists.is_some() {
        return Err(AppError::Conflict(format!(
            "observation {} already exists",
            new.id
        )));
    }

    let node = sqlx::query(
        "INSERT INTO graph_nodes (id, user_id, kind, label)
         VALUES ($1, $2, $3, $4)
         RETURNING created_at",
    )
    .bind(new.id)
    .bind(new.user_id)
    .bind(NodeKind::Observation.as_str())
    .bind(label_for(&new.content))
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO observations (node_id, user_id, content, source, captured_at)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(new.id)
    .bind(new.user_id)
    .bind(&new.content)
    .bind(new.source.as_str())
    .bind(new.captured_at)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Observation {
        id: new.id,
        user_id: new.user_id,
        content: new.content.clone(),
        source: new.source,
        captured_at: new.captured_at,
        created_at: node.get("created_at"),
        deleted_at: None,
    })
}

pub async fn find(pool: &PgPool, user_id: Uuid, id: Uuid) -> AppResult<Observation> {
    let row = sqlx::query(
        "SELECT o.node_id, o.user_id, o.content, o.source, o.captured_at,
                n.created_at, n.deleted_at
         FROM observations o
         JOIN graph_nodes n ON n.id = o.node_id
         WHERE o.node_id = $1 AND o.user_id = $2 AND n.deleted_at IS NULL",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;

    to_observation(&row)
}

pub async fn list(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
    before: Option<DateTime<Utc>>,
) -> AppResult<Vec<Observation>> {
    let rows = sqlx::query(
        "SELECT o.node_id, o.user_id, o.content, o.source, o.captured_at,
                n.created_at, n.deleted_at
         FROM observations o
         JOIN graph_nodes n ON n.id = o.node_id
         WHERE o.user_id = $1
           AND n.deleted_at IS NULL
           AND ($2::timestamptz IS NULL OR o.captured_at < $2)
         ORDER BY o.captured_at DESC
         LIMIT $3",
    )
    .bind(user_id)
    .bind(before)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    rows.iter().map(to_observation).collect()
}

/// Soft delete. The row stays so that anything derived from it keeps a resolvable
/// provenance trail, and so the deletion replicates to other devices as a tombstone.
pub async fn soft_delete(pool: &PgPool, user_id: Uuid, id: Uuid) -> AppResult<()> {
    let result = sqlx::query(
        "UPDATE graph_nodes SET deleted_at = now()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(user_id)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

fn to_observation(row: &sqlx::postgres::PgRow) -> AppResult<Observation> {
    let source: String = row.get("source");
    Ok(Observation {
        id: row.get("node_id"),
        user_id: row.get("user_id"),
        content: row.get("content"),
        source: source.parse::<Source>()?,
        captured_at: row.get("captured_at"),
        created_at: row.get("created_at"),
        deleted_at: row.get("deleted_at"),
    })
}

fn label_for(content: &str) -> String {
    let preview: String = content.chars().take(LABEL_PREVIEW_CHARS).collect();
    if preview.chars().count() < content.chars().count() {
        format!("{preview}…")
    } else {
        preview
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_content_is_its_own_label() {
        assert_eq!(label_for("I slept badly."), "I slept badly.");
    }

    #[test]
    fn long_content_is_truncated_with_an_ellipsis() {
        let label = label_for(&"a".repeat(200));
        assert_eq!(label.chars().count(), LABEL_PREVIEW_CHARS + 1);
        assert!(label.ends_with('…'));
    }

    #[test]
    fn truncation_counts_characters_not_bytes() {
        let label = label_for(&"ä".repeat(200));
        assert_eq!(label.chars().count(), LABEL_PREVIEW_CHARS + 1);
    }
}
