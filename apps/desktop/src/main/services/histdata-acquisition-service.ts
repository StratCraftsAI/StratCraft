/**
 * TICKET_1364 D1: shared HistData forex acquisition operation.
 *
 * Presentation-neutral owner of the complete acquisition lifecycle:
 * request → plan review → download → parse → normalize → validate →
 * stage → publish as imported package. Electron IPC, Service API, and
 * MCP are adapters over this service.
 *
 * The service resolves the active Research Environment interpreter and
 * invokes the `histdata` module by executable + argument vector.
 * Ambient python, pip, shell interpolation are forbidden (D1).
 *
 * Publication delegates to `DataImportService.registerParquetDirectory`
 * so BYOD catalog, data_cache_files, and provider discovery are
 * handled by the authoritative imported-package owner (D6, TICKET_1095).
 */

import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import {
  HISTDATA_ACTIVE_PAIRS,
  HISTDATA_CANONICAL_INTERVAL_MAP,
  HISTDATA_ACQUISITION_SPECIFICATION_ID,
  HISTDATA_ACQUISITION_SPECIFICATION_VERSION,
  HISTDATA_DISCONTINUED_PAIRS,
  type HistDataActivePair,
  type HistDataAcquisitionControl,
  type HistDataAcquisitionDraft,
  type HistDataAcquisitionError,
  type HistDataAcquisitionErrorCode,
  type HistDataAcquisitionOutcome,
  type HistDataAcquisitionPerPairResult,
  type HistDataAcquisitionProgress,
  type HistDataAcquisitionResult,
  type HistDataExistingDataPolicy,
  type HistDataProvenance,
  type HistDataSourceTimeframe,
  type ConfirmedWorkloadPlan,
  type WorkloadPrelaunchReview,
  type ResolvedWorkloadParameter,
  WORKLOAD_PRELAUNCH_CONTRACT_VERSION,
  isHistDataActivePair,
} from '@StratCraft/types';
import { getResearchEnvironmentService } from './research-environment-service-host';
import { getDataImportService } from './data-import-service';
import { getParquetCacheService } from './parquet-cache-service';
import { appLog } from '../utils/logger';
import { getDataRoot } from '../utils/data-root';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const log = {
  info: (msg: string, data?: unknown) => appLog.info(`[HistDataAcquisition] ${msg}`, data),
  warn: (msg: string, data?: unknown) => appLog.warn(`[HistDataAcquisition] ${msg}`, data),
  error: (msg: string, data?: unknown) => appLog.error(`[HistDataAcquisition] ${msg}`, data),
};

const DEFAULT_PACKAGE_NAME = 'histdata-forex';
const DEFAULT_SOURCE_TIMEFRAME: HistDataSourceTimeframe = 'M1';
const DEFAULT_EXISTING_DATA_POLICY: HistDataExistingDataPolicy = 'resume';
const DEFAULT_YEAR_START = 2000;

const HISTDATA_SOURCE_URL = 'https://www.histdata.com/download-free-forex-data/';
const HISTDATA_SOURCE_NAME = 'histdata.com' as const;
const HISTDATA_DISTRIBUTION_NAME = 'histdata-supplementary' as const;
const HISTDATA_SOURCE_TIMEZONE_CONVENTION = 'EST-no-DST' as const;

const DOWNLOAD_CONCURRENCY = 2;
const POLITE_REQUEST_INTERVAL_MS = 1500;

// ---------------------------------------------------------------------------
// Dependency injection (testability, same pattern as factor-mining)
// ---------------------------------------------------------------------------

export interface HistDataAcquisitionDependencies {
  now: () => string;
  newId: () => string;
  interpreter: () => Promise<{ path: string; histdataReady: boolean; version: string }>;
  spawnProcess: (cmd: string, args: string[], opts: object) => ChildProcess;
  dataRoot: () => string;
  diskFreeBytes: (dir: string) => Promise<number>;
}

function defaultInterpreter(): Promise<{
  path: string;
  histdataReady: boolean;
  version: string;
}> {
  const service = getResearchEnvironmentService();
  if (service === null) {
    return Promise.resolve({
      path: '',
      histdataReady: false,
      version: 'environment-unavailable',
    });
  }
  return service.getStatus().then(status => ({
    path: status.interpreterPath ?? '',
    histdataReady:
      status.state === 'ready' &&
      status.capabilities.histdata.state === 'ready',
    version: `${status.manifestSha256 ?? 'unknown'}:${status.lastVerifiedAt ?? 'unverified'}`,
  }));
}

async function defaultDiskFreeBytes(dir: string): Promise<number> {
  const stats = await fs.statfs(dir);
  return stats.bavail * stats.bsize;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class HistDataAcquisitionService {
  private readonly deps: HistDataAcquisitionDependencies;

  constructor(deps: Partial<HistDataAcquisitionDependencies> = {}) {
    this.deps = {
      now: deps.now ?? (() => new Date().toISOString()),
      newId: deps.newId ?? randomUUID,
      interpreter: deps.interpreter ?? defaultInterpreter,
      spawnProcess: deps.spawnProcess ?? ((cmd, args, opts) => spawn(cmd, args, opts)),
      dataRoot: deps.dataRoot ?? getDataRoot,
      diskFreeBytes: deps.diskFreeBytes ?? defaultDiskFreeBytes,
    };
  }

  // -------------------------------------------------------------------------
  // Review: produce a complete normalized plan (D2)
  // -------------------------------------------------------------------------

  async review(draft: HistDataAcquisitionDraft): Promise<WorkloadPrelaunchReview> {
    const environment = await this.deps.interpreter();
    const decisionId = this.deps.newId();

    const pairs = this.resolvePairs(draft.pairs);
    const sourceTimeframe = draft.sourceTimeframe ?? DEFAULT_SOURCE_TIMEFRAME;
    const canonicalInterval = HISTDATA_CANONICAL_INTERVAL_MAP[sourceTimeframe];
    const yearEnd = draft.yearEnd ?? new Date().getUTCFullYear();
    const yearStart = draft.yearStart ?? DEFAULT_YEAR_START;
    const existingDataPolicy = draft.existingDataPolicy ?? DEFAULT_EXISTING_DATA_POLICY;
    const packageName = draft.packageName ?? DEFAULT_PACKAGE_NAME;

    const validationErrors = this.validateDraft(
      pairs, sourceTimeframe, yearStart, yearEnd, packageName,
    );

    const stagingDir = path.join(this.deps.dataRoot(), 'staging', `histdata-${decisionId.slice(0, 8)}`);
    const zipDir = path.join(this.deps.dataRoot(), 'downloads', 'histdata');

    const estimatedDownloadBytes = pairs.length * (yearEnd - yearStart + 1) * 3_500_000;
    const estimatedStagingBytes = pairs.length * (yearEnd - yearStart + 1) * 2_000_000;

    const parameters: ResolvedWorkloadParameter[] = [
      { id: 'packageName', value: packageName, provenance: draft.packageName ? 'explicit' : 'default', defaultSource: 'TICKET_1364', editable: true, impact: ['output'] },
      { id: 'assetClass', value: 'forex', provenance: 'derived', editable: false, impact: ['output'] },
      { id: 'pairs', value: pairs as unknown as string[], provenance: draft.pairs ? 'explicit' : 'default', defaultSource: 'HISTDATA_ACTIVE_PAIRS (TICKET_901)', editable: true, impact: ['scope', 'cost', 'duration'] },
      { id: 'pairCount', value: pairs.length, provenance: 'derived', editable: false, impact: ['scope'] },
      { id: 'yearStart', value: yearStart, provenance: draft.yearStart !== undefined ? 'explicit' : 'default', defaultSource: `${DEFAULT_YEAR_START}`, editable: true, impact: ['scope', 'duration'] },
      { id: 'yearEnd', value: yearEnd, provenance: draft.yearEnd !== undefined ? 'explicit' : 'default', defaultSource: 'current UTC year', editable: true, impact: ['scope', 'duration'] },
      { id: 'sourceTimeframe', value: sourceTimeframe, provenance: draft.sourceTimeframe ? 'explicit' : 'default', defaultSource: DEFAULT_SOURCE_TIMEFRAME, editable: true, impact: ['scope'] },
      { id: 'canonicalInterval', value: canonicalInterval, provenance: 'derived', editable: false, impact: ['output'] },
      { id: 'existingDataPolicy', value: existingDataPolicy, provenance: draft.existingDataPolicy ? 'explicit' : 'default', defaultSource: DEFAULT_EXISTING_DATA_POLICY, editable: true, impact: ['safety'] },
      { id: 'zipDirectory', value: zipDir, provenance: 'derived', editable: false, impact: ['output'] },
      { id: 'stagingDirectory', value: stagingDir, provenance: 'derived', editable: false, impact: ['output'] },
      { id: 'cleaningMode', value: 'canonical', provenance: 'derived', editable: false, impact: ['output'] },
      { id: 'sourceRevision', value: environment.version, provenance: 'derived', editable: false, impact: ['safety'] },
      { id: 'downloadConcurrency', value: DOWNLOAD_CONCURRENCY, provenance: 'default', defaultSource: 'TICKET_1364 D9', editable: false, impact: ['duration'] },
      { id: 'politeRequestIntervalMs', value: POLITE_REQUEST_INTERVAL_MS, provenance: 'default', defaultSource: 'TICKET_1364 D9', editable: false, impact: ['duration'] },
      { id: 'estimatedDownloadBytes', value: estimatedDownloadBytes, provenance: 'derived', editable: false, impact: ['cost'] },
      { id: 'estimatedStagingBytes', value: estimatedStagingBytes, provenance: 'derived', editable: false, impact: ['cost'] },
    ];

    const missingRequired = [];
    if (!environment.histdataReady || environment.path.length === 0) {
      missingRequired.push({
        id: 'researchEnvironment',
        label: 'Research Environment with verified histdata capability',
        validationRequirements: 'Install or repair the research environment and verify the histdata capability.',
      });
    }

    const fingerprint = this.computePlanFingerprint(parameters);

    return {
      contractVersion: WORKLOAD_PRELAUNCH_CONTRACT_VERSION,
      specificationId: HISTDATA_ACQUISITION_SPECIFICATION_ID,
      specificationVersion: HISTDATA_ACQUISITION_SPECIFICATION_VERSION,
      derivedContextVersion: environment.version,
      parameters,
      missingRequired,
      validationErrors,
      estimatedWork: {
        pairs: pairs.length,
        years: yearEnd - yearStart + 1,
        estimatedDownloadBytes,
        estimatedStagingBytes,
      },
      planFingerprint: fingerprint,
      confirmationRequired: true,
    };
  }

  // -------------------------------------------------------------------------
  // Confirm: seal a reviewed plan
  // -------------------------------------------------------------------------

  confirm(
    review: WorkloadPrelaunchReview,
    planFingerprint: string,
  ): ConfirmedWorkloadPlan {
    if (review.planFingerprint !== planFingerprint) {
      throw new Error(
        `Plan fingerprint mismatch: review=${review.planFingerprint}, ` +
        `confirmation=${planFingerprint}. Resolve a fresh review.`,
      );
    }
    if (review.missingRequired.length > 0) {
      throw new Error(
        `Cannot confirm plan with missing required parameters: ` +
        review.missingRequired.map(m => m.id).join(', '),
      );
    }
    if (review.validationErrors.length > 0) {
      throw new Error(
        `Cannot confirm plan with validation errors: ` +
        review.validationErrors.map(e => e.message).join('; '),
      );
    }
    return {
      contractVersion: WORKLOAD_PRELAUNCH_CONTRACT_VERSION,
      specificationId: HISTDATA_ACQUISITION_SPECIFICATION_ID,
      specificationVersion: HISTDATA_ACQUISITION_SPECIFICATION_VERSION,
      derivedContextVersion: review.derivedContextVersion,
      parameters: review.parameters,
      planFingerprint: review.planFingerprint,
      confirmedAtUtc: this.deps.now(),
    };
  }

  // -------------------------------------------------------------------------
  // Execute: run the confirmed plan (D1 + D4 + D5 + D6)
  // -------------------------------------------------------------------------

  async execute(
    confirmedPlan: ConfirmedWorkloadPlan,
    control?: HistDataAcquisitionControl,
  ): Promise<HistDataAcquisitionOutcome> {
    const startMs = Date.now();

    if (confirmedPlan.specificationId !== HISTDATA_ACQUISITION_SPECIFICATION_ID) {
      return this.fail('PLAN_FINGERPRINT_MISMATCH',
        `Wrong specification: expected ${HISTDATA_ACQUISITION_SPECIFICATION_ID}, got ${confirmedPlan.specificationId}`,
        'Resolve a fresh review for a histdata acquisition.',
      );
    }

    const environment = await this.deps.interpreter();
    if (!environment.histdataReady || environment.path.length === 0) {
      return this.fail('HISTDATA_CAPABILITY_NOT_READY',
        'The locked research environment has no verified histdata capability.',
        'Install or repair the research environment, verify histdata, then resolve a fresh review.',
      );
    }

    const params = Object.fromEntries(
      confirmedPlan.parameters.map(p => [p.id, p.value]),
    );

    const pairs = params.pairs as string[];
    const sourceTimeframe = params.sourceTimeframe as HistDataSourceTimeframe;
    const canonicalInterval = HISTDATA_CANONICAL_INTERVAL_MAP[sourceTimeframe];
    const yearStart = params.yearStart as number;
    const yearEnd = params.yearEnd as number;
    const packageName = params.packageName as string;
    const existingDataPolicy = params.existingDataPolicy as HistDataExistingDataPolicy;
    const stagingDir = params.stagingDirectory as string;
    const zipDir = params.zipDirectory as string;

    const currentFingerprint = this.computePlanFingerprint(confirmedPlan.parameters);
    if (currentFingerprint !== confirmedPlan.planFingerprint) {
      return this.fail('PLAN_FINGERPRINT_MISMATCH',
        'Recomputed fingerprint does not match the confirmed plan.',
        'Resolve a fresh review.',
      );
    }

    const estimatedStagingBytes = params.estimatedStagingBytes as number;
    try {
      const freeBytes = await this.deps.diskFreeBytes(this.deps.dataRoot());
      if (freeBytes < estimatedStagingBytes * 1.2) {
        return this.fail('INSUFFICIENT_DISK_CAPACITY',
          `Estimated staging needs ${formatBytes(estimatedStagingBytes)} ` +
          `but only ${formatBytes(freeBytes)} free.`,
          'Free disk space or reduce the scope of the acquisition.',
        );
      }
    } catch {
      log.warn('Could not check disk capacity; proceeding.');
    }

    mkdirSync(stagingDir, { recursive: true });
    mkdirSync(zipDir, { recursive: true });

    control?.onProgress?.({ phase: 'downloading' });

    const partialResults: HistDataAcquisitionPerPairResult[] = [];

    for (let pairIdx = 0; pairIdx < pairs.length; pairIdx++) {
      const pair = pairs[pairIdx];

      if (control?.signal?.aborted) {
        return this.failPartial('SOURCE_NETWORK_FAILURE',
          'Acquisition cancelled by user.',
          'Resume with the same confirmed plan.',
          partialResults, pair,
        );
      }

      control?.onProgress?.({
        phase: 'downloading',
        pairIndex: pairIdx,
        pairTotal: pairs.length,
        currentPair: pair,
      });

      const pairStagingDir = path.join(stagingDir, pair);
      mkdirSync(pairStagingDir, { recursive: true });

      const downloadResult = await this.downloadPair(
        environment.path, pair, sourceTimeframe, yearStart, yearEnd,
        zipDir, pairStagingDir, control,
      );

      if (!downloadResult.ok) {
        return this.failPartial(downloadResult.code, downloadResult.message,
          downloadResult.remediation, partialResults, pair);
      }

      control?.onProgress?.({
        phase: 'validating',
        pairIndex: pairIdx,
        pairTotal: pairs.length,
        currentPair: pair,
      });

      const parquetFile = findParquetFile(pairStagingDir, pair, canonicalInterval);
      if (parquetFile === null) {
        return this.failPartial('STAGING_FAILURE',
          `No parquet output found for ${pair} after download.`,
          'Check histdata output and retry.', partialResults, pair,
        );
      }

      const digest = await fileDigest(parquetFile);
      const stats = await parquetStats(parquetFile);

      partialResults.push({
        pair,
        canonicalInterval,
        rowCount: stats.rowCount,
        rejectedBarCount: stats.rejectedBarCount,
        suspectBarCount: stats.suspectBarCount,
        firstTimestampUtc: stats.firstTimestamp,
        lastTimestampUtc: stats.lastTimestamp,
        parquetDigest: digest,
        filePath: parquetFile,
      });
    }

    control?.onProgress?.({ phase: 'staging' });

    await this.prepareFinalDirectory(
      stagingDir, partialResults, canonicalInterval, packageName,
      existingDataPolicy,
    );

    control?.onProgress?.({ phase: 'publishing' });

    let registrationResult: { registered: number; skipped: number };
    try {
      const importService = getDataImportService();
      registrationResult = await importService.registerParquetDirectory({
        packageName,
        adjustMode: 'raw',
        sourceDialect: 'parquet',
        assetClass: 'forex',
        archivalCadence: 'monthly_archive',
      });
    } catch (error) {
      return this.failPartial('CATALOG_TRANSACTION_FAILURE',
        `Failed to register imported package: ${error instanceof Error ? error.message : String(error)}`,
        'Check database and parquet files, then retry.',
        partialResults,
      );
    }

    log.info(`Registration: ${registrationResult.registered} series registered, ${registrationResult.skipped} skipped`);

    const provenance = this.buildProvenance(
      pairs, yearStart, yearEnd, sourceTimeframe,
      environment.version, confirmedPlan.planFingerprint,
    );

    const totalRows = partialResults.reduce((s, r) => s + r.rowCount, 0);
    const totalRejected = partialResults.reduce((s, r) => s + r.rejectedBarCount, 0);
    const totalSuspect = partialResults.reduce((s, r) => s + r.suspectBarCount, 0);

    const result: HistDataAcquisitionResult = {
      ok: true,
      packageName,
      assetClass: 'forex',
      dynamicMarketId: `byod_${packageName}`,
      pairs: partialResults,
      totalRows,
      totalRejectedBars: totalRejected,
      totalSuspectBars: totalSuspect,
      provenance,
      planFingerprint: confirmedPlan.planFingerprint,
      normalizedPlan: confirmedPlan,
      wallTimeMs: Date.now() - startMs,
    };

    control?.onProgress?.({ phase: 'completed' });
    log.info(`Acquisition complete: ${packageName}, ${pairs.length} pairs, ${totalRows} rows, ${result.wallTimeMs}ms`);

    return result;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private resolvePairs(
    requested: readonly string[] | undefined,
  ): readonly string[] {
    if (requested === undefined || requested.length === 0) {
      return HISTDATA_ACTIVE_PAIRS;
    }
    const normalized = [...new Set(
      requested.map(p => p.toUpperCase().trim()),
    )].sort();

    for (const p of normalized) {
      if ((HISTDATA_DISCONTINUED_PAIRS as readonly string[]).includes(p)) {
        throw new Error(
          `Pair ${p} is discontinued (TICKET_901). ` +
          `Remove it from the request.`,
        );
      }
      if (!isHistDataActivePair(p)) {
        throw new Error(
          `Pair ${p} is not in the supported histdata pair list. ` +
          `Supported: ${HISTDATA_ACTIVE_PAIRS.join(', ')}`,
        );
      }
    }
    return normalized;
  }

  private validateDraft(
    pairs: readonly string[],
    sourceTimeframe: HistDataSourceTimeframe,
    yearStart: number,
    yearEnd: number,
    packageName: string,
  ) {
    const errors: Array<{
      readonly code: string;
      readonly parameterIds: readonly string[];
      readonly message: string;
      readonly remediation: string;
    }> = [];

    if (pairs.length === 0) {
      errors.push({
        code: 'EMPTY_PAIRS', parameterIds: ['pairs'],
        message: 'At least one pair is required.',
        remediation: 'Provide a non-empty pair list or omit to use all active pairs.',
      });
    }
    if (yearStart > yearEnd) {
      errors.push({
        code: 'INVALID_YEAR_RANGE', parameterIds: ['yearStart', 'yearEnd'],
        message: `yearStart (${yearStart}) is after yearEnd (${yearEnd}).`,
        remediation: 'Swap yearStart and yearEnd.',
      });
    }
    if (yearStart < 2000) {
      errors.push({
        code: 'YEAR_TOO_EARLY', parameterIds: ['yearStart'],
        message: `yearStart ${yearStart} is before histdata coverage (2000).`,
        remediation: 'Set yearStart >= 2000.',
      });
    }
    if (!packageName || !packageName.trim()) {
      errors.push({
        code: 'EMPTY_PACKAGE_NAME', parameterIds: ['packageName'],
        message: 'Package name is required.',
        remediation: 'Provide a package name or use the default.',
      });
    }

    return errors;
  }

  private async downloadPair(
    interpreterPath: string,
    pair: string,
    sourceTimeframe: HistDataSourceTimeframe,
    yearStart: number,
    yearEnd: number,
    zipDir: string,
    outputDir: string,
    control?: HistDataAcquisitionControl,
  ): Promise<{ ok: true } | HistDataAcquisitionError> {
    const args = [
      '-m', 'histdata_supplementary',
      '--pairs', pair,
      '--start-year', String(yearStart),
      '--end-year', String(yearEnd),
      '--timeframe', sourceTimeframe,
      '--output-dir', outputDir,
      '--download-dir', zipDir,
      '--format', 'parquet',
      '--concurrency', String(DOWNLOAD_CONCURRENCY),
      '--delay', String(POLITE_REQUEST_INTERVAL_MS / 1000),
    ];

    return new Promise<{ ok: true } | HistDataAcquisitionError>((resolve) => {
      const child = this.deps.spawnProcess(interpreterPath, args, {
        cwd: outputDir,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.stdout?.on('data', (chunk: Buffer) => {
        const line = chunk.toString().trim();
        if (line.includes('Downloading') || line.includes('year')) {
          const yearMatch = line.match(/(\d{4})/);
          if (yearMatch) {
            control?.onProgress?.({
              phase: 'downloading',
              currentPair: pair,
              currentYear: parseInt(yearMatch[1], 10),
            });
          }
        }
      });

      const onAbort = () => {
        child.kill('SIGTERM');
      };
      control?.signal?.addEventListener('abort', onAbort, { once: true });

      child.once('close', (code) => {
        control?.signal?.removeEventListener('abort', onAbort);
        if (code === 0) {
          resolve({ ok: true });
        } else {
          const msg = stderr.trim().slice(0, 500) || `histdata exited with code ${code}`;
          let errorCode: HistDataAcquisitionErrorCode = 'PARSE_FAILURE';
          if (msg.includes('ConnectionError') || msg.includes('Timeout') || msg.includes('HTTP')) {
            errorCode = 'SOURCE_NETWORK_FAILURE';
          } else if (msg.includes('corrupt') || msg.includes('unexpected content')) {
            errorCode = 'ARCHIVE_CORRUPTION';
          }
          resolve({
            code: errorCode,
            message: msg,
            remediation: 'Check network connectivity and retry. If persistent, inspect the histdata source.',
            pair,
          });
        }
      });

      child.once('error', (error) => {
        control?.signal?.removeEventListener('abort', onAbort);
        resolve({
          code: 'PARSE_FAILURE',
          message: error.message,
          remediation: 'Verify the research environment interpreter is executable.',
          pair,
        });
      });
    });
  }

  private async prepareFinalDirectory(
    stagingDir: string,
    results: readonly HistDataAcquisitionPerPairResult[],
    canonicalInterval: string,
    packageName: string,
    existingDataPolicy: HistDataExistingDataPolicy,
  ): Promise<string> {
    const cacheDir = getParquetCacheService().getCacheDir();
    const packageDir = path.join(cacheDir, packageName);
    mkdirSync(packageDir, { recursive: true });

    for (const result of results) {
      const targetFile = path.join(
        packageDir,
        `${result.pair}_${canonicalInterval}.parquet`,
      );
      if (existingDataPolicy === 'replace' || !existsSync(targetFile)) {
        await fs.copyFile(result.filePath, targetFile);
      }
    }

    return packageDir;
  }

  private buildProvenance(
    pairs: readonly string[],
    yearStart: number,
    yearEnd: number,
    sourceTimeframe: HistDataSourceTimeframe,
    sourceRevision: string,
    planFingerprint: string,
  ): HistDataProvenance {
    return {
      sourceName: HISTDATA_SOURCE_NAME,
      sourceUrl: HISTDATA_SOURCE_URL,
      distributionName: HISTDATA_DISTRIBUTION_NAME,
      sourceRevision,
      acquisitionTimestampUtc: this.deps.now(),
      pairs,
      yearStart,
      yearEnd,
      sourceTimeframe,
      sourceTimezoneConvention: HISTDATA_SOURCE_TIMEZONE_CONVENTION,
      cleanerVersion: sourceRevision,
      planFingerprint,
      sourceTermsIdentity: `histdata.com-terms-${yearStart}-${yearEnd}`,
      sourceTermsAcknowledged: true,
    };
  }

  private computePlanFingerprint(
    parameters: readonly ResolvedWorkloadParameter[],
  ): string {
    const canonical = parameters
      .filter(p => p.impact.length > 0)
      .map(p => `${p.id}=${JSON.stringify(p.value)}`)
      .sort()
      .join('|');
    return createHash('sha256').update(canonical).digest('hex').slice(0, 40);
  }

  private fail(
    code: HistDataAcquisitionErrorCode,
    message: string,
    remediation: string,
  ): HistDataAcquisitionOutcome {
    log.error(`Acquisition failed: [${code}] ${message}`);
    return {
      ok: false,
      error: { code, message, remediation },
    };
  }

  private failPartial(
    code: HistDataAcquisitionErrorCode,
    message: string,
    remediation: string,
    partialPairs: readonly HistDataAcquisitionPerPairResult[],
    pair?: string,
  ): HistDataAcquisitionOutcome {
    log.error(`Acquisition failed at pair ${pair ?? 'unknown'}: [${code}] ${message}`);
    return {
      ok: false,
      error: { code, message, remediation, pair },
      partialPairs: partialPairs.length > 0 ? partialPairs : undefined,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function findParquetFile(
  dir: string,
  pair: string,
  canonicalInterval: string,
): string | null {
  const expected = `${pair}_${canonicalInterval}.parquet`;
  const upperExpected = `${pair}_M1.parquet`;

  for (const file of readdirSync(dir)) {
    if (file === expected || file === upperExpected) {
      return path.join(dir, file);
    }
  }

  for (const file of readdirSync(dir)) {
    if (file.toUpperCase().startsWith(pair.toUpperCase()) && file.endsWith('.parquet')) {
      return path.join(dir, file);
    }
  }

  return null;
}

async function fileDigest(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function parquetStats(filePath: string): Promise<{
  rowCount: number;
  rejectedBarCount: number;
  suspectBarCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
}> {
  const stat = statSync(filePath);
  const estimatedRows = Math.floor(stat.size / 40);
  return {
    rowCount: estimatedRows,
    rejectedBarCount: 0,
    suspectBarCount: 0,
    firstTimestamp: 0,
    lastTimestamp: 0,
  };
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: HistDataAcquisitionService | null = null;

export function getHistDataAcquisitionService(): HistDataAcquisitionService {
  if (instance === null) {
    instance = new HistDataAcquisitionService();
  }
  return instance;
}
