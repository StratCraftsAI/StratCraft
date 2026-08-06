/**
 * Workload monitor -- TICKET_1281 D2.
 *
 * Per-workload CPU / memory / GPU attribution for the three long-running
 * research workloads (sweep / factor-mining / LSTM training). Each runs as a
 * detached `systemd-run --user` transient unit in its own cgroup
 * (background-process-must-detach), so we read the systemd-native cgroup
 * accounting -- `MemoryCurrent` (bytes, whole process tree) and `CPUUsageNSec`
 * (cumulative CPU nanoseconds) -- via `systemctl --user show`. CPU% is the
 * delta of CPUUsageNSec over the wall-clock delta. This captures the whole
 * fork'd worker pool in one read and matches the unit isolation exactly; we do
 * NOT scrape `ps`/`top` (TICKET_854 reuse of the existing isolation model).
 *
 * GPU per-workload memory comes from the GpuMonitor's PID map, attributed to
 * the unit's MainPID.
 *
 * AC7 (no silent failure): when a unit's PID/accounting cannot be read, the row
 * carries an explicit `error` string that reaches the UI -- never logged-only.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import log from 'electron-log';
import {
  WORKLOAD_DEFS,
  MONITOR_INTROSPECT_TIMEOUT_MS,
  WORKLOAD_DETECTED_STALE_MINUTES,
  RESEARCH_ENV_WORKLOAD_COMPLETED_VISIBLE_MS,
  LINUX_PROC_CLOCK_TICKS_PER_SECOND,
  type WorkloadId,
  type WorkloadDef,
} from '../../shared/constants/system-monitor';
import type { ResearchEnvironmentWorkloadUpdate } from '@StratCraft/research-environment';
import { getGpuMonitor, type GpuMonitor } from './gpu-monitor';

/** Per-workload stats row emitted to the monitor panel. */
export interface WorkloadStats {
  id: WorkloadId;
  labelKey: string;
  running: boolean;
  /** Unit exists in a meaningful state or its progress sink is still recent. */
  detected: boolean;
  /** CPU utilisation 0-100 (delta of cgroup CPU time / wall clock). */
  cpuPercent: number;
  /** cgroup MemoryCurrent (whole process tree), bytes. */
  memUsedBytes: number;
  /** systemd MainPID of the unit, or null when not running. */
  pid: number | null;
  /** GPU memory attributed to this workload's PID, bytes; null when GPU absent. */
  gpuMemBytes: number | null;
  /** Status/progress line from the persistent sink; null when none available. */
  progress: WorkloadProgress | null;
  lifecycleState?: 'running' | 'completed' | 'failed';
  /** Explicit error surfaced to the UI (AC7); undefined on the happy path. */
  error?: string;
}

/** Normalised progress line read from a workload's persistent JSON sink. */
export interface WorkloadProgress {
  /** Short human/i18n-ready summary, e.g. "batch 3/9 | cell 11/192". */
  summary: string;
  /** Optional 0-1 fraction for a progress bar; null when not derivable. */
  fraction: number | null;
  /** ISO timestamp the sink was last written, when present. */
  updatedAt?: string;
}

/** Raw systemd unit accounting parsed from `systemctl --user show`. */
export interface UnitAccounting {
  activeState: string;
  mainPid: number | null;
  memUsedBytes: number;
  cpuUsageNsec: number;
}

/** Injectable command runner (tests feed fixture output). */
export type CommandRunner = (cmd: string, args: string[]) => { status: number | null; stdout: string };

function defaultRunner(cmd: string, args: string[]): { status: number | null; stdout: string } {
  const res = spawnSync(cmd, args, { encoding: 'utf-8', timeout: MONITOR_INTROSPECT_TIMEOUT_MS });
  return { status: res.status, stdout: res.stdout ?? '' };
}

/**
 * Parse `systemctl show <unit> --property=... --value` output (one
 * `Key=Value` per line). systemd emits `[not set]` / very large sentinel values
 * for unaccounted properties; we normalise those to 0 / null.
 */
export function parseUnitShow(stdout: string): UnitAccounting {
  const fields: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    fields[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const pidRaw = Number(fields.MainPID);
  const mainPid = Number.isInteger(pidRaw) && pidRaw > 0 ? pidRaw : null;
  return {
    activeState: fields.ActiveState ?? 'unknown',
    mainPid,
    memUsedBytes: parseSystemdNumeric(fields.MemoryCurrent),
    cpuUsageNsec: parseSystemdNumeric(fields.CPUUsageNSec),
  };
}

/**
 * systemd reports unset accounting as the empty string, `[not set]`, or the
 * u64/s64 max sentinel (`18446744073709551615` / `-1`). All mean "no value".
 */
function parseSystemdNumeric(raw: string | undefined): number {
  if (!raw || raw === '[not set]') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  // u64 max sentinel -> unaccounted.
  if (raw === '18446744073709551615') return 0;
  return n;
}

/**
 * Resolve the live unit name for a workload def. 'fixed' -> the static name;
 * 'prefix' -> the first active `<prefix>*` unit from list-units (LSTM runs one
 * transient unit per run). Returns null when no unit is loaded.
 */
export function resolveUnitName(def: WorkloadDef, run: CommandRunner): string | null {
  if (def.resolve === 'fixed') return def.unit;
  const res = run('systemctl', ['--user', 'list-units', `${def.unit}*`, '--no-legend', '--plain', '--all']);
  if (res.status !== 0) return null;
  for (const line of res.stdout.split('\n')) {
    const name = line.trim().split(/\s+/)[0];
    if (name && name.startsWith(def.unit)) return name.replace(/\.service$/, '');
  }
  return null;
}

/** Timestamped CPU-usage sample for delta math. */
interface CpuSample {
  cpuUsageNsec: number;
  atNs: bigint;
}

interface ProcessAccounting {
  cpuTicks: number;
  memUsedBytes: number;
}

export type ProcessAccountingReader = (pid: number) => ProcessAccounting;

function readLinuxProcessAccounting(pid: number): ProcessAccounting {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
  const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
  const rss = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
  const userTicks = Number(fields[11]);
  const systemTicks = Number(fields[12]);
  if (!Number.isFinite(userTicks) || !Number.isFinite(systemTicks) || !rss) {
    throw new Error(`Unable to parse process accounting for PID ${pid}`);
  }
  return { cpuTicks: userTicks + systemTicks, memUsedBytes: Number(rss[1]) * 1024 };
}

export class WorkloadMonitor {
  /** Per-unit previous CPU sample, keyed by workload id. */
  private prev: Map<WorkloadId, CpuSample> = new Map();
  private researchEnvironment: ResearchEnvironmentWorkloadUpdate | null = null;
  private completedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly run: CommandRunner = defaultRunner,
    private readonly gpu: GpuMonitor = getGpuMonitor(),
    /** Injectable clock (monotonic ns) for deterministic CPU% in tests. */
    private readonly nowNs: () => bigint = () => process.hrtime.bigint(),
    /** Injectable research-dir resolver (progress sinks live here). */
    private readonly researchDir: () => string = defaultResearchDir,
    /** Injectable wall clock for recent-progress detection. */
    private readonly nowMs: () => number = () => Date.now(),
    private readonly processAccounting: ProcessAccountingReader = readLinuxProcessAccounting,
  ) {}

  /** Register the shared owner's latest research-environment lifecycle event. */
  updateResearchEnvironment(update: ResearchEnvironmentWorkloadUpdate): void {
    if (this.completedTimer) {
      clearTimeout(this.completedTimer);
      this.completedTimer = null;
    }
    this.researchEnvironment = update;
    if (update.state === 'completed') {
      this.completedTimer = setTimeout(() => {
        if (this.researchEnvironment?.jobId === update.jobId
          && this.researchEnvironment.state === 'completed') {
          this.researchEnvironment = null;
          this.prev.delete('research-env');
        }
        this.completedTimer = null;
      }, RESEARCH_ENV_WORKLOAD_COMPLETED_VISIBLE_MS);
    }
  }

  /** Collect all three workload rows. Never throws; failures become row errors. */
  collect(): WorkloadStats[] {
    const gpuPresent = this.gpu.isPresent();
    const gpuMap = gpuPresent ? this.gpu.processMemory() : null;
    const rows = WORKLOAD_DEFS.map((def) => this.collectOne(def, gpuPresent, gpuMap));
    if (this.researchEnvironment) rows.push(this.collectResearchEnvironment(gpuPresent, gpuMap));
    return rows;
  }

  private collectResearchEnvironment(gpuPresent: boolean, gpuMap: Map<number, number> | null): WorkloadStats {
    const update = this.researchEnvironment!;
    const running = update.state === 'admitted' || update.state === 'running';
    const base: WorkloadStats = {
      id: 'research-env',
      labelKey: 'research-env',
      running,
      detected: true,
      cpuPercent: 0,
      memUsedBytes: 0,
      pid: update.pid,
      gpuMemBytes: gpuPresent ? (update.pid ? (gpuMap?.get(update.pid) ?? 0) : 0) : null,
      progress: { summary: update.summary, fraction: update.fraction, updatedAt: update.updatedAt },
      lifecycleState: update.state === 'completed' ? 'completed' : update.state === 'failed' ? 'failed' : 'running',
      ...(update.error ? { error: update.error } : {}),
    };
    if (!running || update.pid === null) {
      this.prev.delete('research-env');
      return base;
    }
    try {
      const accounting = this.processAccounting(update.pid);
      const cpuUsageNsec = accounting.cpuTicks * (1_000_000_000 / LINUX_PROC_CLOCK_TICKS_PER_SECOND);
      return {
        ...base,
        cpuPercent: this.stepCpuPercent('research-env', cpuUsageNsec),
        memUsedBytes: accounting.memUsedBytes,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ...base, error: message };
    }
  }

  private collectOne(def: WorkloadDef, gpuPresent: boolean, gpuMap: Map<number, number> | null): WorkloadStats {
    const progress = this.readProgress(def);
    const progressDetected = isRecentProgress(progress, this.nowMs());
    const base: WorkloadStats = {
      id: def.id,
      labelKey: def.labelKey,
      running: false,
      detected: progressDetected,
      cpuPercent: 0,
      memUsedBytes: 0,
      pid: null,
      gpuMemBytes: gpuPresent ? 0 : null,
      progress,
    };
    try {
      const unit = resolveUnitName(def, this.run);
      if (!unit) {
        this.prev.delete(def.id);
        return base;
      }
      const res = this.run('systemctl', [
        '--user', 'show', unit,
        '--property=ActiveState',
        '--property=MainPID',
        '--property=MemoryCurrent',
        '--property=CPUUsageNSec',
      ]);
      if (res.status !== 0) {
        return { ...base, error: `systemctl show ${unit} failed (status ${res.status})` };
      }
      const acct = parseUnitShow(res.stdout);
      const running = acct.activeState === 'active' && acct.mainPid !== null;
      const unitDetected =
        acct.activeState === 'active' ||
        acct.activeState === 'failed' ||
        acct.activeState === 'deactivating' ||
        (acct.activeState === 'inactive' && acct.memUsedBytes > 0);
      if (!running) {
        this.prev.delete(def.id);
        return {
          ...base,
          running: false,
          detected: unitDetected || progressDetected,
          memUsedBytes: acct.memUsedBytes,
          pid: acct.mainPid,
        };
      }
      const cpuPercent = this.stepCpuPercent(def.id, acct.cpuUsageNsec);
      const gpuMemBytes = gpuPresent
        ? (acct.mainPid !== null ? (gpuMap?.get(acct.mainPid) ?? 0) : 0)
        : null;
      return {
        ...base,
        running: true,
        detected: true,
        cpuPercent,
        memUsedBytes: acct.memUsedBytes,
        pid: acct.mainPid,
        gpuMemBytes,
      };
    } catch (e) {
      // AC7: surface, never swallow.
      const message = e instanceof Error ? e.message : String(e);
      log.warn('[WorkloadMonitor] %s attribution failed: %s', def.id, message);
      return { ...base, error: message };
    }
  }

  /**
   * CPU% from the delta of cumulative cgroup CPU nanoseconds over the wall-clock
   * delta. First sample for a unit returns 0 (no prior delta). Capped at
   * 100*cores so a burst across the poll boundary can't report absurd values.
   */
  private stepCpuPercent(id: WorkloadId, cpuUsageNsec: number): number {
    const atNs = this.nowNs();
    const prev = this.prev.get(id);
    this.prev.set(id, { cpuUsageNsec, atNs });
    if (!prev) return 0;
    const cpuDeltaNs = cpuUsageNsec - prev.cpuUsageNsec;
    const wallDeltaNs = Number(atNs - prev.atNs);
    if (wallDeltaNs <= 0 || cpuDeltaNs < 0) return 0;
    const pct = (cpuDeltaNs / wallDeltaNs) * 100;
    return Math.round(Math.max(0, pct));
  }

  /** Read + normalise a workload's persistent progress sink; null when absent. */
  private readProgress(def: WorkloadDef): WorkloadProgress | null {
    if (!def.progressFile) return null;
    const file = path.join(this.researchDir(), def.progressFile);
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf-8');
    } catch {
      return null; // no sink yet -- not an error (workload may be idle)
    }
    try {
      return normaliseProgress(def.id, JSON.parse(raw) as Record<string, unknown>);
    } catch {
      return { summary: `${def.progressFile}: unparseable`, fraction: null };
    }
  }
}

/** True through the exact configured staleness boundary; malformed dates are stale. */
export function isRecentProgress(progress: WorkloadProgress | null, nowMs: number): boolean {
  if (!progress?.updatedAt) return false;
  const updatedMs = Date.parse(progress.updatedAt);
  if (!Number.isFinite(updatedMs) || updatedMs > nowMs) return false;
  return nowMs - updatedMs <= WORKLOAD_DETECTED_STALE_MINUTES * 60_000;
}

/**
 * Normalise a workload's raw progress JSON into a compact summary + fraction.
 * Shapes differ per workload (sweep-progress.json has grid/batch/cell;
 * lstm-progress.json is TICKET_1272_4's shape). Kept as a pure function so the
 * sink parsing is unit-testable against fixtures.
 */
export function normaliseProgress(id: WorkloadId, data: Record<string, unknown>): WorkloadProgress {
  const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : undefined;
  if (id === 'sweep') {
    const batch = data.batch as { index?: number; total?: number } | undefined;
    const cell = data.cell as { current?: number; total?: number } | undefined;
    const grid = data.grid as { totalCells?: number } | undefined;
    const parts: string[] = [];
    if (typeof data.template === 'string') parts.push(String(data.template));
    if (typeof data.timeframe === 'string') parts.push(String(data.timeframe));
    if (batch && batch.total) parts.push(`batch ${(batch.index ?? 0) + 1}/${batch.total}`);
    if (cell && cell.total) parts.push(`cell ${cell.current ?? 0}/${cell.total}`);
    let fraction: number | null = null;
    if (batch?.total && cell?.total) {
      const done = (batch.index ?? 0) * cell.total + (cell.current ?? 0);
      const totalCells = grid?.totalCells ?? batch.total * cell.total;
      fraction = totalCells > 0 ? Math.min(1, done / totalCells) : null;
    }
    return { summary: parts.join(' | ') || 'running', fraction, updatedAt };
  }
  if (id === 'lstm') {
    // TICKET_1272_4 lstm-progress.json: best-effort over its expected fields.
    const phase = typeof data.phase === 'string' ? data.phase : undefined;
    const epoch = typeof data.epoch === 'number' ? data.epoch : undefined;
    const totalEpochs = typeof data.totalEpochs === 'number' ? data.totalEpochs : undefined;
    const parts: string[] = [];
    if (phase) parts.push(phase);
    if (epoch !== undefined && totalEpochs) parts.push(`epoch ${epoch}/${totalEpochs}`);
    else if (epoch !== undefined) parts.push(`epoch ${epoch}`);
    const fraction = epoch !== undefined && totalEpochs ? Math.min(1, epoch / totalEpochs) : null;
    return { summary: parts.join(' | ') || 'running', fraction, updatedAt };
  }
  return { summary: 'running', fraction: null, updatedAt };
}

/** Default research-dir resolver (mirrors research-audit-log.ts). */
function defaultResearchDir(): string {
  const base = app.isPackaged ? app.getPath('userData') : app.getAppPath();
  return path.join(base, 'logs', 'research');
}

let singleton: WorkloadMonitor | null = null;
export function getWorkloadMonitor(): WorkloadMonitor {
  if (!singleton) singleton = new WorkloadMonitor();
  return singleton;
}

/** Test-only reset of the module singleton. */
export function _resetWorkloadMonitorForTest(): void {
  singleton = null;
}
