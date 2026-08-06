/**
 * TICKET_634_4: timeframe-utils Tests (back-test-nexus)
 *
 * Tests for timeframe comparison, extraction, and multi-timeframe detection.
 */
import { describe, it, expect } from 'vitest';
import { compareTimeframes, extractUniqueTimeframes, getPrimaryTimeframe, hasMultipleTimeframes } from '../timeframe-utils';
import type { WorkflowRow } from '../../components/ui';

function makeWorkflow(timeframes: string[]): WorkflowRow {
  return {
    analysisSelections: timeframes.map((tf) => ({ timeframe: tf })),
    preConditionSelections: [],
    stepSelections: [],
    postConditionSelections: [],
  } as unknown as WorkflowRow;
}

describe('compareTimeframes', () => {
  it('should rank 1M before 1d', () => {
    expect(compareTimeframes('1M', '1d')).toBeLessThan(0);
  });

  it('should rank 1d before 1h', () => {
    expect(compareTimeframes('1d', '1h')).toBeLessThan(0);
  });

  it('should rank 1h before 5m', () => {
    expect(compareTimeframes('1h', '5m')).toBeLessThan(0);
  });

  it('should return 0 for equal timeframes', () => {
    expect(compareTimeframes('1h', '1h')).toBe(0);
  });

  it('should rank 1m after 5m', () => {
    expect(compareTimeframes('1m', '5m')).toBeGreaterThan(0);
  });

  it('should handle unknown timeframes (placed at end)', () => {
    expect(compareTimeframes('1h', 'unknown')).toBeLessThan(0);
  });

  it('should handle two unknown timeframes equally', () => {
    expect(compareTimeframes('foo', 'bar')).toBe(0);
  });

  it('should sort correctly via Array.sort', () => {
    const timeframes = ['1m', '1d', '4h', '1h', '15m'];
    const sorted = timeframes.sort(compareTimeframes);
    expect(sorted).toEqual(['1d', '4h', '1h', '15m', '1m']);
  });
});

describe('extractUniqueTimeframes', () => {
  it('should extract unique timeframes from workflows', () => {
    const workflows = [
      makeWorkflow(['1h', '1d']),
      makeWorkflow(['1h', '5m']),
    ];
    const result = extractUniqueTimeframes(workflows);
    expect(result).toEqual(['1d', '1h', '5m']);
  });

  it('should deduplicate timeframes', () => {
    const workflows = [makeWorkflow(['1h', '1h', '1h'])];
    const result = extractUniqueTimeframes(workflows);
    expect(result).toEqual(['1h']);
  });

  it('should return empty for empty workflows', () => {
    expect(extractUniqueTimeframes([])).toEqual([]);
  });

  it('should return sorted from longest to shortest', () => {
    const workflows = [makeWorkflow(['5m', '1M', '1h'])];
    const result = extractUniqueTimeframes(workflows);
    expect(result).toEqual(['1M', '1h', '5m']);
  });

  it('should handle workflows with empty selections', () => {
    const workflow = {
      analysisSelections: [],
      preConditionSelections: [],
      stepSelections: [],
      postConditionSelections: [],
    } as unknown as WorkflowRow;
    expect(extractUniqueTimeframes([workflow])).toEqual([]);
  });

  it('should skip selections without timeframe', () => {
    const workflow = {
      analysisSelections: [{ timeframe: '1h' }, { timeframe: undefined }],
      preConditionSelections: [],
      stepSelections: [],
      postConditionSelections: [],
    } as unknown as WorkflowRow;
    expect(extractUniqueTimeframes([workflow])).toEqual(['1h']);
  });
});

describe('getPrimaryTimeframe', () => {
  it('should return longest timeframe', () => {
    const workflows = [makeWorkflow(['5m', '1d', '1h'])];
    expect(getPrimaryTimeframe(workflows)).toBe('1d');
  });

  it('should default to 1d when no timeframes found', () => {
    expect(getPrimaryTimeframe([])).toBe('1d');
  });
});

describe('hasMultipleTimeframes', () => {
  it('should return true for multiple timeframes', () => {
    const workflows = [makeWorkflow(['1h', '1d'])];
    expect(hasMultipleTimeframes(workflows)).toBe(true);
  });

  it('should return false for single timeframe', () => {
    const workflows = [makeWorkflow(['1h'])];
    expect(hasMultipleTimeframes(workflows)).toBe(false);
  });

  it('should return false for empty workflows', () => {
    expect(hasMultipleTimeframes([])).toBe(false);
  });
});
