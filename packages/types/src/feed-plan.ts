/**
 * FeedPlan / FeedSpec (TICKET_1225 P0, design doc Section 2.2)
 *
 * The single source of truth for a backtest's data feeds. Computed once by
 * the code generator (main process); the generated C++, the runner
 * config.json, and the data-ensure step all consume this one plan. The
 * renderer passes it through opaquely and never constructs or edits it.
 *
 * Serialization note (frozen at end of P0): the runner config.json carries
 * the plan as a flat `feeds[]` array where `source` is flattened to a
 * discriminator string plus its payload field:
 *
 *   "feeds": [
 *     { "index": 0, "interval": "1h", "role": "execution",
 *       "source": "parquet", "dataPath": "/abs/path/EURAUD_1h.parquet" },
 *     { "index": 1, "interval": "1M", "role": "context",
 *       "source": "resample", "base": "1h" }
 *   ]
 *
 * The flattening happens in executor-service.ts (P4); the C++ runner parses
 * that shape (P2). This module is the TS type contract both build against.
 */

import type { BarInterval } from './index';

/** Where a feed's bars come from. */
export type FeedSource =
  /** Provider-native timeframe, read from a parquet file on disk. */
  | { readonly kind: 'parquet'; readonly dataPath: string }
  /**
   * Derived timeframe (e.g. 1w/1M, or 2h where the provider lacks it),
   * resampled in-engine from the finest provider-native feed in the plan.
   */
  | { readonly kind: 'resample'; readonly base: BarInterval };

/** One data feed in the plan; `index` is the data(N) index baked into the generated C++. */
export interface FeedSpec {
  readonly index: number;
  /** Canonical vocabulary token (case-sensitive: '1m' minute, '1M' month). */
  readonly interval: BarInterval;
  /** feeds[0] is the execution feed (master clock); all others are context. */
  readonly role: 'execution' | 'context';
  readonly source: FeedSource;
}

/**
 * The full plan. Invariants (enforced by the P3 plan builder and the P2
 * runner validation, not by consumers):
 * - `feeds[0].role === 'execution'` and it is strictly the finest interval;
 * - context feeds are sorted coarsest-last and deduplicated by interval;
 * - `executionInterval === feeds[0].interval`.
 */
export interface FeedPlan {
  readonly feeds: readonly FeedSpec[];
  readonly executionInterval: BarInterval;
}
