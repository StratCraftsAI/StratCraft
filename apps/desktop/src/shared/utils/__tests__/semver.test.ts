/**
 * Semver Utilities Unit Tests
 *
 * TICKET_494 Phase 3: Full coverage for semver.ts
 * Pure functions -- no mocks needed.
 */

import { describe, it, expect } from 'vitest';
import { compareSemver, semverGt } from '../semver';

describe('semver', () => {
  describe('compareSemver', () => {
    it('returns 0 for equal versions', () => {
      expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    });

    it('returns 1 when a > b (major)', () => {
      expect(compareSemver('2.0.0', '1.0.0')).toBe(1);
    });

    it('returns -1 when a < b (major)', () => {
      expect(compareSemver('1.0.0', '2.0.0')).toBe(-1);
    });

    it('returns 1 when a > b (minor)', () => {
      expect(compareSemver('1.2.0', '1.1.0')).toBe(1);
    });

    it('returns -1 when a < b (minor)', () => {
      expect(compareSemver('1.1.0', '1.2.0')).toBe(-1);
    });

    it('returns 1 when a > b (patch)', () => {
      expect(compareSemver('1.0.2', '1.0.1')).toBe(1);
    });

    it('returns -1 when a < b (patch)', () => {
      expect(compareSemver('1.0.1', '1.0.2')).toBe(-1);
    });

    it('handles different length versions (a shorter)', () => {
      expect(compareSemver('1.0', '1.0.1')).toBe(-1);
    });

    it('handles different length versions (b shorter)', () => {
      expect(compareSemver('1.0.1', '1.0')).toBe(1);
    });

    it('treats missing parts as 0', () => {
      expect(compareSemver('1.0', '1.0.0')).toBe(0);
    });

    it('compares single-segment versions', () => {
      expect(compareSemver('2', '1')).toBe(1);
    });

    it('compares four-segment versions', () => {
      expect(compareSemver('1.0.0.1', '1.0.0.0')).toBe(1);
    });
  });

  describe('semverGt', () => {
    it('returns true when a > b', () => {
      expect(semverGt('2.0.0', '1.0.0')).toBe(true);
    });

    it('returns false when a < b', () => {
      expect(semverGt('1.0.0', '2.0.0')).toBe(false);
    });

    it('returns false when a == b', () => {
      expect(semverGt('1.0.0', '1.0.0')).toBe(false);
    });

    it('returns true for minor version difference', () => {
      expect(semverGt('1.1.0', '1.0.0')).toBe(true);
    });

    it('returns true for patch version difference', () => {
      expect(semverGt('1.0.1', '1.0.0')).toBe(true);
    });

    // TICKET_892_5: nullish guard (plugin.json from disk may have undefined version)
    it('returns false when a is undefined', () => {
      expect(semverGt(undefined as unknown as string, '1.0.0')).toBe(false);
    });

    it('returns false when b is undefined', () => {
      expect(semverGt('1.0.0', undefined as unknown as string)).toBe(false);
    });

    it('returns false when both are undefined', () => {
      expect(semverGt(undefined as unknown as string, undefined as unknown as string)).toBe(false);
    });

    it('returns false when a is null', () => {
      expect(semverGt(null as unknown as string, '1.0.0')).toBe(false);
    });

    it('returns false when b is null', () => {
      expect(semverGt('1.0.0', null as unknown as string)).toBe(false);
    });

    it('returns false when a is empty string', () => {
      expect(semverGt('', '1.0.0')).toBe(false);
    });
  });

  // TICKET_892_5: compareSemver nullish guard
  describe('compareSemver - nullish inputs', () => {
    it('returns 0 when both are undefined', () => {
      expect(compareSemver(undefined as unknown as string, undefined as unknown as string)).toBe(0);
    });

    it('returns 1 when only a is defined', () => {
      expect(compareSemver('1.0.0', undefined as unknown as string)).toBe(1);
    });

    it('returns -1 when only b is defined', () => {
      expect(compareSemver(undefined as unknown as string, '1.0.0')).toBe(-1);
    });
  });
});
