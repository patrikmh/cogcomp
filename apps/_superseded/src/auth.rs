//! Bearer-token authentication.
//!
//! Every user-facing route takes `CurrentUser` as an argument. That is the
//! enforcement mechanism: a handler that forgets to scope its query to a user
//! is a handler that does not compile, because it has no user id to scope with.

use axum::extract::FromRequestParts;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::AppError;
use crate::state::AppState;

#[derive(Debug, Clone, Copy)]
pub struct CurrentUser {
    pub id: Uuid,
}

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .ok_or(AppError::Unauthorized)?;

        let id: Option<(Uuid,)> = sqlx::query_as(
            "SELECT id FROM users WHERE token_hash = $1 AND deleted_at IS NULL",
        )
        .bind(hash_token(token))
        .fetch_optional(&state.pool)
        .await?;

        id.map(|(id,)| CurrentUser { id })
            .ok_or(AppError::Unauthorized)
    }
}

pub fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    format!("{digest:x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashing_is_deterministic() {
        assert_eq!(hash_token("secret"), hash_token("secret"));
    }

    #[test]
    fn different_tokens_hash_differently() {
        assert_ne!(hash_token("secret"), hash_token("secret2"));
    }

    #[test]
    fn the_raw_token_never_appears_in_its_hash() {
        assert!(!hash_token("hunter2").contains("hunter2"));
    }
}
