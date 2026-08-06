/**
 * canonical-store.ts -- TICKET_827 (Medallion Step 1.5).
 *
 * Persistence layer for the canonical per-bar score series defined by
 * TICKET_822 (`SignalOutputRow` = {timestamp, score, confidence}). One row
 * per (signal_id, ts); writes are immutable -- second-write for an existing
 * key is a silent no-op (Strategy A) so the behavioral fingerprint
 * (TICKET_823) sees a stable input series.
 *
 * This module only owns the DB-facing contract. The orchestrator
 * (`discovery-orchestrator.ts`) drives:
 *   1. coverage check (`getCanonicalCoverage`) before each Run Sweep,
 *   2. target-range computation (seed = 100 bars, otherwise extend-only),
 *   3. canonical row generation via the existing fit_one path, and
 *   4. write-back via `writeCanonicalScores`.
 *
 * Strict layering: this file does NOT know about discovery state, fit_one,
 * fingerprints, or UI events. Its only job is "given (signal_id, rows),
 * persist them immutably and report what happened".
 */

import { writeEvalParquet } from './eval-parquet-writer';
import {
  readCoverage as readEvalCoverage,
  readCanonicalScores as readEvalCanonicalScores,
  readCanonicalScoreSeries as readEvalCanonicalScoreSeries,
  readCanonicalSymbols as readEvalCanonicalSymbols,
} from './eval-parquet-reader';

// ----- Public types ----------------------------------------------------

/**
 * One canonical signal observation, mirroring the Python `SignalOutputRow`
 * defined in `packages/nona-algorithm/.../signal_sweep/canonical.py`.
 * Kept structurally identical so the JSON the producer writes to
 * `canonical_output.json` deserialises straight into this shape.
 */
export interface CanonicalScoreRow {
  /** Bar close, milliseconds since epoch, UTC. */
  timestamp: number;
  /** Directional score in [-1.0, +1.0]. 0.0 = "no opinion". */
  score: number;
  /** Self-confidence in [0.0, 1.0]. 0.0 = abstain; 1.0 = full conviction. */
  confidence: number;
}

/**
 * One canonical row tagged with its symbol partition key, used at the
 * write boundary. The on-disk parquet schema and the SQLite
 * `signal_canonical_score` PK are `(signal_id, symbol, ts)`, so every
 * row carries its own symbol. Single-symbol arms tag every row with the
 * arm-aggregate sentinel `''`; universe arms tag with the manifest
 * symbol verbatim.
 *
 * TICKET_947_1 protocol fix: the writer used to be called once per
 * symbol for a universe arm, which made the multi-symbol parquet
 * partition impossible (the writer is `(signal_id, run_id)` scoped and
 * each call atomically replaced the previous symbol's partition). The
 * orchestrator now accumulates every symbol's rows into a single
 * `WriteCanonicalScoresInput.rows` array and makes ONE call per
 * `signal_run`, which is the parquet partition's natural granularity.
 */
export interface CanonicalScoreRowWithSymbol extends CanonicalScoreRow {
  /**
   * TICKET_196_7_5_3_1 (v75) partition key. Universe-mode rows carry
   * the manifest symbol; single-symbol arms tag with `''`.
   */
  symbol: string;
  /**
   * TICKET_1133: walk-forward path index (fold) that produced this row.
   * Optional -- producers without per-fold substrate omit it and the
   * parquet column stays null.
   */
  pathIndex?: number | null;
}

export interface WriteCanonicalScoresInput {
  /** `nona_signal.id`. Numeric per the table FK; see migration v62. */
  signalId: number;
  /**
   * TICKET_947_1: `signal_run.id` of the run that produced these rows.
   * Required -- the parquet layout
   * `signal_id={id}/run_id={r}/part.parquet` cannot be partitioned
   * without it, and the latest-run-only retention pass cannot
   * distinguish "the run we just wrote" from "an older run to GC"
   * without it. Builder auto-persist creates the run row inside
   * `persistBuilderWorkflowSignal` (TICKET_886_6 root-cause fix that
   * 947_1 surfaced); sweep callers pass `recorded.runId` from
   * `recordComputedRun`.
   */
  runId: number;
  /**
   * All rows for this `(signal_id, run_id)` partition across every
   * symbol. Per TICKET_947_1, the writer's atomic-replace semantics are
   * `(signal_id, run_id)`-scoped: one parquet file per run contains
   * every symbol's series. Callers MUST batch all symbols in one call.
   */
  rows: CanonicalScoreRowWithSymbol[];
}

export interface WriteCanonicalScoresResult {
  /** Rows newly inserted (not previously present for this signal/ts). */
  inserted: number;
  /** Rows skipped because `(signal_id, ts)` already existed. */
  skipped: number;
  /** MIN(ts) for `signalId` AFTER the write. -1 if signal has no rows. */
  coverageStart: number;
  /** MAX(ts) for `signalId` AFTER the write. -1 if signal has no rows. */
  coverageEnd: number;
  /** Total row count for `signalId` AFTER the write. */
  barCount: number;
}

export interface CanonicalCoverage {
  /** MIN(ts) for the signal. */
  start: number;
  /** MAX(ts) for the signal. */
  end: number;
  /** COUNT(*) for the signal. */
  barCount: number;
}

export interface CanonicalScoreRange {
  /** Inclusive start, ms since epoch. */
  start?: number;
  /** Inclusive end, ms since epoch. */
  end?: number;
}

// ----- Validation ------------------------------------------------------

const SCORE_MIN = -1.0;
const SCORE_MAX = 1.0;
const CONFIDENCE_MIN = 0.0;
const CONFIDENCE_MAX = 1.0;

/**
 * Defensive validation. Producers are responsible for emitting in-range
 * values (the Python `SignalOutputRow.__post_init__` already enforces
 * this), but the desktop side does not trust process boundaries -- a
 * mis-shaped row would corrupt the score series with no recovery path.
 * Fail-fast: throw at the boundary so the bad batch never lands.
 */
function assertValidRow(row: CanonicalScoreRowWithSymbol, idx: number): void {
  if (typeof row.symbol !== 'string') {
    throw new Error(
      `[canonical-store] row[${idx}].symbol must be a string ` +
      `('' for single-symbol arms, manifest symbol for universe arms); ` +
      `got ${row.symbol === null ? 'null' : typeof row.symbol}`,
    );
  }
  if (!Number.isFinite(row.timestamp) || !Number.isInteger(row.timestamp)) {
    throw new Error(
      `[canonical-store] row[${idx}].timestamp must be an integer (ms since epoch); ` +
      `got ${row.timestamp}`,
    );
  }
  if (!Number.isFinite(row.score)) {
    throw new Error(
      `[canonical-store] row[${idx}].score must be a finite number; got ${row.score}`,
    );
  }
  if (row.score < SCORE_MIN || row.score > SCORE_MAX) {
    throw new Error(
      `[canonical-store] row[${idx}].score=${row.score} out of [${SCORE_MIN}, ${SCORE_MAX}]`,
    );
  }
  if (!Number.isFinite(row.confidence)) {
    throw new Error(
      `[canonical-store] row[${idx}].confidence must be a finite number; got ${row.confidence}`,
    );
  }
  if (row.confidence < CONFIDENCE_MIN || row.confidence > CONFIDENCE_MAX) {
    throw new Error(
      `[canonical-store] row[${idx}].confidence=${row.confidence} out of ` +
      `[${CONFIDENCE_MIN}, ${CONFIDENCE_MAX}]`,
    );
  }
}

// ----- Write path ------------------------------------------------------

/**
 * Insert canonical score rows for one signal under Strategy A semantics:
 * second-write for an existing `(signal_id, ts)` is a silent no-op (the
 * existing value wins forever). Reports `inserted` / `skipped` counts so
 * the orchestrator can surface "extended" vs "up to date" in the UI.
 *
 * Wraps the batch in a single SQLite transaction so a mid-batch crash
 * leaves the table consistent with the first-N rows of input or with the
 * pre-call state -- never a torn partial write.
 *
 * Returns the post-write coverage (MIN/MAX/COUNT) in the same call so
 * the orchestrator does not have to round-trip a second query.
 */
export async function writeCanonicalScores(
  input: WriteCanonicalScoresInput,
): Promise<WriteCanonicalScoresResult> {
  if (!Number.isInteger(input.signalId) || input.signalId <= 0) {
    throw new Error(
      `[canonical-store] writeCanonicalScores: signalId must be a positive integer; ` +
      `got ${input.signalId}`,
    );
  }
  if (!Number.isInteger(input.runId) || input.runId <= 0) {
    // TICKET_947_1 / TICKET_857: a missing run anchor is a contract
    // violation, not a runtime condition. The parquet partition path
    // cannot be formed without it; the latest-run-only GC cannot
    // distinguish "current" from "stale" without it.
    throw new Error(
      `[canonical-store] writeCanonicalScores: runId must be a positive integer; ` +
      `got ${input.runId}. Eval matrices require a signal_run anchor (TICKET_947_1).`,
    );
  }

  const rows = input.rows;

  if (rows.length === 0) {
    // Empty batch is legitimate (e.g., "already up to date"). Return the
    // current coverage so the caller can still report a coherent status.
    const coverage = await getCanonicalCoverage(input.signalId);
    return {
      inserted: 0,
      skipped: 0,
      coverageStart: coverage?.start ?? -1,
      coverageEnd: coverage?.end ?? -1,
      barCount: coverage?.barCount ?? 0,
    };
  }

  for (let i = 0; i < rows.length; i++) {
    assertValidRow(rows[i], i);
  }

  // TICKET_947_3: parquet is the SOLE substrate. The SQLite dual-write
  // kept during the 947_1/947_2 parity window is removed; the SQLite
  // tables themselves are dropped by migration v96. The writer call is
  // the only persistence path.
  //
  // Protocol per TICKET_947_1: ALL of this `(signal_id, run_id)`'s rows
  // across every symbol land in one writer call. The writer atomically
  // replaces the prior `run_id={r}/` partition, so calling it once per
  // symbol (the pre-fix shape) would have left only the last symbol's
  // rows on disk.
  //
  // Idempotency contract change (Strategy A -> writer-replace): SQLite
  // used `INSERT OR IGNORE` to make re-writes of an existing
  // `(signal_id, symbol, ts)` a silent no-op, reporting `skipped` to the
  // caller. The parquet writer is `(signal_id, run_id)`-scoped and
  // ATOMICALLY REPLACES the run partition on each call. Because the
  // sweep orchestrator now allocates a NEW `signal_run.id` per call
  // (TICKET_886_6 + TICKET_947_1), each call lands in its own partition
  // -- there is no "second write of the same row" path. `inserted` is
  // therefore `rows.length` and `skipped` is `0`; the fields remain in
  // the result shape for backward compatibility with the orchestrator's
  // UI status surface.
  const createdAt = Date.now();
  await writeEvalParquet({
    table: 'canonical_score',
    signalId: input.signalId,
    runId: input.runId,
    createdAtMs: createdAt,
    rows: rows.map((r) => ({
      symbol: r.symbol,
      ts: r.timestamp,
      score: r.score,
      confidence: r.confidence,
      pathIndex: r.pathIndex ?? null,
    })),
  });

  const coverage = await getCanonicalCoverage(input.signalId);

  return {
    inserted: rows.length,
    skipped: 0,
    coverageStart: coverage?.start ?? -1,
    coverageEnd: coverage?.end ?? -1,
    barCount: coverage?.barCount ?? 0,
  };
}

// ----- Read paths ------------------------------------------------------

/**
 * Return the score-coverage envelope for one signal. Returns `null` when
 * the signal has no rows yet (new signal, never sweeped).
 *
 * TICKET_1292_07: served by the C++ Parquet owner from footer row counts
 * and row-group `ts` statistics, with a projected legacy fallback when
 * statistics are absent. The owner picks MAX(run_id) under the partition
 * path so concurrent in-flight writes never produce a stale answer.
 */
export async function getCanonicalCoverage(
  signalId: number,
): Promise<CanonicalCoverage | null> {
  if (!Number.isInteger(signalId) || signalId <= 0) {
    throw new Error(
      `[canonical-store] getCanonicalCoverage: signalId must be a positive integer; ` +
      `got ${signalId}`,
    );
  }
  const result = await readEvalCoverage('canonical_score', signalId);
  if (result === null) return null;
  return {
    start: result.start,
    end: result.end,
    barCount: result.barCount,
  };
}

/**
 * Return the canonical score rows for one signal, optionally bounded by
 * an inclusive [start, end] time range. Rows are ordered by `ts ASC` so
 * the caller can stream them into a chart / fingerprint pipeline without
 * a re-sort.
 *
 * TICKET_1292_07: served by the C++ Parquet owner with column projection
 * and inclusive row-group `ts` pruning. The writer sorts by `(symbol, ts)`
 * and the owner performs an exact post-prune trim.
 */
export async function getCanonicalScores(
  signalId: number,
  range?: CanonicalScoreRange,
): Promise<CanonicalScoreRow[]> {
  if (!Number.isInteger(signalId) || signalId <= 0) {
    throw new Error(
      `[canonical-store] getCanonicalScores: signalId must be a positive integer; ` +
      `got ${signalId}`,
    );
  }
  const rows = await readEvalCanonicalScores(signalId, {
    start: range?.start,
    end: range?.end,
  });
  return rows.map((r) => ({
    timestamp: r.ts,
    score: r.score,
    confidence: r.confidence,
  }));
}

/**
 * TICKET_1135: the canonical score column for one signal as a packed
 * Float64Array, in the same `ORDER BY ts ASC` order `getCanonicalScores`
 * returns. Exists for the L1 stationarity gate, which needs ONLY the
 * score series -- the row-object shape allocated ~4.2M JS objects per
 * universe arm inside the heavy phase (see TICKET_1135 R1) just to be
 * copied into a Float64Array one line later. Returns the empty array
 * when the signal has no persisted partition.
 */
export async function getCanonicalScoreSeries(
  signalId: number,
): Promise<Float64Array> {
  if (!Number.isInteger(signalId) || signalId <= 0) {
    throw new Error(
      `[canonical-store] getCanonicalScoreSeries: signalId must be a positive integer; ` +
      `got ${signalId}`,
    );
  }
  const series = await readEvalCanonicalScoreSeries(signalId);
  return series ?? new Float64Array(0);
}

/**
 * TICKET_947_2: return the distinct symbol set for one signal. Replaces
 * the inline `SELECT DISTINCT symbol FROM signal_canonical_score WHERE
 * signal_id = ?` previously open-coded in `v3-handlers.ts` (two
 * occurrences). Served from the parquet `symbol` dictionary page so the
 * cost is O(dictionary cardinality), not O(rows). Returns the empty
 * array when the signal has no persisted partition (mirrors the
 * SQLite behaviour for unwritten signals).
 */
export async function getCanonicalSymbols(
  signalId: number,
): Promise<string[]> {
  if (!Number.isInteger(signalId) || signalId <= 0) {
    throw new Error(
      `[canonical-store] getCanonicalSymbols: signalId must be a positive integer; ` +
      `got ${signalId}`,
    );
  }
  return readEvalCanonicalSymbols(signalId);
}
