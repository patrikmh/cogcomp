-- The exact observation pairs behind a same-day-order finding.
--
-- The lag table cannot hold these: its checks require a day apart, and the
-- whole claim here is that both moments fell on one day. These rows preserve
-- precedence evidence within a day without asserting a causal graph edge.
-- The user-scoped foreign keys prevent evidence from another account being
-- attached to a pattern.
--
-- There is no database-level same-day check: whether two moments share a day
-- is decided in the writer's calendar, which only the detector knows at mine
-- time. `day` records that decision; the order check stays enforceable here.

CREATE TABLE pattern_sameday_matches (
    user_id                 UUID NOT NULL,
    pattern_id              UUID NOT NULL,
    source_observation_id   UUID NOT NULL,
    target_observation_id   UUID NOT NULL,
    day                     DATE NOT NULL,
    source_at               TIMESTAMPTZ NOT NULL,
    target_at               TIMESTAMPTZ NOT NULL,

    PRIMARY KEY (pattern_id, source_observation_id, target_observation_id),
    FOREIGN KEY (user_id, pattern_id)
        REFERENCES patterns (user_id, node_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, source_observation_id)
        REFERENCES observations (user_id, node_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, target_observation_id)
        REFERENCES observations (user_id, node_id) ON DELETE CASCADE,
    CONSTRAINT pattern_sameday_matches_order CHECK (source_at < target_at)
);

CREATE INDEX pattern_sameday_matches_user_idx ON pattern_sameday_matches (user_id);
