//! Anthropic Messages API extractor.
//!
//! Rust has no official Anthropic SDK, so this speaks the Messages API over raw
//! HTTP. The request shape follows the current API: structured outputs via
//! `output_config.format`, effort via `output_config.effort`, and no sampling
//! parameters — Opus 5 rejects `temperature`, `top_p`, and `top_k`.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::domain::observation::Observation;
use crate::error::{AppError, AppResult};
use crate::extraction::{output_schema, Extraction, ExtractionError, Extractor, PROMPT_VERSION};

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";

pub const DEFAULT_MODEL: &str = "claude-opus-5";

/// Non-streaming, so this stays under the HTTP timeout threshold. Extraction
/// output is small; the ceiling exists to bound a runaway response, not to fit one.
const MAX_TOKENS: u32 = 16_000;

/// Extraction is bounded and well-specified. Higher effort mostly buys deliberation
/// this task does not need.
const EFFORT: &str = "medium";

/// The prompt, compiled in from `packages/prompts/`. Including the file rather than
/// duplicating the text is what makes "no hidden prompts" true rather than aspirational:
/// the reviewable artifact and the shipped bytes cannot drift apart.
const SYSTEM_PROMPT: &str = include_str!("../../../../packages/prompts/extract-v0.1.system.md");

pub struct AnthropicExtractor {
    client: reqwest::Client,
    api_key: String,
    model: String,
}

impl AnthropicExtractor {
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key,
            model,
        }
    }

    fn request_body(&self, content: &str) -> Value {
        json!({
            "model": self.model,
            "max_tokens": MAX_TOKENS,
            "system": SYSTEM_PROMPT,
            "output_config": {
                "effort": EFFORT,
                "format": {
                    "type": "json_schema",
                    "schema": output_schema(),
                },
            },
            "messages": [{ "role": "user", "content": content }],
        })
    }
}

#[derive(Debug, Deserialize)]
struct MessagesResponse {
    #[serde(default)]
    content: Vec<ContentBlock>,
    stop_reason: Option<String>,
    #[serde(default)]
    stop_details: Option<StopDetails>,
}

#[derive(Debug, Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StopDetails {
    #[serde(default)]
    category: Option<String>,
}

impl Extractor for AnthropicExtractor {
    fn version(&self) -> String {
        format!("{PROMPT_VERSION}/{}", self.model)
    }

    async fn extract(&self, observation: &Observation) -> AppResult<Extraction> {
        let response = self
            .client
            .post(API_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", API_VERSION)
            .header("content-type", "application/json")
            .json(&self.request_body(&observation.content))
            .send()
            .await
            .map_err(|err| ExtractionError::Transport(err.to_string()))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|err| ExtractionError::Transport(err.to_string()))?;

        if !status.is_success() {
            // The body can echo the user's journal entry back, so it goes to the
            // log, not to the caller.
            tracing::error!(status = %status, body = %body, "anthropic request failed");
            return Err(ExtractionError::Transport(format!("api returned {status}")).into());
        }

        let parsed: MessagesResponse = serde_json::from_str(&body)
            .map_err(|err| ExtractionError::Malformed(err.to_string()))?;

        // A refusal is a successful HTTP 200 with an empty or partial content array.
        // Checking stop_reason before reading content is what keeps this from
        // panicking on an empty vec.
        if parsed.stop_reason.as_deref() == Some("refusal") {
            let category = parsed
                .stop_details
                .and_then(|details| details.category)
                .unwrap_or_else(|| "unspecified".to_owned());
            return Err(ExtractionError::Refused(category).into());
        }

        let text = parsed
            .content
            .iter()
            .find(|block| block.kind == "text")
            .and_then(|block| block.text.as_deref())
            .ok_or_else(|| {
                ExtractionError::Malformed("response contained no text block".to_owned())
            })?;

        let extraction: Extraction = serde_json::from_str(text)
            .map_err(|err| ExtractionError::Malformed(err.to_string()))?;

        extraction.validate()?;
        Ok(extraction)
    }
}

impl From<ExtractionError> for AppError {
    fn from(err: ExtractionError) -> Self {
        match err {
            // A refusal or a malformed response is our problem to handle, not a
            // client input error — the caller sent a perfectly valid observation.
            ExtractionError::Refused(_)
            | ExtractionError::Transport(_)
            | ExtractionError::Malformed(_) => AppError::Upstream(err.to_string()),
            other => AppError::Validation(other.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use uuid::Uuid;

    fn extractor() -> AnthropicExtractor {
        AnthropicExtractor::new("test-key".to_owned(), DEFAULT_MODEL.to_owned())
    }

    #[test]
    fn the_system_prompt_is_the_file_on_disk() {
        assert!(SYSTEM_PROMPT.contains("You extract structured observations"));
        assert!(SYSTEM_PROMPT.contains("Never produce a diagnosis"));
    }

    #[test]
    fn the_request_omits_sampling_parameters() {
        // Opus 5 rejects temperature/top_p/top_k with a 400.
        let body = extractor().request_body("hello").to_string();
        for param in ["temperature", "top_p", "top_k"] {
            assert!(!body.contains(param), "{param} must not be sent");
        }
    }

    #[test]
    fn the_request_omits_a_thinking_block() {
        // Opus 5 thinks by default; disabling it is the documented cause of
        // malformed output on this model.
        assert!(!extractor().request_body("hello").to_string().contains("thinking"));
    }

    #[test]
    fn the_request_asks_for_schema_constrained_output() {
        let body = extractor().request_body("hello");
        assert_eq!(body["output_config"]["format"]["type"], "json_schema");
        assert_eq!(body["output_config"]["effort"], EFFORT);
        assert!(body["output_config"]["format"]["schema"].is_object());
    }

    #[test]
    fn the_version_string_identifies_both_prompt_and_model() {
        assert_eq!(extractor().version(), "extract-v0.1/claude-opus-5");
    }

    #[test]
    fn the_observation_content_is_the_user_turn() {
        let body = extractor().request_body("I keep putting this off.");
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][0]["content"], "I keep putting this off.");
    }

    #[test]
    fn a_refusal_is_reported_without_reading_content() {
        let body = r#"{"content":[],"stop_reason":"refusal","stop_details":{"category":"cyber"}}"#;
        let parsed: MessagesResponse = serde_json::from_str(body).unwrap();
        assert_eq!(parsed.stop_reason.as_deref(), Some("refusal"));
        assert!(parsed.content.is_empty());
    }

    #[test]
    fn a_response_missing_stop_details_still_parses() {
        let body = r#"{"content":[],"stop_reason":"refusal"}"#;
        let parsed: MessagesResponse = serde_json::from_str(body).unwrap();
        assert!(parsed.stop_details.is_none());
    }

    fn observation() -> Observation {
        Observation {
            id: Uuid::now_v7(),
            user_id: Uuid::now_v7(),
            content: "test".to_owned(),
            source: crate::domain::observation::Source::Text,
            captured_at: Utc::now(),
            created_at: Utc::now(),
            deleted_at: None,
        }
    }

    #[test]
    fn an_observation_is_accepted_by_the_request_builder() {
        let obs = observation();
        let body = extractor().request_body(&obs.content);
        assert_eq!(body["messages"][0]["content"], "test");
    }
}
