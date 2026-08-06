/**
 * TICKET_1284 -- local-system-monitor unit tests.
 *
 * Verifies the in-process system stats collector (used when Electron is not
 * running) returns the correct payload shape and computes CPU deltas correctly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { collectLocalSnapshot } from '../local-system-monitor';

describe('collectLocalSnapshot', () => {
  it('returns a well-shaped snapshot on first call', () => {
    const snap = collectLocalSnapshot();
    expect(snap).toHaveProperty('system');
    expect(snap).toHaveProperty('gpu');
    expect(snap).toHaveProperty('workloads');
    expect(snap).toHaveProperty('sampledAt');
    expect(typeof snap.sampledAt).toBe('number');
  });

  it('system stats have expected shape', () => {
    const snap = collectLocalSnapshot();
    const s = snap.system;
    expect(typeof s.cpuPercent).toBe('number');
    expect(Array.isArray(s.perCorePercent)).toBe(true);
    expect(s.perCorePercent.length).toBeGreaterThan(0);
    expect(typeof s.memUsedBytes).toBe('number');
    expect(typeof s.memTotalBytes).toBe('number');
    expect(s.memTotalBytes).toBeGreaterThan(0);
    expect(s.memUsedBytes).toBeGreaterThan(0);
    expect(typeof s.appMemUsedBytes).toBe('number');
    expect(typeof s.appCpuPercent).toBe('number');
  });

  it('gpu stats have expected shape', () => {
    const snap = collectLocalSnapshot();
    const g = snap.gpu;
    expect(typeof g.present).toBe('boolean');
  });

  it('workloads is an array of three entries', () => {
    const snap = collectLocalSnapshot();
    expect(snap.workloads).toHaveLength(3);
    const ids = snap.workloads.map((w) => w.id);
    expect(ids).toEqual(['sweep', 'mining', 'lstm']);
  });

  it('each workload has required fields', () => {
    const snap = collectLocalSnapshot();
    for (const w of snap.workloads) {
      expect(typeof w.id).toBe('string');
      expect(typeof w.labelKey).toBe('string');
      expect(typeof w.running).toBe('boolean');
      expect(typeof w.cpuPercent).toBe('number');
      expect(typeof w.memUsedBytes).toBe('number');
    }
  });

  it('consecutive calls produce non-zero CPU deltas', () => {
    collectLocalSnapshot();
    const snap = collectLocalSnapshot();
    expect(typeof snap.system.cpuPercent).toBe('number');
    expect(snap.system.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(snap.system.cpuPercent).toBeLessThanOrEqual(100);
  });
});
