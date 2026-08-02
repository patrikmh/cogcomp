-- Background agents, and the record of every time one ran.
--
-- The run log is not telemetry. This product makes claims about people without
-- being asked, which is only defensible if the person can find out what ran,
-- when, on what, and what it produced. A background inference with no record of
-- its origin is exactly the thing the guiding principles forbid.

CREATE TABLE agent_runs (
    id            UUID PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    agent         TEXT NOT NULL,
    -- The agent's own version, so a claim can be attributed to the exact logic
    -- that made it even after the agent changes.
    version       TEXT NOT NULL,
    -- 'scheduled' or 'manual'. Whether the person asked for this matters when
    -- they are looking at a conclusion they do not recognise.
    trigger       TEXT NOT NULL,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ,
    status        TEXT NOT NULL DEFAULT 'running',
    -- What it did, in the agent's own terms. Counts, not content.
    summary       JSONB NOT NULL DEFAULT '{}'::jsonb,
    error         TEXT,

    CONSTRAINT agent_runs_trigger_known CHECK (trigger IN ('scheduled', 'manual')),
    CONSTRAINT agent_runs_status_known CHECK (
        status IN ('running', 'succeeded', 'failed', 'skipped')
    ),
    -- A finished run must say when it finished; a running one must not claim to.
    CONSTRAINT agent_runs_finished_consistently CHECK (
        (status = 'running' AND finished_at IS NULL)
        OR (status <> 'running' AND finished_at IS NOT NULL)
    ),
    -- A failure without a reason is not something anyone can act on.
    CONSTRAINT agent_runs_failure_has_reason CHECK (
        status <> 'failed' OR length(btrim(coalesce(error, ''))) > 0
    )
);

CREATE INDEX agent_runs_user_started_idx ON agent_runs (user_id, started_at DESC);
CREATE INDEX agent_runs_user_agent_idx ON agent_runs (user_id, agent, started_at DESC);

-- Consolidation merges duplicate inferred nodes. The surviving node needs to
-- remember what it absorbed, or "why does this say 4 mentions when I only see 2"
-- becomes unanswerable.
CREATE TABLE node_merges (
    id           UUID PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kept_id      UUID NOT NULL REFERENCES graph_nodes (id) ON DELETE CASCADE,
    merged_id    UUID NOT NULL REFERENCES graph_nodes (id) ON DELETE CASCADE,
    agent_run_id UUID REFERENCES agent_runs (id) ON DELETE SET NULL,
    merged_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT node_merges_not_self CHECK (kept_id <> merged_id)
);

CREATE INDEX node_merges_kept_idx ON node_merges (kept_id);
