-- Theme summaries: one sentence a model writes about what a region's members
-- share, held beside the membership label it must never replace (ADR-0007).
--
-- The summary is derived, provisional data with its generator recorded. The
-- membership list remains the finding; deleting the sentence leaves the theme
-- exactly as it was before models could write.
ALTER TABLE themes
    ADD COLUMN IF NOT EXISTS summary TEXT,
    ADD COLUMN IF NOT EXISTS summary_model TEXT,
    ADD COLUMN IF NOT EXISTS summary_at TIMESTAMPTZ;

-- A stored sentence always says who wrote it. The reverse is fine: no summary,
-- no model named.
ALTER TABLE themes
    ADD CONSTRAINT themes_summary_names_its_writer
    CHECK ((summary IS NULL) = (summary_model IS NULL));
