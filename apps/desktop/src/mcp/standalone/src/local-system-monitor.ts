/**
 * Local system monitor -- TICKET_1284.
 *
 * In-process system stats collector for the standalone MCP server. When the
 * Electron desktop app is not running (discoverServiceApi() returns null), the
 * SSE poll and the get_system_monitor tool fall back to this module instead of
 * returning empty data. Uses the same Node.js APIs as the desktop
 * system-resource-monitor (os.cpus/totalmem/freemem) and the same systemctl
 * cgroup accounting as WorkloadMonitor. No Electron dependency.
 */
import os from 'os';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

// ── Types (mirror the desktop types) ──────────────────────────────────

interface ResourceStats {
  cpuPercent: number;
  perCorePercent: number[];
  memUsedBytes: number;
  memTotalBytes: number;
  appMemUsedBytes: number;
  appCpuPercent: number;
}

interface GpuSystemStats {
  present: boolean;
  vendor?: 'nvidia' | 'amd';
  utilPercent?: number;
  memUsedBytes?: number;
  memTotalBytes?: number;
  error?: string;
}

type WorkloadId = 'sweep' | 'mining' | 'lstm';

interface WorkloadProgress {
  summary: string;
  fraction: number | null;
  updatedAt?: string;
}

interface WorkloadStats {
  id: WorkloadId;
  labelKey: string;
  running: boolean;
  detected: boolean;
  cpuPercent: number;
  memUsedBytes: number;
  pid: number | null;
  gpuMemBytes: number | null;
  progress: WorkloadProgress | null;
  error?: string;
}

export interface SystemMonitorSnapshot {
  system: ResourceStats;
  gpu: GpuSystemStats;
  workloads: WorkloadStats[];
  queue: WorkloadQueueEntry[];
  sampledAt: number;
}

// ── Constants (mirror shared/constants/system-monitor) ─────────────────

const SYSTEMD_LSTM_UNIT_PREFIX = 'stratcraft-lstm-train-';
const INTROSPECT_TIMEOUT_MS = 5_000;
const WORKLOAD_DETECTED_STALE_MS = 30 * 60_000;

interface WorkloadQueueEntry {
  id: WorkloadId;
  params: Record<string, unknown>;
  enqueuedAt: string;
  estimatedPeakMB: number;
  blockerIds: WorkloadId[];
}

interface WorkloadDef {
  id: WorkloadId;
  labelKey: string;
  resolve: 'fixed' | 'prefix';
  unit: string;
  progressFile: string | null;
}

const WORKLOAD_DEFS: readonly WorkloadDef[] = [
  { id: 'sweep', labelKey: 'sweep', resolve: 'fixed', unit: 'catboost-sweep', progressFile: 'sweep-progress.json' },
  { id: 'mining', labelKey: 'mining', resolve: 'fixed', unit: 'factor-mining', progressFile: null },
  { id: 'lstm', labelKey: 'lstm', resolve: 'prefix', unit: SYSTEMD_LSTM_UNIT_PREFIX, progressFile: 'lstm-progress.json' },
];

// ── CPU delta state ───────────────────────────────────────────────────

let prevCpuTimes: { idle: number; total: number } | null = null;
let prevPerCoreTimes: Array<{ idle: number; total: number }> | null = null;
let prevAppCpu: { user: number; system: number; timestamp: number } | null = null;

function samplePerCoreTimes(): Array<{ idle: number; total: number }> {
  return os.cpus().map((cpu) => {
    const t = cpu.times;
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
  });
}

function busyPercent(prev: { idle: number; total: number }, curr: { idle: number; total: number }): number {
  const idleDelta = curr.idle - prev.idle;
  const totalDelta = curr.total - prev.total;
  if (totalDelta <= 0) return 0;
  return Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
}

function collectResourceStats(): ResourceStats {
  const perCore = samplePerCoreTimes();
  const currentAgg = perCore.reduce((a, c) => ({ idle: a.idle + c.idle, total: a.total + c.total }), { idle: 0, total: 0 });

  let aggregate = 0;
  let perCorePercent = perCore.map(() => 0);
  if (prevCpuTimes && prevPerCoreTimes && prevPerCoreTimes.length === perCore.length) {
    perCorePercent = perCore.map((core, i) => busyPercent(prevPerCoreTimes![i], core));
    aggregate = busyPercent(prevCpuTimes, currentAgg);
  }
  prevCpuTimes = currentAgg;
  prevPerCoreTimes = perCore;

  const memTotalBytes = os.totalmem();
  const memUsedBytes = memTotalBytes - os.freemem();

  const usage = process.cpuUsage();
  const now = Date.now();
  let appCpuPercent = 0;
  if (prevAppCpu) {
    const elapsedMs = now - prevAppCpu.timestamp;
    if (elapsedMs > 0) {
      const totalCpuUs = (usage.user - prevAppCpu.user) + (usage.system - prevAppCpu.system);
      appCpuPercent = Math.round((totalCpuUs / (elapsedMs * 1000)) * 100);
    }
  }
  prevAppCpu = { user: usage.user, system: usage.system, timestamp: now };

  return {
    cpuPercent: aggregate,
    perCorePercent,
    memUsedBytes,
    memTotalBytes,
    appMemUsedBytes: process.memoryUsage().rss,
    appCpuPercent,
  };
}

// ── GPU probe ─────────────────────────────────────────────────────────

let gpuVendor: 'nvidia' | 'amd' | null | undefined;

function probeGpu(): GpuSystemStats {
  if (gpuVendor === undefined) {
    const nvidia = spawnSync('nvidia-smi', ['--version'], { encoding: 'utf-8', timeout: INTROSPECT_TIMEOUT_MS });
    if (nvidia.status === 0) { gpuVendor = 'nvidia'; }
    else {
      const amd = spawnSync('rocm-smi', ['--version'], { encoding: 'utf-8', timeout: INTROSPECT_TIMEOUT_MS });
      gpuVendor = amd.status === 0 ? 'amd' : null;
    }
  }
  if (!gpuVendor) return { present: false };

  if (gpuVendor === 'nvidia') {
    const res = spawnSync('nvidia-smi', [
      '--query-gpu=utilization.gpu,memory.used,memory.total',
      '--format=csv,noheader,nounits',
    ], { encoding: 'utf-8', timeout: INTROSPECT_TIMEOUT_MS });
    if (res.status !== 0) return { present: true, vendor: 'nvidia', error: `nvidia-smi query failed (status ${res.status})` };
    const rows = (res.stdout ?? '').split('\n').map(l => l.trim()).filter(Boolean);
    let utilSum = 0, memUsedMib = 0, memTotalMib = 0, counted = 0;
    for (const row of rows) {
      const parts = row.split(',').map(p => p.trim());
      if (parts.length < 3) continue;
      const [u, m, t] = parts.map(Number);
      if ([u, m, t].every(Number.isFinite)) { utilSum += u; memUsedMib += m; memTotalMib += t; counted++; }
    }
    if (counted === 0) return { present: true, vendor: 'nvidia', error: 'nvidia-smi returned no parseable rows' };
    const MIB = 1024 * 1024;
    return { present: true, vendor: 'nvidia', utilPercent: Math.round(utilSum / counted), memUsedBytes: memUsedMib * MIB, memTotalBytes: memTotalMib * MIB };
  }
  return { present: true, vendor: 'amd', error: 'AMD GPU detected; per-process attribution not yet supported' };
}

// ── Per-workload stats ────────────────────────────────────────────────

const workloadCpuPrev = new Map<WorkloadId, { cpuUsageNsec: number; atNs: bigint }>();

function resolveResearchDir(): string {
  return path.join(process.cwd(), 'logs', 'research');
}

function resolveUnitName(def: WorkloadDef): string | null {
  if (def.resolve === 'fixed') return def.unit;
  const res = spawnSync('systemctl', ['--user', 'list-units', `${def.unit}*`, '--no-legend', '--plain', '--all'], {
    encoding: 'utf-8', timeout: INTROSPECT_TIMEOUT_MS,
  });
  if (res.status !== 0) return null;
  for (const line of (res.stdout ?? '').split('\n')) {
    const name = line.trim().split(/\s+/)[0];
    if (name && name.startsWith(def.unit)) return name.replace(/\.service$/, '');
  }
  return null;
}

function parseSystemdNumeric(raw: string | undefined): number {
  if (!raw || raw === '[not set]') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (raw === '18446744073709551615') return 0;
  return n;
}

function readWorkloadProgress(def: WorkloadDef): WorkloadProgress | null {
  if (!def.progressFile) return null;
  const file = path.join(resolveResearchDir(), def.progressFile);
  let raw: string;
  try { raw = fs.readFileSync(file, 'utf-8'); } catch { return null; }
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return normaliseProgress(def.id, data);
  } catch { return { summary: `${def.progressFile}: unparseable`, fraction: null }; }
}

function normaliseProgress(id: WorkloadId, data: Record<string, unknown>): WorkloadProgress {
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

function collectWorkloads(gpuStats: GpuSystemStats): WorkloadStats[] {
  const gpuPresent = gpuStats.present;
  return WORKLOAD_DEFS.map((def): WorkloadStats => {
    const progress = readWorkloadProgress(def);
    const updatedMs = progress?.updatedAt ? Date.parse(progress.updatedAt) : Number.NaN;
    const recentProgress =
      Number.isFinite(updatedMs) &&
      updatedMs <= Date.now() &&
      Date.now() - updatedMs <= WORKLOAD_DETECTED_STALE_MS;
    const base: WorkloadStats = {
      id: def.id, labelKey: def.labelKey, running: false, detected: recentProgress, cpuPercent: 0,
      memUsedBytes: 0, pid: null, gpuMemBytes: gpuPresent ? 0 : null,
      progress,
    };
    try {
      const unit = resolveUnitName(def);
      if (!unit) { workloadCpuPrev.delete(def.id); return base; }
      const res = spawnSync('systemctl', [
        '--user', 'show', unit,
        '--property=ActiveState', '--property=MainPID',
        '--property=MemoryCurrent', '--property=CPUUsageNSec',
      ], { encoding: 'utf-8', timeout: INTROSPECT_TIMEOUT_MS });
      if (res.status !== 0) return { ...base, error: `systemctl show ${unit} failed (status ${res.status})` };

      const fields: Record<string, string> = {};
      for (const line of (res.stdout ?? '').split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) fields[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
      const pidRaw = Number(fields.MainPID);
      const mainPid = Number.isInteger(pidRaw) && pidRaw > 0 ? pidRaw : null;
      const activeState = fields.ActiveState ?? 'unknown';
      const memUsedBytes = parseSystemdNumeric(fields.MemoryCurrent);
      const cpuUsageNsec = parseSystemdNumeric(fields.CPUUsageNSec);
      const running = activeState === 'active' && mainPid !== null;
      const detected =
        activeState === 'active' ||
        activeState === 'failed' ||
        activeState === 'deactivating' ||
        (activeState === 'inactive' && memUsedBytes > 0) ||
        recentProgress;

      if (!running) { workloadCpuPrev.delete(def.id); return { ...base, running: false, detected, memUsedBytes, pid: mainPid }; }

      const atNs = process.hrtime.bigint();
      const prev = workloadCpuPrev.get(def.id);
      workloadCpuPrev.set(def.id, { cpuUsageNsec, atNs });
      let cpuPercent = 0;
      if (prev) {
        const cpuDeltaNs = cpuUsageNsec - prev.cpuUsageNsec;
        const wallDeltaNs = Number(atNs - prev.atNs);
        if (wallDeltaNs > 0 && cpuDeltaNs >= 0) cpuPercent = Math.round((cpuDeltaNs / wallDeltaNs) * 100);
      }
      return { ...base, running: true, detected: true, cpuPercent, memUsedBytes, pid: mainPid, gpuMemBytes: gpuPresent ? 0 : null };
    } catch (e) {
      return { ...base, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

function readQueue(): WorkloadQueueEntry[] {
  const file = path.join(resolveResearchDir(), 'workload-queue.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    return Array.isArray(parsed) ? parsed as WorkloadQueueEntry[] : [];
  } catch {
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────

export function collectLocalSnapshot(): SystemMonitorSnapshot {
  const system = collectResourceStats();
  const gpu = probeGpu();
  const workloads = collectWorkloads(gpu);
  return { system, gpu, workloads, queue: readQueue(), sampledAt: Date.now() };
}
