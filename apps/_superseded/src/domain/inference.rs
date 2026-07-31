#![allow(dead_code)] // Invariant types: defined ahead of the Milestone 1 extractor.

//! The invariants that make an inference explainable.
//!
//! These are newtypes rather than raw `f32` and `Vec<Uuid>` on purpose. An
//! inference without calibrated confidence or without a path back to the user's
//! own words is not something we are willing to store, so the types refuse to
//! be constructed in that state.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Below this, the client renders a node as tentative rather than as knowledge.
pub const TENTATIVE_THRESHOLD: f32 = 0.5;

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize)]
pub struct Confidence(f32);

impl Confidence {
    pub fn new(value: f32) -> Result<Self, InvariantError> {
        if !value.is_finite() || !(0.0..=1.0).contains(&value) {
            return Err(InvariantError::ConfidenceOutOfRange(value));
        }
        Ok(Self(value))
    }

    pub fn get(self) -> f32 {
        self.0
    }

    pub fn is_tentative(self) -> bool {
        self.0 < TENTATIVE_THRESHOLD
    }

    /// A node derived from other inferences cannot be more certain than the
    /// least certain thing it rests on. Confidence never multiplies upward.
    pub fn derived_from(inputs: &[Confidence]) -> Result<Self, InvariantError> {
        let weakest = inputs
            .iter()
            .copied()
            .fold(None::<Confidence>, |acc, c| match acc {
                Some(current) if current.0 <= c.0 => Some(current),
                _ => Some(c),
            });
        weakest.ok_or(InvariantError::NoInputs)
    }
}

impl<'de> Deserialize<'de> for Confidence {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = f32::deserialize(deserializer)?;
        Confidence::new(raw).map_err(serde::de::Error::custom)
    }
}

/// The observations an inference was derived from. Never empty.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Provenance(Vec<Uuid>);

impl Provenance {
    pub fn new(observation_ids: Vec<Uuid>) -> Result<Self, InvariantError> {
        if observation_ids.is_empty() {
            return Err(InvariantError::EmptyProvenance);
        }
        let mut ids = observation_ids;
        ids.sort_unstable();
        ids.dedup();
        Ok(Self(ids))
    }

    pub fn single(observation_id: Uuid) -> Self {
        Self(vec![observation_id])
    }

    pub fn ids(&self) -> &[Uuid] {
        &self.0
    }
}

impl<'de> Deserialize<'de> for Provenance {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = Vec::<Uuid>::deserialize(deserializer)?;
        Provenance::new(raw).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EpistemicStatus {
    /// Where every inference starts, and where it stays until the user says otherwise.
    Hypothesis,
    UserConfirmed,
    UserRejected,
}

impl EpistemicStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            EpistemicStatus::Hypothesis => "hypothesis",
            EpistemicStatus::UserConfirmed => "user_confirmed",
            EpistemicStatus::UserRejected => "user_rejected",
        }
    }
}

impl Default for EpistemicStatus {
    fn default() -> Self {
        Self::Hypothesis
    }
}

/// Everything an inferred node or edge must carry to be storable.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Inference {
    pub confidence: Confidence,
    #[serde(default)]
    pub epistemic_status: EpistemicStatus,
    /// Name and version of the producing model or rule, e.g.
    /// `extract-v0.1/claude-opus-5`. Makes a bad batch identifiable and revocable.
    pub extractor: String,
    pub provenance: Provenance,
}

#[derive(Debug, thiserror::Error)]
pub enum InvariantError {
    #[error("confidence must be a finite value between 0.0 and 1.0, got {0}")]
    ConfidenceOutOfRange(f32),

    #[error("an inference must cite at least one observation")]
    EmptyProvenance,

    #[error("cannot derive confidence from an empty set of inputs")]
    NoInputs,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confidence_rejects_values_outside_the_unit_interval() {
        assert!(Confidence::new(-0.1).is_err());
        assert!(Confidence::new(1.1).is_err());
        assert!(Confidence::new(f32::NAN).is_err());
        assert!(Confidence::new(0.0).is_ok());
        assert!(Confidence::new(1.0).is_ok());
    }

    #[test]
    fn derived_confidence_takes_the_weakest_input() {
        let inputs = [
            Confidence::new(0.9).unwrap(),
            Confidence::new(0.4).unwrap(),
            Confidence::new(0.7).unwrap(),
        ];
        let derived = Confidence::derived_from(&inputs).unwrap();
        assert_eq!(derived.get(), 0.4);
    }

    #[test]
    fn derived_confidence_never_exceeds_its_inputs() {
        let inputs = [Confidence::new(0.3).unwrap(), Confidence::new(0.3).unwrap()];
        assert_eq!(Confidence::derived_from(&inputs).unwrap().get(), 0.3);
    }

    #[test]
    fn derived_confidence_needs_at_least_one_input() {
        assert!(Confidence::derived_from(&[]).is_err());
    }

    #[test]
    fn confidence_below_half_is_tentative() {
        assert!(Confidence::new(0.49).unwrap().is_tentative());
        assert!(!Confidence::new(0.5).unwrap().is_tentative());
    }

    #[test]
    fn provenance_cannot_be_empty() {
        assert!(Provenance::new(vec![]).is_err());
        assert!(Provenance::new(vec![Uuid::now_v7()]).is_ok());
    }

    #[test]
    fn provenance_deduplicates_repeated_observations() {
        let id = Uuid::now_v7();
        let provenance = Provenance::new(vec![id, id, id]).unwrap();
        assert_eq!(provenance.ids(), &[id]);
    }

    #[test]
    fn a_missing_confidence_is_an_error_not_a_default() {
        let json = r#"{"extractor":"test","provenance":["018f0000-0000-7000-8000-000000000000"]}"#;
        assert!(serde_json::from_str::<Inference>(json).is_err());
    }

    #[test]
    fn an_out_of_range_confidence_is_rejected_at_the_api_boundary() {
        let json = r#"{"confidence":1.5,"extractor":"test","provenance":["018f0000-0000-7000-8000-000000000000"]}"#;
        assert!(serde_json::from_str::<Inference>(json).is_err());
    }

    #[test]
    fn empty_provenance_is_rejected_at_the_api_boundary() {
        let json = r#"{"confidence":0.8,"extractor":"test","provenance":[]}"#;
        assert!(serde_json::from_str::<Inference>(json).is_err());
    }

    #[test]
    fn inferences_default_to_hypothesis() {
        let json = r#"{"confidence":0.8,"extractor":"test","provenance":["018f0000-0000-7000-8000-000000000000"]}"#;
        let inference: Inference = serde_json::from_str(json).unwrap();
        assert_eq!(inference.epistemic_status, EpistemicStatus::Hypothesis);
    }
}
