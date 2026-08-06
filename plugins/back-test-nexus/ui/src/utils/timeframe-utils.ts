/**
 * Timeframe Utilities
 *
 * TICKET_248 Phase 2: Centralized timeframe extraction and comparison utilities
 * for multi-timeframe data loading support.
 */

import {
  INTERVAL_1m, INTERVAL_5m, INTERVAL_15m, INTERVAL_30m,
  INTERVAL_1h, INTERVAL_2h, INTERVAL_4h, INTERVAL_1d, INTERVAL_1w, INTERVAL_1M,
} from '@StratCraft/types';
import type { BarInterval } from '@StratCraft/types';
import type { WorkflowRow, AlgorithmSelection } from '../components/ui';

// =============================================================================
// Constants
// =============================================================================

/**
 * Timeframe order from longest to shortest duration.
 * Used for sorting timeframes consistently.
 */
const TIMEFRAME_ORDER: string[] = [INTERVAL_1M, INTERVAL_1w, INTERVAL_1d, INTERVAL_4h, INTERVAL_2h, INTERVAL_1h, INTERVAL_30m, INTERVAL_15m, INTERVAL_5m, INTERVAL_1m];

// =============================================================================
// Types
// =============================================================================

export type TimeframeValue = BarInterval | '2h';

// =============================================================================
// Functions
// =============================================================================

/**
 * Compare two timeframes for sorting (longest to shortest).
 *
 * @param a - First timeframe
 * @param b - Second timeframe
 * @returns Negative if a is longer, positive if b is longer, 0 if equal
 */
export function compareTimeframes(a: string, b: string): number {
  const indexA = TIMEFRAME_ORDER.indexOf(a);
  const indexB = TIMEFRAME_ORDER.indexOf(b);

  // Handle unknown timeframes by placing them at the end
  const effectiveA = indexA === -1 ? TIMEFRAME_ORDER.length : indexA;
  const effectiveB = indexB === -1 ? TIMEFRAME_ORDER.length : indexB;

  return effectiveA - effectiveB;
}

/**
 * Extract unique timeframes from all algorithm selections in workflows.
 * Returns timeframes sorted from longest to shortest duration.
 *
 * TICKET_248 Phase 2: Collects timeframes from all workflow selections
 * (analysis, preCondition, step, postCondition) to determine which
 * data intervals need to be loaded.
 *
 * @param workflows - Array of WorkflowRow objects
 * @returns Sorted array of unique timeframe strings
 */
export function extractUniqueTimeframes(workflows: WorkflowRow[]): string[] {
  const timeframes = new Set<string>();

  for (const workflow of workflows) {
    // Collect timeframes from all selection arrays
    const allSelections: AlgorithmSelection[] = [
      ...(workflow.analysisSelections || []),
      ...(workflow.preConditionSelections || []),
      ...(workflow.stepSelections || []),
      ...(workflow.postConditionSelections || []),
    ];

    for (const selection of allSelections) {
      if (selection.timeframe) {
        timeframes.add(selection.timeframe);
      }
    }
  }

  // Convert to array and sort by duration (longest first)
  return Array.from(timeframes).sort(compareTimeframes);
}

/**
 * Get the primary (longest) timeframe from workflows.
 * Falls back to '1d' if no timeframes are found.
 *
 * @param workflows - Array of WorkflowRow objects
 * @returns The primary timeframe string
 */
export function getPrimaryTimeframe(workflows: WorkflowRow[]): string {
  const timeframes = extractUniqueTimeframes(workflows);
  return timeframes.length > 0 ? timeframes[0] : INTERVAL_1d;
}

/**
 * Check if workflows use multiple timeframes.
 *
 * @param workflows - Array of WorkflowRow objects
 * @returns True if more than one unique timeframe is used
 */
export function hasMultipleTimeframes(workflows: WorkflowRow[]): boolean {
  const timeframes = extractUniqueTimeframes(workflows);
  return timeframes.length > 1;
}
