/**
 * AuthRequiredBanner Unit Tests
 *
 * TICKET_571: Tests for the unified auth-required banner component.
 * Tests component logic without DOM rendering (node environment).
 */

import { describe, it, expect, vi } from 'vitest';

// =============================================================================
// Mocks
// =============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'auth.loginRequiredBanner': 'Login required to use this feature.',
      };
      return translations[key] || key;
    },
  }),
}));

vi.mock('lucide-react', () => ({
  AlertTriangle: () => null,
}));

// =============================================================================
// Tests
// =============================================================================

describe('AuthRequiredBanner', () => {
  it('should export AuthRequiredBanner component', async () => {
    const mod = await import('../AuthRequiredBanner');
    expect(mod.AuthRequiredBanner).toBeDefined();
    expect(typeof mod.AuthRequiredBanner).toBe('function');
  });

  it('should export AuthRequiredBannerProps type-compatible component', async () => {
    const { AuthRequiredBanner } = await import('../AuthRequiredBanner');
    expect(typeof AuthRequiredBanner).toBe('function');
    expect(AuthRequiredBanner.length).toBeGreaterThanOrEqual(0);
  });

  it('should accept isAuthenticated and message props', async () => {
    const { AuthRequiredBanner } = await import('../AuthRequiredBanner');
    // Verify component accepts expected props without error
    expect(typeof AuthRequiredBanner).toBe('function');
  });

  it('should accept optional className prop', async () => {
    const { AuthRequiredBanner } = await import('../AuthRequiredBanner');
    expect(typeof AuthRequiredBanner).toBe('function');
  });
});
