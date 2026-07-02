/**
 * Domain vocabulary shared across all agents, tools, and the orchestrator.
 *
 * These types mirror the schema enums in SPEC §4 and form the **blackboard contract**
 * (AGENT-ARCHITECTURE §5.1): the shape of what agents read and write. Zod schemas back the
 * TypeScript types so agent outputs can be validated at the seam (contracts are schemas, not
 * prose — AGENT-ARCHITECTURE §3.6).
 */
import { z } from 'zod';

// --- Enum-like value sets (must match the CHECK constraints in SPEC §4) ---

export const OriginTier = z.enum(['deterministic', 'verified_memory', 'base_inference']);
export type OriginTier = z.infer<typeof OriginTier>;

export const RuleScope = z.enum(['span', 'section', 'document', 'table']);
export type RuleScope = z.infer<typeof RuleScope>;

export const SuggestionKind = z.enum(['edit', 'author_query']);
export type SuggestionKind = z.infer<typeof SuggestionKind>;

export const SuggestionStatus = z.enum([
  'pending',
  'auto_applied',
  'accepted',
  'rejected',
  'overridden',
  'superseded',
  'queried',
]);
export type SuggestionStatus = z.infer<typeof SuggestionStatus>;

export const StatType = z.enum([
  'p_value',
  'mean',
  'mean_difference',
  'percentage',
  'proportion',
  'ci_bound',
  'sample_size',
  'test_statistic',
  'other',
]);
export type StatType = z.infer<typeof StatType>;

export const LocationContext = z.enum([
  'abstract',
  'body_prose',
  'table_header',
  'table_cell',
  'figure',
]);
export type LocationContext = z.infer<typeof LocationContext>;

export const EditorAction = z.enum([
  'auto_applied',
  'proposed',
  'accepted',
  'rejected',
  'overridden',
  'raise_query',
]);
export type EditorAction = z.infer<typeof EditorAction>;

// --- Span ---

export const CharSpanSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .refine((s) => s.end >= s.start, { message: 'span end must be >= start' });
export type CharSpan = z.infer<typeof CharSpanSchema>;

/**
 * A suggestion as an agent/engine proposes it, before it is persisted (no DB id yet).
 * Enforces the SPEC §4 invariant: an `edit` carries `proposed`, an `author_query` does not.
 */
export const SuggestionDraftSchema = z
  .object({
    /** Target: a prose chunk, and optionally a specific table cell within it. */
    chunkId: z.number().int().positive(),
    cellId: z.number().int().positive().optional(),
    ruleId: z.string().min(1),
    originatorEngine: z.string().min(1),
    originTier: OriginTier,
    kind: SuggestionKind,
    /** Codepoint offsets, relative to chunk_text or cell_text (Principle 8). */
    span: CharSpanSchema,
    originalText: z.string(),
    /** Present iff kind === 'edit'; for author_query the message goes in `queryMessage`. */
    proposedText: z.string().optional(),
    /** Present iff kind === 'author_query': what to ask the author. */
    queryMessage: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .refine(
    (s) =>
      (s.kind === 'edit' && s.proposedText !== undefined && s.queryMessage === undefined) ||
      (s.kind === 'author_query' && s.proposedText === undefined && s.queryMessage !== undefined),
    {
      message:
        'edit requires proposedText; author_query requires queryMessage (and no proposedText)',
    },
  );
export type SuggestionDraft = z.infer<typeof SuggestionDraftSchema>;
