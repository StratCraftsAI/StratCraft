/**
 * TICKET_1126 -- OHLC data-quality constants (TICKET_179: no magic numbers).
 *
 * Shared by the ingest-time validation gate (F2: data-import-service +
 * data-cache-manager write paths), the read-time defense gate (F3:
 * parquet-cache-service), the retroactive audit sweep (F4), and the repair
 * tooling (F1). One source of truth so the import gate, the download gate,
 * and the audit predicate can never drift apart.
 */

// ---------------------------------------------------------------------------
// Asset-class jump thresholds
// ---------------------------------------------------------------------------

/**
 * Asset classes recognised by the inter-bar jump gate. `default` is the
 * conservative fallback used when the write path cannot resolve a class
 * (generic BYOD imports without an assetClass declaration).
 */
export type DataQualityAssetClass = 'forex' | 'equity' | 'crypto' | 'default';

/**
 * Max legitimate |close/prev_close - 1| per asset class before a bar is
 * flagged as a statistical suspect. Chosen ABOVE real historical flash
 * events so genuine market moves pass:
 *   - forex: EURCHF 2015-01-15 depeg ~-17%, TRY overnight crisis moves
 *     ~15-18% -> threshold 20% passes them (they are one-sided and persist).
 *   - equity/crypto: single-name crashes and crypto flash wicks can exceed
 *     30% -> threshold 50%.
 * A threshold breach alone NEVER rejects a bar -- it records a `suspect`
 * data-quality event and keeps the data (flag-and-surface, TICKET_858).
 * Rejection requires a corruption SIGNATURE (see below).
 */
export const INTER_BAR_JUMP_SUSPECT_THRESHOLD: Record<DataQualityAssetClass, number> = {
  forex: 0.2,
  equity: 0.5,
  crypto: 0.5,
  default: 0.5,
};

/**
 * Corruption signature 1 -- scale shift: |close/prev_close| ratio at or
 * beyond this factor (or at or below its reciprocal) is an
 * order-of-magnitude scale break (mis-denominated segment, foreign
 * instrument block boundary, year-value leaked into a price column). No
 * real market moves 5x close-to-close in one bar in any asset class this
 * app trades. Hard reject.
 */
export const SCALE_SHIFT_MIN_RATIO = 5;

/**
 * Corruption signature 2 -- round-trip revert spike: a bar whose close
 * deviates from BOTH neighbours beyond the asset-class jump threshold while
 * the two neighbours agree with each other (|next_close/prev_close - 1|
 * within the threshold). A data error sits between two normal bars
 * (EURUSD 1965.0001 between 0.8485 and 0.8486); a real move is one-sided
 * and persists. Hard reject.
 */
export const REVERT_SPIKE_NEIGHBOUR_AGREEMENT_FACTOR = 1;

/**
 * Gap-awareness: the inter-bar jump gate only compares a bar to its
 * predecessor when the timestamp delta is at most this multiple of the
 * nominal interval. A session close / weekend / halt gap (delta above the
 * multiple) legitimately reprices, so the reopen bar is exempt from the
 * jump predicate entirely.
 */
export const JUMP_GATE_MAX_GAP_INTERVAL_MULTIPLE = 3;

/**
 * The SCALE-SHIFT check uses a much wider gap window than the jump gate:
 * a 3x-interval data gap on a sparse series (1m bars of a pegged pair, a
 * quiet 2005 cross) must NOT reset the baseline -- that blind spot let
 * the AUDJPY cross-symbol block and the UDXUSD foreign-instrument block
 * enter unflagged. No real forex/crypto reprice crosses 5x over ANY gap
 * measured in days (largest real reopen gaps: weekend ~48h + holidays).
 * `0` = fall back to the jump-gate window (used for equities, where an
 * unadjusted split IS a legitimate adjacent-bar scale shift).
 */
export const SCALE_SHIFT_MAX_GAP_SECONDS: Record<DataQualityAssetClass, number> = {
  forex: 7 * 86_400,
  crypto: 86_400,
  equity: 0,
  default: 0,
};

/**
 * Scale-shift disposition per asset class. Forex/crypto: a >= 5x
 * close-to-close ratio is always corruption -> reject. Equity/default:
 * unadjusted split boundaries are legitimate scale shifts -> suspect
 * (flag-and-surface, keep the data).
 */
export const SCALE_SHIFT_SEVERITY: Record<DataQualityAssetClass, 'reject' | 'suspect'> = {
  forex: 'reject',
  crypto: 'reject',
  equity: 'suspect',
  default: 'suspect',
};

/**
 * Intra-bar RANGE disposition per asset class: a single bar whose
 * high/low ratio crosses SCALE_SHIFT_MIN_RATIO. Incident-verified gap
 * (TICKET_1126): the AUDJPY contamination block's weekend-reopen bars
 * (O=135.18 H=135.21 L=0.6747 C=105.1) satisfy H >= max(O,C) and
 * L <= min(O,C), are exempt from the inter-bar gates by the session gap,
 * and their close ratio vs the prior week stays under 5x -- yet a 200x
 * intra-bar span is impossible for a forex pair (largest real intra-bar
 * move on record: CHF depeg 2015, ~30%). Forex: reject. Crypto: SUSPECT,
 * not reject -- altcoin flash crashes genuinely print >5x intra-bar wicks
 * (2025-10-10 market-wide crash: JUP/INJ/AVAX 5m bars). Equity/default:
 * suspect (halted penny stocks / split artifacts).
 */
export const INTRA_BAR_RANGE_SEVERITY: Record<DataQualityAssetClass, 'reject' | 'suspect'> = {
  forex: 'reject',
  crypto: 'suspect',
  equity: 'suspect',
  default: 'suspect',
};

// ---------------------------------------------------------------------------
// Engine-side (replay) input sanity
// ---------------------------------------------------------------------------

/**
 * TICKET_1126 F3: max |per-bar forward return| the replay engine accepts
 * from a fused cross-section entry. Anything at or above this is corrupt
 * input (the incident's corrupt bars produced r_next of -506x / +4.23 /
 * -0.996), not a market move; the entry is skipped with per-symbol skip
 * semantics (TICKET_1048) and the skip is counted + surfaced on the book.
 */
export const ENGINE_MAX_ABS_BAR_RETURN = 0.5;

/**
 * Cap on the number of skipped-entry examples carried on the book result
 * (full count is always reported; examples are for diagnosis).
 */
export const ENGINE_INSANE_INPUT_EXAMPLE_CAP = 20;

// ---------------------------------------------------------------------------
// Data-quality event taxonomy (migration v112 `data_quality_event`)
// ---------------------------------------------------------------------------

export const DQ_SEVERITIES = ['reject', 'suspect', 'repair', 'delete'] as const;
export type DataQualitySeverity = (typeof DQ_SEVERITIES)[number];

export const DQ_RULES = [
  /** O/H/L/C is <= 0 or non-finite. Hard invariant. */
  'nonpositive_price',
  /** high < max(open, close) or low > min(open, close). Hard invariant. */
  'intrabar_incoherent',
  /** high/low ratio >= SCALE_SHIFT_MIN_RATIO within ONE bar. */
  'intrabar_range',
  /** close/prev_close ratio >= SCALE_SHIFT_MIN_RATIO (or <= 1/ratio). */
  'scale_shift',
  /** Double-sided revert spike (deviates from both agreeing neighbours). */
  'revert_spike',
  /** One-sided jump above the asset-class threshold; kept + surfaced. */
  'interbar_jump_suspect',
  /** F1 repair disposition: bar replaced from an independent clean source. */
  'refetch_replace',
  /** F1 repair disposition: bar rebuilt from a verified-clean finer TF. */
  'finer_tf_resample',
  /** F1 repair disposition: bar removed, window marked missing (never fabricated). */
  'delete_marked_missing',
  /** File-level summary event (e.g. detail-cap overflow); bar_ts is NULL. */
  'validation_summary',
] as const;
export type DataQualityRule = (typeof DQ_RULES)[number];

/**
 * Cap on per-bar detail rows recorded to `data_quality_event` from a single
 * validation pass. A pass exceeding the cap records the capped detail rows
 * plus ONE file-level summary event carrying the total count (bar_ts NULL) --
 * the overflow is surfaced, never silently truncated (TICKET_858).
 */
export const DQ_EVENT_DETAIL_CAP = 5000;

/**
 * DDL for the quarantine/audit ledger. Single source shared by migration
 * v112 and the headless F1/F4 tooling (which must be able to record audit
 * events before the app has run the migration) -- TICKET_854.
 *
 * TICKET_1289_1 F1: the string now lives in @StratCraft/db-migrations (the v112
 * migration body moved there, and the standalone MCP -- a separate package --
 * needs it too). Re-exported here so every app-side importer keeps its path.
 */
export { DATA_QUALITY_EVENT_TABLE_DDL } from '@StratCraft/db-migrations';

// ---------------------------------------------------------------------------
// Provider -> asset class resolution
// ---------------------------------------------------------------------------

/**
 * Map a provider id / BYOD package asset-class declaration to the jump-gate
 * asset class. BYOD packages carry an explicit `assetClass` (TICKET_1095,
 * defaults to 'forex'); live providers are classified by id. Unknown
 * providers fall back to the conservative `default` thresholds.
 */
export function resolveDataQualityAssetClass(
  providerIdOrAssetClass: string | null | undefined,
): DataQualityAssetClass {
  switch ((providerIdOrAssetClass ?? '').toLowerCase()) {
    case 'forex':
    case 'dukascopy':
      return 'forex';
    case 'crypto':
    case 'ccxt':
      return 'crypto';
    case 'equity':
    case 'stock':
    case 'etf':
    case 'yfinance':
    case 'alpaca':
    case 'databento':
    case 'akshare':
    case 'tushare':
    case 'baostock':
      return 'equity';
    default:
      return 'default';
  }
}
