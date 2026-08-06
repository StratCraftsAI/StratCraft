/**
 * useAuthGatedOptions Tests
 *
 * TICKET_634: Comprehensive Test Coverage
 * Tests the auth-gated options filtering logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock useIsAuthenticated
const mockIsAuthenticated = vi.fn();
vi.mock('../useAuth', () => ({
  useIsAuthenticated: () => mockIsAuthenticated(),
}));

// Mock React useMemo to just execute the function
vi.mock('react', () => ({
  useMemo: (fn: () => unknown) => fn(),
}));

import { useAuthGatedOptions } from '../useAuthGatedOptions';
import type { AuthGatedOption } from '../useAuthGatedOptions';

describe('useAuthGatedOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const options: (AuthGatedOption & { id: string })[] = [
    { id: 'clickhouse', requiresAuth: true },
    { id: 'yfinance', requiresAuth: false },
    { id: 'dukascopy', requiresAuth: false },
    { id: 'alpaca', requiresAuth: false },
  ];

  // =========================================================================
  // Authenticated
  // =========================================================================

  describe('when authenticated', () => {
    beforeEach(() => {
      mockIsAuthenticated.mockReturnValue(true);
    });

    it('should return all options unchanged in "hide" mode', () => {
      const result = useAuthGatedOptions(options, { behavior: 'hide' });
      expect(result).toEqual(options);
      expect(result).toHaveLength(4);
    });

    it('should return all options unchanged in "disable" mode', () => {
      const result = useAuthGatedOptions(options, { behavior: 'disable' });
      expect(result).toEqual(options);
      expect(result).toHaveLength(4);
    });
  });

  // =========================================================================
  // Unauthenticated - Hide Mode
  // =========================================================================

  describe('when unauthenticated with "hide" behavior', () => {
    beforeEach(() => {
      mockIsAuthenticated.mockReturnValue(false);
    });

    it('should filter out requiresAuth options', () => {
      const result = useAuthGatedOptions(options, { behavior: 'hide' });
      expect(result).toHaveLength(3);
      expect(result.map(o => o.id)).toEqual(['yfinance', 'dukascopy', 'alpaca']);
    });

    it('should return all options when none require auth', () => {
      const noAuthOptions = [
        { id: 'a', requiresAuth: false },
        { id: 'b' },
      ];
      const result = useAuthGatedOptions(noAuthOptions, { behavior: 'hide' });
      expect(result).toHaveLength(2);
    });

    it('should return empty array when all require auth', () => {
      const allAuth = [
        { id: 'a', requiresAuth: true },
        { id: 'b', requiresAuth: true },
      ];
      const result = useAuthGatedOptions(allAuth, { behavior: 'hide' });
      expect(result).toHaveLength(0);
    });
  });

  // =========================================================================
  // Unauthenticated - Disable Mode
  // =========================================================================

  describe('when unauthenticated with "disable" behavior', () => {
    beforeEach(() => {
      mockIsAuthenticated.mockReturnValue(false);
    });

    it('should mark requiresAuth options as disabled', () => {
      const result = useAuthGatedOptions(options, { behavior: 'disable' });
      expect(result).toHaveLength(4);

      const clickhouse = result.find((o: any) => o.id === 'clickhouse');
      expect(clickhouse?.disabled).toBe(true);

      const yfinance = result.find((o: any) => o.id === 'yfinance');
      expect(yfinance?.disabled).toBeUndefined();
    });

    it('should not modify non-auth options', () => {
      const result = useAuthGatedOptions(options, { behavior: 'disable' });
      const yfinance = result.find((o: any) => o.id === 'yfinance');
      expect(yfinance).toEqual({ id: 'yfinance', requiresAuth: false });
    });
  });
});
