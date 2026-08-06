/**
 * PluginPermissions - Plugin Permission System
 *
 * Responsibilities:
 * 1. Permission definition and classification
 * 2. Permission verification and checking
 * 3. Permission approval workflow
 * 4. Runtime permission control
 */

import type { PluginPermission, PluginManifest } from '@shared/types';
import i18n from 'i18next';

// =============================================================================
// Permission Definitions
// =============================================================================

export interface PermissionDefinition {
  id: PluginPermission;
  name: string;
  nameKey: string;
  description: string;
  descriptionKey: string;
  level: 'low' | 'medium' | 'high' | 'dangerous';
  requiresApproval: boolean;
}

export const PERMISSION_DEFINITIONS: Record<PluginPermission, PermissionDefinition> = {
  'network': {
    id: 'network',
    get name() { return i18n.t('pluginPermissions.network.name', { ns: 'ui' }); },
    nameKey: 'pluginPermissions.network.name',
    get description() { return i18n.t('pluginPermissions.network.description', { ns: 'ui' }); },
    descriptionKey: 'pluginPermissions.network.description',
    level: 'medium',
    requiresApproval: true,
  },
  'network:internal': {
    id: 'network:internal',
    get name() { return i18n.t('pluginPermissions.networkInternal.name', { ns: 'ui' }); },
    nameKey: 'pluginPermissions.networkInternal.name',
    get description() { return i18n.t('pluginPermissions.networkInternal.description', { ns: 'ui' }); },
    descriptionKey: 'pluginPermissions.networkInternal.description',
    level: 'low',
    requiresApproval: false,
  },
  'filesystem': {
    id: 'filesystem',
    get name() { return i18n.t('pluginPermissions.filesystem.name', { ns: 'ui' }); },
    nameKey: 'pluginPermissions.filesystem.name',
    get description() { return i18n.t('pluginPermissions.filesystem.description', { ns: 'ui' }); },
    descriptionKey: 'pluginPermissions.filesystem.description',
    level: 'low',
    requiresApproval: false,
  },
  'filesystem:full': {
    id: 'filesystem:full',
    get name() { return i18n.t('pluginPermissions.filesystemFull.name', { ns: 'ui' }); },
    nameKey: 'pluginPermissions.filesystemFull.name',
    get description() { return i18n.t('pluginPermissions.filesystemFull.description', { ns: 'ui' }); },
    descriptionKey: 'pluginPermissions.filesystemFull.description',
    level: 'dangerous',
    requiresApproval: true,
  },
  'database': {
    id: 'database',
    get name() { return i18n.t('pluginPermissions.database.name', { ns: 'ui' }); },
    nameKey: 'pluginPermissions.database.name',
    get description() { return i18n.t('pluginPermissions.database.description', { ns: 'ui' }); },
    descriptionKey: 'pluginPermissions.database.description',
    level: 'medium',
    requiresApproval: true,
  },
  'notification': {
    id: 'notification',
    get name() { return i18n.t('pluginPermissions.notification.name', { ns: 'ui' }); },
    nameKey: 'pluginPermissions.notification.name',
    get description() { return i18n.t('pluginPermissions.notification.description', { ns: 'ui' }); },
    descriptionKey: 'pluginPermissions.notification.description',
    level: 'low',
    requiresApproval: false,
  },
  'clipboard': {
    id: 'clipboard',
    get name() { return i18n.t('pluginPermissions.clipboard.name', { ns: 'ui' }); },
    nameKey: 'pluginPermissions.clipboard.name',
    get description() { return i18n.t('pluginPermissions.clipboard.description', { ns: 'ui' }); },
    descriptionKey: 'pluginPermissions.clipboard.description',
    level: 'medium',
    requiresApproval: true,
  },
  'shell': {
    id: 'shell',
    get name() { return i18n.t('pluginPermissions.shell.name', { ns: 'ui' }); },
    nameKey: 'pluginPermissions.shell.name',
    get description() { return i18n.t('pluginPermissions.shell.description', { ns: 'ui' }); },
    descriptionKey: 'pluginPermissions.shell.description',
    level: 'dangerous',
    requiresApproval: true,
  },
  'native': {
    id: 'native',
    get name() { return i18n.t('pluginPermissions.native.name', { ns: 'ui' }); },
    nameKey: 'pluginPermissions.native.name',
    get description() { return i18n.t('pluginPermissions.native.description', { ns: 'ui' }); },
    descriptionKey: 'pluginPermissions.native.description',
    level: 'dangerous',
    requiresApproval: true,
  },
};

// =============================================================================
// Permission Storage
// =============================================================================

const STORAGE_KEY = 'plugin:permissions:granted';

interface GrantedPermissions {
  [pluginId: string]: {
    permissions: PluginPermission[];
    grantedAt: number;
    version: string;
  };
}

function loadGrantedPermissions(): GrantedPermissions {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveGrantedPermissions(data: GrantedPermissions): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// =============================================================================
// Permission Manager
// =============================================================================

export class PermissionManager {
  private grantedPermissions: GrantedPermissions;
  private pendingRequests: Map<string, {
    resolve: (granted: boolean) => void;
    reject: (error: Error) => void;
  }> = new Map();

  constructor() {
    this.grantedPermissions = loadGrantedPermissions();
  }

  // ===========================================================================
  // Permission Checking
  // ===========================================================================

  /**
   * Check if plugin has a specific permission
   */
  hasPermission(pluginId: string, permission: PluginPermission): boolean {
    const granted = this.grantedPermissions[pluginId];
    if (!granted) return false;
    return granted.permissions.includes(permission);
  }

  /**
   * Check if plugin has all required permissions
   */
  hasAllPermissions(pluginId: string, permissions: PluginPermission[]): boolean {
    return permissions.every(p => this.hasPermission(pluginId, p));
  }

  /**
   * Get plugin's missing permissions
   */
  getMissingPermissions(pluginId: string, required: PluginPermission[]): PluginPermission[] {
    return required.filter(p => !this.hasPermission(pluginId, p));
  }

  // ===========================================================================
  // Permission Granting
  // ===========================================================================

  /**
   * Grant permissions to plugin
   */
  grantPermissions(pluginId: string, permissions: PluginPermission[], version: string): void {
    this.grantedPermissions[pluginId] = {
      permissions,
      grantedAt: Date.now(),
      version,
    };
    saveGrantedPermissions(this.grantedPermissions);
  }

  /**
   * Revoke plugin permissions
   */
  revokePermissions(pluginId: string): void {
    delete this.grantedPermissions[pluginId];
    saveGrantedPermissions(this.grantedPermissions);
  }

  /**
   * Revoke single permission
   */
  revokePermission(pluginId: string, permission: PluginPermission): void {
    const granted = this.grantedPermissions[pluginId];
    if (!granted) return;

    granted.permissions = granted.permissions.filter(p => p !== permission);
    if (granted.permissions.length === 0) {
      delete this.grantedPermissions[pluginId];
    }
    saveGrantedPermissions(this.grantedPermissions);
  }

  // ===========================================================================
  // Permission Requests
  // ===========================================================================

  /**
   * Request permissions (requires user approval)
   */
  async requestPermissions(
    manifest: PluginManifest,
    onPrompt: (manifest: PluginManifest, permissions: PluginPermission[]) => Promise<boolean>
  ): Promise<boolean> {
    const pluginId = manifest.id;
    const required = manifest.permissions || [];

    if (required.length === 0) {
      return true; // No permissions required
    }

    // Check if already authorized
    const granted = this.grantedPermissions[pluginId];
    if (granted) {
      // Same version and permissions match, pass directly
      if (granted.version === manifest.version && this.hasAllPermissions(pluginId, required)) {
        return true;
      }
    }

    // Separate permissions that require approval and those that don't
    const needsApproval = required.filter(p => PERMISSION_DEFINITIONS[p]?.requiresApproval);
    const autoGrant = required.filter(p => !PERMISSION_DEFINITIONS[p]?.requiresApproval);

    // If all permissions don't require approval, auto-grant
    if (needsApproval.length === 0) {
      this.grantPermissions(pluginId, required, manifest.version);
      return true;
    }

    // Requires user approval
    const approved = await onPrompt(manifest, needsApproval);

    if (approved) {
      this.grantPermissions(pluginId, required, manifest.version);
      return true;
    }

    return false;
  }

  // ===========================================================================
  // Permission Analysis
  // ===========================================================================

  /**
   * Analyze plugin permission risk level
   */
  analyzeRiskLevel(permissions: PluginPermission[]): 'low' | 'medium' | 'high' | 'dangerous' {
    const levels = permissions.map(p => PERMISSION_DEFINITIONS[p]?.level || 'low');

    if (levels.includes('dangerous')) return 'dangerous';
    if (levels.includes('high')) return 'high';
    if (levels.includes('medium')) return 'medium';
    return 'low';
  }

  /**
   * Get permission summary
   */
  getPermissionSummary(permissions: PluginPermission[]): {
    total: number;
    byLevel: Record<string, number>;
    dangerous: PluginPermission[];
  } {
    const byLevel: Record<string, number> = { low: 0, medium: 0, high: 0, dangerous: 0 };
    const dangerous: PluginPermission[] = [];

    for (const p of permissions) {
      const def = PERMISSION_DEFINITIONS[p];
      if (def) {
        byLevel[def.level]++;
        if (def.level === 'dangerous') {
          dangerous.push(p);
        }
      }
    }

    return { total: permissions.length, byLevel, dangerous };
  }

  // ===========================================================================
  // State Access
  // ===========================================================================

  /**
   * Get all authorized plugins
   */
  getAllGrantedPlugins(): string[] {
    return Object.keys(this.grantedPermissions);
  }

  /**
   * Get plugin's authorization details
   */
  getPluginGrant(pluginId: string): GrantedPermissions[string] | undefined {
    return this.grantedPermissions[pluginId];
  }
}

// =============================================================================
// Runtime Permission Guards
// =============================================================================

/**
 * Create permission guard proxy
 * Wrap API calls with permission checks before execution
 */
export function createPermissionGuard<T extends object>(
  target: T,
  pluginId: string,
  manager: PermissionManager,
  permissionMap: Partial<Record<keyof T, PluginPermission>>
): T {
  return new Proxy(target, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop);

      // Check if permission is required
      const requiredPermission = permissionMap[prop as keyof T];
      if (requiredPermission) {
        if (!manager.hasPermission(pluginId, requiredPermission)) {
          // Return a function that throws an error
          if (typeof value === 'function') {
            return () => {
              throw new PermissionDeniedError(pluginId, requiredPermission);
            };
          }
          throw new PermissionDeniedError(pluginId, requiredPermission);
        }
      }

      return value;
    },
  });
}

// =============================================================================
// Errors
// =============================================================================

export class PermissionDeniedError extends Error {
  constructor(
    public readonly pluginId: string,
    public readonly permission: PluginPermission
  ) {
    super(i18n.t('renderer.plugin.permissionDenied', { ns: 'errors', pluginId, permission }));
    this.name = 'PermissionDeniedError';
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

export const permissionManager = new PermissionManager();

// =============================================================================
// Export
// =============================================================================

export default PermissionManager;
