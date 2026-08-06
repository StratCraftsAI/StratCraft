/**
 * TICKET_634_4: chart-utils Tests (Tier 0 Data Plugin)
 *
 * Tests for candle coloring and processed state detection (TICKET_231).
 */
import { describe, it, expect } from 'vitest';
import {
  CANDLE_COLOR_BULLISH,
  CANDLE_COLOR_BEARISH,
  CANDLE_COLOR_UNPROCESSED,
  getCandleColor,
  isCandleProcessed,
} from '../chart-utils';

describe('candle color constants', () => {
  it('should define green for bullish', () => {
    expect(CANDLE_COLOR_BULLISH).toBe('#22c55e');
  });

  it('should define red for bearish', () => {
    expect(CANDLE_COLOR_BEARISH).toBe('#ef4444');
  });

  it('should define gray for unprocessed', () => {
    expect(CANDLE_COLOR_UNPROCESSED).toBe('#4B5563');
  });
});

describe('getCandleColor', () => {
  it('should return bullish color for processed up candle', () => {
    expect(getCandleColor(true, true)).toBe(CANDLE_COLOR_BULLISH);
  });

  it('should return bearish color for processed down candle', () => {
    expect(getCandleColor(false, true)).toBe(CANDLE_COLOR_BEARISH);
  });

  it('should return unprocessed color when not processed (up)', () => {
    expect(getCandleColor(true, false)).toBe(CANDLE_COLOR_UNPROCESSED);
  });

  it('should return unprocessed color when not processed (down)', () => {
    expect(getCandleColor(false, false)).toBe(CANDLE_COLOR_UNPROCESSED);
  });
});

describe('isCandleProcessed', () => {
  it('should return true when candle index < processedBars', () => {
    expect(isCandleProcessed(5, 10)).toBe(true);
  });

  it('should return false when candle index >= processedBars', () => {
    expect(isCandleProcessed(10, 5)).toBe(false);
  });

  it('should return false when processedBars is 0', () => {
    expect(isCandleProcessed(0, 0)).toBe(false);
  });

  it('should return false when processedBars is negative', () => {
    expect(isCandleProcessed(0, -1)).toBe(false);
  });

  it('should return true for all candles when processedBars >= totalBars', () => {
    expect(isCandleProcessed(999, 100, 100)).toBe(true);
  });

  it('should handle boundary - candle at exact processedBars', () => {
    expect(isCandleProcessed(10, 10)).toBe(false);
  });

  it('should handle first candle', () => {
    expect(isCandleProcessed(0, 1)).toBe(true);
  });
});
