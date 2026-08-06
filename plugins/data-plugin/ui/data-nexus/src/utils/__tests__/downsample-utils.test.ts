/**
 * TICKET_634_4: downsample-utils Tests (Tier 0 Data Plugin)
 *
 * Tests for chart downsampling algorithms: safeMinMax, downsampleOHLC, downsampleLTTB.
 */
import { describe, it, expect } from 'vitest';
import { MAX_RENDER_POINTS, safeMinMax, downsampleOHLC, downsampleLTTB } from '../downsample-utils';
import type { Candle } from '../../types/executor';

function makeCandle(timestamp: number, price: number, variance = 5): Candle {
  return {
    timestamp,
    open: price,
    high: price + variance,
    low: price - variance,
    close: price + 1,
    volume: 1000,
  };
}

describe('MAX_RENDER_POINTS', () => {
  it('should be 2000', () => {
    expect(MAX_RENDER_POINTS).toBe(2000);
  });
});

describe('safeMinMax', () => {
  it('should return min and max from array', () => {
    const data = [3, 1, 4, 1, 5, 9, 2, 6];
    const result = safeMinMax(data, (x) => x);
    expect(result.min).toBe(1);
    expect(result.max).toBe(9);
  });

  it('should return { min: 0, max: 0 } for empty array', () => {
    const result = safeMinMax([], (x: number) => x);
    expect(result.min).toBe(0);
    expect(result.max).toBe(0);
  });

  it('should handle single element array', () => {
    const result = safeMinMax([42], (x) => x);
    expect(result.min).toBe(42);
    expect(result.max).toBe(42);
  });

  it('should work with object accessor', () => {
    const data = [{ v: 10 }, { v: 5 }, { v: 20 }];
    const result = safeMinMax(data, (x) => x.v);
    expect(result.min).toBe(5);
    expect(result.max).toBe(20);
  });

  it('should handle large arrays without stack overflow', () => {
    const large = Array.from({ length: 100000 }, (_, i) => i);
    const result = safeMinMax(large, (x) => x);
    expect(result.min).toBe(0);
    expect(result.max).toBe(99999);
  });
});

describe('downsampleOHLC', () => {
  it('should return original when under maxPoints', () => {
    const candles = [makeCandle(1, 100), makeCandle(2, 101)];
    const result = downsampleOHLC(candles, 100);
    expect(result).toBe(candles); // Same reference
  });

  it('should reduce to maxPoints', () => {
    const candles = Array.from({ length: 1000 }, (_, i) => makeCandle(i, 100 + i));
    const result = downsampleOHLC(candles, 100);
    expect(result).toHaveLength(100);
  });

  it('should preserve first candle open and last candle close in each bucket', () => {
    const candles = Array.from({ length: 100 }, (_, i) => makeCandle(i, 100 + i));
    const result = downsampleOHLC(candles, 10);

    // First bucket: candles 0-9
    expect(result[0].open).toBe(candles[0].open);
    expect(result[0].timestamp).toBe(candles[0].timestamp);
  });

  it('should preserve price extremes (min low, max high) per bucket', () => {
    // Create candles with a known extreme
    const candles = Array.from({ length: 100 }, (_, i) =>
      makeCandle(i, 100, 5) // All similar range
    );
    // Inject extreme at index 5
    candles[5] = { ...candles[5], low: 10, high: 500 };

    const result = downsampleOHLC(candles, 10);
    // First bucket should capture the extreme
    expect(result[0].low).toBe(10);
    expect(result[0].high).toBe(500);
  });

  it('should handle exact maxPoints', () => {
    const candles = Array.from({ length: 50 }, (_, i) => makeCandle(i, 100));
    const result = downsampleOHLC(candles, 50);
    expect(result).toBe(candles);
  });
});

describe('downsampleLTTB', () => {
  it('should return original when under maxPoints', () => {
    const data = [1, 2, 3];
    const result = downsampleLTTB(data, 10, (x) => x);
    expect(result).toBe(data);
  });

  it('should reduce to maxPoints', () => {
    const data = Array.from({ length: 1000 }, (_, i) => ({ x: i, y: Math.sin(i / 50) }));
    const result = downsampleLTTB(data, 100, (d) => d.y);
    expect(result).toHaveLength(100);
  });

  it('should always include first and last points', () => {
    const data = Array.from({ length: 500 }, (_, i) => i);
    const result = downsampleLTTB(data, 10, (x) => x);
    expect(result[0]).toBe(0);
    expect(result[result.length - 1]).toBe(499);
  });

  it('should preserve visual features (peaks)', () => {
    // Create data with a sharp peak at index 250
    const data = Array.from({ length: 500 }, (_, i) => ({
      x: i,
      y: i === 250 ? 1000 : 0,
    }));
    const result = downsampleLTTB(data, 50, (d) => d.y);
    // The peak should be preserved by LTTB
    expect(result.some((d) => d.y === 1000)).toBe(true);
  });

  it('should handle exact maxPoints', () => {
    const data = Array.from({ length: 10 }, (_, i) => i);
    const result = downsampleLTTB(data, 10, (x) => x);
    expect(result).toBe(data);
  });
});
