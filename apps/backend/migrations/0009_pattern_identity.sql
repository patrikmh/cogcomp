-- Durable identity for patterns.
--
-- Until now, re-mining tombstoned every Pattern node and inserted fresh ones
-- with new ids. That was defensible while mining was one deterministic pass over
-- exact labels: the same graph produced the same patterns, so churn was
-- invisible. It stops being defensible the moment there is more than one
-- detector and a shorter cadence, for two reasons.
--
-- **A claim that changes id cannot be tracked.** "Has this pattern held up for
-- three weeks?" is the question the person actually cares about, and it is
-- unanswerable if nothing survives a run. Age is the cheapest evidence a pattern
-- has, and recreating the node throws it away every six hours.
--
-- **A claim that changes id cannot be corrected.** Rejecting a pattern is
-- meaningless if the next run resurrects it under a new id. Durable identity is
-- what makes `user_rejected` stick.
--
-- Identity is `(user_id, detector, pattern_key)`. The row outlives the claim: a
-- pattern that stops holding has its node tombstoned but keeps this row, so if
-- the same recurrence returns a month later it comes back as the same pattern
-- with its original first_seen_at, rather than as a discovery.

CREATE TABLE patterns (
    node_id            UUID PRIMARY KEY REFERENCES graph_nodes (id) ON DELETE CASCADE,
    user_id            UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- Which detector made this claim. Recorded rather than inferred because
    -- detectors differ in how much they are allowed to assert: an exact-label
    -- recurrence is a count, a co-occurrence is a statistic, and a semantic
    -- cluster is an interpretation. The client renders them differently, and it
    -- can only do that if the provenance of the method travels with the claim.
    detector           TEXT NOT NULL,

    -- The detector's own stable name for this claim, unique within the detector.
    -- Opaque here on purpose: what makes two findings "the same finding" is a
    -- question only the detector can answer.
    pattern_key        TEXT NOT NULL,

    -- When this was first true, not when this row was written. Survives lapses.
    first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The last run that still found it. With first_seen_at this gives the span a
    -- pattern has held, which is the only durable evidence of its seriousness.
    last_confirmed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Set when a run no longer finds it. Cleared if it returns. A lapsed pattern
    -- is not a deleted one: "this stopped" is itself worth being able to say.
    lapsed_at          TIMESTAMPTZ,

    -- What the detector counted, kept alongside the claim so the explain screen
    -- does not have to re-derive it from provenance to show its arithmetic.
    occurrences        INTEGER NOT NULL,
    distinct_days      INTEGER NOT NULL,

    CONSTRAINT patterns_detector_not_blank CHECK (length(btrim(detector)) > 0),
    CONSTRAINT patterns_key_not_blank CHECK (length(btrim(pattern_key)) > 0),
    CONSTRAINT patterns_counts_positive CHECK (occurrences > 0 AND distinct_days > 0),
    -- Arithmetic, not policy: a thing cannot recur on more distinct days than the
    -- number of entries it appeared in.
    CONSTRAINT patterns_days_within_occurrences CHECK (distinct_days <= occurrences),
    -- A pattern cannot have been confirmed before it was first seen.
    CONSTRAINT patterns_confirmed_after_first_seen CHECK (last_confirmed_at >= first_seen_at)
);

-- One row per identity, ever. This is what makes re-mining an upsert rather than
-- a replacement, and it is enforced here rather than in application code because
-- a duplicate identity would silently reintroduce exactly the churn this table
-- exists to prevent.
CREATE UNIQUE INDEX patterns_identity_idx ON patterns (user_id, detector, pattern_key);

CREATE INDEX patterns_user_live_idx ON patterns (user_id) WHERE lapsed_at IS NULL;
