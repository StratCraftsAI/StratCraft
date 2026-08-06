/**
 * useAuthGatedValue Tests
 *
 * TICKET_634: Comprehensive Test Coverage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIsAuthenticated = vi.fn();
vi.mock('../useAuth', () => ({
  useIsAuthenticated: () => mockIsAuthenticated(),
}));

import { useAuthGatedValue } from '../useAuthGatedValue';

describe('useAuthGatedValue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return authenticated value when authenticated', () => {
    mockIsAuthenticated.mockReturnValue(true);
    const result = useAuthGatedValue({
      authenticated: 'clickhouse',
      unauthenticated: 'yfinance',
    });
    expect(result).toBe('clickhouse');
  });

  it('should return unauthenticated value when not authenticated', () => {
    mockIsAuthenticated.mockReturnValue(false);
    const result = useAuthGatedValue({
      authenticated: 'clickhouse',
      unauthenticated: 'yfinance',
    });
    expect(result).toBe('yfinance');
  });

  it('should work with non-string types', () => {
    mockIsAuthenticated.mockReturnValue(true);
    const result = useAuthGatedValue({
      authenticated: 42,
      unauthenticated: 0,
    });
    expect(result).toBe(42);
  });

  it('should work with null values', () => {
    mockIsAuthenticated.mockReturnValue(false);
    const result = useAuthGatedValue({
      authenticated: { data: 'secret' },
      unauthenticated: null,
    });
    expect(result).toBeNull();
  });

  it('should work with boolean values', () => {
    mockIsAuthenticated.mockReturnValue(true);
    const result = useAuthGatedValue({
      authenticated: true,
      unauthenticated: false,
    });
    expect(result).toBe(true);
  });
});
