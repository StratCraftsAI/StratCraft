/**
 * useAuthGate Tests
 *
 * TICKET_634: Comprehensive Test Coverage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIsAuthenticated = vi.fn();
vi.mock('../useAuth', () => ({
  useAuthState: () => ({ isAuthenticated: mockIsAuthenticated() }),
}));

// Mock React useCallback to just return the function
vi.mock('react', () => ({
  useCallback: (fn: Function) => fn,
}));

// Mock window.dispatchEvent
const mockDispatchEvent = vi.fn();
vi.stubGlobal('window', {
  dispatchEvent: mockDispatchEvent,
});

import { useAuthGate } from '../useAuthGate';

describe('useAuthGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when authenticated', () => {
    beforeEach(() => {
      mockIsAuthenticated.mockReturnValue(true);
    });

    it('should return isAuthenticated=true', () => {
      const { isAuthenticated } = useAuthGate();
      expect(isAuthenticated).toBe(true);
    });

    it('should execute action when requireAuth is called', () => {
      const { requireAuth } = useAuthGate();
      const action = vi.fn();
      requireAuth(action);
      expect(action).toHaveBeenCalledOnce();
      expect(mockDispatchEvent).not.toHaveBeenCalled();
    });
  });

  describe('when not authenticated', () => {
    beforeEach(() => {
      mockIsAuthenticated.mockReturnValue(false);
    });

    it('should return isAuthenticated=false', () => {
      const { isAuthenticated } = useAuthGate();
      expect(isAuthenticated).toBe(false);
    });

    it('should not execute action and dispatch auth-required event', () => {
      const { requireAuth } = useAuthGate();
      const action = vi.fn();
      requireAuth(action);
      expect(action).not.toHaveBeenCalled();
      expect(mockDispatchEvent).toHaveBeenCalledOnce();
      expect(mockDispatchEvent.mock.calls[0][0]).toBeInstanceOf(Event);
      expect(mockDispatchEvent.mock.calls[0][0].type).toBe('nexus:auth-required');
    });
  });
});
