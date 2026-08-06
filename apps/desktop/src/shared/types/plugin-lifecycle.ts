/**
 * Plugin Lifecycle Types
 *
 * TICKET_101: Plugin Lifecycle Hooks
 *
 * Shared type definitions for plugin lifecycle hooks.
 * Used by both LifecycleRunner (Host) and plugin scripts.
 */

// =============================================================================
// Lifecycle Storage
// =============================================================================

export interface LifecycleStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

// =============================================================================
// Database Protocol
// =============================================================================

export interface Transaction {
  execute(sql: string, params?: any[]): Promise<void>;
  query(sql: string, params?: any[]): Promise<any[]>;
}

export interface DatabaseProtocol {
  // Basic execution
  execute(sql: string, params?: any[]): Promise<void>;
  query(sql: string, params?: any[]): Promise<any[]>;
  queryOne(sql: string, params?: any[]): Promise<any | null>;

  // Transaction support
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;

  // Schema management
  getCurrentVersion(): Promise<number>;
  setVersion(version: number): Promise<void>;

  // Integrity check
  checkIntegrity(): Promise<{ ok: boolean; errors?: string[] }>;
}

// =============================================================================
// Lifecycle Logger
// =============================================================================

export interface LifecycleLogger {
  debug(msg: string): void;
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

// =============================================================================
// Lifecycle Progress
// =============================================================================

export interface LifecycleProgress {
  report(percent: number, message?: string): void;
}

// =============================================================================
// Install Context
// =============================================================================

export interface InstallContext {
  /** Plugin installation directory */
  pluginPath: string;
  /** Plugin data storage directory */
  storagePath: string;
  /** Temporary directory (cleaned after install) */
  tempPath: string;
  /** Operating system platform */
  platform: NodeJS.Platform;
  /** CPU architecture */
  arch: string;
  /** Download a file from URL to destination */
  download: (url: string, dest: string) => Promise<void>;
  /** Extract an archive to destination */
  extract: (archive: string, dest: string) => Promise<void>;
  /** Key-value storage for plugin state */
  storage: LifecycleStorage;
  /** Database protocol for secure database access */
  database: DatabaseProtocol;
  /** Logger for lifecycle events */
  log: LifecycleLogger;
  /** Progress reporter for UI updates */
  progress: LifecycleProgress;
}

// =============================================================================
// Upgrade Context
// =============================================================================

export interface UpgradeContext extends InstallContext {
  /** Previous version being upgraded from */
  fromVersion: string;
  /** New version being upgraded to */
  toVersion: string;
  /** Path to old plugin files (read-only, in temp) */
  oldPluginPath: string;
}

// =============================================================================
// Downgrade Context
// =============================================================================

export interface DowngradeContext extends InstallContext {
  /** Current (higher) version being downgraded from */
  fromVersion: string;
  /** Target (lower) version being downgraded to */
  toVersion: string;
}

// =============================================================================
// Uninstall Context
// =============================================================================

export interface UninstallContext {
  /** Plugin installation directory */
  pluginPath: string;
  /** Plugin data storage directory */
  storagePath: string;
  /** Whether to preserve user data */
  keepUserData: boolean;
  /** Logger for lifecycle events */
  log: LifecycleLogger;
}

// =============================================================================
// Lifecycle Hook Types
// =============================================================================

export type LifecycleHook = 'onInstall' | 'onUpgrade' | 'onDowngrade' | 'onUninstall';

export interface LifecycleManifest {
  lifecycle?: {
    onInstall?: string;
    onUpgrade?: string;
    onDowngrade?: string;
    onUninstall?: string;
  };
}

// =============================================================================
// Lifecycle Hook Functions
// =============================================================================

export type OnInstallFn = (context: InstallContext) => Promise<void>;
export type OnUpgradeFn = (context: UpgradeContext) => Promise<void>;
export type OnDowngradeFn = (context: DowngradeContext) => Promise<void>;
export type OnUninstallFn = (context: UninstallContext) => Promise<void>;
