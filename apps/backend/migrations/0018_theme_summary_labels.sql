-- A summary must keep faith with the words it was written from (ADR-0007).
-- Regions live: members join and leave as associations shift. A sentence that
-- was drawn from words that have since left the region is no longer backed by
-- anything, so the labels it was written from are recorded beside it. When a
-- stored label set no longer sits inside the region's current members, the
-- sentence falls rather than quietly outliving its evidence.
ALTER TABLE themes
    ADD COLUMN IF NOT EXISTS summary_labels JSONB;

-- All three derived fields stand or fall together: a sentence, its writer,
-- and the words it was written from.
ALTER TABLE themes DROP CONSTRAINT IF EXISTS themes_summary_names_its_writer;
ALTER TABLE themes
    ADD CONSTRAINT themes_summary_names_its_writer
    CHECK (
        (summary IS NULL AND summary_model IS NULL AND summary_labels IS NULL)
        OR (summary IS NOT NULL AND summary_model IS NOT NULL AND summary_labels IS NOT NULL)
    );
