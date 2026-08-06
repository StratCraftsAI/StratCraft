/**
 * GPU monitor -- TICKET_1281 D3.
 *
 * Probes once for `nvidia-smi` (NVIDIA) / `rocm-smi` (AMD). When a GPU is
 * present, reports utilisation + per-process GPU memory. When absent, reports
 * an explicit `present: false` state so the UI can render "not present" -- NOT
 * a fabricated 0% and NOT a silently hidden section (TICKET_858 no silent
 * failure; TICKET_856 intentional, logged fallback).
 *
 * This machine currently has neither tool (the ML sweeps run CPU-bound), so the
 * absent branch is the live path today; the present branch is exercised by
 * unit tests with injected command output.
 */
import { spawnSync } from 'child_process';
import log from 'electron-log';
import { MONITOR_INTROSPECT_TIMEOUT_MS } from '../../shared/constants/system-monitor';

/** Whole-GPU utilisation snapshot (top / system section). */
export interface GpuSystemStats {
  present: boolean;
  /** Vendor tool that answered, when present. */
  vendor?: 'nvidia' | 'amd';
  /** GPU compute utilisation 0-100 (present only). */
  utilPercent?: number;
  /** Used / total GPU memory in bytes (present only). */
  memUsedBytes?: number;
  memTotalBytes?: number;
  /** Non-empty when the probe found a tool but the query failed (AC7). */
  error?: string;
}

/** Per-process GPU memory, keyed by PID (bottom / per-workload attribution). */
export type GpuProcessMap = Map<number, number>;

/** Injectable command runner so tests can feed fixture output. */
export type CommandRunner = (cmd: string, args: string[]) => { status: number | null; stdout: string };

function defaultRunner(cmd: string, args: string[]): { status: number | null; stdout: string } {
  const res = spawnSync(cmd, args, { encoding: 'utf-8', timeout: MONITOR_INTROSPECT_TIMEOUT_MS });
  return { status: res.status, stdout: res.stdout ?? '' };
}

const BYTES_PER_MIB = 1024 * 1024;

/**
 * Detect an available GPU vendor tool. Returns null when neither is present.
 * Pure over the injected runner: probes `--version` (cheap, no device access).
 */
export function detectGpuVendor(run: CommandRunner): 'nvidia' | 'amd' | null {
  const nvidia = run('nvidia-smi', ['--version']);
  if (nvidia.status === 0) return 'nvidia';
  const amd = run('rocm-smi', ['--version']);
  if (amd.status === 0) return 'amd';
  return null;
}

/**
 * Parse `nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total
 * --format=csv,noheader,nounits`. Values are integers; memory is in MiB.
 * Aggregates across multiple GPUs (util averaged, memory summed).
 */
export function parseNvidiaGpuQuery(stdout: string): { utilPercent: number; memUsedBytes: number; memTotalBytes: number } | null {
  const rows = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (rows.length === 0) return null;
  let utilSum = 0;
  let memUsedMib = 0;
  let memTotalMib = 0;
  let counted = 0;
  for (const row of rows) {
    const parts = row.split(',').map((p) => p.trim());
    if (parts.length < 3) continue;
    const util = Number(parts[0]);
    const used = Number(parts[1]);
    const total = Number(parts[2]);
    if (!Number.isFinite(util) || !Number.isFinite(used) || !Number.isFinite(total)) continue;
    utilSum += util;
    memUsedMib += used;
    memTotalMib += total;
    counted += 1;
  }
  if (counted === 0) return null;
  return {
    utilPercent: Math.round(utilSum / counted),
    memUsedBytes: memUsedMib * BYTES_PER_MIB,
    memTotalBytes: memTotalMib * BYTES_PER_MIB,
  };
}

/**
 * Parse `nvidia-smi --query-compute-apps=pid,used_memory
 * --format=csv,noheader,nounits` into a PID -> bytes map (memory in MiB).
 */
export function parseNvidiaComputeApps(stdout: string): GpuProcessMap {
  const map: GpuProcessMap = new Map();
  for (const line of stdout.split('\n')) {
    const row = line.trim();
    if (!row) continue;
    const parts = row.split(',').map((p) => p.trim());
    if (parts.length < 2) continue;
    const pid = Number(parts[0]);
    const usedMib = Number(parts[1]);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isFinite(usedMib)) continue;
    map.set(pid, usedMib * BYTES_PER_MIB);
  }
  return map;
}

export class GpuMonitor {
  private vendor: 'nvidia' | 'amd' | null = null;
  private probed = false;

  constructor(private readonly run: CommandRunner = defaultRunner) {}

  /** One-time vendor probe (idempotent). */
  private ensureProbed(): void {
    if (this.probed) return;
    this.probed = true;
    this.vendor = detectGpuVendor(this.run);
    if (this.vendor) {
      log.info('[GpuMonitor] GPU tooling detected: %s', this.vendor);
    } else {
      // TICKET_856: intentional, logged fallback -- no GPU tooling on this host.
      log.info('[GpuMonitor] No GPU tooling (nvidia-smi / rocm-smi) present -- reporting "not present"');
    }
  }

  /** Whole-system GPU stats for the top section. */
  systemStats(): GpuSystemStats {
    this.ensureProbed();
    if (!this.vendor) return { present: false };
    if (this.vendor === 'nvidia') {
      const res = this.run('nvidia-smi', [
        '--query-gpu=utilization.gpu,memory.used,memory.total',
        '--format=csv,noheader,nounits',
      ]);
      if (res.status !== 0) {
        return { present: true, vendor: 'nvidia', error: `nvidia-smi query failed (status ${res.status})` };
      }
      const parsed = parseNvidiaGpuQuery(res.stdout);
      if (!parsed) return { present: true, vendor: 'nvidia', error: 'nvidia-smi returned no parseable rows' };
      return { present: true, vendor: 'nvidia', ...parsed };
    }
    // AMD rocm-smi shape differs materially from nvidia-smi; until a rocm host
    // is available to validate the exact CSV, surface presence honestly rather
    // than emit an unverified parse (TICKET_857 fail-fast over guessing).
    return { present: true, vendor: 'amd', error: 'AMD GPU detected; per-process attribution not yet supported' };
  }

  /** Per-PID GPU memory map for workload attribution (empty when absent). */
  processMemory(): GpuProcessMap {
    this.ensureProbed();
    if (this.vendor !== 'nvidia') return new Map();
    const res = this.run('nvidia-smi', [
      '--query-compute-apps=pid,used_memory',
      '--format=csv,noheader,nounits',
    ]);
    if (res.status !== 0) return new Map();
    return parseNvidiaComputeApps(res.stdout);
  }

  /** True when a GPU tool answered the probe (for the workload rows' branch). */
  isPresent(): boolean {
    this.ensureProbed();
    return this.vendor !== null;
  }
}

let singleton: GpuMonitor | null = null;
export function getGpuMonitor(): GpuMonitor {
  if (!singleton) singleton = new GpuMonitor();
  return singleton;
}

/** Test-only reset of the module singleton. */
export function _resetGpuMonitorForTest(): void {
  singleton = null;
}
