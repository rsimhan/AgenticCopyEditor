-- Up Migration
-- author_query suggestions carry a message ("ask the author X") but proposed_text is NULL for them
-- (per the kind CHECK). Add a dedicated column so the message has a home. Nullable; the app-layer
-- schema (domain/types.ts) enforces that edits have no query_message and author_queries do.
ALTER TABLE editing_suggestions ADD COLUMN query_message TEXT;

-- Down Migration
ALTER TABLE editing_suggestions DROP COLUMN IF EXISTS query_message;
