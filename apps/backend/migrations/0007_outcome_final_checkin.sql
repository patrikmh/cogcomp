-- Add `final_checkin_observation_id` to experiment_outcomes.
--
-- The column is already declared in 0006, but 0006 was edited *after* it had run
-- on existing databases. A migration that has been applied is a historical fact:
-- the runner records its name and never executes it again, so editing one only
-- ever helps databases created afterwards. Every database that had already
-- applied 0006 was left without the column, and every request to the experiment
-- detail endpoint failed with a 500 — which the browser reported as a CORS error,
-- because an unhandled exception loses the CORS headers on the way out.
--
-- Written to be safe on both shapes: databases created from the edited 0006
-- already have the column, so this is a no-op there.
ALTER TABLE experiment_outcomes
    ADD COLUMN IF NOT EXISTS final_checkin_observation_id UUID
        REFERENCES observations (node_id) ON DELETE RESTRICT;

-- 0006 declares the column NOT NULL. It cannot be added that way to a table with
-- existing rows and no default, so it is added nullable here and constrained
-- only once any pre-existing outcomes have been backfilled. There is no sensible
-- value to invent for an outcome recorded before check-ins were linked — the
-- person did not choose one — so those rows keep NULL rather than being handed a
-- fabricated citation.
--
-- The composite key mirrors the one 0006 uses everywhere else: it makes it
-- impossible to cite another user's entry as your own experiment's evidence,
-- enforced by the database rather than by remembering to filter.
ALTER TABLE experiment_outcomes
    DROP CONSTRAINT IF EXISTS experiment_outcomes_user_final_checkin_fkey;

ALTER TABLE experiment_outcomes
    ADD CONSTRAINT experiment_outcomes_user_final_checkin_fkey
        FOREIGN KEY (user_id, final_checkin_observation_id)
        REFERENCES observations (user_id, node_id);
