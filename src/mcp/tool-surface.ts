/**
 * MCP boundary seam (AGENT-ARCHITECTURE §5.7, SPEC §8).
 *
 * This is the stable EXTERNAL contract: the intent-scoped tools the worker service and editor
 * dashboard call. Internal agents/phases can change freely behind it. The `@modelcontextprotocol/sdk`
 * server that exposes these is wired in Milestone 5; this file pins the tool names + I/O shapes now
 * so the boundary is designed, not discovered.
 */
import type { SuggestionKind, OriginTier, EditorAction } from '../domain/types.js';

export interface McpToolSurface {
  ingest_manuscript(input: { title?: string; rawContentMarkdown: string }): Promise<{
    manuscriptId: string;
    chunkCount: number;
  }>;

  extract_manuscript_statistics(input: { manuscriptId: string }): Promise<{
    perLogicalKeyCounts: Record<string, number>;
  }>;

  reconcile_statistics(input: { manuscriptId: string }): Promise<{
    discrepancies: Array<{ logicalKey: string; detail: string }>;
  }>;

  run_consistency_normalizers(input: { manuscriptId: string }): Promise<{
    perRuleCounts: Record<string, number>;
  }>;

  run_deterministic_fixes(input: { chunkId?: number; manuscriptId?: string }): Promise<{
    changes: number;
  }>;

  retrieve_curated_lessons(input: { textSpan: string; ruleId: string }): Promise<{
    examples: Array<{ original: string; corrected: string; rationale: string }>;
  }>;

  post_suggestion(input: {
    chunkId: number;
    cellId?: number;
    ruleId: string;
    originTier: OriginTier;
    kind: SuggestionKind;
    charStart: number;
    charEnd: number;
    original: string;
    proposed?: string;
    queryMessage?: string;
    originatorEngine: string;
    confidence?: number;
  }): Promise<{ suggestionId: number }>;

  merge_chunk_suggestions(input: { chunkId: number }): Promise<{ reconciledCount: number }>;

  record_editor_action(input: {
    suggestionId: number;
    editorId: number;
    action: EditorAction;
    finalText?: string;
  }): Promise<{ ok: true }>;

  verify_memory_record(input: {
    memoryId: number;
    verifyingEditorId: number;
  }): Promise<{ ok: true }>;
}
