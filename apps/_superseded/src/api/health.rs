use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;

use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/ready", get(ready))
}

#[derive(Debug, Serialize)]
pub struct Health {
    pub status: &'static str,
    pub schema_version: &'static str,
}

/// Liveness: the process is up. Deliberately does not touch the database, so a
/// database outage does not get the process restarted out from under us.
async fn health() -> Json<Health> {
    Json(Health {
        status: "ok",
        schema_version: crate::graph::SCHEMA_VERSION,
    })
}

/// Readiness: we can actually serve traffic, which means the database answers.
async fn ready(State(state): State<AppState>) -> (StatusCode, Json<Health>) {
    let reachable = sqlx::query("SELECT 1")
        .fetch_one(&state.pool)
        .await
        .is_ok();

    let status = if reachable {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        status,
        Json(Health {
            status: if reachable { "ready" } else { "degraded" },
            schema_version: crate::graph::SCHEMA_VERSION,
        }),
    )
}
