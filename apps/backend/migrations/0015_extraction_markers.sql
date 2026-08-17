-- Durable claim for observations whose valid extraction produced no graph rows.
CREATE TABLE observation_extraction_markers (
    observation_id UUID PRIMARY KEY REFERENCES observations (node_id) ON DELETE CASCADE,
    extractor TEXT NOT NULL,
    extracted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
