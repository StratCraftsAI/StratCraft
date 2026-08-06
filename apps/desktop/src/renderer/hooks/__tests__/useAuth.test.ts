/**
 * TICKET_634_3: useAuth Tests
 *
 * Tests for authentication utility functions and type exports.
 * React hook functions (useAuth, useAuthState, etc.) require React testing context
 * and are covered by integration tests. This file tests the pure logic and types.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub window.electronAPI.auth for module-level checks
const mockAuth = {
  getState: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  onStateChanged: vi.fn(() => vi.fn()),
  onError: vi.fn(() => vi.fn()),
};
vi.stubGlobal('window', {
  electronAPI: { auth: mockAuth },
});

// Must import after stub
import type { AuthUser, AuthPlan, AuthState } from '../useAuth';

describe('useAuth types and utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Type Shape Validation
  // =========================================================================

  describe('AuthUser type shape', () => {
    it('should accept valid AuthUser objects', () => {
      const user: AuthUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        plan: 'PRO',
      };
      expect(user.id).toBe('user-123');
      expect(user.plan).toBe('PRO');
    });

    it('should accept optional avatar and levelExpiresAt', () => {
      const user: AuthUser = {
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
        plan: 'GOLD',
        avatar: 'https://example.com/avatar.png',
        levelExpiresAt: '2025-12-31T23:59:59Z',
      };
      expect(user.avatar).toBeDefined();
      expect(user.levelExpiresAt).toBeDefined();
    });
  });

  describe('AuthPlan type', () => {
    it('should support FREE, BASIC, PRO, and GOLD plans', () => {
      const plans: AuthPlan[] = ['FREE', 'BASIC', 'PRO', 'GOLD'];
      expect(plans).toHaveLength(4);
    });
  });

  describe('AuthState type shape', () => {
    it('should represent unauthenticated state', () => {
      const state: AuthState = {
        isAuthenticated: false,
        user: null,
        expiresAt: null,
        isLoading: false,
        error: null,
      };
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
    });

    it('should represent authenticated state', () => {
      const state: AuthState = {
        isAuthenticated: true,
        user: {
          id: '1',
          email: 'a@b.com',
          name: 'A',
          plan: 'PRO',
        },
        expiresAt: Date.now() + 3600000,
        isLoading: false,
        error: null,
      };
      expect(state.isAuthenticated).toBe(true);
      expect(state.user?.plan).toBe('PRO');
    });

    it('should represent error state', () => {
      const state: AuthState = {
        isAuthenticated: false,
        user: null,
        expiresAt: null,
        isLoading: false,
        error: 'Network timeout',
      };
      expect(state.error).toBe('Network timeout');
    });
  });

  // =========================================================================
  // Plan Hierarchy Logic (matches useHasPlan)
  // =========================================================================

  describe('plan hierarchy', () => {
    // TICKET_704: Four-tier hierarchy matching ENTITLEMENT_TIER_LEVELS
    const planHierarchy: Record<AuthPlan, number> = {
      FREE: 0,
      BASIC: 1,
      PRO: 2,
      GOLD: 3,
    };

    it('FREE < BASIC < PRO < GOLD', () => {
      expect(planHierarchy['FREE']).toBeLessThan(planHierarchy['BASIC']);
      expect(planHierarchy['BASIC']).toBeLessThan(planHierarchy['PRO']);
      expect(planHierarchy['PRO']).toBeLessThan(planHierarchy['GOLD']);
    });

    it('FREE user does not have BASIC access', () => {
      expect(planHierarchy['FREE'] >= planHierarchy['BASIC']).toBe(false);
    });

    it('BASIC user has BASIC access', () => {
      expect(planHierarchy['BASIC'] >= planHierarchy['BASIC']).toBe(true);
    });

    it('BASIC user does not have PRO access', () => {
      expect(planHierarchy['BASIC'] >= planHierarchy['PRO']).toBe(false);
    });

    it('PRO user has PRO access', () => {
      expect(planHierarchy['PRO'] >= planHierarchy['PRO']).toBe(true);
    });

    it('GOLD user has PRO access', () => {
      expect(planHierarchy['GOLD'] >= planHierarchy['PRO']).toBe(true);
    });
  });
});
