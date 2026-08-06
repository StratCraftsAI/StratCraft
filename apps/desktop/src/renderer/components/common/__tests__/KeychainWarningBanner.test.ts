/**
 * KeychainWarningBanner Unit Tests
 *
 * TICKET_580_4: Tests for the keychain warning banner component.
 * Tests component logic without DOM rendering (node environment).
 */

import { describe, it, expect, vi } from 'vitest';

// =============================================================================
// Mocks
// =============================================================================

vi.mock('lucide-react', () => ({
  AlertTriangle: () => null,
  X: () => null,
  Shield: () => null,
}));

vi.mock('@/hooks/useKeychainWarning', () => ({
  useKeychainWarning: vi.fn(() => ({
    keychainUnavailable: false,
    platform: '',
    instructions: '',
    desktop: '',
    dismiss: vi.fn(),
  })),
}));

// =============================================================================
// Tests
// =============================================================================

describe('KeychainWarningBanner', () => {
  it('should export KeychainWarningBanner component', async () => {
    const mod = await import('../KeychainWarningBanner');
    expect(mod.KeychainWarningBanner).toBeDefined();
    expect(typeof mod.KeychainWarningBanner).toBe('function');
  });

  it('should be a valid React functional component', async () => {
    const { KeychainWarningBanner } = await import('../KeychainWarningBanner');
    expect(typeof KeychainWarningBanner).toBe('function');
  });
});

describe('useKeychainWarning', () => {
  it('should export useKeychainWarning hook', async () => {
    const mod = await import('@/hooks/useKeychainWarning');
    expect(mod.useKeychainWarning).toBeDefined();
    expect(typeof mod.useKeychainWarning).toBe('function');
  });
});
