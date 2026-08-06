/**
 * TICKET_927_1_4_B -- per-bucket regime gating types.
 *
 * Tier-0 promotion: `RegimeAdjustment` / `RegimeBarState` move here from
 * `factor-portfolio-backtest.ts` so the handler and replay share one import
 * path. `PerBucketRegimeAdjustment` encodes the per-market axis: each bucket
 * carries its own `RegimeAdjustment` sourced from its own HMM signal; a
 * market absent from the map is un-gated (explicit opt-out, not a silent gap).
 *
 * The state indices are NOT comparable across MarketIds; each
 * `RegimeAdjustment` is sourced from its own HMM signal
 * (`regimeSignalId` in the handler request). No cross-bucket
 * synchronisation, no joint-regime reconciliation.
 */

import type { MarketId } from './market-id';

export interface RegimeBarState {
  state: number;
  posterior: number;
}

export interface RegimeAdjustment {
  regimeMap: Map<number, RegimeBarState>;
  allowedRegimes: ReadonlySet<number>;
  minPosterior?: number;
}

/**
 * TICKET_927_1_4_B: per-bucket regime gating map.
 *
 * Key = the `MarketId` of the bucket the gate applies to.
 * A market absent from the map = "no regime gating in that bucket"
 * (explicit opt-out, not a silent gap -- TICKET_858).
 */
export type PerBucketRegimeAdjustment = ReadonlyMap<MarketId, RegimeAdjustment>;
