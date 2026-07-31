use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use crate::domain::inference::InvariantError;
use crate::domain::observation::ObservationError;
use crate::graph::schema::UnknownKind;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not found")]
    NotFound,

    #[error("unauthorized")]
    Unauthorized,

    #[error("{0}")]
    Validation(String),

    #[error("conflict: {0}")]
    Conflict(String),

    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

impl AppError {
    fn status(&self) -> StatusCode {
        match self {
            AppError::NotFound => StatusCode::NOT_FOUND,
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::Validation(_) => StatusCode::UNPROCESSABLE_ENTITY,
            AppError::Conflict(_) => StatusCode::CONFLICT,
            AppError::Database(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status();

        // Database errors carry connection strings and row contents. The client
        // gets a generic message; the detail goes to the log.
        let message = match &self {
            AppError::Database(err) => {
                tracing::error!(error = %err, "database error");
                "internal error".to_owned()
            }
            other => other.to_string(),
        };

        (status, Json(json!({ "error": message }))).into_response()
    }
}

impl From<ObservationError> for AppError {
    fn from(err: ObservationError) -> Self {
        AppError::Validation(err.to_string())
    }
}

impl From<InvariantError> for AppError {
    fn from(err: InvariantError) -> Self {
        AppError::Validation(err.to_string())
    }
}

impl From<UnknownKind> for AppError {
    fn from(err: UnknownKind) -> Self {
        AppError::Validation(err.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
