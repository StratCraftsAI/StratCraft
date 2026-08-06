import { describe, it, expect } from 'vitest';
import { parseLookbackMs, computeMinStartDate } from '../lookback-constraints';

describe('parseLookbackMs', () => {
  it('parses days: 7d -> 604800000', () => {
    expect(parseLookbackMs('7d')).toBe(604800000);
  });

  it('parses days: 60d', () => {
    expect(parseLookbackMs('60d')).toBe(60 * 86400000);
  });

  it('parses hours: 24h -> 86400000', () => {
    expect(parseLookbackMs('24h')).toBe(86400000);
  });

  it('parses minutes: 60m -> 3600000', () => {
    expect(parseLookbackMs('60m')).toBe(3600000);
  });

  it('returns Infinity for invalid format', () => {
    expect(parseLookbackMs('abc')).toBe(Infinity);
  });

  it('returns Infinity for empty string', () => {
    expect(parseLookbackMs('')).toBe(Infinity);
  });

  it('returns Infinity for missing unit', () => {
    expect(parseLookbackMs('100')).toBe(Infinity);
  });
});

describe('computeMinStartDate', () => {
  it('returns correct ISO date for valid constraint', () => {
    const result = computeMinStartDate(
      '1h',
      { '1h': '7d' },
      '2024-06-15',
    );
    expect(result).toBe('2024-06-08');
  });

  it('returns null when maxLookback is undefined', () => {
    expect(computeMinStartDate('1h', undefined, '2024-06-15')).toBeNull();
  });

  it('returns null when no matching interval in maxLookback', () => {
    expect(computeMinStartDate('5m', { '1h': '7d' }, '2024-06-15')).toBeNull();
  });

  it('returns null when endDate is empty', () => {
    expect(computeMinStartDate('1h', { '1h': '7d' }, '')).toBeNull();
  });

  it('handles hour-based lookback', () => {
    const result = computeMinStartDate(
      '1m',
      { '1m': '24h' },
      '2024-06-15',
    );
    // 2024-06-15 00:00 UTC - 24h = 2024-06-14
    expect(result).toBe('2024-06-14');
  });

  it('returns null when parseLookbackMs returns Infinity', () => {
    const result = computeMinStartDate(
      '1h',
      { '1h': 'invalid' },
      '2024-06-15',
    );
    expect(result).toBeNull();
  });
});
