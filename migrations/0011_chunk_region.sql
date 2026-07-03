-- Up Migration
-- Section-scoping (UAT root-cause fix): tag each chunk with its manuscript region so statistical
-- rules run only on the body. Front matter (author affiliations, DOIs, submission dates) and back
-- matter (references + end sections) are full of IDs/dates/citation numbers a copy editor never
-- reformats — the main source of false positives in the first UAT run.
ALTER TABLE manuscript_chunks
    ADD COLUMN region VARCHAR(20) NOT NULL DEFAULT 'body'
        CHECK (region IN ('front_matter', 'body', 'back_matter'));

-- Down Migration
ALTER TABLE manuscript_chunks DROP COLUMN IF EXISTS region;
