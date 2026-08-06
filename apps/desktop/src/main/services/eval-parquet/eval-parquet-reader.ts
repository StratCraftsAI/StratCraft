/**
 * Thin Electron adapter for the C++ eval Parquet owner (TICKET_1292_07).
 *
 * Production code in this module performs no Parquet scan, schema probe,
 * join, ordering, window filtering, or aggregate computation.
 */

import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PARQUET_CACHE_DIR } from '../../../shared/constants/data-import';
import { getDataRoot } from '../../utils/data-root';
import {
  EVAL_PARQUET_CONTRACT_VERSION,
  invokeEvalParquetOwner,
} from './eval-parquet-runner';

export type EvalParquetTable = 'canonical_score' | 'forward_return';

let evalRootOverride: string | null = null;

export function setEvalParquetReadRoot(path: string | null): void {
  evalRootOverride = path;
}

export function getEvalParquetReadRoot(): string {
  return evalRootOverride ?? join(getDataRoot(), PARQUET_CACHE_DIR, 'eval');
}

function getSignalDir(table: EvalParquetTable, signalId: number): string {
  return join(getEvalParquetReadRoot(), table, `signal_id=${signalId}`);
}

export function resolveLatestPartition(
  table: EvalParquetTable,
  signalId: number,
): string | null {
  return resolveLatestPartitionInDir(getSignalDir(table, signalId));
}

export function resolveLatestPartitionInDir(signalDir: string): string | null {
  if (!existsSync(signalDir)) return null;
  let latestRunId = -1;
  for (const entry of readdirSync(signalDir)) {
    if (!entry.startsWith('run_id=') || entry.endsWith('.tmp')) continue;
    const runId = Number(entry.slice('run_id='.length));
    if (Number.isInteger(runId) && runId > latestRunId) latestRunId = runId;
  }
  return latestRunId > 0
    ? join(signalDir, `run_id=${latestRunId}`, 'part.parquet')
    : null;
}

const READ_OUTPUT_MAGIC = 'QNXEPR10';

async function runCppRequest(
  request: Record<string, unknown>,
  withOutput = false,
): Promise<{ response: Record<string, unknown>; output: Buffer | null }> {
  const workDir = await mkdtemp(join(tmpdir(), 'qnx-eval-parquet-read-'));
  const requestPath = join(workDir, 'request.json');
  const outputPath = join(workDir, 'output.bin');
  try {
    await writeFile(requestPath, JSON.stringify({
      version: EVAL_PARQUET_CONTRACT_VERSION,
      ...request,
      ...(withOutput ? { output_path: outputPath } : {}),
    }), 'utf8');
    const response = await invokeEvalParquetOwner(requestPath);
    return {
      response,
      output: withOutput ? await readFile(outputPath) : null,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function binaryHeader(
  output: Buffer,
  expectedKind: number,
): { offset: number; count: number } {
  if (
    output.length < 17 ||
    output.subarray(0, 8).toString('ascii') !== READ_OUTPUT_MAGIC
  ) {
    throw new Error('QNX_EVAL_PARQUET_INVALID: invalid read sidecar magic');
  }
  if (output.readUInt8(8) !== expectedKind) {
    throw new Error('QNX_EVAL_PARQUET_INVALID: read sidecar kind mismatch');
  }
  const count = output.readBigUInt64LE(9);
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('QNX_EVAL_PARQUET_INVALID: row count exceeds JS safe integer');
  }
  return { offset: 17, count: Number(count) };
}

function readBinaryString(
  output: Buffer,
  offset: number,
): { value: string; offset: number } {
  if (offset + 4 > output.length) {
    throw new Error('QNX_EVAL_PARQUET_INVALID: truncated string length');
  }
  const length = output.readUInt32LE(offset);
  const start = offset + 4;
  const end = start + length;
  if (end > output.length) {
    throw new Error('QNX_EVAL_PARQUET_INVALID: truncated string');
  }
  return { value: output.subarray(start, end).toString('utf8'), offset: end };
}

export interface CoverageResult {
  start: number;
  end: number;
  barCount: number;
}

export async function readCoverage(
  table: EvalParquetTable,
  signalId: number,
): Promise<CoverageResult | null> {
  const { response } = await runCppRequest({
    operation: 'coverage',
    root: getEvalParquetReadRoot(),
    table,
    signal_id: signalId,
  });
  const row = response.result as Record<string, unknown> | null;
  return row === null
    ? null
    : {
        start: Number(row.start),
        end: Number(row.end),
        barCount: Number(row.bar_count),
      };
}

export async function readParquetFooterRowCounts(
  paths: string[],
): Promise<Map<string, number>> {
  if (paths.length === 0) return new Map();
  const { response } = await runCppRequest({
    operation: 'footer_counts',
    paths,
  });
  const raw = response.counts as Record<string, unknown>;
  return new Map(paths.map((path) => [path, Number(raw[path])]));
}

export interface ReadCanonicalScoresOptions {
  start?: number;
  end?: number;
}

export interface CanonicalScoreReaderRow {
  ts: number;
  score: number;
  confidence: number;
}

export async function readCanonicalScores(
  signalId: number,
  options?: ReadCanonicalScoresOptions,
): Promise<CanonicalScoreReaderRow[]> {
  const { output } = await runCppRequest({
    operation: 'canonical_scores',
    root: getEvalParquetReadRoot(),
    signal_id: signalId,
    ...(options?.start !== undefined ? { start_ms: options.start } : {}),
    ...(options?.end !== undefined ? { end_ms: options.end } : {}),
  }, true);
  const payload = output!;
  const header = binaryHeader(payload, 1);
  if (payload.length !== header.offset + header.count * 24) {
    throw new Error('QNX_EVAL_PARQUET_INVALID: invalid canonical row length');
  }
  const rows = new Array<CanonicalScoreReaderRow>(header.count);
  for (let index = 0; index < header.count; index += 1) {
    const offset = header.offset + index * 24;
    rows[index] = {
      ts: Number(payload.readBigInt64LE(offset)),
      score: payload.readDoubleLE(offset + 8),
      confidence: payload.readDoubleLE(offset + 16),
    };
  }
  return rows;
}

export interface ForwardReturnPairReaderRow {
  ts: number;
  symbol: string;
  signalValue: number;
  signalConfidence: number;
  rNext: number;
  horizonBars: number;
}

export interface ReadForwardReturnPairsOptions {
  start?: number;
  end?: number;
}

export async function readForwardReturnPairs(
  signalId: number,
  options?: ReadForwardReturnPairsOptions,
): Promise<ForwardReturnPairReaderRow[]> {
  const { output } = await runCppRequest({
    operation: 'forward_pairs',
    root: getEvalParquetReadRoot(),
    signal_id: signalId,
    ...(options?.start !== undefined ? { start_ms: options.start } : {}),
    ...(options?.end !== undefined ? { end_ms: options.end } : {}),
  }, true);
  const payload = output!;
  const header = binaryHeader(payload, 2);
  const rows = new Array<ForwardReturnPairReaderRow>(header.count);
  let offset = header.offset;
  for (let index = 0; index < header.count; index += 1) {
    const symbol = readBinaryString(payload, offset);
    offset = symbol.offset;
    if (offset + 40 > payload.length) {
      throw new Error('QNX_EVAL_PARQUET_INVALID: truncated forward pairs');
    }
    rows[index] = {
      symbol: symbol.value,
      ts: Number(payload.readBigInt64LE(offset)),
      signalValue: payload.readDoubleLE(offset + 8),
      signalConfidence: payload.readDoubleLE(offset + 16),
      rNext: payload.readDoubleLE(offset + 24),
      horizonBars: payload.readInt32LE(offset + 32),
    };
    offset += 40;
  }
  if (offset !== payload.length) {
    throw new Error('QNX_EVAL_PARQUET_INVALID: trailing forward-pair bytes');
  }
  return rows;
}

export interface ArmFunnelFoldAggregateRow {
  pathIndex: number;
  testSegmentIndex: number;
  nPairs: number;
  distinctSymbols: number;
  pooledIc: number | null;
  xsMeanIc: number | null;
  xsBarsMeasurable: number;
  xsBarsObserved: number;
}

export interface ArmFunnelRegimeAggregateRow {
  regimeLabel: number;
  nPairs: number;
  pooledIc: number | null;
}

export interface ArmFunnelDecayLagRow {
  lag: number;
  nPairs: number;
  pooledIc: number | null;
  xsMeanIc: number | null;
  xsBarsMeasurable: number;
}

export interface ArmFunnelFoldBoundaryInput {
  pathIndex: number;
  testSegmentIndex: number;
  startMs: number;
  endMs: number;
}

export interface ArmFunnelAggregates {
  nPairsClean: number;
  distinctSymbols: number;
  pooledArmIc: number | null;
  xsArmMeanIc: number | null;
  xsArmBarsMeasurable: number;
  xsArmBarsObserved: number;
  foldAttribution: 'path_index' | 'ts_window';
  folds: ArmFunnelFoldAggregateRow[];
  regimes: ArmFunnelRegimeAggregateRow[];
  decayLagIcs: ArmFunnelDecayLagRow[];
}

export function emptyArmFunnelAggregates(): ArmFunnelAggregates {
  return {
    nPairsClean: 0,
    distinctSymbols: 0,
    pooledArmIc: null,
    xsArmMeanIc: null,
    xsArmBarsMeasurable: 0,
    xsArmBarsObserved: 0,
    foldAttribution: 'ts_window',
    folds: [],
    regimes: [],
    decayLagIcs: [],
  };
}

export async function readArmFunnelAggregates(
  signalId: number,
  options: {
    foldBoundaries: ReadonlyArray<ArmFunnelFoldBoundaryInput>;
    regimeByTimestamp?: ReadonlyMap<number, number | null> | null;
    minSymbolsPerBar: number;
    maxDecayLag?: number;
  },
): Promise<ArmFunnelAggregates | null> {
  if (!Number.isInteger(signalId) || signalId <= 0) {
    throw new Error(
      `[eval-parquet-reader] readArmFunnelAggregates: signalId must be a ` +
      `positive integer; got ${signalId}`,
    );
  }
  if (!Number.isInteger(options.minSymbolsPerBar) || options.minSymbolsPerBar < 1) {
    throw new Error(
      `[eval-parquet-reader] readArmFunnelAggregates: minSymbolsPerBar must ` +
      `be a positive integer; got ${options.minSymbolsPerBar}`,
    );
  }
  const maxDecayLag = options.maxDecayLag ?? -1;
  if (!Number.isInteger(maxDecayLag)) {
    throw new Error(
      `[eval-parquet-reader] readArmFunnelAggregates: maxDecayLag must be ` +
      `an integer; got ${maxDecayLag}`,
    );
  }
  const regimes: Array<{ ts: number; label: number }> = [];
  for (const [ts, label] of options.regimeByTimestamp ?? []) {
    if (label === null || !Number.isFinite(ts) || !Number.isInteger(label)) continue;
    regimes.push({ ts: Math.floor(ts), label });
  }
  const { response } = await runCppRequest({
    operation: 'arm_funnel',
    root: getEvalParquetReadRoot(),
    signal_id: signalId,
    min_symbols_per_bar: options.minSymbolsPerBar,
    max_decay_lag: maxDecayLag,
    fold_boundaries: options.foldBoundaries.map((row) => ({
      path_index: row.pathIndex,
      test_segment_index: row.testSegmentIndex,
      start_ms: Math.floor(row.startMs),
      end_ms: Math.floor(row.endMs),
    })),
    regimes,
  });
  return response.result as ArmFunnelAggregates | null;
}

export async function readCanonicalScoreSeries(
  signalId: number,
): Promise<Float64Array | null> {
  if (resolveLatestPartition('canonical_score', signalId) === null) return null;
  const { output } = await runCppRequest({
    operation: 'score_series',
    root: getEvalParquetReadRoot(),
    signal_id: signalId,
  }, true);
  const payload = output!;
  const header = binaryHeader(payload, 3);
  if (payload.length !== header.offset + header.count * 8) {
    throw new Error('QNX_EVAL_PARQUET_INVALID: invalid score series length');
  }
  const series = new Float64Array(header.count);
  for (let index = 0; index < header.count; index += 1) {
    series[index] = payload.readDoubleLE(header.offset + index * 8);
  }
  return series;
}

export async function readCanonicalSymbols(signalId: number): Promise<string[]> {
  const { response } = await runCppRequest({
    operation: 'symbols',
    root: getEvalParquetReadRoot(),
    signal_id: signalId,
  });
  return (response.symbols as unknown[]).map(String);
}

export async function __countCanonicalScoresForTesting(
  signalId: number,
  options?: ReadCanonicalScoresOptions,
): Promise<number> {
  return (await readCanonicalScores(signalId, options)).length;
}

export interface EvalCacheReaderRow {
  symbol: string;
  ts: number;
  score: number;
  confidence: number;
  rNext: number;
  horizonBars: number;
}

export async function readEvalCacheRows(path: string): Promise<EvalCacheReaderRow[]> {
  const { output } = await runCppRequest({
    operation: 'eval_cache_rows',
    path,
  }, true);
  const payload = output!;
  const header = binaryHeader(payload, 4);
  const rows = new Array<EvalCacheReaderRow>(header.count);
  let offset = header.offset;
  for (let index = 0; index < header.count; index += 1) {
    const symbol = readBinaryString(payload, offset);
    offset = symbol.offset;
    if (offset + 36 > payload.length) {
      throw new Error('QNX_EVAL_PARQUET_INVALID: truncated eval-cache rows');
    }
    rows[index] = {
      symbol: symbol.value,
      ts: Number(payload.readBigInt64LE(offset)),
      score: payload.readDoubleLE(offset + 8),
      confidence: payload.readDoubleLE(offset + 16),
      rNext: payload.readDoubleLE(offset + 24),
      horizonBars: payload.readInt32LE(offset + 32),
    };
    offset += 36;
  }
  if (offset !== payload.length) {
    throw new Error('QNX_EVAL_PARQUET_INVALID: trailing eval-cache bytes');
  }
  return rows;
}

export interface EvalCacheReaderMetadata {
  rowCount: number;
  symbols: string[];
  horizonBars: number;
}

export async function readEvalCacheFileMetadata(
  path: string,
): Promise<EvalCacheReaderMetadata> {
  const { response } = await runCppRequest({
    operation: 'eval_cache_metadata',
    path,
  });
  return {
    rowCount: Number(response.row_count),
    symbols: (response.symbols as unknown[]).map(String),
    horizonBars: Number(response.horizon_bars),
  };
}

export async function computeEvalCacheIcStats(
  paths: ReadonlyArray<string>,
  samplingThreshold: number,
  sampleBars: number,
): Promise<{ ic: number | null; icStd: number | null }> {
  const { response } = await runCppRequest({
    operation: 'eval_cache_ic',
    paths,
    sampling_threshold: samplingThreshold,
    sample_bars: sampleBars,
  });
  return {
    ic: response.ic === null ? null : Number(response.ic),
    icStd: response.ic_std === null ? null : Number(response.ic_std),
  };
}
