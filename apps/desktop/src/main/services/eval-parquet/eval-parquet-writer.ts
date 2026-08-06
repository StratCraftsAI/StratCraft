/**
 * Thin Electron adapter for the C++ eval Parquet owner (TICKET_1292_07).
 *
 * This module owns no Parquet schema, ordering, compression, atomic publish,
 * or retention policy. It streams the already-materialized rows into the
 * versioned C++ row protocol and invokes the packaged StratCraft executor.
 */

import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PARQUET_CACHE_DIR } from '../../../shared/constants/data-import';
import { getDataRoot } from '../../utils/data-root';
import {
  EVAL_PARQUET_ARG_PREFIX,
  EVAL_PARQUET_CONTRACT_VERSION,
  invokeEvalParquetOwner,
} from './eval-parquet-runner';

export { EVAL_PARQUET_ARG_PREFIX, EVAL_PARQUET_CONTRACT_VERSION };

const ROW_STREAM_MAGIC = Buffer.from('QNXEVL10', 'ascii');
const TABLE_CODE: Readonly<Record<EvalParquetTable, number>> = {
  canonical_score: 1,
  forward_return: 2,
};

export type EvalParquetTable = 'canonical_score' | 'forward_return';

export interface CanonicalScoreParquetRow {
  symbol: string;
  ts: number;
  score: number;
  confidence: number;
  pathIndex?: number | null;
}

export interface ForwardReturnParquetRow {
  symbol: string;
  ts: number;
  rNext: number;
  horizonBars: number;
  pathIndex?: number | null;
}

export type EvalParquetWritePhase =
  | 'tmp_mkdir'
  | 'write_parquet'
  | 'fsync'
  | 'atomic_rename'
  | 'gc_old_runs'
  | 'encode_rows'
  | 'invoke_cpp';

export class EvalParquetWriteError extends Error {
  readonly table: EvalParquetTable;
  readonly signalId: number;
  readonly runId: number;
  readonly phase: EvalParquetWritePhase;

  constructor(
    table: EvalParquetTable,
    signalId: number,
    runId: number,
    phase: EvalParquetWritePhase,
    cause: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `[eval-parquet-writer] ${table} write failed: ` +
      `signal_id=${signalId} run_id=${runId} phase=${phase}: ${reason}`,
    );
    this.name = 'EvalParquetWriteError';
    this.table = table;
    this.signalId = signalId;
    this.runId = runId;
    this.phase = phase;
  }
}

let evalRootOverride: string | null = null;

export function setEvalParquetRoot(path: string | null): void {
  evalRootOverride = path;
}

export function getEvalParquetRoot(): string {
  return evalRootOverride ?? join(getDataRoot(), PARQUET_CACHE_DIR, 'eval');
}

export interface WriteEvalParquetInput {
  table: EvalParquetTable;
  signalId: number;
  runId: number;
  rows: ReadonlyArray<CanonicalScoreParquetRow | ForwardReturnParquetRow>;
  createdAtMs?: number;
}

function assertInteger(value: number, field: string, positive: boolean): void {
  if (positive && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(
      `[eval-parquet-writer] ${field} must be a positive integer; got ${value}`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `[eval-parquet-writer] ${field} must be a safe integer; got ${value}`,
    );
  }
}

function encodeHeader(table: EvalParquetTable, rowCount: number): Buffer {
  const header = Buffer.allocUnsafe(ROW_STREAM_MAGIC.length + 1 + 8);
  ROW_STREAM_MAGIC.copy(header, 0);
  header.writeUInt8(TABLE_CODE[table], ROW_STREAM_MAGIC.length);
  header.writeBigUInt64LE(BigInt(rowCount), ROW_STREAM_MAGIC.length + 1);
  return header;
}

function encodeRow(
  table: EvalParquetTable,
  row: CanonicalScoreParquetRow | ForwardReturnParquetRow,
  index: number,
): Buffer {
  if (typeof row.symbol !== 'string') {
    throw new Error(`row[${index}].symbol must be a string`);
  }
  assertInteger(row.ts, `row[${index}].ts`, false);
  const symbol = Buffer.from(row.symbol, 'utf8');
  const valueBytes = table === 'canonical_score' ? 8 + 8 : 8 + 4;
  const encoded = Buffer.allocUnsafe(4 + symbol.length + 8 + valueBytes + 4);
  let offset = 0;
  encoded.writeUInt32LE(symbol.length, offset);
  offset += 4;
  symbol.copy(encoded, offset);
  offset += symbol.length;
  encoded.writeBigInt64LE(BigInt(row.ts), offset);
  offset += 8;
  if (table === 'canonical_score') {
    const canonical = row as CanonicalScoreParquetRow;
    if (!Number.isFinite(canonical.score) || !Number.isFinite(canonical.confidence)) {
      throw new Error(`row[${index}] score and confidence must be finite`);
    }
    encoded.writeDoubleLE(canonical.score, offset);
    offset += 8;
    encoded.writeDoubleLE(canonical.confidence, offset);
    offset += 8;
  } else {
    const forward = row as ForwardReturnParquetRow;
    if (!Number.isFinite(forward.rNext)) {
      throw new Error(`row[${index}].rNext must be finite`);
    }
    assertInteger(forward.horizonBars, `row[${index}].horizonBars`, true);
    encoded.writeDoubleLE(forward.rNext, offset);
    offset += 8;
    encoded.writeInt32LE(forward.horizonBars, offset);
    offset += 4;
  }
  const pathIndex = row.pathIndex;
  if (pathIndex !== null && pathIndex !== undefined) {
    assertInteger(pathIndex, `row[${index}].pathIndex`, false);
    if (pathIndex < 0 || pathIndex > 0x7fffffff) {
      throw new Error(`row[${index}].pathIndex must fit non-negative int32`);
    }
  }
  encoded.writeInt32LE(pathIndex ?? -1, offset);
  return encoded;
}

async function writeRowStream(
  path: string,
  table: EvalParquetTable,
  rows: WriteEvalParquetInput['rows'],
): Promise<void> {
  const output = await open(path, 'wx');
  try {
    await output.write(encodeHeader(table, rows.length));
    for (let index = 0; index < rows.length; index += 1) {
      await output.write(encodeRow(table, rows[index], index));
    }
  } finally {
    await output.close();
  }
}

export async function writeEvalParquet(input: WriteEvalParquetInput): Promise<void> {
  const { table, signalId, runId, rows } = input;
  assertInteger(signalId, 'signalId', true);
  assertInteger(runId, 'runId', true);
  const createdAtMs = input.createdAtMs ?? Date.now();
  assertInteger(createdAtMs, 'createdAtMs', false);

  const workDir = await mkdtemp(join(tmpdir(), 'qnx-eval-parquet-'));
  const rowsPath = join(workDir, 'rows.bin');
  const requestPath = join(workDir, 'request.json');
  try {
    try {
      await writeRowStream(rowsPath, table, rows);
    } catch (error) {
      throw new EvalParquetWriteError(
        table, signalId, runId, 'encode_rows', error,
      );
    }
    await writeFile(requestPath, JSON.stringify({
      version: EVAL_PARQUET_CONTRACT_VERSION,
      operation: 'write',
      root: getEvalParquetRoot(),
      table,
      signal_id: signalId,
      run_id: runId,
      created_at_ms: createdAtMs,
      rows_path: rowsPath,
    }), { encoding: 'utf8', flag: 'wx' });
    try {
      await invokeEvalParquetOwner(requestPath);
    } catch (error) {
      throw new EvalParquetWriteError(
        table, signalId, runId, 'invoke_cpp', error,
      );
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
