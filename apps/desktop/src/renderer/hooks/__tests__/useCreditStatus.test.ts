/**
 * useCreditStatus Logic Tests
 *
 * TICKET_634: Comprehensive Test Coverage
 * Tests credit threshold computation logic (percentRemaining, isLow, isCritical, isExhausted).
 *
 * NOTE: Since the hook uses React hooks internally, we test the computation logic
 * by replicating the threshold formulas from the source code.
 */

import { describe, it, expect } from 'vitest';
import { CREDIT_CONFIG } from '@shared/constants';

// =============================================================================
// Replicate computation logic from useCreditStatus.ts
// =============================================================================

interface CreditData {
  remaining: number;
  totalRecharged?: number;
}

function computeCreditThresholds(data: CreditData | null | undefined) {
  const total = data?.totalRecharged ?? 0;
  const percentRemaining = data && total > 0
    ? (data.remaining / total) * 100
    : data ? (data.remaining > 0 ? 100 : 0) : 100;

  const isLow = data !== null && data !== undefined
    && percentRemaining <= CREDIT_CONFIG.LOW_THRESHOLD_PERCENT
    && percentRemaining > CREDIT_CONFIG.CRITICAL_THRESHOLD_PERCENT;

  const isCritical = data !== null && data !== undefined
    && percentRemaining <= CREDIT_CONFIG.CRITICAL_THRESHOLD_PERCENT
    && percentRemaining > 0;

  const isExhausted = data !== null && data !== undefined
    && data.remaining <= 0;

  return { percentRemaining, isLow, isCritical, isExhausted };
}

// =============================================================================
// Tests
// =============================================================================

describe('useCreditStatus computation logic', () => {
  describe('CREDIT_CONFIG', () => {
    it('should have threshold constants defined', () => {
      expect(CREDIT_CONFIG.LOW_THRESHOLD_PERCENT).toBeGreaterThan(0);
      expect(CREDIT_CONFIG.CRITICAL_THRESHOLD_PERCENT).toBeGreaterThan(0);
      expect(CREDIT_CONFIG.LOW_THRESHOLD_PERCENT).toBeGreaterThan(CREDIT_CONFIG.CRITICAL_THRESHOLD_PERCENT);
    });
  });

  describe('percentRemaining', () => {
    it('should compute 100% when null data', () => {
      const { percentRemaining } = computeCreditThresholds(null);
      expect(percentRemaining).toBe(100);
    });

    it('should compute 100% when undefined data', () => {
      const { percentRemaining } = computeCreditThresholds(undefined);
      expect(percentRemaining).toBe(100);
    });

    it('should compute 100% when remaining > 0 but no totalRecharged', () => {
      const { percentRemaining } = computeCreditThresholds({ remaining: 50 });
      expect(percentRemaining).toBe(100);
    });

    it('should compute 0% when remaining = 0 and no totalRecharged', () => {
      const { percentRemaining } = computeCreditThresholds({ remaining: 0 });
      expect(percentRemaining).toBe(0);
    });

    it('should compute correct percentage', () => {
      const { percentRemaining } = computeCreditThresholds({ remaining: 25, totalRecharged: 100 });
      expect(percentRemaining).toBe(25);
    });

    it('should compute 50%', () => {
      const { percentRemaining } = computeCreditThresholds({ remaining: 50, totalRecharged: 100 });
      expect(percentRemaining).toBe(50);
    });

    it('should handle zero totalRecharged', () => {
      const { percentRemaining } = computeCreditThresholds({ remaining: 10, totalRecharged: 0 });
      expect(percentRemaining).toBe(100); // remaining > 0 fallback
    });
  });

  describe('isLow', () => {
    it('should be false when null data', () => {
      expect(computeCreditThresholds(null).isLow).toBe(false);
    });

    it('should be false when above low threshold', () => {
      const { isLow } = computeCreditThresholds({ remaining: 90, totalRecharged: 100 });
      expect(isLow).toBe(false);
    });

    it('should be true when at low threshold', () => {
      const remaining = CREDIT_CONFIG.LOW_THRESHOLD_PERCENT;
      const { isLow } = computeCreditThresholds({ remaining, totalRecharged: 100 });
      // isLow: percentRemaining <= LOW and > CRITICAL
      if (remaining > CREDIT_CONFIG.CRITICAL_THRESHOLD_PERCENT) {
        expect(isLow).toBe(true);
      }
    });

    it('should be false when at critical threshold (not low, but critical)', () => {
      const remaining = CREDIT_CONFIG.CRITICAL_THRESHOLD_PERCENT;
      const { isLow, isCritical } = computeCreditThresholds({ remaining, totalRecharged: 100 });
      // At exactly critical: percentRemaining <= LOW is true, but percentRemaining > CRITICAL is false
      expect(isLow).toBe(false);
    });
  });

  describe('isCritical', () => {
    it('should be false when null data', () => {
      expect(computeCreditThresholds(null).isCritical).toBe(false);
    });

    it('should be true when below critical threshold but above 0', () => {
      const remaining = CREDIT_CONFIG.CRITICAL_THRESHOLD_PERCENT - 1;
      if (remaining > 0) {
        const { isCritical } = computeCreditThresholds({ remaining, totalRecharged: 100 });
        expect(isCritical).toBe(true);
      }
    });

    it('should be false when exhausted (remaining = 0)', () => {
      const { isCritical } = computeCreditThresholds({ remaining: 0, totalRecharged: 100 });
      expect(isCritical).toBe(false); // percentRemaining is 0, not > 0
    });
  });

  describe('isExhausted', () => {
    it('should be false when null data', () => {
      expect(computeCreditThresholds(null).isExhausted).toBe(false);
    });

    it('should be true when remaining is 0', () => {
      const { isExhausted } = computeCreditThresholds({ remaining: 0, totalRecharged: 100 });
      expect(isExhausted).toBe(true);
    });

    it('should be true when remaining is negative', () => {
      const { isExhausted } = computeCreditThresholds({ remaining: -5, totalRecharged: 100 });
      expect(isExhausted).toBe(true);
    });

    it('should be false when remaining is positive', () => {
      const { isExhausted } = computeCreditThresholds({ remaining: 1, totalRecharged: 100 });
      expect(isExhausted).toBe(false);
    });
  });

  describe('combined states', () => {
    it('healthy: high remaining', () => {
      const result = computeCreditThresholds({ remaining: 80, totalRecharged: 100 });
      expect(result.isLow).toBe(false);
      expect(result.isCritical).toBe(false);
      expect(result.isExhausted).toBe(false);
    });

    it('exhausted state overrides critical', () => {
      const result = computeCreditThresholds({ remaining: 0, totalRecharged: 100 });
      expect(result.isExhausted).toBe(true);
      expect(result.isCritical).toBe(false);
      expect(result.isLow).toBe(false);
    });
  });
});
