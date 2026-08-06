/**
 * TICKET_1301 -- cross-workload peak-RSS admission and persistent queue.
 *
 * `canAdmitWorkload` is the single pure decision contract. Live callers build
 * its inputs from WorkloadMonitor + host memory, then every launch surface
 * consumes the same verdict rather than reconstructing resource arithmetic.
 */
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import log from 'electron-log';
import type {
  WorkloadAdmissionBreakdown,
  WorkloadAdmissionRefusal,
} from '@StratCraft/types';
import {
  MINING_PEAK_RSS_MB,
  SWEEP_ADMISSION_CONCURRENCY,
  SWEEP_PER_WORKER_RSS_MB,
  UNKNOWN_RUNNING_WORKLOAD_HEADROOM_MULTIPLIER,
  WORKLOAD_ADMISSION_MAX_SYSTEM_PERCENT,
  WORKLOAD_QUEUE_POLL_INTERVAL_MS,
  type WorkloadId,
} from '../../shared/constants/system-monitor';
import { getConfigService } from './config-service';
import { getWorkloadMonitor, type WorkloadStats } from './workload-monitor';

const BYTES_PER_MB = 1024 * 1024;
const QUEUE_FILENAME = 'workload-queue.json';
const ADMISSION_ERROR_CODE = 'WORKLOAD_ADMISSION_REFUSED';

export interface RunningWorkloadAdmissionInput {
  id: WorkloadId;
  currentRssMB: number;
  /** null means the registry cannot determine the pending peak. */
  estimatedPeakMB: number | null;
}

export type AdmissionBreakdown = WorkloadAdmissionBreakdown;

export interface AdmissionAccepted {
  admitted: true;
  candidateId: WorkloadId;
  candidatePeakMB: number;
  ceilingMB: number;
  baselineRssMB: number;
  combinedPeakMB: number;
  runningBreakdown: AdmissionBreakdown[];
}

export type AdmissionRefusal = WorkloadAdmissionRefusal;

export type AdmissionVerdict = AdmissionAccepted | AdmissionRefusal;

export interface AdmissionCandidate {
  id: WorkloadId;
  estimatedPeakMB: number | null;
}

export interface AdmissionSnapshotOptions {
  monitor?: Pick<ReturnType<typeof getWorkloadMonitor>, 'collect'>;
  machineMemTotalMB?: number;
  machineMemUsedMB?: number;
  maxSystemPercent?: number;
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function refusal(params: Omit<AdmissionRefusal, 'admitted' | 'errorCode' | 'enqueueAvailable'>): AdmissionRefusal {
  return {
    admitted: false,
    errorCode: ADMISSION_ERROR_CODE,
    enqueueAvailable: true,
    ...params,
  };
}

/**
 * Pure admission decision. Unknown candidates and invalid machine inputs
 * refuse fail-safe. Unknown running peaks retain 20% over current RSS.
 */
export function canAdmitWorkload(
  candidateId: WorkloadId,
  candidateEstimatedPeakMB: number | null,
  runningWorkloads: RunningWorkloadAdmissionInput[],
  machineMemTotalMB: number,
  baselineRssMB: number,
  maxSystemPercent: number,
): AdmissionVerdict {
  const validMachine =
    Number.isFinite(machineMemTotalMB) &&
    machineMemTotalMB > 0 &&
    finiteNonNegative(baselineRssMB) &&
    Number.isFinite(maxSystemPercent) &&
    maxSystemPercent > 0 &&
    maxSystemPercent <= 100;
  const ceilingMB = validMachine
    ? machineMemTotalMB * (maxSystemPercent / 100)
    : 0;
  const runningBreakdown = runningWorkloads.map((workload) => {
    const currentMB = finiteNonNegative(workload.currentRssMB) ? workload.currentRssMB : 0;
    const peakMB =
      workload.estimatedPeakMB != null && finiteNonNegative(workload.estimatedPeakMB)
        ? workload.estimatedPeakMB
        : currentMB * UNKNOWN_RUNNING_WORKLOAD_HEADROOM_MULTIPLIER;
    return {
      id: workload.id,
      currentMB,
      peakMB,
      admittedPeakMB: Math.max(currentMB, peakMB),
    };
  });

  if (!validMachine) {
    return refusal({
      reason: 'Workload admission could not determine a valid machine memory capacity.',
      candidateId,
      candidatePeakMB: candidateEstimatedPeakMB,
      ceilingMB,
      baselineRssMB: finiteNonNegative(baselineRssMB) ? baselineRssMB : 0,
      combinedPeakMB: null,
      runningBreakdown,
      suggestion: 'stop-other',
    });
  }
  if (candidateEstimatedPeakMB == null || !finiteNonNegative(candidateEstimatedPeakMB)) {
    return refusal({
      reason: `No authoritative peak-RSS estimate is available for candidate workload '${candidateId}'.`,
      candidateId,
      candidatePeakMB: null,
      ceilingMB,
      baselineRssMB,
      combinedPeakMB: null,
      runningBreakdown,
      suggestion: 'stop-other',
    });
  }

  const combinedPeakMB =
    baselineRssMB +
    runningBreakdown.reduce((sum, workload) => sum + workload.admittedPeakMB, 0) +
    candidateEstimatedPeakMB;
  if (combinedPeakMB <= ceilingMB) {
    return {
      admitted: true,
      candidateId,
      candidatePeakMB: candidateEstimatedPeakMB,
      ceilingMB,
      baselineRssMB,
      combinedPeakMB,
      runningBreakdown,
    };
  }

  const runningNames = runningBreakdown.map((workload) => workload.id).join(', ');
  return refusal({
    reason:
      `Combined workload peak ${Math.round(combinedPeakMB)} MB exceeds the ` +
      `${Math.round(ceilingMB)} MB system ceiling` +
      `${runningNames ? ` while ${runningNames} is active` : ''}. ` +
      'Wait for the running workload to finish, stop it first, or change the admission ceiling.',
    candidateId,
    candidatePeakMB: candidateEstimatedPeakMB,
    ceilingMB,
    baselineRssMB,
    combinedPeakMB,
    runningBreakdown,
    suggestion: runningBreakdown.length > 0 ? 'enqueue' : 'raise-ceiling',
  });
}

/** Authoritative fixed estimators. LSTM supplies its existing solver output. */
export function estimateWorkloadPeakMB(
  id: WorkloadId,
  solverEstimatedPeakMB?: number | null,
): number | null {
  if (id === 'sweep') return SWEEP_ADMISSION_CONCURRENCY * SWEEP_PER_WORKER_RSS_MB;
  if (id === 'mining') return MINING_PEAK_RSS_MB;
  return solverEstimatedPeakMB != null && finiteNonNegative(solverEstimatedPeakMB)
    ? solverEstimatedPeakMB
    : null;
}

function configuredCeilingPercent(): number {
  try {
    const value = getConfigService().get<number>('resourceGovernance.admissionCeilingPercent');
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : WORKLOAD_ADMISSION_MAX_SYSTEM_PERCENT;
  } catch {
    return WORKLOAD_ADMISSION_MAX_SYSTEM_PERCENT;
  }
}

function runningEstimate(row: WorkloadStats): number | null {
  return estimateWorkloadPeakMB(row.id);
}

/**
 * Compose one live snapshot. Baseline is current whole-system used memory minus
 * known workload RSS, clamped at zero, so Electron/ClickHouse/OS/cache remain
 * represented once while each workload is replaced by its conservative peak.
 */
export function buildAdmissionSnapshot(
  candidate: AdmissionCandidate,
  options: AdmissionSnapshotOptions = {},
): AdmissionVerdict {
  const monitor = options.monitor ?? getWorkloadMonitor();
  const rows = monitor.collect().filter((row) => row.running);
  const running = rows.map((row) => ({
    id: row.id,
    currentRssMB:
      process.platform === 'linux'
        ? row.memUsedBytes / BYTES_PER_MB
        : (row.pid != null ? readCurrentRssMB(row.pid) : row.memUsedBytes / BYTES_PER_MB),
    estimatedPeakMB: runningEstimate(row),
  }));
  const totalMB = options.machineMemTotalMB ?? os.totalmem() / BYTES_PER_MB;
  const usedMB = options.machineMemUsedMB ?? (os.totalmem() - os.freemem()) / BYTES_PER_MB;
  const knownCurrentMB = running.reduce((sum, workload) => sum + workload.currentRssMB, 0);
  const baselineRssMB = Math.max(0, usedMB - knownCurrentMB);
  const verdict = canAdmitWorkload(
    candidate.id,
    candidate.estimatedPeakMB,
    running,
    totalMB,
    baselineRssMB,
    options.maxSystemPercent ?? configuredCeilingPercent(),
  );
  if (!verdict.admitted && verdict.candidatePeakMB != null) {
    lastRefusals.set(candidate.id, verdict);
  }
  return verdict;
}

/** Cross-platform working-set collector for non-systemd process identities. */
export function readCurrentRssMB(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  run: typeof spawnSync = spawnSync,
): number {
  if (!Number.isInteger(pid) || pid <= 0) return 0;
  if (platform === 'darwin' || platform === 'linux') {
    const result = run('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf-8' });
    const kb = Number(String(result.stdout ?? '').trim());
    return Number.isFinite(kb) && kb > 0 ? kb / 1024 : 0;
  }
  if (platform === 'win32') {
    const result = run(
      'wmic',
      ['process', 'where', `ProcessId=${pid}`, 'get', 'WorkingSetSize', '/value'],
      { encoding: 'utf-8' },
    );
    const match = String(result.stdout ?? '').match(/WorkingSetSize=(\d+)/i);
    const bytes = match ? Number(match[1]) : 0;
    return Number.isFinite(bytes) && bytes > 0 ? bytes / BYTES_PER_MB : 0;
  }
  return 0;
}

export interface WorkloadQueueEntry {
  id: WorkloadId;
  params: Record<string, unknown>;
  enqueuedAt: string;
  estimatedPeakMB: number;
  blockerIds: WorkloadId[];
}

export type WorkloadLauncher = (params: Record<string, unknown>) => Promise<void>;

export class WorkloadQueue {
  private entries = new Map<WorkloadId, WorkloadQueueEntry>();

  constructor(private readonly filePath: string = defaultQueuePath()) {
    this.load();
  }

  enqueue(
    id: WorkloadId,
    params: Record<string, unknown>,
    estimatedPeakMB: number,
    blockerIds: WorkloadId[] = [],
  ): WorkloadQueueEntry {
    if (!finiteNonNegative(estimatedPeakMB)) {
      throw new Error(`Cannot enqueue '${id}' without an authoritative peak-RSS estimate.`);
    }
    const entry: WorkloadQueueEntry = {
      id,
      params,
      estimatedPeakMB,
      blockerIds: [...new Set(blockerIds)],
      enqueuedAt: new Date().toISOString(),
    };
    this.entries.set(id, entry);
    this.persist();
    return entry;
  }

  dequeue(id: WorkloadId): boolean {
    const removed = this.entries.delete(id);
    if (removed) this.persist();
    return removed;
  }

  peek(): WorkloadQueueEntry[] {
    return [...this.entries.values()].sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));
  }

  isEmpty(): boolean {
    return this.entries.size === 0;
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as unknown;
      if (!Array.isArray(parsed)) throw new Error('queue root must be an array');
      for (const raw of parsed) {
        if (!isQueueEntry(raw)) throw new Error('queue entry has an invalid shape');
        this.entries.set(raw.id, raw);
      }
    } catch (error) {
      log.error(
        '[WorkloadAdmission] Failed to load queue %s: %s',
        this.filePath,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  private persist(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.peek(), null, 2), 'utf-8');
    renameSync(temporary, this.filePath);
  }
}

function isQueueEntry(value: unknown): value is WorkloadQueueEntry {
  if (typeof value !== 'object' || value == null) return false;
  const row = value as Record<string, unknown>;
  return (
    (row.id === 'sweep' || row.id === 'mining' || row.id === 'lstm') &&
    typeof row.params === 'object' &&
    row.params != null &&
    typeof row.enqueuedAt === 'string' &&
    typeof row.estimatedPeakMB === 'number' &&
    Array.isArray(row.blockerIds)
  );
}

function defaultQueuePath(): string {
  const base = app.isPackaged ? app.getPath('userData') : app.getAppPath();
  return path.join(base, 'logs', 'research', QUEUE_FILENAME);
}

let queueSingleton: WorkloadQueue | null = null;
const launchers = new Map<WorkloadId, WorkloadLauncher>();
const lastRefusals = new Map<WorkloadId, AdmissionRefusal>();
let lastQueueTickAt = 0;
let queueTickInFlight = false;

export function getWorkloadQueue(): WorkloadQueue {
  if (!queueSingleton) queueSingleton = new WorkloadQueue();
  return queueSingleton;
}

export function registerWorkloadLauncher(id: WorkloadId, launcher: WorkloadLauncher): void {
  launchers.set(id, launcher);
}

/** Retrieve the last authoritative refusal produced by the owning gate. */
export function getLastAdmissionRefusal(id: WorkloadId): AdmissionRefusal | null {
  return lastRefusals.get(id) ?? null;
}

/**
 * Re-evaluate and launch every currently admissible queued workload. The
 * queue entry is removed after any launch attempt so a rejected child-process
 * start cannot be retried indefinitely without an explicit new request.
 */
export async function drainWorkloadQueue(
  queue: WorkloadQueue,
  verdictFor: (entry: WorkloadQueueEntry) => AdmissionVerdict = (entry) =>
    buildAdmissionSnapshot({ id: entry.id, estimatedPeakMB: entry.estimatedPeakMB }),
  launcherFor: (id: WorkloadId) => WorkloadLauncher | undefined = (id) => launchers.get(id),
): Promise<void> {
  for (const entry of queue.peek()) {
    const verdict = verdictFor(entry);
    if (!verdict.admitted) continue;
    const launcher = launcherFor(entry.id);
    if (!launcher) {
      log.error('[WorkloadAdmission] No registered launcher for queued workload %s', entry.id);
      continue;
    }
    try {
      await launcher(entry.params);
    } catch (error) {
      log.error(
        '[WorkloadAdmission] Queued %s launch failed: %s',
        entry.id,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      queue.dequeue(entry.id);
    }
  }
}

export async function tickWorkloadQueue(nowMs: number = Date.now()): Promise<void> {
  if (queueTickInFlight || nowMs - lastQueueTickAt < WORKLOAD_QUEUE_POLL_INTERVAL_MS) return;
  lastQueueTickAt = nowMs;
  const queue = getWorkloadQueue();
  if (queue.isEmpty()) return;
  queueTickInFlight = true;
  try {
    await drainWorkloadQueue(queue);
  } finally {
    queueTickInFlight = false;
  }
}

export function admissionRefusalPayload(refusalVerdict: AdmissionRefusal): {
  success: false;
  error: string;
  errorCode: string;
  data: AdmissionRefusal;
} {
  return {
    success: false,
    error: refusalVerdict.reason,
    errorCode: refusalVerdict.errorCode,
    data: refusalVerdict,
  };
}

export function _resetWorkloadAdmissionForTest(): void {
  queueSingleton = null;
  launchers.clear();
  lastRefusals.clear();
  lastQueueTickAt = 0;
  queueTickInFlight = false;
}
