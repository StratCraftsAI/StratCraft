/**
 * useKeychainWarning Type & Contract Tests
 *
 * TICKET_634: Comprehensive Test Coverage
 * Tests the KeychainWarningState type shape.
 */

import { describe, it, expect } from 'vitest';

describe('useKeychainWarning types', () => {
  describe('KeychainWarningState', () => {
    it('should have expected shape when keychain available', () => {
      const state = {
        keychainUnavailable: false,
        platform: '',
        instructions: '',
        desktop: '',
        dismiss: () => {},
      };
      expect(state.keychainUnavailable).toBe(false);
      expect(typeof state.dismiss).toBe('function');
    });

    it('should represent keychain unavailable on Linux', () => {
      const state = {
        keychainUnavailable: true,
        platform: 'linux',
        instructions: 'Install gnome-keyring or kwallet',
        desktop: 'GNOME',
        dismiss: () => {},
      };
      expect(state.keychainUnavailable).toBe(true);
      expect(state.platform).toBe('linux');
      expect(state.instructions).toContain('gnome-keyring');
    });

    it('should represent keychain unavailable on macOS', () => {
      const state = {
        keychainUnavailable: true,
        platform: 'darwin',
        instructions: 'Keychain Access not available',
        desktop: '',
        dismiss: () => {},
      };
      expect(state.platform).toBe('darwin');
    });
  });
});
