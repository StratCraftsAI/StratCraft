/**
 * TICKET_634_3: lib/utils Tests
 *
 * Tests for pure utility functions: cn, formatPercent, formatCurrency, formatDate, delay.
 */
import { describe, it, expect, vi } from 'vitest';
import { cn, formatPercent, formatCurrency, delay } from '../utils';

describe('cn (className merger)', () => {
  it('should merge single class', () => {
    expect(cn('p-4')).toBe('p-4');
  });

  it('should merge multiple classes', () => {
    const result = cn('p-4', 'text-white');
    expect(result).toContain('p-4');
    expect(result).toContain('text-white');
  });

  it('should handle conditional classes', () => {
    const result = cn('base', false && 'hidden', 'always');
    expect(result).toContain('base');
    expect(result).toContain('always');
    expect(result).not.toContain('hidden');
  });

  it('should deduplicate Tailwind classes', () => {
    // twMerge deduplicates conflicting classes
    const result = cn('p-4', 'p-8');
    expect(result).toBe('p-8');
  });

  it('should handle empty input', () => {
    expect(cn()).toBe('');
  });

  it('should handle undefined and null', () => {
    expect(cn(undefined, null, 'valid')).toBe('valid');
  });
});

describe('formatPercent', () => {
  it('should format 0.05 as 5.00%', () => {
    expect(formatPercent(0.05)).toBe('5.00%');
  });

  it('should format 1.0 as 100.00%', () => {
    expect(formatPercent(1.0)).toBe('100.00%');
  });

  it('should format 0 as 0.00%', () => {
    expect(formatPercent(0)).toBe('0.00%');
  });

  it('should respect custom decimal places', () => {
    expect(formatPercent(0.12345, 1)).toBe('12.3%');
    expect(formatPercent(0.12345, 4)).toBe('12.3450%');
  });

  it('should handle negative values', () => {
    expect(formatPercent(-0.05)).toBe('-5.00%');
  });
});

describe('formatCurrency', () => {
  it('should format number with default currency (CNY)', () => {
    const result = formatCurrency(1234.56);
    // Should contain the number in some currency format
    expect(result).toContain('1,234.56');
  });

  it('should format with USD currency', () => {
    const result = formatCurrency(1000, 'USD');
    expect(result).toContain('1,000');
  });

  it('should handle zero', () => {
    const result = formatCurrency(0);
    expect(result).toContain('0');
  });

  it('should handle negative values', () => {
    const result = formatCurrency(-500);
    expect(result).toContain('500');
  });
});

describe('delay', () => {
  it('should return a promise', () => {
    vi.useFakeTimers();
    const promise = delay(100);
    expect(promise).toBeInstanceOf(Promise);
    vi.advanceTimersByTime(100);
    vi.useRealTimers();
  });

  it('should resolve after specified time', async () => {
    vi.useFakeTimers();
    let resolved = false;
    delay(500).then(() => { resolved = true; });

    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });
});
