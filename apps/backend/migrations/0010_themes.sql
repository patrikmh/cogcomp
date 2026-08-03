-- Themes: the regions a person's life falls into.
--
-- The first addition to the node vocabulary since v0.1, and it is deliberate
-- rather than convenient. `Theme` earns a kind because it is a claim of a shape
-- nothing else in the ontology makes: a Pattern says one thing recurs, an
-- association says two things travel together, and a Theme says *this group of
-- things is one area of your life*. Putting that in a side table to dodge a
-- migration would have kept it outside the CHECK constraints that make every
-- other claim in this system accountable, which is the wrong trade — the
-- constraint machinery is the reason a claim here can be trusted at all.
--
-- Themes are derived from `CO_OCCURS_WITH` structure only. That matters: an
-- association carries no causal claim and no direction, so a community built
-- from them is a statement about adjacency and nothing more. Clustering over
-- TRIGGERED_BY would launder a pile of causal hypotheses into something that
-- looks like an established region of someone's life.

ALTER TABLE graph_nodes DROP CONSTRAINT graph_nodes_kind_known;
ALTER TABLE graph_nodes ADD CONSTRAINT graph_nodes_kind_known CHECK (kind IN (
    'Observation',
    'Thought', 'Emotion', 'Need', 'Value', 'Belief',
    'Person', 'Place', 'Activity', 'Event', 'Pattern', 'Theme'
));

-- Identity, on the same argument as `patterns`: a theme that changed id on every
-- run could not be aged, could not be rejected, and would read as a new discovery
-- every time the clustering settled slightly differently.
--
-- A theme's identity cannot be its membership, because membership is exactly what
-- drifts as the graph grows. It is matched to the previous run by overlap
-- instead, so a community that gains a member is the same theme with one more
-- thing in it rather than a different theme that happens to look similar.
CREATE TABLE themes (
    node_id            UUID PRIMARY KEY REFERENCES graph_nodes (id) ON DELETE CASCADE,
    user_id            UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    detector           TEXT NOT NULL,
    first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_confirmed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    lapsed_at          TIMESTAMPTZ,
    -- How many things are in it, kept alongside so the explain screen does not
    -- have to reconstruct the community to state its size.
    member_count       INTEGER NOT NULL,

    CONSTRAINT themes_detector_not_blank CHECK (length(btrim(detector)) > 0),
    -- Two things adjacent to each other is an association, which the graph
    -- already says with an edge. A theme has to be a region.
    CONSTRAINT themes_are_more_than_a_pair CHECK (member_count >= 3),
    CONSTRAINT themes_confirmed_after_first_seen CHECK (last_confirmed_at >= first_seen_at)
);

CREATE INDEX themes_user_live_idx ON themes (user_id) WHERE lapsed_at IS NULL;

-- Which nodes are in which theme. A table rather than an array column for the
-- same reason provenance is one: membership is a foreign key relationship and
-- the database should be the thing enforcing that the members exist.
CREATE TABLE theme_members (
    theme_id  UUID NOT NULL REFERENCES graph_nodes (id) ON DELETE CASCADE,
    node_id   UUID NOT NULL REFERENCES graph_nodes (id) ON DELETE CASCADE,
    PRIMARY KEY (theme_id, node_id),
    CONSTRAINT theme_members_no_self_membership CHECK (theme_id <> node_id)
);

CREATE INDEX theme_members_node_idx ON theme_members (node_id);
