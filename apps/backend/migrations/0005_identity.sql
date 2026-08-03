-- User-curated identity projection. Membership is a separate assertion from
-- epistemic status and remains as a removed tombstone for audit and reselection.
ALTER TABLE graph_nodes
    ADD CONSTRAINT graph_nodes_user_id_unique UNIQUE (user_id, id);

CREATE TABLE identity_selections (
    id         UUID PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    node_id    UUID NOT NULL REFERENCES graph_nodes (id) ON DELETE CASCADE,
    status     TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT identity_selections_status_known CHECK (status IN ('selected', 'removed')),
    CONSTRAINT identity_selections_user_node_unique UNIQUE (user_id, node_id),
    CONSTRAINT identity_selections_same_user_node_fk
        FOREIGN KEY (user_id, node_id) REFERENCES graph_nodes (user_id, id)
);

CREATE INDEX identity_selections_user_status_idx
    ON identity_selections (user_id, status);
CREATE INDEX identity_selections_node_status_idx
    ON identity_selections (node_id, status);
