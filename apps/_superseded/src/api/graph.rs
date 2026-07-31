//! Graph reads: explanation and dashboard counts.

use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use uuid::Uuid;

use crate::auth::CurrentUser;
use crate::db;
use crate::db::graph::Explanation;
use crate::error::AppResult;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/graph/nodes/{id}/explain", get(explain))
        .route("/v1/graph/summary", get(summary))
}

/// "Why do you think this?" — answered by walking provenance back to the user's
/// own words. Available for every node in the graph, not just some of them.
async fn explain(
    State(state): State<AppState>,
    user: CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Explanation>> {
    let explanation = db::graph::explain(&state.pool, user.id, id).await?;
    Ok(Json(explanation))
}

#[derive(Debug, Serialize)]
pub struct KindCount {
    pub kind: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
pub struct SummaryResponse {
    pub schema_version: &'static str,
    pub counts: Vec<KindCount>,
}

async fn summary(
    State(state): State<AppState>,
    user: CurrentUser,
) -> AppResult<Json<SummaryResponse>> {
    let counts = db::graph::kind_counts(&state.pool, user.id).await?;
    Ok(Json(SummaryResponse {
        schema_version: crate::graph::SCHEMA_VERSION,
        counts: counts
            .into_iter()
            .map(|(kind, count)| KindCount { kind, count })
            .collect(),
    }))
}
