-- Graph schema v0.1. See packages/ontology/README.md.
--
-- The two-tier rule (observed vs inferred) is enforced here with CHECK
-- constraints rather than left to application convention. An inferred node
-- without confidence, an extractor, or provenance cannot be inserted at all.

CREATE TABLE users (
    id          UUID PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    token_hash  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

-- Every node lives here, observed and inferred alike, so that edges have a
-- single foreign key target and provenance can be enforced referentially.
CREATE TABLE graph_nodes (
    id                UUID PRIMARY KEY,
    user_id           UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind              TEXT NOT NULL,
    label             TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,

    -- Present if and only if the node is inferred.
    confidence        REAL,
    epistemic_status  TEXT,
    extractor         TEXT,

    CONSTRAINT graph_nodes_kind_known CHECK (kind IN (
        'Observation',
        'Thought', 'Emotion', 'Need', 'Value', 'Belief',
        'Person', 'Place', 'Activity', 'Event', 'Pattern'
    )),

    CONSTRAINT graph_nodes_epistemic_status_known CHECK (
        epistemic_status IS NULL
        OR epistemic_status IN ('hypothesis', 'user_confirmed', 'user_rejected')
    ),

    -- The two-tier rule. Observations carry no confidence because they are not
    -- claims; inferences must carry all three fields because they are.
    CONSTRAINT graph_nodes_two_tier CHECK (
        (kind = 'Observation'
            AND confidence IS NULL
            AND epistemic_status IS NULL
            AND extractor IS NULL)
        OR
        (kind <> 'Observation'
            AND confidence IS NOT NULL
            AND confidence BETWEEN 0.0 AND 1.0
            AND epistemic_status IS NOT NULL
            AND extractor IS NOT NULL)
    )
);

CREATE INDEX graph_nodes_user_kind_idx ON graph_nodes (user_id, kind);
CREATE INDEX graph_nodes_user_created_idx ON graph_nodes (user_id, created_at DESC);

-- Raw captured content. One row per Observation node.
CREATE TABLE observations (
    node_id      UUID PRIMARY KEY REFERENCES graph_nodes (id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    content      TEXT NOT NULL,
    source       TEXT NOT NULL,
    captured_at  TIMESTAMPTZ NOT NULL,

    CONSTRAINT observations_source_known CHECK (source IN ('text', 'voice')),
    CONSTRAINT observations_content_not_blank CHECK (length(btrim(content)) > 0)
);

CREATE INDEX observations_user_captured_idx ON observations (user_id, captured_at DESC);

CREATE TABLE graph_edges (
    id                UUID PRIMARY KEY,
    user_id           UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind              TEXT NOT NULL,
    from_id           UUID NOT NULL REFERENCES graph_nodes (id) ON DELETE CASCADE,
    to_id             UUID NOT NULL REFERENCES graph_nodes (id) ON DELETE CASCADE,
    note              TEXT,
    confidence        REAL NOT NULL,
    epistemic_status  TEXT NOT NULL,
    extractor         TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at        TIMESTAMPTZ,

    CONSTRAINT graph_edges_kind_known CHECK (kind IN (
        'DERIVED_FROM', 'EXPRESSES', 'ABOUT', 'FELT_TOWARD', 'TRIGGERED_BY',
        'SUPPORTS', 'CONTRADICTS', 'INDICATES', 'CO_OCCURS_WITH', 'RELATES_TO'
    )),
    CONSTRAINT graph_edges_confidence_range CHECK (confidence BETWEEN 0.0 AND 1.0),
    CONSTRAINT graph_edges_epistemic_status_known CHECK (
        epistemic_status IN ('hypothesis', 'user_confirmed', 'user_rejected')
    ),
    -- RELATES_TO is the escape hatch; requiring a note keeps it from becoming
    -- the default answer to "which edge kind is this?".
    CONSTRAINT graph_edges_relates_to_needs_note CHECK (
        kind <> 'RELATES_TO' OR length(btrim(coalesce(note, ''))) > 0
    ),
    CONSTRAINT graph_edges_no_self_loop CHECK (from_id <> to_id)
);

CREATE INDEX graph_edges_from_idx ON graph_edges (from_id);
CREATE INDEX graph_edges_to_idx ON graph_edges (to_id);
CREATE INDEX graph_edges_user_kind_idx ON graph_edges (user_id, kind);

-- Provenance. Modelled as a table rather than an array column so that the
-- reference to the originating observation is enforced by the database and
-- survives deletion of the observation as a cascade rather than a dangling id.
CREATE TABLE node_provenance (
    node_id         UUID NOT NULL REFERENCES graph_nodes (id) ON DELETE CASCADE,
    observation_id  UUID NOT NULL REFERENCES observations (node_id) ON DELETE CASCADE,
    PRIMARY KEY (node_id, observation_id)
);

CREATE INDEX node_provenance_observation_idx ON node_provenance (observation_id);

CREATE TABLE edge_provenance (
    edge_id         UUID NOT NULL REFERENCES graph_edges (id) ON DELETE CASCADE,
    observation_id  UUID NOT NULL REFERENCES observations (node_id) ON DELETE CASCADE,
    PRIMARY KEY (edge_id, observation_id)
);

CREATE INDEX edge_provenance_observation_idx ON edge_provenance (observation_id);
