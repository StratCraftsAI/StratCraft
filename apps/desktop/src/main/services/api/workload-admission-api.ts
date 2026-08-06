import {
  buildAdmissionSnapshot,
  estimateWorkloadPeakMB,
  getLastAdmissionRefusal,
  getWorkloadQueue,
} from '../workload-admission-gate';
import type { WorkloadId } from '../../../shared/constants/system-monitor';

type Result = { success: boolean; data?: unknown; error?: string };

function parseWorkloadId(value: unknown): WorkloadId | null {
  return value === 'sweep' || value === 'mining' || value === 'lstm' ? value : null;
}

export function getQueue(): Result {
  return { success: true, data: getWorkloadQueue().peek() };
}

export function enqueue(body: Record<string, unknown>): Result {
  const id = parseWorkloadId(body.workload_id);
  if (!id) return { success: false, error: 'workload_id must be sweep, mining, or lstm' };
  const params =
    typeof body.params === 'object' && body.params != null && !Array.isArray(body.params)
      ? body.params as Record<string, unknown>
      : {};
  const lastRefusal = getLastAdmissionRefusal(id);
  const peak = estimateWorkloadPeakMB(id) ?? lastRefusal?.candidatePeakMB ?? null;
  if (peak == null) {
    return {
      success: false,
      error: `No authoritative refused peak-RSS estimate is available for '${id}'; start it first to obtain a gate verdict`,
    };
  }
  const verdict = buildAdmissionSnapshot({ id, estimatedPeakMB: peak });
  const blockerIds = verdict.admitted
    ? lastRefusal?.runningBreakdown.map((row) => row.id) ?? []
    : verdict.runningBreakdown.map((row) => row.id);
  const entry = getWorkloadQueue().enqueue(id, params, peak, blockerIds);
  return { success: true, data: entry };
}

export function dequeue(body: Record<string, unknown>): Result {
  const id = parseWorkloadId(body.workload_id);
  if (!id) return { success: false, error: 'workload_id must be sweep, mining, or lstm' };
  return { success: true, data: { workloadId: id, removed: getWorkloadQueue().dequeue(id) } };
}
