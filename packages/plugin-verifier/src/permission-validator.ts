/**
 * Permission Validator
 *
 * TICKET_099: Permission Declaration Schema
 * Validates and parses plugin permission declarations
 */

import type {
  PluginPermissions,
  PermissionValidationResult,
  ParsedPermission,
  PermissionRiskLevel,
  NetworkPermission,
  FileSystemPermission,
  BridgePermission,
  SecretsPermission,
  ShellPermission,
  NativePermission,
  BridgeApiName,
} from './types';

// =============================================================================
// Risk Level Configuration
// =============================================================================

const PERMISSION_RISK_LEVELS: Record<keyof PluginPermissions, PermissionRiskLevel> = {
  network: 'medium',
  fs: 'medium',       // read is medium, write is high
  bridge: 'medium',
  secrets: 'medium',
  shell: 'high',
  native: 'critical',
};

// Patterns that indicate overly broad permissions
const OVERLY_BROAD_PATTERNS = [
  { pattern: '*', field: 'network.hosts', severity: 'error' as const },
  { pattern: '**', field: 'fs.write', severity: 'error' as const },
  { pattern: '*', field: 'bridge.apis', severity: 'warning' as const },
];

// Valid Bridge API names
const VALID_BRIDGE_APIS: BridgeApiName[] = [
  'DataChannel',
  'SessionApi',
  'Registry',
  'EventBus',
  '*',
];

// =============================================================================
// Permission Validator Class
// =============================================================================

export class PermissionValidator {
  /**
   * Validate permission declaration from manifest
   */
  validate(permissions: unknown): PermissionValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const parsedPermissions: ParsedPermission[] = [];

    if (!permissions || typeof permissions !== 'object') {
      return {
        valid: true,
        riskLevel: 'low',
        errors: [],
        warnings: [],
        permissions: [],
      };
    }

    const perms = permissions as Record<string, unknown>;

    // Validate each permission type
    if (perms.network) {
      const result = this.validateNetwork(perms.network);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
      if (result.parsed) {
        parsedPermissions.push(result.parsed);
      }
    }

    if (perms.fs) {
      const result = this.validateFileSystem(perms.fs);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
      if (result.parsed) {
        parsedPermissions.push(result.parsed);
      }
    }

    if (perms.bridge) {
      const result = this.validateBridge(perms.bridge);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
      if (result.parsed) {
        parsedPermissions.push(result.parsed);
      }
    }

    if (perms.secrets) {
      const result = this.validateSecrets(perms.secrets);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
      if (result.parsed) {
        parsedPermissions.push(result.parsed);
      }
    }

    if (perms.shell) {
      const result = this.validateShell(perms.shell);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
      if (result.parsed) {
        parsedPermissions.push(result.parsed);
      }
    }

    if (perms.native) {
      const result = this.validateNative(perms.native);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
      if (result.parsed) {
        parsedPermissions.push(result.parsed);
      }
    }

    // Determine overall risk level
    const riskLevel = this.calculateOverallRisk(parsedPermissions);

    return {
      valid: errors.length === 0,
      riskLevel,
      errors,
      warnings,
      permissions: parsedPermissions,
    };
  }

  /**
   * Validate network permission
   */
  private validateNetwork(value: unknown): {
    errors: string[];
    warnings: string[];
    parsed: ParsedPermission | null;
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (typeof value !== 'object' || !value) {
      errors.push('network: must be an object');
      return { errors, warnings, parsed: null };
    }

    const network = value as Partial<NetworkPermission>;

    if (!Array.isArray(network.hosts)) {
      errors.push('network.hosts: must be an array');
      return { errors, warnings, parsed: null };
    }

    if (!network.reason || typeof network.reason !== 'string') {
      errors.push('network.reason: must be a string');
      return { errors, warnings, parsed: null };
    }

    // Check for overly broad patterns
    if (network.hosts.includes('*')) {
      errors.push('network.hosts: wildcard "*" is not allowed');
    }

    // Check for valid host patterns
    for (const host of network.hosts) {
      if (typeof host !== 'string') {
        errors.push(`network.hosts: invalid host "${host}"`);
      }
    }

    const description = `Network access to: ${network.hosts.join(', ')}`;

    return {
      errors,
      warnings,
      parsed: {
        type: 'network',
        riskLevel: 'medium',
        description,
        reason: network.reason,
      },
    };
  }

  /**
   * Validate file system permission
   */
  private validateFileSystem(value: unknown): {
    errors: string[];
    warnings: string[];
    parsed: ParsedPermission | null;
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (typeof value !== 'object' || !value) {
      errors.push('fs: must be an object');
      return { errors, warnings, parsed: null };
    }

    const fs = value as Partial<FileSystemPermission>;

    if (fs.read && !Array.isArray(fs.read)) {
      errors.push('fs.read: must be an array');
    }

    if (fs.write && !Array.isArray(fs.write)) {
      errors.push('fs.write: must be an array');
    }

    if (!fs.reason || typeof fs.reason !== 'string') {
      errors.push('fs.reason: must be a string');
      return { errors, warnings, parsed: null };
    }

    // Check for overly broad write patterns
    if (fs.write) {
      for (const path of fs.write) {
        if (path === '**' || path === '/**' || path === '/*') {
          errors.push(`fs.write: overly broad pattern "${path}" is not allowed`);
        }
      }
    }

    // Determine risk level
    const hasWrite = fs.write && fs.write.length > 0;
    const riskLevel: PermissionRiskLevel = hasWrite ? 'high' : 'medium';

    const paths = [
      ...(fs.read || []).map(p => `read: ${p}`),
      ...(fs.write || []).map(p => `write: ${p}`),
    ];
    const description = `File system access: ${paths.join(', ')}`;

    return {
      errors,
      warnings,
      parsed: {
        type: 'fs',
        riskLevel,
        description,
        reason: fs.reason,
      },
    };
  }

  /**
   * Validate bridge permission
   */
  private validateBridge(value: unknown): {
    errors: string[];
    warnings: string[];
    parsed: ParsedPermission | null;
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (typeof value !== 'object' || !value) {
      errors.push('bridge: must be an object');
      return { errors, warnings, parsed: null };
    }

    const bridge = value as Partial<BridgePermission>;

    if (!Array.isArray(bridge.apis)) {
      errors.push('bridge.apis: must be an array');
      return { errors, warnings, parsed: null };
    }

    if (!bridge.reason || typeof bridge.reason !== 'string') {
      errors.push('bridge.reason: must be a string');
      return { errors, warnings, parsed: null };
    }

    // Validate API names
    for (const api of bridge.apis) {
      if (!VALID_BRIDGE_APIS.includes(api as BridgeApiName)) {
        errors.push(`bridge.apis: unknown API "${api}"`);
      }
    }

    // Warn about wildcard
    if (bridge.apis.includes('*')) {
      warnings.push('bridge.apis: wildcard grants access to all Bridge APIs');
    }

    const description = `Bridge API access: ${bridge.apis.join(', ')}`;

    return {
      errors,
      warnings,
      parsed: {
        type: 'bridge',
        riskLevel: 'medium',
        description,
        reason: bridge.reason,
      },
    };
  }

  /**
   * Validate secrets permission
   */
  private validateSecrets(value: unknown): {
    errors: string[];
    warnings: string[];
    parsed: ParsedPermission | null;
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (typeof value !== 'object' || !value) {
      errors.push('secrets: must be an object');
      return { errors, warnings, parsed: null };
    }

    const secrets = value as Partial<SecretsPermission>;

    if (!Array.isArray(secrets.keys)) {
      errors.push('secrets.keys: must be an array');
      return { errors, warnings, parsed: null };
    }

    if (!secrets.reason || typeof secrets.reason !== 'string') {
      errors.push('secrets.reason: must be a string');
      return { errors, warnings, parsed: null };
    }

    const description = `Secrets storage: ${secrets.keys.join(', ')}`;

    return {
      errors,
      warnings,
      parsed: {
        type: 'secrets',
        riskLevel: 'medium',
        description,
        reason: secrets.reason,
      },
    };
  }

  /**
   * Validate shell permission
   */
  private validateShell(value: unknown): {
    errors: string[];
    warnings: string[];
    parsed: ParsedPermission | null;
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (typeof value !== 'object' || !value) {
      errors.push('shell: must be an object');
      return { errors, warnings, parsed: null };
    }

    const shell = value as Partial<ShellPermission>;

    if (!Array.isArray(shell.commands)) {
      errors.push('shell.commands: must be an array');
      return { errors, warnings, parsed: null };
    }

    if (!shell.reason || typeof shell.reason !== 'string') {
      errors.push('shell.reason: must be a string');
      return { errors, warnings, parsed: null };
    }

    // Shell is always high risk
    warnings.push('shell: grants ability to execute system commands');

    const description = `Shell execution: ${shell.commands.join(', ')}`;

    return {
      errors,
      warnings,
      parsed: {
        type: 'shell',
        riskLevel: 'high',
        description,
        reason: shell.reason,
      },
    };
  }

  /**
   * Validate native permission
   */
  private validateNative(value: unknown): {
    errors: string[];
    warnings: string[];
    parsed: ParsedPermission | null;
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (typeof value !== 'object' || !value) {
      errors.push('native: must be an object');
      return { errors, warnings, parsed: null };
    }

    const native = value as Partial<NativePermission>;

    if (!Array.isArray(native.modules)) {
      errors.push('native.modules: must be an array');
      return { errors, warnings, parsed: null };
    }

    if (!native.reason || typeof native.reason !== 'string') {
      errors.push('native.reason: must be a string');
      return { errors, warnings, parsed: null };
    }

    // Native is critical risk - requires dev mode
    warnings.push('native: requires Developer Mode to be enabled');

    const description = `Native modules: ${native.modules.join(', ')}`;

    return {
      errors,
      warnings,
      parsed: {
        type: 'native',
        riskLevel: 'critical',
        description,
        reason: native.reason,
      },
    };
  }

  /**
   * Calculate overall risk level
   */
  private calculateOverallRisk(
    permissions: ParsedPermission[]
  ): PermissionRiskLevel {
    if (permissions.length === 0) {
      return 'low';
    }

    const riskOrder: PermissionRiskLevel[] = ['low', 'medium', 'high', 'critical'];
    let maxRisk: PermissionRiskLevel = 'low';

    for (const perm of permissions) {
      if (riskOrder.indexOf(perm.riskLevel) > riskOrder.indexOf(maxRisk)) {
        maxRisk = perm.riskLevel;
      }
    }

    return maxRisk;
  }

  /**
   * Check if permission requires dev mode
   */
  requiresDevMode(permissions: PluginPermissions): boolean {
    return !!permissions.native;
  }

  /**
   * Check if permission requires explicit user consent
   */
  requiresConsent(riskLevel: PermissionRiskLevel): boolean {
    return riskLevel !== 'low';
  }
}

// =============================================================================
// Path Variable Resolution
// =============================================================================

export interface PathVariables {
  storagePath: string;
  workspacePath: string;
  appPath: string;
  tempPath: string;
}

/**
 * Resolve path variables in permission paths
 */
export function resolvePath(
  path: string,
  pluginId: string,
  variables: PathVariables
): string {
  return path
    .replace('$storagePath', `${variables.storagePath}/${pluginId}`)
    .replace('$workspacePath', variables.workspacePath)
    .replace('$appPath', variables.appPath)
    .replace('$tempPath', variables.tempPath);
}

/**
 * Check if a path matches a permission pattern
 */
export function matchPathPattern(
  pattern: string,
  targetPath: string,
  pluginId: string,
  variables: PathVariables
): boolean {
  const resolvedPattern = resolvePath(pattern, pluginId, variables);

  // Handle glob patterns
  if (resolvedPattern.includes('*')) {
    const regex = globToRegex(resolvedPattern);
    return regex.test(targetPath);
  }

  // Exact match or prefix match for directories
  return (
    targetPath === resolvedPattern ||
    targetPath.startsWith(resolvedPattern + '/')
  );
}

/**
 * Convert glob pattern to regex
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Check if a hostname matches a permission pattern
 */
export function matchHostPattern(pattern: string, hostname: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    return hostname.endsWith(suffix) || hostname === suffix.slice(1);
  }
  return pattern === hostname;
}

// =============================================================================
// Export singleton
// =============================================================================

let defaultValidator: PermissionValidator | null = null;

export function getPermissionValidator(): PermissionValidator {
  if (!defaultValidator) {
    defaultValidator = new PermissionValidator();
  }
  return defaultValidator;
}
