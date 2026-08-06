/**
 * System Monitor API -- TICKET_1281 D4.
 *
 * Composes the whole-system resource snapshot (D1 `collectStats`), the
 * per-workload attribution (D2 WorkloadMonitor), and the GPU probe (D3
 * GpuMonitor) into one payload for the web-dashboard monitor panel. The web
 * dashboard is a separate Vite app that reaches this over the Service API
 * bridge (HTTP) + the MCP SSE stream -- NOT the Electron `sendToRenderer`
 * channel (which the desktop renderer keeps using). The collector logic is
 * shared; only the emission adapter differs.
 */
import { collectStats, type ResourceStats } from '../system-resource-monitor';
import { getWorkloadMonitor, type WorkloadStats } from '../workload-monitor';
import { getGpuMonitor, type GpuSystemStats } from '../gpu-monitor';
import {
  getWorkloadQueue,
  tickWorkloadQueue,
  type WorkloadQueueEntry,
} from '../workload-admission-gate';

export interface SystemMonitorSnapshot {
  system: ResourceStats;
  gpu: GpuSystemStats;
  workloads: WorkloadStats[];
  queue: WorkloadQueueEntry[];
  /** Epoch ms the snapshot was sampled (UI staleness / degraded indicator). */
  sampledAt: number;
}

/**
 * Sample the current system-monitor snapshot. Advances the shared CPU-delta
 * state in `collectStats()` and the WorkloadMonitor's per-unit CPU state, so
 * this must be driven on a stable cadence (the SSE poll / renderer poll do
 * that); ad-hoc extra calls between polls only shorten the delta window.
 */
export function getSystemMonitorSnapshot(): { success: boolean; data: SystemMonitorSnapshot } {
  const system = collectStats();
  const gpu = getGpuMonitor().systemStats();
  const workloads = getWorkloadMonitor().collect();
  const queue = getWorkloadQueue().peek();
  void tickWorkloadQueue();
  return {
    success: true,
    data: { system, gpu, workloads, queue, sampledAt: Date.now() },
  };
}
