/**
 * Platform Resolver Utility
 *
 * TICKET_725_2: Maps process.platform + process.arch to PluginPlatform,
 * selects correct per-platform ZIP from versions array.
 */

import type { PluginPlatform, PluginVersionInfo } from '../../shared/types/marketplace';

const PLATFORM_MAP: Record<string, PluginPlatform> = {
  'linux-x64': 'linux-x64',
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-x64',
  'win32-x64': 'win32-x64',
};

/**
 * Resolves current OS + arch to a PluginPlatform identifier.
 * Throws if the combination is not supported.
 */
export function getCurrentPlatform(): PluginPlatform {
  const key = `${process.platform}-${process.arch}`;
  const platform = PLATFORM_MAP[key];
  if (!platform) {
    throw new Error(
      `Unsupported platform: ${process.platform} ${process.arch}. ` +
      `Supported: ${Object.keys(PLATFORM_MAP).join(', ')}`
    );
  }
  return platform;
}

/**
 * Given a list of PluginVersionInfo entries for the same version,
 * selects the one matching the current platform.
 *
 * Priority:
 * 1. Exact platform match (e.g., 'linux-x64')
 * 2. 'universal' fallback (JS-only plugins)
 * 3. Entry with no platform field (backward compat)
 *
 * Throws if no suitable entry is found.
 */
export function resolvePlatformVersion(versions: PluginVersionInfo[]): PluginVersionInfo {
  if (versions.length === 0) {
    throw new Error('No version entries available');
  }

  // If all entries lack platform field, return first (backward compat)
  const allLackPlatform = versions.every((v) => !v.platform);
  if (allLackPlatform) {
    return versions[0];
  }

  const currentPlatform = getCurrentPlatform();

  // Exact match
  const exactMatch = versions.find((v) => v.platform === currentPlatform);
  if (exactMatch) return exactMatch;

  // Universal fallback
  const universalMatch = versions.find((v) => v.platform === 'universal');
  if (universalMatch) return universalMatch;

  // No platform field fallback
  const noPlatformMatch = versions.find((v) => !v.platform);
  if (noPlatformMatch) return noPlatformMatch;

  const available = versions.map((v) => v.platform).join(', ');
  throw new Error(
    `No plugin build available for ${currentPlatform}. Available: ${available}`
  );
}

/**
 * Returns the expected native library file extension for the current platform.
 */
export function getPlatformBinarySuffix(): string {
  switch (process.platform) {
    case 'linux': return '.so';
    case 'darwin': return '.dylib';
    case 'win32': return '.dll';
    default:
      throw new Error(`Unsupported platform for native binaries: ${process.platform}`);
  }
}
