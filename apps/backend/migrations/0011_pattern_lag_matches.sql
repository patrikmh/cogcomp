-- The exact observation pairs behind an ordered lag finding.
--
-- These rows preserve precedence evidence without asserting a causal graph
-- edge. The user-scoped foreign keys prevent evidence from another account
-- being attached to a pattern.

ALTER TABLE patterns
    ADD CONSTRAINT patterns_user_id_node_id_key UNIQUE (user_id, node_id);

CREATE TABLE pattern_lag_matches (
    user_id                 UUID NOT NULL,
    pattern_id              UUID NOT NULL,
    source_observation_id   UUID NOT NULL,
    target_observation_id   UUID NOT NULL,
    source_day              DATE NOT NULL,
    target_day              DATE NOT NULL,
    lag_days                INTEGER NOT NULL,

    PRIMARY KEY (pattern_id, source_observation_id, target_observation_id),
    FOREIGN KEY (user_id, pattern_id)
        REFERENCES patterns (user_id, node_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, source_observation_id)
        REFERENCES observations (user_id, node_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, target_observation_id)
        REFERENCES observations (user_id, node_id) ON DELETE CASCADE,
    CONSTRAINT pattern_lag_matches_lag_range CHECK (lag_days BETWEEN 1 AND 3),
    CONSTRAINT pattern_lag_matches_date_order CHECK (target_day > source_day),
    CONSTRAINT pattern_lag_matches_lag_matches_dates
        CHECK (target_day = source_day + lag_days)
);

CREATE INDEX pattern_lag_matches_user_idx ON pattern_lag_matches (user_id);
