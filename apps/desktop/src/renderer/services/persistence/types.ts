/**
 * Persistence Types
 *
 * Type definitions for centralized state persistence.
 *
 * @see TICKET_007 - PersistenceManager design
 */

// =============================================================================
// Framework Persistence Types
// =============================================================================

/**
 * ViewId type - matches the view registry
 */
export type ViewId =
  | 'nexus'
  | 'chart'
  | 'backtest'
  | 'strategy'
  | 'data'
  | 'ai'
  | 'marketplace'
  | 'settings';

/**
 * Window bounds for restore
 */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

/**
 * Framework-level persistent state
 *
 * Stored in localStorage under key "StratCraft:framework"
 */
export interface FrameworkPersistentState {
  // === Version (for migration) ===
  /** Schema version for migration */
  _version: number;

  // === Navigation State ===
  /** Current active view */
  activeView: ViewId;

  // === UI State ===
  /** Sidebar collapsed state */
  sidebarCollapsed: boolean;

  // === Plugin State ===
  /** List of user-activated plugin IDs */
  enabledPlugins: string[];

  // === Session State (Optional) ===
  /** Last opened project path */
  lastOpenedProject?: string;

  /** Window bounds for restore */
  windowBounds?: WindowBounds;
}

/**
 * Default values for framework state
 */
export const FRAMEWORK_STATE_DEFAULTS: FrameworkPersistentState = {
  _version: 1,
  activeView: 'nexus',
  sidebarCollapsed: false,
  enabledPlugins: [],
};

/**
 * Storage keys
 *
 * IMPORTANT: Each storage mechanism must use a unique key to avoid conflicts.
 * - FRAMEWORK: Used by PersistenceManager for enabledPlugins
 * - APP_STATE: Used by useAppStore (zustand persist) for UI state
 * - THEME: Used by useThemeStore for theme settings
 */
export const STORAGE_KEYS = {
  /** PersistenceManager - enabledPlugins, windowBounds */
  FRAMEWORK: 'StratCraft:framework',
  /** useAppStore (zustand) - activeView, sidebarCollapsed */
  APP_STATE: 'StratCraft:app-state',
  /** useThemeStore - theme settings */
  THEME: 'StratCraft-theme',
  /** Plugin-specific state prefix */
  PLUGIN_PREFIX: 'StratCraft:plugin:',
} as const;

// =============================================================================
// Plugin Persistence Types (Reserved)
// =============================================================================

/**
 * Plugin-specific persistent state wrapper
 */
export interface PluginPersistentState<T = unknown> {
  /** Plugin ID */
  pluginId: string;
  /** Schema version */
  _version: number;
  /** Plugin-specific data */
  data: T;
  /** Last updated timestamp */
  updatedAt: number;
}
