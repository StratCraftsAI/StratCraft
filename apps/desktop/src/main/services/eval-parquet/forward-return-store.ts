/**
 * forward-return-store.ts -- TICKET_863_0_2.
 *
 * Persistence layer for the per-bar realized forward-return series
 * r[t+H] aligned to the canonical score series `s[t]` produced by the
 * `factor_eval` C++ plugin. One row per `(signal_id, ts)`; writes are
 * immutable (Strategy A) so L2 IC/IR can join `signal_canonical_score`
 * with `signal_forward_return` on `(signal_id, ts)` and get a stable
 * `(s[t], r[t+H])` pair series.
 *
 * Alignment contract (do NOT change without re-reading TICKET_863_0_2):
 *   - `ts` is the timestamp of the bar that PRODUCED the prediction
 *     `s[t]`. `r_next` is the realized return measured from close[t] to
 *     close[t + horizon_bars]. The realized return is OBSERVED at
 *     `t + horizon_bars` but ATTRIBUTED to `t` so the IC reduction is
 *     `corr(s[t], r[t+H])` without re-deriving the offset.
 *   - The last `horizon_bars` rows of every series are OMITTED here
 *     because the forward window is unavailable. They are NEVER stored
 *     with a shifted value -- a missing tail row is a missing tail row.
 *     L2 callers see `NULL` from the LEFT JOIN, which the metric code
 *     filters out explicitly.
 *
 * Strict layering: this file does NOT know about discovery state, the
 * factor envelope, or UI events. Its only job is "given (signal_id,
 * rows), persist them immutably and answer point queries".
 */

import { writeEvalParquet } from './eval-parquet-writer';
import {
  readCoverage as readEvalCoverage,
  readForwardReturnPairs as readEvalForwardReturnPairs,
} from './eval-parquet-reader';

// ----- Public types ----------------------------------------------------

/**
 * One realized-forward-return observation aligned to the canonical
 * score series. `timestamp` MUST equal the `timestamp` of the
 * corresponding `CanonicalScoreRow` index-for-index -- no off-by-one,
 * no shift.
 */
export interface ForwardReturnRow {
  /** Bar close of the prediction bar `t`, milliseconds since epoch, UTC. */
  timestamp: number;
  /** Realized forward return r[t+H] = (close[t+H] - close[t]) / close[t]. */
  rNext: number;
  /** Horizon H in bars used to compute `rNext`. Per-row so heterogeneous
   *  horizons across signals stay self-describing. */
  horizonBars: number;
}

/**
 * Forward-return row tagged with its symbol partition key. Same protocol
 * fix as {@link import('./canonical-store').CanonicalScoreRowWithSymbol}:
 * one writer call per `(signal_id, run_id)` carries every symbol's
 * realized-return series, because the parquet partition's atomic-replace
 * granularity is `(signal_id, run_id)` not `(signal_id, run_id, symbol)`.
 */
export interface ForwardReturnRowWithSymbol extends ForwardReturnRow {
  /**
   * TICKET_196_7_5_3_1 (v75) partition key. Universe-mode rows carry
   * the manifest symbol; single-symbol arms tag with `''`.
   */
  symbol: string;
  /**
   * TICKET_1133: walk-forward path index (fold) that produced this row.
   * Optional -- producers without per-fold substrate (single-symbol
   * arms, factor paths) omit it and the parquet column stays null.
   */
  pathIndex?: number | null;
}

export interface WriteForwardReturnsInput {
  /** `nona_signal.id`. Same key space as `signal_canonical_score`. */
  signalId: number;
  /**
   * TICKET_947_1: `signal_run.id` of the run that produced these rows.
   * Required for the same reason as
   * {@link import('./canonical-store').WriteCanonicalScoresInput.runId}.
   */
  runId: number;
  /**
   * All rows for this `(signal_id, run_id)` partition across every
   * symbol. Per TICKET_947_1, callers MUST batch all symbols in one
   * call -- the writer's atomic-replace semantics are
   * `(signal_id, run_id)`-scoped.
   */
  rows: ForwardReturnRowWithSymbol[];
}

export interface WriteForwardReturnsResult {
  /** Rows newly inserted (not previously present for this signal/ts). */
  inserted: number;
  /** Rows skipped because `(signal_id, ts)` already existed. */
  skipped: number;
}

// ----- Validation ------------------------------------------------------

function assertValidRow(row: ForwardReturnRowWithSymbol, idx: number): void {
  if (typeof row.symbol !== 'string') {
    throw new Error(
      `[forward-return-store] row[${idx}].symbol must be a string ` +
      `('' for single-symbol arms, manifest symbol for universe arms); ` +
      `got ${row.symbol === null ? 'null' : typeof row.symbol}`,
    );
  }
  if (!Number.isFinite(row.timestamp) || !Number.isInteger(row.timestamp)) {
    throw new Error(
      `[forward-return-store] row[${idx}].timestamp must be an integer ms; ` +
      `got ${row.timestamp}`,
    );
  }
  if (!Number.isFinite(row.rNext)) {
    throw new Error(
      `[forward-return-store] row[${idx}].rNext must be a finite number; ` +
      `got ${row.rNext}`,
    );
  }
  if (!Number.isInteger(row.horizonBars) || row.horizonBars <= 0) {
    throw new Error(
      `[forward-return-store] row[${idx}].horizonBars must be a positive ` +
      `integer; got ${row.horizonBars}`,
    );
  }
}

// ----- Write path ------------------------------------------------------

/**
 * Insert forward-return rows for one signal under Strategy A semantics.
 * Second-write for an existing `(signal_id, ts)` is a silent no-op so
 * reruns are idempotent and the L2 join sees a stable series.
 */
export async function writeForwardReturns(
  input: WriteForwardReturnsInput,
): Promise<WriteForwardReturnsResult> {
  if (!Number.isInteger(input.signalId) || input.signalId <= 0) {
    throw new Error(
      `[forward-return-store] writeForwardReturns: signalId must be a ` +
      `positive integer; got ${input.signalId}`,
    );
  }
  if (!Number.isInteger(input.runId) || input.runId <= 0) {
    // TICKET_947_1 / TICKET_857.
    throw new Error(
      `[forward-return-store] writeForwardReturns: runId must be a ` +
      `positive integer; got ${input.runId}. Eval matrices require a ` +
      `signal_run anchor (TICKET_947_1).`,
    );
  }

  const rows = input.rows;
  if (rows.length === 0) {
    return { inserted: 0, skipped: 0 };
  }

  for (let i = 0; i < rows.length; i++) {
    assertValidRow(rows[i], i);
  }

  // TICKET_947_3: parquet is the SOLE substrate; SQLite dual-write
  // removed and table dropped by migration v96. Single call per
  // `(signal_id, run_id)` carries every symbol's rows -- the writer
  // atomically replaces the partition. See canonical-store.ts for the
  // matching idempotency-contract discussion (Strategy A -> writer-
  // replace per fresh signal_run.id).
  const createdAt = Date.now();
  await writeEvalParquet({
    table: 'forward_return',
    signalId: input.signalId,
    runId: input.runId,
    createdAtMs: createdAt,
    rows: rows.map((r) => ({
      symbol: r.symbol,
      ts: r.timestamp,
      rNext: r.rNext,
      horizonBars: r.horizonBars,
      pathIndex: r.pathIndex ?? null,
    })),
  });

  return { inserted: rows.length, skipped: 0 };
}

// ----- Read paths ------------------------------------------------------

/**
 * Aligned `(signal_value, forward_return)` pair for one bar. Returned by
 * `getSignalForwardReturnPairs`. L2 IC reduces over these directly.
 */
export interface SignalForwardReturnPair {
  timestamp: number;
  /**
   * TICKET_196_10_4: the cross-section partition key for this observation.
   * `signal_canonical_score` has PK `(signal_id, symbol, ts)`
   * (TICKET_196_7_5_3_1 v75), so a multi-symbol universe arm has one row per
   * symbol at each `ts`. Surfacing `symbol` here lets the L2 IC gate group by
   * `(ts)` cross-section and compute the canonical cross-sectional rank-IC --
   * instead of pooling every (symbol x time) pair into one diluted-toward-zero
   * correlation. Single-symbol arms write `symbol=''` (canonical-store.ts),
   * which is a valid stable group key the gate reads as "single-symbol".
   */
  symbol: string;
  signalValue: number;
  signalConfidence: number;
  rNext: number;
  horizonBars: number;
}

// TICKET_1058 Phase 3: columnar typed-array representation for large universes.
// 33M JS objects = ~6.5 GB; the same data in typed arrays = ~1.1 GB.
export interface SignalPairColumns {
  length: number;
  timestamps: Float64Array;
  symbols: string[];
  signalValues: Float64Array;
  signalConfidences: Float64Array;
  rNexts: Float64Array;
  horizonBars: number;
  /**
   * TICKET_1133: per-row walk-forward path index (fold attribution),
   * parallel to `timestamps`. `null` / absent on substrates that
   * predate per-fold persistence and on producers without folds. The
   * L2/L3 funnel groups observations by this array -- fold attribution
   * by ts-window slicing is wrong for pooled multi-calendar universes.
   */
  pathIndices?: Int32Array | null;
}

// TICKET_1102: chunked columnar representation for 80M+ row universes
// (e.g. 66 forex symbols x 26 years x 5m = ~83M rows). Allocating 4
// Float64Arrays of 83M elements = 2.65 GB exceeds V8 heap. Instead,
// store one SignalPairColumns per symbol -- each chunk is ~1-2M rows
// (~64 MB), well within limits. All iteration helpers walk chunks
// sequentially so consumers see no difference.
export interface SignalPairChunked {
  chunked: true;
  chunks: SignalPairColumns[];
  length: number;
  horizonBars: number;
}

// TICKET_1106: lightweight reference to pairs spilled to eval-cache disk.
// Preserves `length` for logging/counting but holds zero typed-array data.
// Iterating a spilled ref throws — callers must rehydrate before use.
export interface SpilledPairsRef {
  spilled: true;
  signalId: number;
  cacheKey: string;
  length: number;
  horizonBars: number;
  /** TICKET_1244 D5 P3-S1: per-signal data identity from the CAS manifest.
   *  SHA-256 of the sorted symKey list — changes when any symbol's L1 data
   *  is repaired or re-imported. Used by derived caches (fusion output,
   *  cross-TF alignment) so they invalidate correctly after L1 repair. */
  dataStateToken?: string;
  /** TICKET_1244 D5 P3-S1: resolved absolute paths of sym-file parquets
   *  from the manifest. Passed to C++ fusion as explicit `part_files` so
   *  the plugin does not need to glob the directory. */
  partFiles?: string[];
}

export type SignalPairData =
  | SignalForwardReturnPair[]
  | SignalPairColumns
  | SignalPairChunked
  | SpilledPairsRef;

export function isSpilled(data: SignalPairData): data is SpilledPairsRef {
  return !Array.isArray(data) && 'spilled' in data;
}

export function isColumnar(data: SignalPairData): data is SignalPairColumns {
  return !Array.isArray(data) && 'timestamps' in data && !('chunked' in data);
}

export function isChunked(data: SignalPairData): data is SignalPairChunked {
  return !Array.isArray(data) && 'chunked' in data && !('spilled' in data);
}

export function pairDataLength(data: SignalPairData): number {
  if (isSpilled(data)) return data.length;
  if (isChunked(data)) return data.length;
  return isColumnar(data) ? data.length : data.length;
}

export function countPairs(
  data: SignalPairData,
  predicate: (signalValue: number) => boolean,
): number {
  if (isSpilled(data)) {
    throw new Error(
      `countPairs called on spilled pairs (signal ${data.signalId}). ` +
      `Call rehydrateSpilledPairs() first (TICKET_1106).`,
    );
  }
  let count = 0;
  if (isChunked(data)) {
    for (const chunk of data.chunks) {
      const sv = chunk.signalValues;
      for (let i = 0; i < chunk.length; i++) {
        if (predicate(sv[i])) count++;
      }
    }
  } else if (isColumnar(data)) {
    const sv = data.signalValues;
    for (let i = 0; i < data.length; i++) {
      if (predicate(sv[i])) count++;
    }
  } else {
    for (const p of data) {
      if (predicate(p.signalValue)) count++;
    }
  }
  return count;
}

export function forEachPair(
  data: SignalPairData,
  fn: (timestamp: number, symbol: string, signalValue: number, signalConfidence: number, rNext: number, horizonBars: number) => void,
): void {
  if (isSpilled(data)) {
    throw new Error(
      `forEachPair called on spilled pairs (signal ${data.signalId}). ` +
      `Call rehydrateSpilledPairs() first (TICKET_1106).`,
    );
  }
  if (isChunked(data)) {
    for (const chunk of data.chunks) {
      const { timestamps, symbols, signalValues, signalConfidences, rNexts, horizonBars } = chunk;
      for (let i = 0; i < chunk.length; i++) {
        fn(timestamps[i], symbols[i], signalValues[i], signalConfidences[i], rNexts[i], horizonBars);
      }
    }
  } else if (isColumnar(data)) {
    const { timestamps, symbols, signalValues, signalConfidences, rNexts, horizonBars } = data;
    for (let i = 0; i < data.length; i++) {
      fn(timestamps[i], symbols[i], signalValues[i], signalConfidences[i], rNexts[i], horizonBars);
    }
  } else {
    for (const p of data) {
      fn(p.timestamp, p.symbol, p.signalValue, p.signalConfidence, p.rNext, p.horizonBars);
    }
  }
}

/**
 * TICKET_863_0_2 acceptance API: return aligned (s[t], r[t+H]) pairs for
 * one signal, optionally bounded by an inclusive [start, end] timestamp
 * range. Uses INNER JOIN so the trailing `horizon_bars` rows (where
 * r[t+H] is unavailable) and any pre-existing canonical bars without a
 * persisted forward return are EXCLUDED -- the caller never has to
 * filter `NULL` and never has to guess whether a missing pair is "out of
 * universe" vs "boundary bar".
 *
 * Namespace: `signalId` here is `nona_signal.id` (algorithm id) -- same
 * key the writer (`writeForwardReturns`) uses and the same key the
 * on-disk parquet directory token `signal_id=<id>/` carries. The
 * directory literal `signal_id` is historic naming; the *value* is
 * `nona_signal.id`. NOT `nona_signal_definition.id` -- see
 * TICKET_970_7 for the catalog-side bug this disambiguation prevents.
 */
export async function getSignalForwardReturnPairs(
  signalId: number,
  range?: { start?: number; end?: number },
): Promise<SignalForwardReturnPair[]> {
  if (!Number.isInteger(signalId) || signalId <= 0) {
    throw new Error(
      `[forward-return-store] getSignalForwardReturnPairs: signalId must ` +
      `be a positive integer; got ${signalId}`,
    );
  }

  // TICKET_1292_07: the C++ owner reads the two projected partitions and
  // preserves TICKET_196_10_4's `(signal_id, symbol, ts)` join key. The
  // layout already partitions by signal_id, so symbol alignment prevents
  // the K x K cartesian explosion fixed by the earlier SQLite migration.
  const rows = await readEvalForwardReturnPairs(signalId, {
    start: range?.start,
    end: range?.end,
  });

  return rows.map((r) => ({
    timestamp: r.ts,
    symbol: r.symbol,
    signalValue: r.signalValue,
    signalConfidence: r.signalConfidence,
    rNext: r.rNext,
    horizonBars: r.horizonBars,
  }));
}

/**
 * Aggregate forward-return coverage for one signal: MIN/MAX/COUNT over
 * the persisted rows. Mirrors `getCanonicalCoverage` in shape so the
 * orchestrator can surface an honest "forward returns persisted for
 * N bars" status alongside the canonical coverage.
 *
 * Namespace: see `getSignalForwardReturnPairs` -- `signalId` is
 * `nona_signal.id` (algorithm id), NOT `nona_signal_definition.id`.
 * TICKET_970_7.
 */
export interface ForwardReturnCoverage {
  start: number;
  end: number;
  barCount: number;
}

export async function getForwardReturnCoverage(
  signalId: number,
): Promise<ForwardReturnCoverage | null> {
  if (!Number.isInteger(signalId) || signalId <= 0) {
    throw new Error(
      `[forward-return-store] getForwardReturnCoverage: signalId must be ` +
      `a positive integer; got ${signalId}`,
    );
  }
  // TICKET_1292_07: footer and row-group statistics served by C++. See
  // canonical-store.getCanonicalCoverage for the matching docstring.
  const result = await readEvalCoverage('forward_return', signalId);
  if (result === null) return null;
  return {
    start: result.start,
    end: result.end,
    barCount: result.barCount,
  };
}
