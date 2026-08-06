/**
 * TICKET_383: Shared large dataset rendering utilities (Tier 0)
 *
 * Canonical definitions consumed by both back-test-nexus and quant-lab-nexus.
 */

import type { Candle } from '../types/executor';

export const MAX_RENDER_POINTS = 2000;

/** Loop-based min/max to avoid V8 call stack limit on Math.min(...spread) */
export function safeMinMax<T>(arr: T[], accessor: (item: T) => number): { min: number; max: number } {
  if (arr.length === 0) return { min: 0, max: 0 };
  let min = accessor(arr[0]);
  let max = min;
  for (let i = 1; i < arr.length; i++) {
    const v = accessor(arr[i]);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/** Min-Max bucket aggregation for OHLC candles (preserves price extremes per bucket) */
export function downsampleOHLC(candles: Candle[], maxPoints: number): Candle[] {
  if (candles.length <= maxPoints) return candles;
  const bucketSize = candles.length / maxPoints;
  const result: Candle[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.min(Math.floor((i + 1) * bucketSize), candles.length);
    let low = candles[start].low;
    let high = candles[start].high;
    for (let j = start + 1; j < end; j++) {
      if (candles[j].low < low) low = candles[j].low;
      if (candles[j].high > high) high = candles[j].high;
    }
    result.push({
      timestamp: candles[start].timestamp,
      open: candles[start].open,
      high,
      low,
      close: candles[end - 1].close,
      volume: 0,
    });
  }
  return result;
}

/** Largest-Triangle-Three-Buckets downsampling for line charts */
export function downsampleLTTB<T>(data: T[], maxPoints: number, accessor: (item: T) => number): T[] {
  if (data.length <= maxPoints) return data;
  const result: T[] = [data[0]];
  const bucketSize = (data.length - 2) / (maxPoints - 2);
  let prevSelected = 0;
  for (let i = 1; i < maxPoints - 1; i++) {
    const bucketStart = Math.floor((i - 1) * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor(i * bucketSize) + 1, data.length - 1);
    const nextBucketStart = Math.floor(i * bucketSize) + 1;
    const nextBucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, data.length - 1);
    let avgY = 0;
    for (let j = nextBucketStart; j < nextBucketEnd; j++) avgY += accessor(data[j]);
    avgY /= (nextBucketEnd - nextBucketStart) || 1;
    const avgX = (nextBucketStart + nextBucketEnd - 1) / 2;
    let maxArea = -1;
    let bestIdx = bucketStart;
    const ax = prevSelected;
    const ay = accessor(data[prevSelected]);
    for (let j = bucketStart; j < bucketEnd; j++) {
      const area = Math.abs((ax - avgX) * (accessor(data[j]) - ay) - (ax - j) * (avgY - ay));
      if (area > maxArea) { maxArea = area; bestIdx = j; }
    }
    result.push(data[bestIdx]);
    prevSelected = bestIdx;
  }
  result.push(data[data.length - 1]);
  return result;
}
