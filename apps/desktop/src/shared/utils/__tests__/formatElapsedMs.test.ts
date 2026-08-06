import { describe, it, expect } from 'vitest';
import { formatElapsedCompact, formatElapsedFixed } from '../formatElapsedMs';

describe('formatElapsedCompact', () => {
  it('formats 0ms', () => {
    expect(formatElapsedCompact(0)).toBe('0s');
  });

  it('formats sub-minute', () => {
    expect(formatElapsedCompact(45_000)).toBe('45s');
  });

  it('formats exactly 1 minute', () => {
    expect(formatElapsedCompact(60_000)).toBe('1m');
  });

  it('formats minutes with remainder', () => {
    expect(formatElapsedCompact(14 * 60_000 + 39_000)).toBe('14m 39s');
  });

  it('formats exactly 1 hour', () => {
    expect(formatElapsedCompact(3600_000)).toBe('1h 0m');
  });

  it('formats hours with minutes and seconds', () => {
    expect(formatElapsedCompact(3600_000 + 14 * 60_000 + 39_000)).toBe('1h 14m 39s');
  });

  it('formats hours with minutes, no seconds', () => {
    expect(formatElapsedCompact(3600_000 + 14 * 60_000)).toBe('1h 14m');
  });

  it('truncates sub-second precision', () => {
    expect(formatElapsedCompact(45_999)).toBe('45s');
  });
});

describe('formatElapsedFixed', () => {
  it('formats 0ms', () => {
    expect(formatElapsedFixed(0)).toBe('00:00:00');
  });

  it('formats sub-minute', () => {
    expect(formatElapsedFixed(45_000)).toBe('00:00:45');
  });

  it('formats minutes', () => {
    expect(formatElapsedFixed(14 * 60_000 + 39_000)).toBe('00:14:39');
  });

  it('formats hours', () => {
    expect(formatElapsedFixed(3600_000 + 14 * 60_000 + 39_000)).toBe('01:14:39');
  });

  it('pads single digits', () => {
    expect(formatElapsedFixed(5_000)).toBe('00:00:05');
    expect(formatElapsedFixed(3 * 60_000 + 7_000)).toBe('00:03:07');
  });

  it('truncates sub-second precision', () => {
    expect(formatElapsedFixed(45_999)).toBe('00:00:45');
  });
});
