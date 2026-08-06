import os from 'os';
import log from 'electron-log';
import { sendToRenderer } from '../window';
import { tickWorkloadQueue } from './workload-admission-gate';

export interface ResourceStats {
  cpuPercent: number;
  /**
   * TICKET_1281 D1: per-logical-core utilisation (0-100), one entry per
   * `os.cpus()` core. Exposes the 28-pipeline parallelism (TICKET_077) the
   * aggregate `cpuPercent` collapses. Length == os.cpus().length; first
   * sample after start is all-zero until a delta exists.
   */
  perCorePercent: number[];
  memUsedBytes: number;
  memTotalBytes: number;
  appMemUsedBytes: number;
  appCpuPercent: number;
}

const POLL_INTERVAL_MS = 2_000;
const CHANNEL = 'system:resource-stats';

let timer: ReturnType<typeof setInterval> | null = null;
let prevCpuTimes: { idle: number; total: number } | null = null;
/** TICKET_1281 D1: previous per-core idle/total snapshot for delta math. */
let prevPerCoreTimes: Array<{ idle: number; total: number }> | null = null;
let prevAppCpu: { user: number; system: number; timestamp: number } | null = null;

/** Per-core idle/total tick counts sampled straight from os.cpus(). */
function samplePerCoreTimes(): Array<{ idle: number; total: number }> {
  return os.cpus().map((cpu) => {
    const t = cpu.times;
    return {
      idle: t.idle,
      total: t.user + t.nice + t.sys + t.idle + t.irq,
    };
  });
}

function sampleCpuTimes(perCore: Array<{ idle: number; total: number }>): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const core of perCore) {
    idle += core.idle;
    total += core.total;
  }
  return { idle, total };
}

/** Busy percentage from an idle/total delta pair; 0 when no time elapsed. */
function busyPercent(prev: { idle: number; total: number }, current: { idle: number; total: number }): number {
  const idleDelta = current.idle - prev.idle;
  const totalDelta = current.total - prev.total;
  if (totalDelta <= 0) return 0;
  return Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
}

/**
 * TICKET_1281 D1: compute aggregate + per-core CPU from a single per-core
 * sample so both derive from the same instant (no double-sampling drift).
 */
function computeCpuPercent(perCore: Array<{ idle: number; total: number }>): {
  aggregate: number;
  perCorePercent: number[];
} {
  const current = sampleCpuTimes(perCore);
  const zeros = perCore.map(() => 0);
  if (!prevCpuTimes || !prevPerCoreTimes || prevPerCoreTimes.length !== perCore.length) {
    prevCpuTimes = current;
    prevPerCoreTimes = perCore;
    return { aggregate: 0, perCorePercent: zeros };
  }
  const perCorePercent = perCore.map((core, i) => busyPercent(prevPerCoreTimes![i], core));
  const aggregate = busyPercent(prevCpuTimes, current);
  prevCpuTimes = current;
  prevPerCoreTimes = perCore;
  return { aggregate, perCorePercent };
}

function computeAppCpuPercent(): number {
  const usage = process.cpuUsage();
  const now = Date.now();
  if (!prevAppCpu) {
    prevAppCpu = { user: usage.user, system: usage.system, timestamp: now };
    return 0;
  }
  const elapsedMs = now - prevAppCpu.timestamp;
  if (elapsedMs <= 0) return 0;
  const userDelta = usage.user - prevAppCpu.user;
  const systemDelta = usage.system - prevAppCpu.system;
  prevAppCpu = { user: usage.user, system: usage.system, timestamp: now };
  const totalCpuUs = userDelta + systemDelta;
  const elapsedUs = elapsedMs * 1000;
  return Math.round((totalCpuUs / elapsedUs) * 100);
}

/**
 * Sample and return the current whole-system resource snapshot. Advances the
 * CPU delta state, so callers must space calls apart (the poll timer does; the
 * D4 HTTP snapshot path shares this single stepping source).
 */
export function collectStats(): ResourceStats {
  const perCore = samplePerCoreTimes();
  const { aggregate, perCorePercent } = computeCpuPercent(perCore);
  const memTotalBytes = os.totalmem();
  const memUsedBytes = memTotalBytes - os.freemem();
  return {
    cpuPercent: aggregate,
    perCorePercent,
    memUsedBytes,
    memTotalBytes,
    appMemUsedBytes: process.memoryUsage().rss,
    appCpuPercent: computeAppCpuPercent(),
  };
}

export function startResourceMonitor(): void {
  if (timer) return;
  const perCore = samplePerCoreTimes();
  prevPerCoreTimes = perCore;
  prevCpuTimes = sampleCpuTimes(perCore);
  log.info('[ResourceMonitor] Started');
  timer = setInterval(() => {
    sendToRenderer(CHANNEL, collectStats());
    void tickWorkloadQueue().catch((error) => {
      log.error(
        '[ResourceMonitor] Workload queue tick failed: %s',
        error instanceof Error ? error.message : String(error),
      );
    });
  }, POLL_INTERVAL_MS);
}

export function stopResourceMonitor(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  prevCpuTimes = null;
  prevPerCoreTimes = null;
  prevAppCpu = null;
  log.info('[ResourceMonitor] Stopped');
}
