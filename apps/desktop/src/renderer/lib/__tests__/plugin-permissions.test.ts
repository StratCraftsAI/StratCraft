/**
 * Plugin Permissions Unit Tests
 *
 * TICKET_634: Comprehensive Test Coverage
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage
const mockStorage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
  clear: vi.fn(() => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }),
});

import {
  PERMISSION_DEFINITIONS,
  PermissionManager,
} from '../plugin-permissions';
import type { PermissionDefinition } from '../plugin-permissions';

// =============================================================================
// PERMISSION_DEFINITIONS
// =============================================================================

describe('PERMISSION_DEFINITIONS', () => {
  it('should define all expected permissions', () => {
    const expectedIds = [
      'network', 'network:internal', 'filesystem', 'filesystem:full',
      'database', 'notification', 'clipboard', 'shell', 'native',
    ];
    for (const id of expectedIds) {
      expect(PERMISSION_DEFINITIONS[id as keyof typeof PERMISSION_DEFINITIONS]).toBeDefined();
    }
  });

  it('should have valid levels for all permissions', () => {
    const validLevels = ['low', 'medium', 'high', 'dangerous'];
    for (const def of Object.values(PERMISSION_DEFINITIONS)) {
      expect(validLevels).toContain(def.level);
    }
  });

  it('should require approval for dangerous permissions', () => {
    for (const def of Object.values(PERMISSION_DEFINITIONS)) {
      if (def.level === 'dangerous') {
        expect(def.requiresApproval).toBe(true);
      }
    }
  });

  it('should not require approval for low-level permissions', () => {
    for (const def of Object.values(PERMISSION_DEFINITIONS)) {
      if (def.level === 'low') {
        expect(def.requiresApproval).toBe(false);
      }
    }
  });

  it('should have authoritative translation keys for all permissions', () => {
    for (const def of Object.values(PERMISSION_DEFINITIONS)) {
      expect(def.nameKey).toMatch(/^pluginPermissions\..+\.name$/);
      expect(def.descriptionKey).toMatch(/^pluginPermissions\..+\.description$/);
    }
  });
});

// =============================================================================
// PermissionManager
// =============================================================================

describe('PermissionManager', () => {
  let manager: PermissionManager;

  beforeEach(() => {
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    vi.clearAllMocks();
    manager = new PermissionManager();
  });

  // =========================================================================
  // Permission Checking
  // =========================================================================

  describe('hasPermission', () => {
    it('should return false when no permissions granted', () => {
      expect(manager.hasPermission('com.test.plugin', 'network')).toBe(false);
    });

    it('should return true after permission is granted', () => {
      manager.grantPermissions('com.test.plugin', ['network', 'database'], '1.0.0');
      expect(manager.hasPermission('com.test.plugin', 'network')).toBe(true);
      expect(manager.hasPermission('com.test.plugin', 'database')).toBe(true);
    });

    it('should return false for ungranted permissions', () => {
      manager.grantPermissions('com.test.plugin', ['network'], '1.0.0');
      expect(manager.hasPermission('com.test.plugin', 'shell')).toBe(false);
    });
  });

  describe('hasAllPermissions', () => {
    it('should return true when all permissions granted', () => {
      manager.grantPermissions('com.test.plugin', ['network', 'database', 'clipboard'], '1.0.0');
      expect(manager.hasAllPermissions('com.test.plugin', ['network', 'database'])).toBe(true);
    });

    it('should return false when some permissions missing', () => {
      manager.grantPermissions('com.test.plugin', ['network'], '1.0.0');
      expect(manager.hasAllPermissions('com.test.plugin', ['network', 'database'])).toBe(false);
    });

    it('should return true for empty permissions array', () => {
      expect(manager.hasAllPermissions('com.test.plugin', [])).toBe(true);
    });
  });

  describe('getMissingPermissions', () => {
    it('should return all required when none granted', () => {
      const missing = manager.getMissingPermissions('com.test.plugin', ['network', 'database']);
      expect(missing).toEqual(['network', 'database']);
    });

    it('should return only missing permissions', () => {
      manager.grantPermissions('com.test.plugin', ['network'], '1.0.0');
      const missing = manager.getMissingPermissions('com.test.plugin', ['network', 'database']);
      expect(missing).toEqual(['database']);
    });

    it('should return empty array when all granted', () => {
      manager.grantPermissions('com.test.plugin', ['network', 'database'], '1.0.0');
      const missing = manager.getMissingPermissions('com.test.plugin', ['network', 'database']);
      expect(missing).toEqual([]);
    });
  });

  // =========================================================================
  // Permission Granting / Revoking
  // =========================================================================

  describe('grantPermissions', () => {
    it('should persist permissions to localStorage', () => {
      manager.grantPermissions('com.test.plugin', ['network'], '1.0.0');
      expect(localStorage.setItem).toHaveBeenCalled();
    });

    it('should store version and timestamp', () => {
      manager.grantPermissions('com.test.plugin', ['network'], '2.0.0');
      const stored = JSON.parse(mockStorage['plugin:permissions:granted']);
      expect(stored['com.test.plugin'].version).toBe('2.0.0');
      expect(stored['com.test.plugin'].grantedAt).toBeGreaterThan(0);
    });
  });

  describe('revokePermissions', () => {
    it('should remove all permissions for plugin', () => {
      manager.grantPermissions('com.test.plugin', ['network', 'database'], '1.0.0');
      manager.revokePermissions('com.test.plugin');
      expect(manager.hasPermission('com.test.plugin', 'network')).toBe(false);
      expect(manager.hasPermission('com.test.plugin', 'database')).toBe(false);
    });

    it('should not affect other plugins', () => {
      manager.grantPermissions('plugin-a', ['network'], '1.0.0');
      manager.grantPermissions('plugin-b', ['database'], '1.0.0');
      manager.revokePermissions('plugin-a');
      expect(manager.hasPermission('plugin-b', 'database')).toBe(true);
    });
  });

  describe('revokePermission (single)', () => {
    it('should remove only the specified permission', () => {
      manager.grantPermissions('com.test.plugin', ['network', 'database'], '1.0.0');
      manager.revokePermission('com.test.plugin', 'network');
      expect(manager.hasPermission('com.test.plugin', 'network')).toBe(false);
      expect(manager.hasPermission('com.test.plugin', 'database')).toBe(true);
    });

    it('should remove plugin entry when last permission revoked', () => {
      manager.grantPermissions('com.test.plugin', ['network'], '1.0.0');
      manager.revokePermission('com.test.plugin', 'network');
      // After revoking last permission, plugin entry should be removed
      const stored = JSON.parse(mockStorage['plugin:permissions:granted']);
      expect(stored['com.test.plugin']).toBeUndefined();
    });

    it('should handle revoking from non-existent plugin', () => {
      expect(() => manager.revokePermission('unknown', 'network')).not.toThrow();
    });
  });
});
