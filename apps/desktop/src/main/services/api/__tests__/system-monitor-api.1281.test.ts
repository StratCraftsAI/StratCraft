/**
 * TICKET_1281 D4 -- system-monitor-api payload-shape unit test.
 *
 * Asserts `getSystemMonitorSnapshot()` composes the D1 system stats, the D3 GPU
 * stats, and the D2 workload rows into the `{ success, data: { system, gpu,
 * workloads, sampledAt } }` envelope the HTTP route + SSE poll rely on (AC8).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../system-resource-monitor', () => ({
  collectStats: vi.fn(() => ({
    cpuPercent: 42,
    perCorePercent: [10, 20, 30, 40],
    memUsedBytes: 1000,
    memTotalBytes: 4000,
    appMemUsedBytes: 100,
    appCpuPercent: 5,
  })),
}));

vi.mock('../../gpu-monitor', () => ({
  getGpuMonitor: () => ({ systemStats: () => ({ present: false }) }),
}));

vi.mock('../../workload-monitor', () => ({
  getWorkloadMonitor: () => ({
    collect: () => [
      { id: 'sweep', labelKey: 'sweep', running: true, cpuPercent: 90, memUsedBytes: 200, pid: 1, gpuMemBytes: null, progress: null },
      { id: 'mining', labelKey: 'mining', running: false, cpuPercent: 0, memUsedBytes: 0, pid: null, gpuMemBytes: null, progress: null },
      { id: 'lstm', labelKey: 'lstm', running: false, cpuPercent: 0, memUsedBytes: 0, pid: null, gpuMemBytes: null, progress: null },
    ],
  }),
}));

const { tickWorkloadQueue } = vi.hoisted(() => ({
  tickWorkloadQueue: vi.fn(async () => undefined),
}));
vi.mock('../../workload-admission-gate', () => ({
  getWorkloadQueue: () => ({ peek: () => [] }),
  tickWorkloadQueue,
}));

import { getSystemMonitorSnapshot } from '../system-monitor-api';

describe('getSystemMonitorSnapshot', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns the composed snapshot envelope', () => {
    const res = getSystemMonitorSnapshot();
    expect(res.success).toBe(true);
    expect(res.data.system.cpuPercent).toBe(42);
    expect(res.data.system.perCorePercent).toHaveLength(4);
    expect(res.data.gpu.present).toBe(false);
    expect(res.data.workloads.map((w) => w.id)).toEqual(['sweep', 'mining', 'lstm']);
    expect(res.data.queue).toEqual([]);
    expect(tickWorkloadQueue).toHaveBeenCalledOnce();
    expect(typeof res.data.sampledAt).toBe('number');
  });

  it('propagates GPU-absent honestly (no fabricated util field)', () => {
    const res = getSystemMonitorSnapshot();
    expect(res.data.gpu.present).toBe(false);
    expect((res.data.gpu as { utilPercent?: number }).utilPercent).toBeUndefined();
  });
});
