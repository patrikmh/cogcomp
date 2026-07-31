//! The observation API — Milestone 1's intake path.
//!
//! Handlers stay thin: validate, delegate, serialize. Business logic belongs in
//! the domain and persistence layers where it can be tested without HTTP.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::db;
use crate::domain::observation::{NewObservation, Observation, Source};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 200;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/observations", post(create).get(list))
        .route("/v1/observations/{id}", get(fetch).delete(delete))
}

#[derive(Debug, Deserialize)]
pub struct CreateObservation {
    /// Client-generated UUIDv7. Supplying it here makes capture idempotent: a
    /// retry after a flaky connection resolves to the same observation.
    pub id: Uuid,
    pub content: String,
    pub source: Source,
    /// When the user actually captured it, which is not when the server heard
    /// about it. Offline entries can be hours old.
    pub captured_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct ObservationResponse {
    pub id: Uuid,
    pub content: String,
    pub source: Source,
    pub captured_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

impl From<Observation> for ObservationResponse {
    fn from(observation: Observation) -> Self {
        Self {
            id: observation.id,
            content: observation.content,
            source: observation.source,
            captured_at: observation.captured_at,
            created_at: observation.created_at,
        }
    }
}

async fn create(
    State(state): State<AppState>,
    user: CurrentUser,
    Json(payload): Json<CreateObservation>,
) -> AppResult<(StatusCode, Json<ObservationResponse>)> {
    let new = NewObservation::new(
        payload.id,
        user.id,
        &payload.content,
        payload.source,
        payload.captured_at.unwrap_or_else(Utc::now),
    )?;

    let observation = db::observations::insert(&state.pool, &new).await?;
    Ok((StatusCode::CREATED, Json(observation.into())))
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub limit: Option<i64>,
    /// Keyset pagination on `captured_at`, which is stable under concurrent writes
    /// in a way that offset pagination is not.
    pub before: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct ListResponse {
    pub observations: Vec<ObservationResponse>,
    pub next_before: Option<DateTime<Utc>>,
}

async fn list(
    State(state): State<AppState>,
    user: CurrentUser,
    Query(query): Query<ListQuery>,
) -> AppResult<Json<ListResponse>> {
    let limit = clamp_limit(query.limit)?;
    let observations = db::observations::list(&state.pool, user.id, limit, query.before).await?;

    let next_before = if observations.len() as i64 == limit {
        observations.last().map(|o| o.captured_at)
    } else {
        None
    };

    Ok(Json(ListResponse {
        observations: observations.into_iter().map(Into::into).collect(),
        next_before,
    }))
}

async fn fetch(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<ObservationResponse>> {
    let observation = db::observations::find(&state.pool, user.id, id).await?;
    Ok(Json(observation.into()))
}

async fn delete(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    db::observations::soft_delete(&state.pool, user.id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

fn clamp_limit(requested: Option<i64>) -> AppResult<i64> {
    match requested {
        None => Ok(DEFAULT_LIMIT),
        Some(limit) if limit < 1 => Err(AppError::Validation("limit must be at least 1".into())),
        Some(limit) => Ok(limit.min(MAX_LIMIT)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_limit_falls_back_to_the_default() {
        assert_eq!(clamp_limit(None).unwrap(), DEFAULT_LIMIT);
    }

    #[test]
    fn an_oversized_limit_is_capped_rather_than_rejected() {
        assert_eq!(clamp_limit(Some(10_000)).unwrap(), MAX_LIMIT);
    }

    #[test]
    fn a_nonpositive_limit_is_rejected() {
        assert!(clamp_limit(Some(0)).is_err());
        assert!(clamp_limit(Some(-5)).is_err());
    }

    #[test]
    fn an_unknown_source_is_rejected_at_the_api_boundary() {
        let json = r#"{"id":"018f0000-0000-7000-8000-000000000000","content":"hi","source":"telepathy"}"#;
        assert!(serde_json::from_str::<CreateObservation>(json).is_err());
    }

    #[test]
    fn captured_at_is_optional() {
        let json = r#"{"id":"018f0000-0000-7000-8000-000000000000","content":"hi","source":"text"}"#;
        let payload: CreateObservation = serde_json::from_str(json).unwrap();
        assert!(payload.captured_at.is_none());
    }
}
