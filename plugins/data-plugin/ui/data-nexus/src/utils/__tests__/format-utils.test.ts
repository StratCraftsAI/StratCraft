/**
 * TICKET_634_4: format-utils Tests (Tier 0 Data Plugin)
 *
 * Tests for shared formatting utilities used across plugins.
 */
import { describe, it, expect } from 'vitest';
import { formatCurrency, formatPercent, formatRatio, getColorClass, safeNum } from '../format-utils';

describe('formatCurrency', () => {
  it('should format positive number with + sign', () => {
    const result = formatCurrency(1234.56);
    expect(result).toContain('+');
    expect(result).toContain('$');
    expect(result).toContain('1,234.56');
  });

  it('should format negative number without + sign', () => {
    const result = formatCurrency(-500);
    expect(result).not.toMatch(/^\+/);
    expect(result).toContain('$');
    expect(result).toContain('500.00');
  });

  it('should format zero as +$0.00', () => {
    expect(formatCurrency(0)).toBe('+$0.00');
  });

  it('should handle null', () => {
    expect(formatCurrency(null)).toBe('$0.00');
  });

  it('should handle undefined', () => {
    expect(formatCurrency(undefined)).toBe('$0.00');
  });

  it('should handle NaN', () => {
    expect(formatCurrency(NaN)).toBe('$0.00');
  });

  it('should handle Infinity', () => {
    expect(formatCurrency(Infinity)).toBe('$0.00');
  });

  it('should cap extreme values at 1e12', () => {
    const result = formatCurrency(1e15);
    // Should be capped, not overflow
    expect(result).toBeDefined();
  });
});

describe('formatPercent', () => {
  it('should format positive value with + sign', () => {
    expect(formatPercent(5.5)).toBe('+5.50%');
  });

  it('should format negative value', () => {
    expect(formatPercent(-3.2)).toBe('-3.20%');
  });

  it('should format zero', () => {
    expect(formatPercent(0)).toBe('+0.00%');
  });

  it('should handle null', () => {
    expect(formatPercent(null)).toBe('0.00%');
  });

  it('should handle undefined', () => {
    expect(formatPercent(undefined)).toBe('0.00%');
  });

  it('should handle NaN', () => {
    expect(formatPercent(NaN)).toBe('0.00%');
  });

  it('should cap at 9999', () => {
    expect(formatPercent(99999)).toBe('+9999.00%');
  });
});

describe('formatRatio', () => {
  it('should format number with 2 decimal places', () => {
    expect(formatRatio(1.5)).toBe('1.50');
  });

  it('should handle null', () => {
    expect(formatRatio(null)).toBe('0.00');
  });

  it('should format negative values', () => {
    expect(formatRatio(-0.75)).toBe('-0.75');
  });
});

describe('getColorClass', () => {
  it('should return green for positive values', () => {
    expect(getColorClass(5)).toBe('text-green-400');
  });

  it('should return red for negative values', () => {
    expect(getColorClass(-5)).toBe('text-red-400');
  });

  it('should return default for zero', () => {
    expect(getColorClass(0)).toBe('text-color-terminal-text');
  });

  it('should return default for null', () => {
    expect(getColorClass(null)).toBe('text-color-terminal-text');
  });

  it('should return default for undefined', () => {
    expect(getColorClass(undefined)).toBe('text-color-terminal-text');
  });
});

describe('safeNum', () => {
  it('should return value when defined', () => {
    expect(safeNum(42)).toBe(42);
  });

  it('should return 0 for null', () => {
    expect(safeNum(null)).toBe(0);
  });

  it('should return 0 for undefined', () => {
    expect(safeNum(undefined)).toBe(0);
  });

  it('should return custom default for null', () => {
    expect(safeNum(null, -1)).toBe(-1);
  });
});
