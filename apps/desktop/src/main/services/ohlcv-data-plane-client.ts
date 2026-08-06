/**
 * Mandatory Electron Main client for the C++ OHLCV data-plane owner.
 *
 * Electron owns request assembly, process lifecycle, cancellation, progress,
 * and SQLite metadata. The packaged C++ command owns schema conversion,
 * bounded reads, quality policy, merge/dedup, aggregation, pooling, and
 * canonical Parquet publication.
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { getCompilerResolver } from './compiler-resolver';

export const OHLCV_DATA_PLANE_VERSION = 'qnx.ohlcv-data-plane/1.0.0' as const;
export const OHLCV_SCHEMA_VERSION = 'qnx.ohlcv/1.0.0' as const;
export const OHLCV_TIMESTAMP_UNIT = 'epoch_ms' as const;
export const OHLCV_DATA_PLANE_ARG_PREFIX = '--ohlcv-data-plane=' as const;

export type OhlcvOperation = 'canonicalize' | 'merge' | 'aggregate' | 'pool' | 'byod';
export type OhlcvTimestampUnit = 's' | 'ms' | 'us' | 'ns';

export interface OhlcvDataPlaneInput {
  path: string;
  precedence?: number;
  projection?: {
    symbol?: string;
    timestamp?: string;
    open?: string;
    high?: string;
    low?: string;
    close?: string;
    volume?: string;
    fixedSymbol?: string;
    timestampUnit?: OhlcvTimestampUnit;
  };
}

export interface OhlcvInlineRow {
  symbol: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  precedence?: number;
  timestampUnit?: OhlcvTimestampUnit;
}

export interface OhlcvDataPlaneRequest {
  decisionId?: string;
  operation: OhlcvOperation;
  inputs: OhlcvDataPlaneInput[];
  inlineRows?: OhlcvInlineRow[];
  window: { startMs: number; endMs: number };
  outputPath: string;
  targetIntervalMs?: number;
  sessionAnchors?: Array<{ effectiveStartMs: number; anchorMs: number }>;
  keepPartialBucket?: boolean;
  calendarMs?: number[];
  symbols?: string[];
  fillPolicy?: 'none' | 'forward';
  qualityAction?: 'reject_artifact' | 'drop_rows';
  qualityPolicy?: {
    assetClass: 'forex' | 'equity' | 'crypto' | 'default';
    intervalMs: number;
  };
  minimumOutputRows?: number;
}

export interface OhlcvDecisionMetadata {
  version: typeof OHLCV_DATA_PLANE_VERSION;
  status: 'ok';
  decisionId: string;
  operation: OhlcvOperation;
  schema: {
    version: typeof OHLCV_SCHEMA_VERSION;
    columns: ['symbol', 'timestamp', 'open', 'high', 'low', 'close', 'volume'];
    timestampUnit: typeof OHLCV_TIMESTAMP_UNIT;
  };
  rowCount: number;
  extent: { startMs: number; endMs: number } | null;
  codec: 'zstd';
  bytesWritten: number;
  decisions: {
    rejectedRows: number;
    suspectRows: number;
    duplicateRows: number;
    filledRows: number;
    inputRowGroups: number;
    selectedRowGroups: number;
  };
  qualityEvents: Array<{
    symbol: string;
    timestampMs: number;
    rule:
      | 'nonpositive_price'
      | 'intrabar_incoherent'
      | 'intrabar_range'
      | 'scale_shift'
      | 'revert_spike'
      | 'interbar_jump_suspect';
    severity: 'reject' | 'suspect';
    original: {
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    };
  }>;
}

export class OhlcvDataPlaneError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'OhlcvDataPlaneError';
  }
}

function invalid(message: string): never {
  throw new OhlcvDataPlaneError(
    'QNX_OHLCV_CLIENT_CONTRACT_INVALID',
    `OHLCV data-plane contract invalid: ${message}. Rebuild or reinstall the application so Electron Main and StratCraft-executor use the same contract.`,
    false,
  );
}

function finiteInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    invalid(`${field} must be a safe integer`);
  }
  return value;
}

function readErrorEnvelope(stderr: string, exitCode: number | null): OhlcvDataPlaneError {
  try {
    const parsed = JSON.parse(stderr.trim()) as {
      version?: unknown;
      status?: unknown;
      error?: { code?: unknown; message?: unknown; retryable?: unknown };
    };
    if (
      parsed.version === OHLCV_DATA_PLANE_VERSION &&
      (parsed.status === 'error' || parsed.status === 'cancelled') &&
      parsed.error &&
      typeof parsed.error.code === 'string' &&
      typeof parsed.error.message === 'string' &&
      typeof parsed.error.retryable === 'boolean'
    ) {
      return new OhlcvDataPlaneError(
        parsed.error.code,
        `${parsed.error.message} (StratCraft-executor exit ${String(exitCode)})`,
        parsed.error.retryable,
      );
    }
  } catch {
    // The actionable malformed-envelope error below is the owning failure.
  }
  return new OhlcvDataPlaneError(
    'QNX_OHLCV_EXECUTOR_FAILED',
    `StratCraft-executor OHLCV data plane exited ${String(exitCode)} without a compatible error envelope: ${stderr.trim() || '(empty stderr)'}. Rebuild or reinstall the application.`,
    false,
  );
}

export function parseOhlcvDecision(
  document: unknown,
  expectedDecisionId: string,
  expectedOperation: OhlcvOperation,
): OhlcvDecisionMetadata {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    invalid('output must be an object');
  }
  const value = document as Record<string, unknown>;
  if (value.version !== OHLCV_DATA_PLANE_VERSION || value.status !== 'ok') {
    invalid(`unexpected version/status ${String(value.version)}/${String(value.status)}`);
  }
  if (value.decisionId !== expectedDecisionId) invalid('decisionId does not match the request');
  if (value.operation !== expectedOperation) invalid('operation does not match the request');
  const schema = value.schema as Record<string, unknown> | undefined;
  if (
    !schema ||
    schema.version !== OHLCV_SCHEMA_VERSION ||
    schema.timestampUnit !== OHLCV_TIMESTAMP_UNIT ||
    JSON.stringify(schema.columns) !==
      JSON.stringify(['symbol', 'timestamp', 'open', 'high', 'low', 'close', 'volume'])
  ) {
    invalid('schema is incompatible');
  }
  const extentRaw = value.extent;
  const extent = extentRaw === null
    ? null
    : {
      startMs: finiteInteger((extentRaw as Record<string, unknown>)?.startMs, 'extent.startMs'),
      endMs: finiteInteger((extentRaw as Record<string, unknown>)?.endMs, 'extent.endMs'),
    };
  const decisions = value.decisions as Record<string, unknown> | undefined;
  if (!decisions) invalid('decisions must be an object');
  if (!Array.isArray(value.qualityEvents)) invalid('qualityEvents must be an array');
  const qualityEvents = value.qualityEvents.map((event, index) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      invalid(`qualityEvents[${index}] must be an object`);
    }
    const item = event as Record<string, unknown>;
    const original = item.original as Record<string, unknown> | undefined;
    const allowedRules = new Set([
      'nonpositive_price', 'intrabar_incoherent', 'intrabar_range',
      'scale_shift', 'revert_spike', 'interbar_jump_suspect',
    ]);
    if (
      typeof item.symbol !== 'string' ||
      !allowedRules.has(String(item.rule)) ||
      (item.severity !== 'reject' && item.severity !== 'suspect') ||
      !original
    ) {
      invalid(`qualityEvents[${index}] is incompatible`);
    }
    for (const field of ['open', 'high', 'low', 'close', 'volume'] as const) {
      if (typeof original[field] !== 'number') {
        invalid(`qualityEvents[${index}].original.${field} must be numeric`);
      }
    }
    return {
      symbol: item.symbol,
      timestampMs: finiteInteger(item.timestampMs, `qualityEvents[${index}].timestampMs`),
      rule: item.rule,
      severity: item.severity,
      original,
    } as OhlcvDecisionMetadata['qualityEvents'][number];
  });
  if (value.codec !== 'zstd') invalid(`codec must be zstd, received ${String(value.codec)}`);
  return {
    version: OHLCV_DATA_PLANE_VERSION,
    status: 'ok',
    decisionId: expectedDecisionId,
    operation: expectedOperation,
    schema: schema as OhlcvDecisionMetadata['schema'],
    rowCount: finiteInteger(value.rowCount, 'rowCount'),
    extent,
    codec: 'zstd',
    bytesWritten: finiteInteger(value.bytesWritten, 'bytesWritten'),
    decisions: {
      rejectedRows: finiteInteger(decisions.rejectedRows, 'decisions.rejectedRows'),
      suspectRows: finiteInteger(decisions.suspectRows, 'decisions.suspectRows'),
      duplicateRows: finiteInteger(decisions.duplicateRows, 'decisions.duplicateRows'),
      filledRows: finiteInteger(decisions.filledRows, 'decisions.filledRows'),
      inputRowGroups: finiteInteger(decisions.inputRowGroups, 'decisions.inputRowGroups'),
      selectedRowGroups: finiteInteger(decisions.selectedRowGroups, 'decisions.selectedRowGroups'),
    },
    qualityEvents,
  };
}

export function newOhlcvDecisionId(operation: OhlcvOperation): string {
  return `mc21-${operation}-${randomUUID()}`;
}

export async function runOhlcvDataPlane(
  request: OhlcvDataPlaneRequest,
  abortSignal?: AbortSignal,
): Promise<OhlcvDecisionMetadata> {
  if (!Number.isSafeInteger(request.window.startMs) ||
      !Number.isSafeInteger(request.window.endMs) ||
      request.window.startMs > request.window.endMs) {
    invalid('window must contain ordered safe-integer epoch-ms endpoints');
  }
  if (!request.outputPath) invalid('outputPath must be non-empty');
  if (
    request.qualityPolicy &&
    (!Number.isSafeInteger(request.qualityPolicy.intervalMs) ||
      request.qualityPolicy.intervalMs <= 0)
  ) {
    invalid('qualityPolicy.intervalMs must be a positive safe integer');
  }
  if (
    request.minimumOutputRows !== undefined &&
    (!Number.isSafeInteger(request.minimumOutputRows) ||
      request.minimumOutputRows < 0)
  ) {
    invalid('minimumOutputRows must be a non-negative safe integer');
  }
  const executor = getCompilerResolver().resolvePluginExecutor();
  if (!executor) {
    throw new OhlcvDataPlaneError(
      'QNX_OHLCV_EXECUTOR_MISSING',
      'StratCraft-executor is unavailable; the mandatory C++ OHLCV data plane cannot run. Run packages/executor/build.sh, then restart the application.',
      false,
    );
  }

  const decisionId = request.decisionId ?? newOhlcvDecisionId(request.operation);
  const stem = join(tmpdir(), `qnx-ohlcv-${process.pid}-${decisionId}`);
  const inputPath = `${stem}.json`;
  const cancellationPath = `${stem}.cancel`;
  const document = {
    version: OHLCV_DATA_PLANE_VERSION,
    ...request,
    decisionId,
    cancellationPath,
  };
  await fs.writeFile(inputPath, JSON.stringify(document), { encoding: 'utf8', flag: 'wx' });

  try {
    if (abortSignal?.aborted) {
      throw new OhlcvDataPlaneError(
        'QNX_OHLCV_CANCELLED',
        'OHLCV data-plane operation was cancelled before launch.',
        false,
      );
    }
    return await new Promise<OhlcvDecisionMetadata>((resolve, reject) => {
      const child = spawn(executor.path, [`${OHLCV_DATA_PLANE_ARG_PREFIX}${inputPath}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        abortSignal?.removeEventListener('abort', onAbort);
        action();
      };
      const onAbort = (): void => {
        void fs.writeFile(cancellationPath, decisionId, 'utf8').catch((error) => {
          finish(() => reject(new OhlcvDataPlaneError(
            'QNX_OHLCV_CANCEL_FAILED',
            `Failed to signal OHLCV cancellation: ${(error as Error).message}`,
            true,
          )));
        });
      };
      abortSignal?.addEventListener('abort', onAbort, { once: true });

      child.on('error', (error) => {
        finish(() => reject(new OhlcvDataPlaneError(
          'QNX_OHLCV_EXECUTOR_SPAWN_FAILED',
          `Failed to start the mandatory StratCraft-executor OHLCV data plane: ${error.message}. Rebuild or reinstall the application.`,
          true,
        )));
      });
      child.on('exit', (code) => {
        finish(() => {
          if (code !== 0) {
            reject(readErrorEnvelope(stderr, code));
            return;
          }
          try {
            resolve(parseOhlcvDecision(JSON.parse(stdout), decisionId, request.operation));
          } catch (error) {
            reject(error);
          }
        });
      });
    });
  } finally {
    await Promise.all([
      fs.rm(inputPath, { force: true }),
      fs.rm(cancellationPath, { force: true }),
    ]);
  }
}
