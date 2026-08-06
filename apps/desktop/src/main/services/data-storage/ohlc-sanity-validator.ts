/**
 * TICKET_1126 F2 -- OHLC bar sanity validation.
 *
 * The single validation predicate for every L1 write path (BYOD import via
 * `data-import-service`, live download / heal via `data-cache-manager`) and
 * the read-time defense gate (F3). One rule set, three consumption forms:
 *
 *   - `StreamingOhlcValidator`: the ONE implementation of the per-bar
 *     rules. Processes rows in timestamp order with a 1-bar lookahead and
 *     a last-VALID-bar baseline; usable over chunked reads so a whole
 *     parquet never has to sit in JS memory.
 *   - `validateOhlcvRows`: array convenience wrapper over the streaming
 *     validator (provider fetch batches, read gates).
 *   - `buildOhlcvViolationScanSql`: the same rules approximated as DuckDB
 *     window functions for the F4 retroactive audit sweep. NOTE: the SQL
 *     form compares each bar to its RAW neighbours (no last-valid baseline
 *     exists in a one-pass window function), so around corrupt bars it
 *     over-flags the immediate successor. That is acceptable for a
 *     DETECTOR (F4); the write-path FILTER always uses the streaming
 *     validator, which is exact.
 *
 * Why the last-VALID baseline matters (incident-verified): in the AUDJPY
 * cross-symbol contamination block, prices flip between the real series
 * (~0.674) and foreign values (0.78 / 1.28 / 105 / 135). With a raw-prev
 * baseline, block-interior bars that agree with their corrupt predecessor
 * pass; with the last-valid baseline, every bar of the block is measured
 * against the last REAL price and the whole block rejects, while the
 * first real bar after the block agrees with the baseline and is kept.
 *
 * Disposition semantics (TICKET_858 -- no silent failures):
 *   - HARD (`reject`): nonpositive/non-finite price, intra-bar
 *     incoherence, scale shift vs the last valid close, double-sided
 *     revert spike. Corruption signatures -- excluded from the write and
 *     recorded as `reject` data-quality events.
 *   - SUSPECT (`suspect`): one-sided inter-bar jumps above the
 *     asset-class threshold that persist (real flash events look like
 *     this). KEPT and recorded + surfaced.
 *
 * All inter-bar predicates are gap-aware: a bar following a session /
 * weekend / halt gap (timestamp delta above
 * `JUMP_GATE_MAX_GAP_INTERVAL_MULTIPLE` x interval) is exempt -- reopen
 * repricing is legitimate.
 */

import type { OHLCVRow } from '../data-providers/types';
import {
  INTER_BAR_JUMP_SUSPECT_THRESHOLD,
  INTRA_BAR_RANGE_SEVERITY,
  JUMP_GATE_MAX_GAP_INTERVAL_MULTIPLE,
  SCALE_SHIFT_MAX_GAP_SECONDS,
  SCALE_SHIFT_MIN_RATIO,
  SCALE_SHIFT_SEVERITY,
  resolveDataQualityAssetClass,
  type DataQualityAssetClass,
  type DataQualityRule,
} from '../../../shared/constants/data-quality';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OhlcBarViolation {
  /** Unix epoch SECONDS of the offending bar. */
  barTs: number;
  rule: DataQualityRule;
  severity: 'reject' | 'suspect';
  original: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
  /** Close of the last VALID bar before this one (the baseline the
   *  inter-bar rules measured against); null when no baseline existed.
   *  Repair tooling uses it to check candidate replacements for
   *  neighbour coherence (TICKET_1126 F1). */
  prevValidClose: number | null;
  message: string;
}

export interface OhlcValidationContext {
  symbol: string;
  interval: string;
  /** Nominal bar length in seconds (gap-awareness denominator). */
  intervalSeconds: number;
  /** Provider id or BYOD assetClass declaration; resolves the jump threshold. */
  providerOrAssetClass: string | null | undefined;
}

export interface OhlcValidationResult {
  /** Input rows minus hard rejects, original order preserved. Empty when
   *  the validator was constructed with `collectAccepted: false`. */
  acceptedRows: OHLCVRow[];
  rejects: OhlcBarViolation[];
  /** Kept in the output; recorded + surfaced, never dropped. */
  suspects: OhlcBarViolation[];
  assetClass: DataQualityAssetClass;
}

// ---------------------------------------------------------------------------
// Per-bar predicates
// ---------------------------------------------------------------------------

function isHardPriceInvalid(r: OHLCVRow): boolean {
  return (
    !Number.isFinite(r.open) || !Number.isFinite(r.high)
    || !Number.isFinite(r.low) || !Number.isFinite(r.close)
    || r.open <= 0 || r.high <= 0 || r.low <= 0 || r.close <= 0
  );
}

function isIntraBarIncoherent(r: OHLCVRow): boolean {
  return r.high < Math.max(r.open, r.close) || r.low > Math.min(r.open, r.close);
}

function violation(
  r: OHLCVRow,
  rule: DataQualityRule,
  severity: 'reject' | 'suspect',
  prevValidClose: number | null,
  message: string,
): OhlcBarViolation {
  return {
    barTs: r.timestamp,
    rule,
    severity,
    original: { open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume },
    prevValidClose,
    message,
  };
}

// ---------------------------------------------------------------------------
// Streaming validator (the single implementation of the rules)
// ---------------------------------------------------------------------------

/**
 * Push rows in ascending-timestamp order via `push()`, then call
 * `finish()`. Holds exactly one bar of lookahead, so it works unchanged
 * over chunked reads of arbitrarily large files.
 */
export class StreamingOhlcValidator {
  private readonly jumpThreshold: number;
  private readonly maxGapSeconds: number;
  private readonly scaleGapSeconds: number;
  private readonly scaleShiftSeverity: 'reject' | 'suspect';
  private readonly intraBarRangeSeverity: 'reject' | 'suspect';
  private readonly collectAccepted: boolean;
  readonly assetClass: DataQualityAssetClass;

  private prevValid: OHLCVRow | null = null;
  /** Bar awaiting its raw successor (revert-spike lookahead). */
  private held: OHLCVRow | null = null;
  private finished = false;

  readonly acceptedRows: OHLCVRow[] = [];
  readonly rejects: OhlcBarViolation[] = [];
  readonly suspects: OhlcBarViolation[] = [];

  constructor(ctx: OhlcValidationContext, opts?: { collectAccepted?: boolean }) {
    this.assetClass = resolveDataQualityAssetClass(ctx.providerOrAssetClass);
    this.jumpThreshold = INTER_BAR_JUMP_SUSPECT_THRESHOLD[this.assetClass];
    this.maxGapSeconds = JUMP_GATE_MAX_GAP_INTERVAL_MULTIPLE * ctx.intervalSeconds;
    // Scale-shift keeps its baseline across far larger data gaps than the
    // jump gate: a 3x-interval gap on a sparse series must not launder a
    // 5x reprice (the AUDJPY / UDXUSD blocks entered through exactly that
    // blind spot). 0 in the table = use the jump-gate window (equities:
    // unadjusted splits are legitimate adjacent scale shifts).
    this.scaleGapSeconds = Math.max(
      this.maxGapSeconds,
      SCALE_SHIFT_MAX_GAP_SECONDS[this.assetClass],
    );
    this.scaleShiftSeverity = SCALE_SHIFT_SEVERITY[this.assetClass];
    this.intraBarRangeSeverity = INTRA_BAR_RANGE_SEVERITY[this.assetClass];
    this.collectAccepted = opts?.collectAccepted ?? true;
  }

  push(row: OHLCVRow): void {
    if (this.finished) {
      throw new Error('StreamingOhlcValidator: push() after finish()');
    }
    if (this.held !== null) {
      this.classify(this.held, row);
    }
    this.held = row;
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.held !== null) {
      this.classify(this.held, null);
      this.held = null;
    }
  }

  /** Classify `r` against the last VALID bar and its raw successor. */
  private classify(r: OHLCVRow, next: OHLCVRow | null): void {
    const prevValidClose = this.prevValid?.close ?? null;
    if (isHardPriceInvalid(r)) {
      this.rejects.push(violation(
        r, 'nonpositive_price', 'reject', prevValidClose,
        `O/H/L/C must be finite and > 0 (got O=${r.open} H=${r.high} L=${r.low} C=${r.close})`,
      ));
      return;
    }
    if (isIntraBarIncoherent(r)) {
      this.rejects.push(violation(
        r, 'intrabar_incoherent', 'reject', prevValidClose,
        `high < max(open, close) or low > min(open, close) ` +
          `(O=${r.open} H=${r.high} L=${r.low} C=${r.close})`,
      ));
      return;
    }
    // Intra-bar range: a single bar spanning an order of magnitude is a
    // corruption signature the neighbour-based gates cannot see when the
    // bar sits after a session gap (TICKET_1126 AUDJPY reopen bars:
    // H=135.21 / L=0.6747 with a sub-5x close ratio).
    if (r.high / r.low >= SCALE_SHIFT_MIN_RATIO) {
      const v = violation(
        r, 'intrabar_range', this.intraBarRangeSeverity, prevValidClose,
        `high/low = ${(r.high / r.low).toFixed(2)} crosses the ` +
          `${SCALE_SHIFT_MIN_RATIO}x intra-bar range boundary ` +
          `(O=${r.open} H=${r.high} L=${r.low} C=${r.close})`,
      );
      if (this.intraBarRangeSeverity === 'reject') {
        this.rejects.push(v);
        return;
      }
      this.suspects.push(v);
    }

    const prevValid = this.prevValid;

    if (prevValid !== null) {
      const delta = r.timestamp - prevValid.timestamp;
      const ratio = r.close / prevValid.close;

      // Scale shift: wide gap window (sparse-series gaps must not launder
      // an order-of-magnitude reprice -- the AUDJPY / UDXUSD blind spot).
      if (
        delta <= this.scaleGapSeconds
        && (ratio >= SCALE_SHIFT_MIN_RATIO || ratio <= 1 / SCALE_SHIFT_MIN_RATIO)
      ) {
        const v = violation(
          r, 'scale_shift', this.scaleShiftSeverity, prevValidClose,
          `close/prev_valid_close = ${ratio.toFixed(4)} crosses the ` +
            `${SCALE_SHIFT_MIN_RATIO}x scale-shift boundary ` +
            `(prev=${prevValid.close}, close=${r.close})`,
        );
        if (this.scaleShiftSeverity === 'reject') {
          this.rejects.push(v);
          return;
        }
        // Equity/default: legitimate split boundary -- keep the bar, it
        // becomes the new baseline; skip the jump gate (already flagged).
        this.suspects.push(v);
        if (this.collectAccepted) this.acceptedRows.push(r);
        this.prevValid = r;
        return;
      }

      const gapOk = delta <= this.maxGapSeconds;
      const jump = Math.abs(ratio - 1);
      if (gapOk && jump > this.jumpThreshold) {
        // Double-sided revert signature: the raw successor agrees with the
        // last valid bar while this bar deviates from both -- a data error
        // sitting between two normal bars.
        const nextGapOk =
          next !== null && next.timestamp - r.timestamp <= this.maxGapSeconds;
        if (
          next !== null && nextGapOk && !isHardPriceInvalid(next)
          && Math.abs(next.close / r.close - 1) > this.jumpThreshold
          && Math.abs(next.close / prevValid.close - 1) <= this.jumpThreshold
        ) {
          this.rejects.push(violation(
            r, 'revert_spike', 'reject', prevValidClose,
            `close deviates ${(jump * 100).toFixed(1)}% from both agreeing ` +
              `neighbours (prev=${prevValid.close}, close=${r.close}, ` +
              `next=${next.close}) -- round-trip data error`,
          ));
          return;
        }

        // One-sided persistent move: legitimate flash events look like
        // this (EURCHF depeg, TRY crisis). Keep + surface.
        this.suspects.push(violation(
          r, 'interbar_jump_suspect', 'suspect', prevValidClose,
          `one-sided ${(jump * 100).toFixed(1)}% close-to-close move ` +
            `exceeds the ${this.assetClass} threshold ` +
            `${(this.jumpThreshold * 100).toFixed(0)}% (kept; review)`,
        ));
      }
    }

    if (this.collectAccepted) this.acceptedRows.push(r);
    this.prevValid = r;
  }
}

/**
 * Validate a timestamp-ascending batch of OHLCV rows. Rows MUST be sorted
 * ascending by timestamp (every write path already guarantees this via
 * dedup/merge); the inter-bar predicates rely on it.
 */
export function validateOhlcvRows(
  rows: ReadonlyArray<OHLCVRow>,
  ctx: OhlcValidationContext,
): OhlcValidationResult {
  const v = new StreamingOhlcValidator(ctx);
  for (const r of rows) v.push(r);
  v.finish();
  return {
    acceptedRows: v.acceptedRows,
    rejects: v.rejects,
    suspects: v.suspects,
    assetClass: v.assetClass,
  };
}

// ---------------------------------------------------------------------------
// DuckDB SQL form (F4 retroactive audit sweep -- detector, not filter)
// ---------------------------------------------------------------------------

/**
 * Compile an approximation of the rules to a DuckDB query over
 * `sourceExpr` (any relation expression: `read_parquet('...')`, an
 * attached table, a `read_csv` projection). Returns only flagged rows:
 *   (timestamp, open, high, low, close, volume, rule, severity)
 * ordered by timestamp.
 *
 * Divergence from the streaming validator (documented above): window
 * functions compare each bar to its RAW neighbours, not the last VALID
 * bar, so the successor of a corrupt bar may be over-flagged and
 * corrupt-BLOCK interiors are under-flagged (interior bars agree with
 * their corrupt raw predecessor). A corrupt block flags at whichever of
 * its boundaries fall within the scale-shift gap window, so a scan
 * returning ZERO rows certifies the store clean of corruption
 * SIGNATURES (AC1) -- but reject COUNTS are boundary counts, not block
 * sizes; the exact per-bar set comes from the streaming form. Inherent
 * limit (both forms): a foreign-instrument block at the HEAD of a series
 * or isolated by gaps wider than the scale-shift window presents no
 * in-band boundary at all and is only detectable against an external
 * reference (the TICKET_1126 UDXUSD DJIA block -- handled by an explicit
 * investigation directive in the repair tooling, not by this predicate).
 */
export function buildOhlcvViolationScanSql(
  sourceExpr: string,
  ctx: { intervalSeconds: number; providerOrAssetClass: string | null | undefined },
): string {
  const assetClass = resolveDataQualityAssetClass(ctx.providerOrAssetClass);
  const jump = INTER_BAR_JUMP_SUSPECT_THRESHOLD[assetClass];
  const maxGap = JUMP_GATE_MAX_GAP_INTERVAL_MULTIPLE * ctx.intervalSeconds;
  const scale = SCALE_SHIFT_MIN_RATIO;
  const scaleGap = Math.max(maxGap, SCALE_SHIFT_MAX_GAP_SECONDS[assetClass]);
  const scaleIsReject = SCALE_SHIFT_SEVERITY[assetClass] === 'reject';
  const rangeIsReject = INTRA_BAR_RANGE_SEVERITY[assetClass] === 'reject';

  return `
WITH bars AS (
  SELECT timestamp, open, high, low, close, volume,
         lag(close)  OVER w AS prev_close,
         lag(timestamp) OVER w AS prev_ts,
         lead(close) OVER w AS next_close,
         lead(timestamp) OVER w AS next_ts
  FROM ${sourceExpr}
  WINDOW w AS (ORDER BY timestamp)
), flagged AS (
  SELECT *,
    CASE
      WHEN NOT (isfinite(open) AND isfinite(high) AND isfinite(low) AND isfinite(close))
        OR open <= 0 OR high <= 0 OR low <= 0 OR close <= 0
        THEN 'nonpositive_price'
      WHEN high < greatest(open, close) OR low > least(open, close)
        THEN 'intrabar_incoherent'
      WHEN ${rangeIsReject ? 'TRUE' : 'FALSE'}
        AND low > 0 AND high / low >= ${scale}
        THEN 'intrabar_range'
      WHEN ${scaleIsReject ? 'TRUE' : 'FALSE'}
        AND prev_close IS NOT NULL AND prev_close > 0
        AND (timestamp - prev_ts) <= ${scaleGap}
        AND (close / prev_close >= ${scale} OR close / prev_close <= 1.0 / ${scale})
        THEN 'scale_shift'
      WHEN prev_close IS NOT NULL AND prev_close > 0
        AND next_close IS NOT NULL AND next_close > 0
        AND (timestamp - prev_ts) <= ${maxGap}
        AND (next_ts - timestamp) <= ${maxGap}
        AND abs(close / prev_close - 1) > ${jump}
        AND abs(next_close / close - 1) > ${jump}
        AND abs(next_close / prev_close - 1) <= ${jump}
        THEN 'revert_spike'
      ELSE NULL
    END AS hard_rule,
    CASE
      WHEN ${rangeIsReject ? 'FALSE' : 'TRUE'}
        AND low > 0 AND high / low >= ${scale}
        THEN 'intrabar_range'
      WHEN ${scaleIsReject ? 'FALSE' : 'TRUE'}
        AND prev_close IS NOT NULL AND prev_close > 0
        AND close > 0 AND isfinite(close)
        AND (timestamp - prev_ts) <= ${scaleGap}
        AND (close / prev_close >= ${scale} OR close / prev_close <= 1.0 / ${scale})
        THEN 'scale_shift'
      WHEN prev_close IS NOT NULL AND prev_close > 0
        AND close > 0 AND isfinite(close)
        AND (timestamp - prev_ts) <= ${maxGap}
        AND abs(close / prev_close - 1) > ${jump}
        THEN 'interbar_jump_suspect'
      ELSE NULL
    END AS jump_rule
  FROM bars
)
SELECT timestamp, open, high, low, close, volume,
       COALESCE(hard_rule, jump_rule) AS rule,
       CASE WHEN hard_rule IS NOT NULL THEN 'reject' ELSE 'suspect' END AS severity
FROM flagged
WHERE hard_rule IS NOT NULL OR jump_rule IS NOT NULL
ORDER BY timestamp`;
}
