/**
 * TICKET_1370 R12/AC38+AC39 -- shared presentation adapter for reviewed
 * parameter values.
 *
 * Scope boundary: this module formats an ALREADY-RESOLVED value for display. It
 * never re-derives the horizon map, expands a preset, or makes any other domain
 * decision -- those belong to `horizon.ts` and `market-scope.ts`. Formatting is
 * pure and total: the canonical value handed to the fingerprint, the
 * confirmation payload, and the Python command is never touched.
 *
 * It lives in the shared package rather than in either surface because both the
 * Electron renderer and the Guide WebUI must show a reviewed plan identically.
 * A per-surface formatter is exactly how two surfaces start describing the same
 * confirmed plan differently.
 */
import type { WorkloadJsonValue } from '@StratCraft/types';
import { FACTOR_MINING_TIMEFRAMES } from '@StratCraft/types';

/** A single readable `key -> value` assignment from a reviewed map parameter. */
export interface WorkloadDisplayAssignment {
  readonly key: string;
  readonly value: string;
}

/**
 * Display order for timeframe-keyed maps. The canonical map key order is
 * lexicographic so a plan fingerprint cannot depend on click order; that same
 * order reads wrong to a human (`15m, 1h, 30m, 5m`). The repository's
 * authoritative timeframe sequence is the display order, and any key outside it
 * is appended in canonical order rather than dropped -- a reviewed value must
 * never become invisible because presentation did not recognise it.
 */
function timeframeRank(key: string): number {
  const index = (FACTOR_MINING_TIMEFRAMES as readonly string[]).indexOf(key);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * True when a reviewed value is a keyed map rather than a scalar or list. Such
 * a value has no acceptable single-line rendering -- serializing it as JSON is
 * how `{"15m":5,"1h":1,...}` reached the user.
 */
export function isDisplayableMap(
  value: WorkloadJsonValue,
): value is Readonly<Record<string, WorkloadJsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Ordered readable assignments for a keyed reviewed value, e.g.
 * `5m -> 5`, `15m -> 5`, `30m -> 5`, `1h -> 1`.
 *
 * Returns a new array; the input object is not mutated or re-keyed.
 */
export function formatWorkloadMapAssignments(
  value: Readonly<Record<string, WorkloadJsonValue>>,
): readonly WorkloadDisplayAssignment[] {
  return Object.keys(value)
    .sort((left, right) => {
      const delta = timeframeRank(left) - timeframeRank(right);
      return delta !== 0 ? delta : left.localeCompare(right);
    })
    .map(key => ({ key, value: formatWorkloadScalar(value[key]) }));
}

/**
 * Readable text for a scalar reviewed value. `null` renders as an explicit
 * `not set` rather than the literal `null`, because a reviewed absence is a
 * value the user is accepting and must be legible as one.
 */
export function formatWorkloadScalar(value: WorkloadJsonValue): string {
  if (value === null || value === undefined) return 'not set';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(item => formatWorkloadScalar(item)).join(', ');
  if (!isDisplayableMap(value)) return String(value);
  return formatWorkloadMapAssignments(value)
    .map(assignment => `${assignment.key} -> ${assignment.value}`)
    .join('   ');
}
