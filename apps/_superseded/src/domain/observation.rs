//! Observations are the raw material: what the user actually said or typed.
//!
//! They are never edited and never inferred. Everything else in the graph is
//! downstream of them, which is why they are the one thing we store verbatim.

use std::fmt;
use std::str::FromStr;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Text,
    Voice,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Source::Text => "text",
            Source::Voice => "voice",
        }
    }
}

impl fmt::Display for Source {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Source {
    type Err = ObservationError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "text" => Ok(Source::Text),
            "voice" => Ok(Source::Voice),
            other => Err(ObservationError::UnknownSource(other.to_owned())),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Observation {
    pub id: Uuid,
    pub user_id: Uuid,
    pub content: String,
    pub source: Source,
    pub captured_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// A validated observation ready to persist.
///
/// The id comes from the client so that capture works offline — the phone mints
/// a UUIDv7 the moment the user speaks, and sync reconciles later without having
/// to rewrite references.
#[derive(Debug, Clone)]
pub struct NewObservation {
    pub id: Uuid,
    pub user_id: Uuid,
    pub content: String,
    pub source: Source,
    pub captured_at: DateTime<Utc>,
}

impl NewObservation {
    pub fn new(
        id: Uuid,
        user_id: Uuid,
        content: &str,
        source: Source,
        captured_at: DateTime<Utc>,
    ) -> Result<Self, ObservationError> {
        let content = content.trim();
        if content.is_empty() {
            return Err(ObservationError::BlankContent);
        }
        if content.chars().count() > MAX_CONTENT_CHARS {
            return Err(ObservationError::ContentTooLong {
                max: MAX_CONTENT_CHARS,
            });
        }
        Ok(Self {
            id,
            user_id,
            content: content.to_owned(),
            source,
            captured_at,
        })
    }
}

/// Generous enough for a long voice entry, bounded so a runaway client cannot
/// write an unbounded row.
pub const MAX_CONTENT_CHARS: usize = 50_000;

#[derive(Debug, thiserror::Error)]
pub enum ObservationError {
    #[error("observation content cannot be blank")]
    BlankContent,

    #[error("observation content exceeds {max} characters")]
    ContentTooLong { max: usize },

    #[error("unknown observation source: {0}")]
    UnknownSource(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid(content: &str) -> Result<NewObservation, ObservationError> {
        NewObservation::new(
            Uuid::now_v7(),
            Uuid::now_v7(),
            content,
            Source::Text,
            Utc::now(),
        )
    }

    #[test]
    fn blank_content_is_rejected() {
        assert!(valid("").is_err());
        assert!(valid("   \n\t ").is_err());
    }

    #[test]
    fn content_is_trimmed_but_otherwise_kept_verbatim() {
        let observation = valid("  I keep putting this off.  ").unwrap();
        assert_eq!(observation.content, "I keep putting this off.");
    }

    #[test]
    fn overlong_content_is_rejected() {
        let long = "a".repeat(MAX_CONTENT_CHARS + 1);
        assert!(valid(&long).is_err());
    }

    #[test]
    fn content_at_the_limit_is_accepted() {
        let at_limit = "a".repeat(MAX_CONTENT_CHARS);
        assert!(valid(&at_limit).is_ok());
    }

    #[test]
    fn source_round_trips_through_strings() {
        assert_eq!(Source::from_str("text").unwrap(), Source::Text);
        assert_eq!(Source::from_str("voice").unwrap(), Source::Voice);
        assert!(Source::from_str("telepathy").is_err());
    }
}
