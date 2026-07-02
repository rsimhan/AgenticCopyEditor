/**
 * A statistic extracted from a chunk or table cell (pre-persist form of an `extracted_statistics`
 * row, SPEC §4 part 4). Offsets are codepoint-based (Principle 8), relative to the source text.
 */
import type { StatType, LocationContext, CharSpan } from './types.js';

export interface StatExtraction {
  chunkId: number;
  cellId?: number;
  locationContext: LocationContext;
  statType: StatType;
  /** Normalized identifier grouping the same quantity across locations (SPEC §5 B); may be unset. */
  logicalKey?: string;
  rawValueString: string;
  numericPrimary?: number;
  numericSecondary?: number;
  span: CharSpan;
}
