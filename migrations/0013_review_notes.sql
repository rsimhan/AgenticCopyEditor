-- Up Migration
-- Review-console notes thread (UI-DESIGN §5, the @-routed command bar; NEXT #3). The senior/junior
-- leave notes — optionally attached to a specific change and/or rule — routed to a target
-- (@junior instruction, @senior question, @agent feedback, or an unrouted note). Previously the
-- thread lived only in the browser and was lost on refresh; this gives it a durable home so a
-- rejection can carry "here's what to do instead" and @agent feedback is captured as flywheel
-- signal. Rule adjustment itself (acting on the feedback) remains a separate, gated admin step.
CREATE TABLE review_notes (
    note_id       INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    manuscript_id UUID NOT NULL REFERENCES manuscripts(manuscript_id) ON DELETE CASCADE,
    -- The change this note is about (optional). Kept if the suggestion is later removed.
    suggestion_id INT REFERENCES editing_suggestions(suggestion_id) ON DELETE SET NULL,
    -- Denormalized from the suggestion for rule-directed feedback + easy per-rule retrieval.
    rule_id       VARCHAR(50) REFERENCES style_rules(rule_id) ON DELETE SET NULL,
    editor_id     INT NOT NULL REFERENCES editors(editor_id),
    routed_to     VARCHAR(20) NOT NULL DEFAULT 'note'
        CHECK (routed_to IN ('note', 'junior', 'senior', 'agent')),
    body          TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_review_notes_manuscript ON review_notes (manuscript_id, created_at);
CREATE INDEX idx_review_notes_suggestion ON review_notes (suggestion_id);

-- Down Migration
DROP TABLE IF EXISTS review_notes;
