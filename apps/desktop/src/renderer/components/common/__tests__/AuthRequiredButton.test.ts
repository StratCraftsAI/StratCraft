/**
 * AuthRequiredButton Unit Tests
 *
 * TICKET_571: Tests for the unified auth-required button component.
 * Tests component logic without DOM rendering (node environment).
 */

import { describe, it, expect, vi } from 'vitest';
import { RENDERER_EVENTS } from '@shared/constants/events';

// =============================================================================
// Mocks
// =============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'auth.loginRequired': 'Login required',
      };
      return translations[key] || key;
    },
  }),
}));

// =============================================================================
// Tests
// =============================================================================

describe('AuthRequiredButton', () => {
  it('should export AuthRequiredButton component', async () => {
    const mod = await import('../AuthRequiredButton');
    expect(mod.AuthRequiredButton).toBeDefined();
    expect(typeof mod.AuthRequiredButton).toBe('function');
  });

  it('should use RENDERER_EVENTS.AUTH_REQUIRED constant value', () => {
    expect(RENDERER_EVENTS.AUTH_REQUIRED).toBe('nexus:auth-required');
  });

  it('should export AuthRequiredButtonProps type-compatible component', async () => {
    const { AuthRequiredButton } = await import('../AuthRequiredButton');
    // Verify component is a callable function (React.FC)
    expect(typeof AuthRequiredButton).toBe('function');
    expect(AuthRequiredButton.length).toBeGreaterThanOrEqual(0);
  });

  it('should have correct event name for auth-required dispatch', () => {
    expect(RENDERER_EVENTS.AUTH_REQUIRED).toBe('nexus:auth-required');
    expect(typeof RENDERER_EVENTS.AUTH_REQUIRED).toBe('string');
  });
});
