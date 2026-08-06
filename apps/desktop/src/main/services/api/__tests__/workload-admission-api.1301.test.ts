import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  lastRefusal: vi.fn(),
  enqueue: vi.fn(),
  dequeue: vi.fn(),
  peek: vi.fn(),
}));

vi.mock('../../workload-admission-gate', () => ({
  buildAdmissionSnapshot: mocks.snapshot,
  estimateWorkloadPeakMB: (id: string) =>
    id === 'sweep' ? 23_400 : id === 'mining' ? 27_000 : null,
  getLastAdmissionRefusal: mocks.lastRefusal,
  getWorkloadQueue: () => ({
    enqueue: mocks.enqueue,
    dequeue: mocks.dequeue,
    peek: mocks.peek,
  }),
}));

import { dequeue, enqueue, getQueue } from '../workload-admission-api';

describe('workload admission queue API (TICKET_1301)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.peek.mockReturnValue([]);
    mocks.enqueue.mockImplementation((id, params, peak, blockers) => ({
      id, params, estimatedPeakMB: peak, blockerIds: blockers,
    }));
    mocks.snapshot.mockReturnValue({ admitted: true, runningBreakdown: [] });
  });

  it('uses the fixed sweep estimator and never accepts a caller-supplied peak', () => {
    const result = enqueue({
      workload_id: 'sweep',
      params: { template_id: 7 },
      estimated_peak_mb: 1,
    });
    expect(result.success).toBe(true);
    expect(mocks.enqueue).toHaveBeenCalledWith(
      'sweep',
      { template_id: 7 },
      23_400,
      [],
    );
  });

  it('uses only the exact peak from the last owning-gate LSTM refusal', () => {
    mocks.lastRefusal.mockReturnValue({
      candidatePeakMB: 8_642,
      runningBreakdown: [{ id: 'mining' }],
    });
    mocks.snapshot.mockReturnValue({
      admitted: false,
      runningBreakdown: [{ id: 'mining' }],
    });
    expect(enqueue({ workload_id: 'lstm', params: { signal_ids: [1] } }).success).toBe(true);
    expect(mocks.enqueue).toHaveBeenCalledWith(
      'lstm',
      { signal_ids: [1] },
      8_642,
      ['mining'],
    );
  });

  it('refuses LSTM enqueue without a prior authoritative refusal', () => {
    mocks.lastRefusal.mockReturnValue(null);
    const result = enqueue({
      workload_id: 'lstm',
      params: {},
      estimated_peak_mb: 1,
    });
    expect(result.success).toBe(false);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('validates ids and exposes queue/dequeue state', () => {
    mocks.dequeue.mockReturnValue(true);
    expect(enqueue({ workload_id: 'other' }).success).toBe(false);
    expect(dequeue({ workload_id: 'other' }).success).toBe(false);
    expect(dequeue({ workload_id: 'sweep' }).data).toEqual({
      workloadId: 'sweep',
      removed: true,
    });
    expect(getQueue()).toEqual({ success: true, data: [] });
  });
});
