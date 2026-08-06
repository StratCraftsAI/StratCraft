import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';

import { appLog } from '../utils/logger';

// TICKET_1192_1 F0: on Linux, os.freemem() returns MemFree — completely free
// pages, excluding reclaimable page cache. On a cached-up machine MemFree sits
// at a few GB while true MemAvailable is tens of GB, so every consumer of
// memAvailableMB (TICKET_1114/1192 memory gates, worker-cap derivation)
// under-estimates. Parse MemAvailable from /proc/meminfo instead.
const MEMINFO_PATH = '/proc/meminfo';
const KB_PER_MB = 1024;


export function parseMemAvailableKB(meminfo: string): number | null {
  const match = /^MemAvailable:\s+(\d+)\s*kB/m.exec(meminfo);
  return match ? Number(match[1]) : null;
}

// TICKET_1257_1 3.1: swap axis. Parsed from the SAME /proc/meminfo read that
// sources MemAvailable (SwapTotal / SwapFree) -- one file read, no new syscall.
// This is the identical swap signal TICKET_1285's runtime ResourceGate consumes,
// so the pre-run estimate and the runtime gate agree on the axis. `SwapTotal: 0`
// (swap disabled) yields swapTotalMB=0 / swapUtilization=0; a missing field or
// non-Linux platform degrades to the same zeros (graceful, mirrors the
// MemAvailable fallback semantics -- a swap-blind machine is reported as "no
// swap", never as a crash).
export interface SwapInfoKB {
  swapTotalKB: number;
  swapUsedKB: number;
}

/** Parse SwapTotal / SwapFree (kB) from a /proc/meminfo blob. Returns null when
 *  SwapTotal is absent (field missing entirely -- treated as "unknown" by the
 *  caller, which falls back to zeros). A present `SwapTotal: 0` returns
 *  { total: 0, used: 0 } (swap disabled is a KNOWN state, not a parse miss). */
export function parseSwapKB(meminfo: string): SwapInfoKB | null {
  const totalMatch = /^SwapTotal:\s+(\d+)\s*kB/m.exec(meminfo);
  if (!totalMatch) {
    return null;
  }
  const swapTotalKB = Number(totalMatch[1]);
  const freeMatch = /^SwapFree:\s+(\d+)\s*kB/m.exec(meminfo);
  // SwapFree missing but SwapTotal present is degenerate; treat free as total
  // (used = 0) rather than inventing pressure.
  const swapFreeKB = freeMatch ? Number(freeMatch[1]) : swapTotalKB;
  const swapUsedKB = Math.max(0, swapTotalKB - swapFreeKB);
  return { swapTotalKB, swapUsedKB };
}

export interface SwapState {
  swapTotalMB: number;
  swapUsedMB: number;
  swapUtilization: number; // swapUsedMB / swapTotalMB (0..1); 0 when SwapTotal==0
}

const SWAP_ZERO: SwapState = { swapTotalMB: 0, swapUsedMB: 0, swapUtilization: 0 };

let swapFallbackWarned = false;

export function __resetSwapFallbackWarnForTest(): void {
  swapFallbackWarned = false;
}

function warnSwapFallbackOnce(reason: string): void {
  if (swapFallbackWarned) {
    return;
  }
  swapFallbackWarned = true;
  appLog.warn(
    `[compute-environment] TICKET_1257_1: swap probe falling back to zeros ` +
    `(pre-run modal reports "no swap"): ${reason}`,
  );
}

/** Read swap state from /proc/meminfo. Non-Linux / unreadable / no SwapTotal
 *  field -> zeros (a machine we cannot probe is reported as swap-free, never
 *  fabricated pressure). SwapTotal==0 (swap disabled) is a first-class zero,
 *  not a fallback. */
export function readSwapMB(): SwapState {
  if (process.platform !== 'linux') {
    warnSwapFallbackOnce(`platform ${process.platform} has no ${MEMINFO_PATH}`);
    return SWAP_ZERO;
  }
  let parsed: SwapInfoKB | null;
  try {
    parsed = parseSwapKB(fs.readFileSync(MEMINFO_PATH, 'utf8'));
  } catch (err) {
    warnSwapFallbackOnce(
      `${MEMINFO_PATH} read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return SWAP_ZERO;
  }
  if (parsed === null) {
    warnSwapFallbackOnce(`SwapTotal not found in ${MEMINFO_PATH}`);
    return SWAP_ZERO;
  }
  const swapTotalMB = parsed.swapTotalKB / KB_PER_MB;
  const swapUsedMB = parsed.swapUsedKB / KB_PER_MB;
  return {
    swapTotalMB,
    swapUsedMB,
    swapUtilization: swapTotalMB > 0 ? swapUsedMB / swapTotalMB : 0,
  };
}

let memAvailableFallbackWarned = false;

export function __resetMemAvailableFallbackWarnForTest(): void {
  memAvailableFallbackWarned = false;
}

function warnMemAvailableFallbackOnce(reason: string): void {
  if (memAvailableFallbackWarned) {
    return;
  }
  memAvailableFallbackWarned = true;
  appLog.warn(
    `[compute-environment] TICKET_1192_1: memAvailableMB falling back to ` +
    `os.freemem() (MemFree semantics, under-estimates on cached-up Linux): ${reason}`,
  );
}

export function readMemAvailableMB(): number {
  if (process.platform === 'linux') {
    try {
      const kb = parseMemAvailableKB(fs.readFileSync(MEMINFO_PATH, 'utf8'));
      if (kb !== null) {
        return kb / KB_PER_MB;
      }
      warnMemAvailableFallbackOnce(`MemAvailable not found in ${MEMINFO_PATH}`);
    } catch (err) {
      warnMemAvailableFallbackOnce(
        `${MEMINFO_PATH} read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    warnMemAvailableFallbackOnce(`platform ${process.platform} has no ${MEMINFO_PATH}`);
  }
  return os.freemem() / (1024 * 1024);
}

// ---------------------------------------------------------------------------
// TICKET_1204 P2-1: sibling electron RSS probe.
// Enumerates electron PIDs owned by the current user, excludes the caller's
// own process tree (renderers match the pgrep pattern too), and sums VmRSS
// from /proc/<pid>/status for the remaining PIDs.
// ---------------------------------------------------------------------------

export interface SiblingElectronRssResult {
  totalMB: number;
  count: number;
}

let siblingRssFallbackWarned = false;

export function __resetSiblingRssFallbackWarnForTest(): void {
  siblingRssFallbackWarned = false;
}

/**
 * Walk the PPid chain for `pid` up to init (1) and return the set of
 * ancestor PIDs. Used to identify PIDs belonging to the caller's own
 * process tree so they can be excluded from the sibling scan.
 */
function getAncestorPids(pid: number): Set<number> {
  const ancestors = new Set<number>();
  let current = pid;
  while (current > 1) {
    ancestors.add(current);
    try {
      const status = fs.readFileSync(`/proc/${current}/status`, 'utf8');
      const ppidMatch = /^PPid:\s+(\d+)/m.exec(status);
      if (!ppidMatch) break;
      current = Number(ppidMatch[1]);
    } catch {
      break;
    }
  }
  return ancestors;
}

/**
 * Check whether `pid` belongs to the caller's own process tree by walking
 * its PPid chain until it reaches `process.pid` or init.
 */
function isInOwnProcessTree(pid: number, ownPid: number, ownAncestors: Set<number>): boolean {
  if (pid === ownPid) return true;
  let current = pid;
  // Walk up to a bounded depth to avoid pathological loops.
  for (let depth = 0; depth < 64; depth++) {
    try {
      const status = fs.readFileSync(`/proc/${current}/status`, 'utf8');
      const ppidMatch = /^PPid:\s+(\d+)/m.exec(status);
      if (!ppidMatch) return false;
      const ppid = Number(ppidMatch[1]);
      if (ppid === ownPid) return true;
      if (ownAncestors.has(ppid)) return true;
      if (ppid <= 1) return false;
      current = ppid;
    } catch {
      return false;
    }
  }
  return false;
}

export function readSiblingElectronRssMB(): SiblingElectronRssResult {
  if (process.platform !== 'linux') {
    return { totalMB: 0, count: 0 };
  }

  try {
    const uid = execSync('id -u', { encoding: 'utf8', timeout: 2000 }).trim();
    let pgrepOutput: string;
    try {
      pgrepOutput = execSync(`pgrep -u ${uid} -f electron`, {
        encoding: 'utf8',
        timeout: 2000,
      }).trim();
    } catch {
      // pgrep returns exit code 1 when no processes match — not an error.
      return { totalMB: 0, count: 0 };
    }

    if (!pgrepOutput) {
      return { totalMB: 0, count: 0 };
    }

    const pids = pgrepOutput
      .split('\n')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);

    const ownPid = process.pid;
    const ownAncestors = getAncestorPids(ownPid);

    let totalKB = 0;
    let count = 0;

    for (const pid of pids) {
      if (isInOwnProcessTree(pid, ownPid, ownAncestors)) {
        continue;
      }
      try {
        const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
        const vmRssMatch = /^VmRSS:\s+(\d+)\s*kB/m.exec(status);
        if (vmRssMatch) {
          totalKB += Number(vmRssMatch[1]);
          count++;
        }
      } catch {
        // PID vanished between pgrep and read — skip.
      }
    }

    return { totalMB: totalKB / KB_PER_MB, count };
  } catch (err) {
    if (!siblingRssFallbackWarned) {
      siblingRssFallbackWarned = true;
      appLog.warn(
        `[compute-environment] TICKET_1204 P2: readSiblingElectronRssMB failed, ` +
        `degrading to { totalMB: 0, count: 0 }: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { totalMB: 0, count: 0 };
  }
}

// ---------------------------------------------------------------------------
// TICKET_1204 P2-1: memory pressure probe.
// Parses the `some avg10=<value>` line from /proc/pressure/memory.
// Returns null on non-Linux or when the file is absent/unreadable.
// ---------------------------------------------------------------------------

const PRESSURE_MEMORY_PATH = '/proc/pressure/memory';

export function readMemoryPressureSome10(): number | null {
  if (process.platform !== 'linux') {
    return null;
  }
  try {
    const content = fs.readFileSync(PRESSURE_MEMORY_PATH, 'utf8');
    // Format: some avg10=0.00 avg60=0.00 avg300=0.00 total=12345
    const match = /^some\s+avg10=(\d+(?:\.\d+)?)/m.exec(content);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

export interface ComputeEnvironmentState {
  totalCores: number;
  cpuAvailable: number;
  cpuUtilization: number;
  memAvailableMB: number;
  memTotalMB: number;
  memUtilization: number;
  // TICKET_1257_1 3.1: swap axis (shared with TICKET_1285 ResourceGate).
  swapTotalMB: number;
  swapUsedMB: number;
  swapUtilization: number;
  appMemMB: number;
  sweepActive: boolean;
  sweepInFlightArms: number;
  sweepConcurrency: number;
  lstmTrainingActive: boolean;
  /** TICKET_1249_2 D2: active factor mining compute children (run-factor-mining.py). */
  miningWorkers: number;
  probedAt: number;
}

interface CpuSnapshot {
  idle: number[];
  total: number[];
}

interface OrchestratorLike {
  getIsRunning(): boolean;
  getInFlightArms(): number;
  getResolvedConcurrency(): number;
}

/** TICKET_1249_2 D2: count active factor mining compute children.
 *  Mining runs as a systemd user unit, outside Electron's process tree.
 *  pgrep is the simplest reliable cross-invocation detection.
 *  Returns 0 on error or no match (pgrep exits 1 when no match). */
export function countMiningWorkers(): number {
  if (process.platform !== 'linux') return 0;
  try {
    const result = execSync(
      "pgrep -cf 'run-factor-mining\\.py'",
      { timeout: 1000, encoding: 'utf-8' },
    );
    const count = parseInt(result.trim(), 10);
    // -1: parent orchestrator is lightweight; only count compute children
    return Math.max(0, count - 1);
  } catch {
    return 0;
  }
}

export class ComputeEnvironment {
  private lastSnapshot: CpuSnapshot | null = null;
  private lastSnapshotAt = 0;
  private lastDelta: { busyCores: number } | null = null;

  constructor(
    private readonly getOrchestrator: () => OrchestratorLike | null,
    private readonly getLstmActive: () => boolean = () => false,
  ) {}

  async probe(): Promise<ComputeEnvironmentState> {
    const snap1 = this.takeCpuSnapshot();
    await this.sleep(100);
    const snap2 = this.takeCpuSnapshot();
    const delta = this.computeCpuDelta(snap1, snap2);
    this.lastSnapshot = snap2;
    this.lastSnapshotAt = Date.now();
    this.lastDelta = delta;

    return this.buildState(delta.busyCores);
  }

  quickProbe(): ComputeEnvironmentState {
    const age = Date.now() - this.lastSnapshotAt;
    if (this.lastDelta && age < 5_000) {
      return this.buildState(this.lastDelta.busyCores);
    }
    const loadAvg = os.loadavg()[0];
    const totalCores = os.cpus().length;
    const busyCores = loadAvg > 0
      ? Math.min(loadAvg, totalCores)
      : totalCores * 0.5;
    return this.buildState(busyCores);
  }

  private buildState(busyCores: number): ComputeEnvironmentState {
    const totalCores = os.cpus().length;
    const cpuAvailable = Math.max(0.5, totalCores - busyCores);
    const memTotalMB = os.totalmem() / (1024 * 1024);
    const memAvailableMB = readMemAvailableMB();
    // TICKET_1257_1 3.1: read swap from the same /proc/meminfo the pre-run
    // modal and the 1285 runtime gate both consume.
    const swap = readSwapMB();
    const orch = this.getOrchestrator();

    return {
      totalCores,
      cpuAvailable,
      cpuUtilization: busyCores / totalCores,
      memAvailableMB,
      memTotalMB,
      memUtilization: 1 - memAvailableMB / memTotalMB,
      swapTotalMB: swap.swapTotalMB,
      swapUsedMB: swap.swapUsedMB,
      swapUtilization: swap.swapUtilization,
      appMemMB: process.memoryUsage().rss / (1024 * 1024),
      sweepActive: orch?.getIsRunning() ?? false,
      sweepInFlightArms: orch?.getInFlightArms() ?? 0,
      // TICKET_1249_2 D6: sweepConcurrency is the local orchestrator's value.
      // Sibling sweep instances (separate Electron processes) have their RSS
      // already reflected in memAvailableMB; their growth headroom is bounded
      // and partially accounted for by the EVAL_SYSTEM_RESERVE_MB cushion.
      sweepConcurrency: orch?.getResolvedConcurrency() ?? 0,
      lstmTrainingActive: this.getLstmActive(),
      miningWorkers: countMiningWorkers(),
      probedAt: Date.now(),
    };
  }

  private takeCpuSnapshot(): CpuSnapshot {
    const cpus = os.cpus();
    return {
      idle: cpus.map(c => c.times.idle),
      total: cpus.map(c =>
        c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq,
      ),
    };
  }

  private computeCpuDelta(
    a: CpuSnapshot,
    b: CpuSnapshot,
  ): { busyCores: number } {
    let busy = 0;
    for (let i = 0; i < a.idle.length; i++) {
      const totalDelta = b.total[i] - a.total[i];
      const idleDelta = b.idle[i] - a.idle[i];
      if (totalDelta > 0) {
        busy += (totalDelta - idleDelta) / totalDelta;
      }
    }
    return { busyCores: busy };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

let instance: ComputeEnvironment | null = null;

export function getComputeEnvironment(): ComputeEnvironment {
  if (!instance) {
    throw new Error('ComputeEnvironment not initialised -- call initComputeEnvironment first');
  }
  return instance;
}

export function initComputeEnvironment(
  getOrchestrator: () => OrchestratorLike | null,
  getLstmActive: () => boolean = () => false,
): ComputeEnvironment {
  instance = new ComputeEnvironment(getOrchestrator, getLstmActive);
  return instance;
}
