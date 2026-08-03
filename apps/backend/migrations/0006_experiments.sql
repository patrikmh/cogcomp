-- Supporting constraints for the composite foreign keys below.
--
-- The `(user_id, <id>)` foreign keys in this file are what make it impossible to
-- attach an experiment to another user's observation or node — the isolation is
-- enforced by the database rather than by remembering to filter. Postgres will
-- only accept such a key if the referenced columns carry a unique constraint,
-- and neither table had one: both are keyed on the id alone.
--
-- Redundant in the sense that `id` is already unique, so `(user_id, id)` cannot
-- collide. Not redundant to Postgres, which requires the constraint to exist
-- before it will trust the reference. Without these the whole migration fails
-- with "no unique constraint matching given keys".
ALTER TABLE graph_nodes ADD CONSTRAINT graph_nodes_user_id_id_key UNIQUE (user_id, id);
ALTER TABLE observations ADD CONSTRAINT observations_user_id_node_id_key UNIQUE (user_id, node_id);

-- User-authored relational experiments. No ontology kind is introduced.
CREATE TABLE experiments (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    hypothesis TEXT NOT NULL,
    action TEXT NOT NULL,
    success_criterion TEXT NOT NULL,
    start_date DATE NOT NULL,
    duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 42),
    timezone TEXT NOT NULL,
    cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly', 'end_only')),
    state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','active','paused','completed','cancelled')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    request_fingerprint TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    UNIQUE(user_id, id),
    CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    CHECK (length(btrim(hypothesis)) BETWEEN 1 AND 2000),
    CHECK (length(btrim(action)) BETWEEN 1 AND 2000),
    CHECK (length(btrim(success_criterion)) BETWEEN 1 AND 2000),
    CHECK (timezone <> '')
);
CREATE INDEX experiments_user_updated_idx ON experiments(user_id, updated_at DESC, id);

CREATE TABLE experiment_links (
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    node_id UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    PRIMARY KEY (experiment_id, node_id),
    FOREIGN KEY (user_id, experiment_id) REFERENCES experiments(user_id, id),
    FOREIGN KEY (user_id, node_id) REFERENCES graph_nodes(user_id, id)
);
CREATE INDEX experiment_links_live_idx ON experiment_links(experiment_id) WHERE deleted_at IS NULL;

CREATE TABLE experiment_checkins (
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    observation_id UUID NOT NULL REFERENCES observations(node_id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    PRIMARY KEY (experiment_id, observation_id),
    FOREIGN KEY (user_id, experiment_id) REFERENCES experiments(user_id, id),
    FOREIGN KEY (user_id, observation_id) REFERENCES observations(user_id, node_id)
);
CREATE INDEX experiment_checkins_live_idx ON experiment_checkins(experiment_id) WHERE deleted_at IS NULL;

CREATE TABLE experiment_outcomes (
    experiment_id UUID PRIMARY KEY REFERENCES experiments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assessment TEXT NOT NULL CHECK (assessment IN ('met','partly_met','not_met','unclear')),
    note TEXT,
    final_checkin_observation_id UUID NOT NULL REFERENCES observations(node_id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (user_id, experiment_id) REFERENCES experiments(user_id, id),
    FOREIGN KEY (user_id, final_checkin_observation_id) REFERENCES observations(user_id, node_id)
);
