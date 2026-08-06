/**
 * TICKET_854 (code reuse) / TICKET_1263_1 D3: single in-app LTTB
 * (Largest-Triangle-Three-Buckets) implementation, shared by the
 * main-process IPC decimation layer (decimate-equity-curve.ts) and the
 * renderer accumulator worker (backtest-accumulator.worker.ts).
 *
 * The x-axis is the array index (all in-app series are uniformly spaced
 * bars); the y value comes from `accessor`. First and last points are
 * always preserved.
 *
 * NOTE: the plugin packages (data-nexus, back-test-nexus, quant-lab-nexus)
 * carry their own copies in their `downsample-utils.ts` -- plugins are
 * independently built IIFE bundles and cannot import app source. This
 * module is the canonical source for the desktop app itself.
 */
export function downsampleLTTB<T>(
  data: readonly T[],
  maxPoints: number,
  accessor: (item: T) => number,
): T[] {
  // Read-only over the input; the returned array shares item references.
  if (data.length <= maxPoints) return data as T[];

  const result: T[] = [data[0]];
  const bucketSize = (data.length - 2) / (maxPoints - 2);
  let prevSelected = 0;

  for (let i = 1; i < maxPoints - 1; i++) {
    const bucketStart = Math.floor((i - 1) * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor(i * bucketSize) + 1, data.length - 1);
    const nextBucketStart = Math.floor(i * bucketSize) + 1;
    const nextBucketEnd = Math.min(
      Math.floor((i + 1) * bucketSize) + 1,
      data.length - 1,
    );

    let avgY = 0;
    for (let j = nextBucketStart; j < nextBucketEnd; j++) avgY += accessor(data[j]);
    avgY /= (nextBucketEnd - nextBucketStart) || 1;
    const avgX = (nextBucketStart + nextBucketEnd - 1) / 2;

    let maxArea = -1;
    let bestIdx = bucketStart;
    const ax = prevSelected;
    const ay = accessor(data[prevSelected]);

    for (let j = bucketStart; j < bucketEnd; j++) {
      const area = Math.abs(
        (ax - avgX) * (accessor(data[j]) - ay) - (ax - j) * (avgY - ay),
      );
      if (area > maxArea) {
        maxArea = area;
        bestIdx = j;
      }
    }

    result.push(data[bestIdx]);
    prevSelected = bestIdx;
  }

  result.push(data[data.length - 1]);
  return result;
}
