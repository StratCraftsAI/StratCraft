/**
 * Trading Constants
 *
 * TICKET_179: Unified Constants Management
 *
 * All trading-related constants: execution parameters, checkpoint settings.
 */

// =============================================================================
// Execution Parameters
// =============================================================================

/** Default initial capital for backtesting */
export const DEFAULT_INITIAL_CAPITAL = 100000.0;

/** Default commission rate (0.1%) */
export const DEFAULT_COMMISSION_RATE = 0.001;

/** Default slippage rate (0.05%) */
export const DEFAULT_SLIPPAGE_RATE = 0.0005;

/** Default maximum position size as fraction of capital */
export const DEFAULT_MAX_POSITION_SIZE = 1.0;

/** TICKET_1130: Default sizer type for C++ runner ('percent' | 'fixed' | 'allin') */
export const DEFAULT_SIZER_TYPE = 'percent' as const;

/** TICKET_1130: Default sizer param (100% of capital, divided by symbol_count in runner) */
export const DEFAULT_SIZER_PARAM = 100.0;

/** TICKET_1130 Phase 2: confidence-weighted sizing (off by default) */
export const DEFAULT_CONFIDENCE_WEIGHTED_SIZING = false;

// =============================================================================
// Per-Symbol Volatility (TICKET_1131)
// =============================================================================

/** TICKET_1131: lookback window for per-symbol trailing vol (bars). */
export const DEFAULT_VOL_LOOKBACK_BARS = 21;

/** TICKET_1131: vol floor for inverse-vol weighting -- prevents near-zero
 *  vol symbols from producing unbounded weights via score/vol. */
export const MIN_SYMBOL_VOL_FLOOR = 0.001;

// =============================================================================
// Per-Stock Cost Model (TICKET_880_3_5 / TICKET_1129_2)
// =============================================================================

/** TICKET_1129_2: minimum average volume for per-stock cost inclusion.
 *  The 3/2-power impact law uses 1/sqrt(V), which explodes for synthetic
 *  or near-zero volume (OTC forex tick counts, placeholder volume fields).
 *  Symbols below this floor fall back to uniform costPerTurnover, which is
 *  the correct behaviour -- the per-stock model requires genuine exchange
 *  volume to produce meaningful estimates. */
export const MIN_AVG_VOLUME_FOR_PER_STOCK_COST = 100;

// =============================================================================
// Checkpoint Parameters
// =============================================================================

/** Save checkpoint every N bars */
export const CHECKPOINT_DEFAULT_INTERVAL = 500;

/** Keep N most recent checkpoints */
export const CHECKPOINT_DEFAULT_MAX_COUNT = 5;

/** Replay N bars for indicator warmup on resume */
export const CHECKPOINT_DEFAULT_WARMUP_PERIOD = 50;

// =============================================================================
// Query Limits
// =============================================================================

/** Default audit log max entries */
export const DEFAULT_AUDIT_LOG_MAX_ENTRIES = 100;

/** Default ticks max count */
export const DEFAULT_TICKS_MAX_COUNT = 100;
