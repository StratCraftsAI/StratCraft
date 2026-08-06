/**
 * Plugin System Type Definitions - StratCraft Plugin Architecture
 *
 * Plugin system follows these design principles:
 * 1. Declarative configuration (manifest.json)
 * 2. Permission isolation (sandbox / trusted)
 * 3. Lifecycle management (activate / deactivate)
 * 4. Contribution point mechanism (contributes)
 */

// =============================================================================
// Plugin Manifest (manifest.json specification)
// =============================================================================

export interface PluginManifest {
  // Basic information
  id: string;                          // Unique identifier (e.g., "com.stratcraft.chart")
  name: string;                        // Internal technical name (kebab-case, e.g., "strategy-nexus")
  displayName: string;                 // User-facing display name (e.g., "Strategy-Nexus")
  // TICKET_786_6 Phase 1: optional i18n key siblings for user-visible fields.
  // Resolved at render time via resolveManifestI18n() using the plugin's i18n
  // namespace; falls back to the literal string when the key is missing.
  displayNameKey?: string;
  descriptionKey?: string;
  version: string;                     // Semantic version
  description?: string;                // Description
  author?: string;                     // Author
  homepage?: string;                   // Homepage
  repository?: string;                 // Code repository
  license?: string;                    // License

  // Entry point and type
  main: string;                        // Main entry file (e.g., "./dist/index.js")
  type: PluginType;                    // Plugin type
  category?: PluginCategory;           // Category

  // Distribution (PLUGIN_TICKET_002)
  distribution?: PluginDistribution;   // 'bundled' (default) | 'marketplace'

  // Architectural plugin tier. Tier 0 is host-internal; Tier 1 is user-facing.
  tier?: number;

  // Contribution points (UI extensions)
  contributes?: PluginContributes;

  // Dependencies and permissions
  dependencies?: Record<string, string>;  // Dependent plugins
  permissions?: PluginPermission[];       // Required permissions

  // Runtime configuration
  isolation?: PluginIsolation;         // Isolation mode
  configSchema?: PluginConfigSchema;   // Configuration schema

  // Activation conditions
  activationEvents?: string[];         // Activation events (e.g., "onStartup", "onCommand:*")

  // ---------------------------------------------------------------------------
  // Independent Process Configuration (TICKET_632_2)
  // ---------------------------------------------------------------------------
  process?: PluginProcessConfig;

  // ---------------------------------------------------------------------------
  // Service Entitlements (TICKET_066, TICKET_075)
  // ---------------------------------------------------------------------------
  entitlements?: PluginEntitlementDefinition;

  // Hub entity permissions consumed by the Main-process entitlement owner.
  hub?: {
    contributes?: string[];
    consumes?: string[];
  };
}

// =============================================================================
// Plugin Process Configuration (TICKET_632_2)
// =============================================================================

/**
 * Configuration for independent plugin processes.
 * When mode is 'independent', the plugin runs in its own Node.js child process
 * with a direct MessagePort to Renderer (Host out of the loop after setup).
 */
export interface PluginProcessConfig {
  mode: 'independent';
  entry: string;                       // Entry script relative to plugin directory
  native?: Record<string, string>;     // Native module mappings
}

/**
 * Plugin process lifecycle status
 */
export type PluginProcessStatus = 'spawning' | 'running' | 'crashed' | 'stopped';

/**
 * Plugin process status information returned by getStatus()
 */
export interface PluginProcessStatusInfo {
  status: PluginProcessStatus;
  restartCount: number;
  pid?: number;
}

// =============================================================================
// Service Entitlements (TICKET_066, TICKET_075)
// =============================================================================

/**
 * Plugin entitlement configuration in manifest.json
 * Each plugin can define its own tier mapping (TICKET_075)
 */
export interface PluginEntitlementDefinition {
  /**
   * Tier mapping for this plugin (TICKET_075)
   * Maps tier names to numeric levels for comparison
   * Example: { "basic": 0, "premium": 1, "ultimate": 2 }
   */
  tierMapping?: Record<string, number>;

  /**
   * Services provided by this plugin
   */
  services: ServiceEntitlementDefinition[];
}

// TICKET_544: Tier mapping moved to @shared/constants/entitlement.ts (ENTITLEMENT_TIER_LEVELS)
export { ENTITLEMENT_TIER_LEVELS as DEFAULT_TIER_MAPPING } from '../constants/entitlement';

/**
 * Service tier levels for entitlement gating
 */
export type ServiceTier = string;  // TICKET_075: Allow custom tier names

/**
 * Service entitlement definition in manifest.json
 * Declares what services a plugin provides
 */
export interface ServiceEntitlementDefinition {
  id: string;                          // Service ID (e.g., "kronos_predictor")
  name: string;                        // Display name (e.g., "KRONOS PREDICTOR")
  // TICKET_786_6 Phase 1: optional i18n keys (see PluginManifest comment).
  nameKey?: string;
  descriptionKey?: string;
  categoryKey?: string;
  description?: string;                // Service description
  tier: ServiceTier;                   // Required tier to use this service
  defaultEnabled: boolean;             // Default enabled state in standalone mode
  category?: string;                   // Grouping category (e.g., "KRONOS MODE")
  icon?: string;                       // Icon for display
}

/**
 * User's service configuration (stored in user-config.json)
 *
 * TICKET_927_2_2: `preferences` carries arbitrary string-keyed preference
 * values per plugin. Used by the data-routing host plugin to persist
 * `data.providerPreference.<MarketId>: DataProviderId[]`. Reserved for
 * structured user preferences -- not a generic key/value bucket for plugin
 * developers; new top-level shapes belong in the plugin's manifest.
 */
export interface UserServiceConfig {
  services: {
    [serviceId: string]: {
      enabled: boolean;
    };
  };
  preferences?: {
    [key: string]: unknown;
  };
}

/**
 * Runtime service state (merged from manifest + user config + server entitlements)
 */
export interface ServiceEntitlementState {
  id: string;
  name: string;
  description?: string;
  tier: ServiceTier;
  category?: string;
  icon?: string;

  // Runtime state
  enabled: boolean;                    // Final enabled state
  effectiveEnabled: boolean;           // False when disabled or tier-locked
  source: 'manifest' | 'user-config' | 'server';  // Where enabled state comes from
  locked: boolean;                     // True if tier requirement not met
  lockReason?: string;                 // Why locked (e.g., "pro_required")

  // Quota (for connected mode)
  quota?: number;                      // -1 = unlimited
  used?: number;
}

/**
 * Plugin's full entitlement state
 */
export interface PluginEntitlementState {
  pluginId: string;
  services: ServiceEntitlementState[];
}

// =============================================================================
// Plugin Distribution Type (PLUGIN_TICKET_002)
// =============================================================================

/**
 * Plugin distribution type - determines visibility in NexusHub
 *
 * - 'bundled': Always displayed (core plugins shipped with app)
 * - 'marketplace': Only displayed when installed via Marketplace
 */
export type PluginDistribution = 'bundled' | 'marketplace';

// =============================================================================
// Plugin Types and Categories
// =============================================================================

export type PluginType =
  | 'nexus'            // Core Nexus plugins (Data, Strategy, Backtest)
  | 'ui'               // UI plugins (charts, panels, etc.)
  | 'data-source'      // Data source plugins
  | 'indicator'        // Indicator plugins
  | 'strategy'         // Strategy plugins
  | 'execution'        // Execution plugins
  | 'analysis'         // Analysis plugins
  | 'utility';         // Utility plugins

export type PluginCategory =
  | 'visualization'    // Visualization
  | 'trading'          // Trading
  | 'data'             // Data
  | 'ai'               // AI/ML
  | 'tools'            // Tools
  | 'themes';          // Themes

// =============================================================================
// Plugin Contributes (contribution points)
// =============================================================================

export interface PluginContributes {
  // Main view (occupies main area)
  mainView?: MainViewContribution[];

  // Sidebar panels
  sidePanel?: SidePanelContribution[];

  // Bottom panels
  bottomPanel?: BottomPanelContribution[];

  // Toolbar buttons
  toolbar?: ToolbarContribution[];

  // Menu items
  menus?: MenuContribution[];

  // Commands
  commands?: CommandContribution[];

  // Settings (legacy)
  settings?: SettingContribution[];

  // Themes
  themes?: ThemeContribution[];

  // ---------------------------------------------------------------------------
  // Plugin Configuration (TICKET_081)
  // Declarative configuration schema - Host renders UI automatically
  // ---------------------------------------------------------------------------
  configuration?: ConfigurationContribution;

  // ---------------------------------------------------------------------------
  // Plugin I18N Contribution (TICKET_086)
  // Allows plugins to contribute translation resources
  // ---------------------------------------------------------------------------
  i18n?: I18nContribution;

  // ---------------------------------------------------------------------------
  // Host/Plugin Architecture (TICKET_059)
  // ---------------------------------------------------------------------------

  // View containers in sidebar/activitybar
  viewsContainers?: ViewsContainersContribution;

  // Views registered to containers
  views?: Record<string, ViewContribution[]>;

  // Custom editors for specific resource types
  editors?: EditorContribution[];

  // Tree data providers
  treeDataProviders?: TreeDataProviderContribution[];

  // ---------------------------------------------------------------------------
  // Signal Fusion Methods (TICKET_987 Phase 4)
  // Allows plugins to register custom ISignalFusion implementations
  // ---------------------------------------------------------------------------
  signalFusion?: SignalFusionContribution[];
}

// =============================================================================
// Signal Fusion Contribution (TICKET_987 Phase 4)
// =============================================================================

export interface SignalFusionContribution {
  id: string;
  displayName: string;
  displayNameKey?: string;
  description?: string;
}

// =============================================================================
// I18N Contribution (TICKET_086)
// =============================================================================

/**
 * Plugin i18n contribution configuration
 * Declares translation resources provided by this plugin
 */
export interface I18nContribution {
  /**
   * Relative path to locales directory from plugin root
   * @example "./locales"
   */
  path: string;

  /**
   * Namespace identifiers for this plugin's translations
   * Must be unique across all plugins and not conflict with core namespaces
   * Convention: use plugin-id or a short unique name
   * @example ["strategy-builder", "strategy-builder-errors"]
   */
  namespaces: string[];
}

// =============================================================================
// Configuration Contribution (TICKET_081)
// =============================================================================

/**
 * Plugin configuration schema (VS Code pattern)
 * Host renders settings UI based on this schema
 */
export interface ConfigurationContribution {
  /** Display title for this configuration section */
  title: string;
  /** TICKET_786_6 Phase 1: optional i18n key for `title`. */
  titleKey?: string;
  /** Configuration properties */
  properties: Record<string, ConfigurationProperty>;
}

/**
 * Single configuration property definition
 */
export interface ConfigurationProperty {
  /** Property type */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  /** Default value */
  default?: unknown;
  /** Description shown in UI */
  description?: string;
  /** TICKET_786_6 Phase 1: optional i18n key for `description`. */
  descriptionKey?: string;
  /** TICKET_786_6 Phase 1: optional i18n key for `category`. */
  categoryKey?: string;

  // String constraints
  /** Enum values for dropdown */
  enum?: string[];
  /** Descriptions for each enum value */
  enumDescriptions?: string[];
  /** Regex pattern for validation */
  pattern?: string;

  // Number constraints
  /** Minimum value */
  minimum?: number;
  /** Maximum value */
  maximum?: number;

  // UI hints
  /** Display order (lower = first) */
  order?: number;
  /** Category for grouping */
  category?: string;

  // Security
  /** If true, stored in encrypted storage */
  secret?: boolean;
}

// Views containers contribution (sidebar/activitybar)
export interface ViewsContainersContribution {
  sidebar?: ViewContainerItem[];
  activitybar?: ViewContainerItem[];
}

export interface ViewContainerItem {
  id: string;
  title: string;
  /** TICKET_786_6 Phase 1: optional i18n key for `title`. */
  titleKey?: string;
  icon?: string;
}

// View contribution (registered to a container)
export interface ViewContribution {
  id: string;
  name: string;
  /** TICKET_786_6 Phase 1: optional i18n key for `name`. */
  nameKey?: string;
  when?: string;  // Conditional visibility expression
  order?: number;
}

// Custom editor contribution
export interface EditorContribution {
  viewType: string;
  displayName: string;
  /** TICKET_786_6 Phase 1: optional i18n key for `displayName`. */
  displayNameKey?: string;
  selector: EditorSelector[];
  priority?: 'default' | 'option';
  /**
   * Service IDs that use this editor (TICKET_079)
   * Maps service entitlements to their editor page
   */
  serviceIds?: string[];
}

export interface EditorSelector {
  filenamePattern?: string;
  resourceScheme?: string;
}

// Tree data provider contribution
export interface TreeDataProviderContribution {
  id: string;
  viewId: string;  // Which tree view container this provides data for
}

// Main view contribution
export interface MainViewContribution {
  id: string;
  title: string;
  /** TICKET_786_6 Phase 1: optional i18n key for `title`. */
  titleKey?: string;
  entry: string;          // Component entry (e.g., "./dist/ChartView.js")
  icon?: string;
  route?: string;         // Route path (e.g., "/chart")
  order?: number;
}

// Sidebar panel contribution
export interface SidePanelContribution {
  id: string;
  title: string;
  /** TICKET_786_6 Phase 1: optional i18n key for `title`. */
  titleKey?: string;
  entry: string;
  icon?: string;
  position?: 'left' | 'right';
  order?: number;
}

// Bottom panel contribution
export interface BottomPanelContribution {
  id: string;
  title: string;
  /** TICKET_786_6 Phase 1: optional i18n key for `title`. */
  titleKey?: string;
  entry: string;
  icon?: string;
  order?: number;
}

// Toolbar contribution
export interface ToolbarContribution {
  id: string;
  title: string;
  icon: string;
  command: string;        // Command to trigger
  group?: string;
  order?: number;
}

// Menu contribution
export interface MenuContribution {
  id: string;
  title: string;
  command: string;
  menu: 'file' | 'edit' | 'view' | 'tools' | 'help' | 'context';
  group?: string;
  order?: number;
  when?: string;          // Condition expression
}

// Command contribution
export interface CommandContribution {
  id: string;             // Command ID (e.g., "chart.zoomIn")
  title: string;
  /** TICKET_786_6 Phase 1: optional i18n key for `title`. */
  titleKey?: string;
  category?: string;
  /** TICKET_786_6 Phase 1: optional i18n key for `category`. */
  categoryKey?: string;
  icon?: string;
  keybinding?: string;    // Keyboard shortcut (e.g., "Ctrl+Plus")
}

// Setting contribution
export interface SettingContribution {
  id: string;
  title: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  default: unknown;
  description?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
}

// Theme contribution
export interface ThemeContribution {
  id: string;
  label: string;
  uiTheme: 'light' | 'dark';
  path: string;           // CSS/JSON file path
}

// =============================================================================
// Plugin Permissions (Legacy - simple string identifiers)
// =============================================================================

export type PluginPermission =
  | 'network'            // Network access
  | 'network:internal'   // Internal API access only
  | 'filesystem'         // File system (sandbox)
  | 'filesystem:full'    // Full file system access
  | 'database'           // Database access
  | 'notification'       // Notifications
  | 'clipboard'          // Clipboard
  | 'shell'              // Shell execution (dangerous)
  | 'native';            // Native modules (dangerous)

// =============================================================================
// Detailed Permission Schema (TICKET_099)
// =============================================================================

/**
 * Trust level for plugin packages
 */
export type PluginTrustLevel =
  | 'official'     // L1: Signed by StratCraft root CA
  | 'verified'     // L2: Signed by Market-verified publisher
  | 'unverified'   // L3: Self-signed by publisher (warning shown)
  | 'unsigned';    // L4: No signature (requires dev mode)

/**
 * Permission risk level
 */
export type PermissionRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Detailed permission declaration in manifest.json
 */
export interface DetailedPluginPermissions {
  network?: {
    hosts: string[];      // Allowed hostnames (supports wildcards)
    reason: string;       // User-visible explanation
  };
  fs?: {
    read?: string[];      // Paths with $variables and globs
    write?: string[];
    reason: string;
  };
  bridge?: {
    apis: PluginBridgeApi[];
    reason: string;
  };
  secrets?: {
    keys: string[];       // Allowed secret key names
    reason: string;
  };
  shell?: {
    commands: string[];   // Allowed executables
    args?: string[];      // Allowed argument patterns
    reason: string;
  };
  native?: {
    modules: string[];    // N-API addon names
    reason: string;
  };
}

/**
 * Bridge API names that plugins can request access to
 */
export type PluginBridgeApi =
  | 'DataChannel'
  | 'SessionApi'
  | 'Registry'
  | 'EventBus'
  | '*';

/**
 * Parsed permission for display in consent dialog
 */
export interface ParsedPluginPermission {
  type: keyof DetailedPluginPermissions;
  riskLevel: PermissionRiskLevel;
  description: string;
  reason: string;
}

/**
 * Publisher information from signature
 */
export interface PluginPublisherInfo {
  id: string;           // e.g., "com.StratCraft"
  name: string;         // e.g., "StratCraft Official"
  certificate?: string; // PEM-encoded certificate
}

/**
 * Installation preview for consent dialog
 */
export interface PluginInstallPreview {
  pluginId: string;
  version: string;
  displayName: string;
  publisher: PluginPublisherInfo | null;
  trustLevel: PluginTrustLevel;
  permissions: ParsedPluginPermission[];
  warnings: string[];
  requiresDevMode: boolean;
  existingVersion?: string;
}

/**
 * Granted permissions record
 */
export interface GrantedPluginPermissions {
  version: string;
  grantedAt: string;
  permissions: DetailedPluginPermissions;
  revokedPermissions?: string[];
}

// Isolation mode
export type PluginIsolation =
  | 'sandbox'            // Sandbox mode (iframe/Web Worker)
  | 'trusted';           // Trusted mode (direct loading)

// =============================================================================
// Plugin State
// =============================================================================

export interface PluginState {
  id: string;
  enabled: boolean;
  loaded: boolean;
  active: boolean;
  error?: string;
  config?: Record<string, unknown>;
  loadedAt?: number;
  activatedAt?: number;
}

// Plugin instance
export interface PluginInstance {
  manifest: PluginManifest;
  state: PluginState;
  api?: PluginApi;
  context?: PluginContext;
  module?: PluginModule;
}

// =============================================================================
// Plugin API (APIs callable by plugins)
// =============================================================================

export interface PluginApi {
  // Lifecycle
  activate(): Promise<void>;
  deactivate(): Promise<void>;

  // Configuration
  getConfig?(): Record<string, unknown>;
  setConfig?(config: Record<string, unknown>): void;

  // Events
  onEvent?(event: PluginEvent): void;
}

// Plugin event
export interface PluginEvent {
  type: string;
  data?: unknown;
  source?: string;
}

// =============================================================================
// Plugin Context (APIs provided by host to plugins)
// =============================================================================

export interface PluginContext {
  // Plugin information
  pluginId: string;
  pluginPath: string;

  // Logging
  log: PluginLogger;

  // Storage
  storage: PluginStorage;

  // Commands
  commands: PluginCommands;

  // Messaging
  messaging: PluginMessaging;

  // State
  state: PluginStateApi;

  // UI
  ui: PluginUi;

  // Data
  data: PluginData;
}

// Logging API
export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

// Storage API
export interface PluginStorage {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

// Commands API
export interface PluginCommands {
  register(id: string, handler: (...args: unknown[]) => unknown): void;
  execute(id: string, ...args: unknown[]): Promise<unknown>;
  getAll(): string[];
}

// Messaging API
export interface PluginMessaging {
  send(target: string, message: unknown): void;
  broadcast(message: unknown): void;
  onMessage(handler: (source: string, message: unknown) => void): void;
}

// State API
export interface PluginStateApi {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  subscribe(key: string, handler: (value: unknown) => void): () => void;
}

// UI API
export interface PluginUi {
  showNotification(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void;
  showDialog(options: DialogOptions): Promise<DialogResult>;
  showProgress(title: string): ProgressHandle;
}

export interface DialogOptions {
  title: string;
  message: string;
  buttons?: string[];
  type?: 'info' | 'warning' | 'error' | 'question';
}

export interface DialogResult {
  button: string;
  checkboxChecked?: boolean;
}

export interface ProgressHandle {
  update(progress: number, message?: string): void;
  done(): void;
}

// Data API
export interface PluginData {
  getMarketData(symbol: string, interval: string, start: string, end: string): Promise<unknown[]>;
  getSymbols(): Promise<string[]>;
}

// =============================================================================
// Plugin Module (loaded module)
// =============================================================================

export interface PluginModule {
  activate(context: PluginContext): Promise<PluginApi>;
  deactivate?(): Promise<void>;
}

// =============================================================================
// Plugin Config Schema
// =============================================================================

export interface PluginConfigSchema {
  type: 'object';
  properties: Record<string, ConfigProperty>;
  required?: string[];
}

export interface ConfigProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  items?: ConfigProperty;
}

// =============================================================================
// Data Source Plugin Interface
// =============================================================================

import type { DataProvider, ProviderConfig } from './data-provider';
import type { DataStorage, StorageConfig } from './data-storage';
import type { DataCache, CacheConfig } from './data-cache';
import type {
  OHLCVSeries,
  Quote,
  SymbolInfo,
  DataRequest,
  DataResponse,
  DataEvent,
  DataEventType,
  SubscriptionHandle,
  Interval,
} from './market-data';

/**
 * Data Source Plugin Interface
 *
 * Complete interface for data plugins that provide market data.
 * Extends PluginApi with data-specific capabilities.
 */
export interface DataSourcePlugin extends PluginApi {
  // ===========================================================================
  // Provider Management
  // ===========================================================================

  /**
   * Get available data providers
   */
  getProviders(): DataProvider[];

  /**
   * Get active provider
   */
  getActiveProvider(): DataProvider | undefined;

  /**
   * Set active provider
   */
  setActiveProvider(providerId: string): Promise<void>;

  /**
   * Configure a provider
   */
  configureProvider(providerId: string, config: ProviderConfig): Promise<void>;

  // ===========================================================================
  // Data Access
  // ===========================================================================

  /**
   * Fetch historical data
   */
  fetchHistoricalData(request: DataRequest): Promise<DataResponse<OHLCVSeries>>;

  /**
   * Get real-time quote
   */
  getQuote(symbol: string): Promise<DataResponse<Quote>>;

  /**
   * Get multiple quotes
   */
  getQuotes(symbols: string[]): Promise<Map<string, DataResponse<Quote>>>;

  /**
   * Subscribe to real-time data
   */
  subscribe(
    symbol: string,
    types: DataEventType[],
    onData: (event: DataEvent) => void
  ): Promise<SubscriptionHandle>;

  /**
   * Unsubscribe from all
   */
  unsubscribeAll(): Promise<void>;

  // ===========================================================================
  // Symbol Operations
  // ===========================================================================

  /**
   * Search symbols
   */
  searchSymbols(query: string): Promise<SymbolInfo[]>;

  /**
   * Get symbol info
   */
  getSymbolInfo(symbol: string): Promise<DataResponse<SymbolInfo>>;

  /**
   * List available symbols
   */
  listSymbols(): Promise<SymbolInfo[]>;

  // ===========================================================================
  // Storage Access
  // ===========================================================================

  /**
   * Get storage instance
   */
  getStorage(): DataStorage | undefined;

  /**
   * Get cache instance
   */
  getCache(): DataCache | undefined;

  // ===========================================================================
  // Utility
  // ===========================================================================

  /**
   * Get supported intervals
   */
  getSupportedIntervals(symbol: string): Interval[];

  /**
   * Check if symbol is supported
   */
  isSymbolSupported(symbol: string): Promise<boolean>;
}

/**
 * Data Source Plugin Configuration
 */
export interface DataSourcePluginConfig {
  // Provider configs
  providers: Record<string, ProviderConfig>;
  defaultProvider?: string;

  // Storage config
  storage?: StorageConfig;

  // Cache config
  cache?: CacheConfig;
}

// =============================================================================
// Indicator Plugin Interface
// =============================================================================

/**
 * Indicator Plugin Interface
 *
 * Interface for technical indicator plugins.
 */
export interface IndicatorPlugin extends PluginApi {
  /**
   * Calculate indicator values
   */
  calculate(data: number[], params?: Record<string, unknown>): number[];

  /**
   * Calculate with OHLCV data
   */
  calculateOHLCV?(data: OHLCVSeries, params?: Record<string, unknown>): IndicatorResult;

  /**
   * Get indicator parameters definition
   */
  getParams(): IndicatorParam[];

  /**
   * Get indicator metadata
   */
  getMetadata(): IndicatorMetadata;
}

/**
 * Indicator parameter definition
 */
export interface IndicatorParam {
  name: string;
  type: 'number' | 'string' | 'boolean';
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: unknown[];
  description?: string;
}

/**
 * Indicator metadata
 */
export interface IndicatorMetadata {
  name: string;
  shortName: string;
  description?: string;
  category: IndicatorCategory;
  overlay: boolean;            // Display on price chart vs separate pane
  outputs: IndicatorOutput[];
}

/**
 * Indicator category
 */
export type IndicatorCategory =
  | 'trend'
  | 'momentum'
  | 'volatility'
  | 'volume'
  | 'oscillator'
  | 'other';

/**
 * Indicator output definition
 */
export interface IndicatorOutput {
  name: string;
  type: 'line' | 'histogram' | 'area' | 'band';
  color?: string;
}

/**
 * Indicator calculation result
 */
export interface IndicatorResult {
  values: Record<string, number[]>;
  startIndex: number;          // First valid index
}

// =============================================================================
// Host/Plugin Architecture APIs (TICKET_059)
// =============================================================================

/**
 * Disposable pattern for cleanup
 */
export interface Disposable {
  dispose(): void;
}

/**
 * Event emitter interface
 */
export interface EventEmitter<T> {
  event: Event<T>;
  fire(data: T): void;
  dispose(): void;
}

export type Event<T> = (listener: (e: T) => void) => Disposable;

// -----------------------------------------------------------------------------
// Tree Data Provider
// -----------------------------------------------------------------------------

/**
 * TreeItem represents a single node in the tree
 */
export interface TreeItem {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  iconPath?: string;
  collapsibleState: TreeItemCollapsibleState;
  command?: TreeItemCommand;
  contextValue?: string;  // For context menu matching
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export interface TreeItemCommand {
  command: string;
  title?: string;
  arguments?: unknown[];
}

/**
 * TreeDataProvider interface for plugins to implement
 */
export interface TreeDataProvider<T = unknown> {
  onDidChangeTreeData?: Event<T | undefined>;
  getTreeItem(element: T): TreeItem | Promise<TreeItem>;
  getChildren(element?: T): T[] | Promise<T[]>;
  getParent?(element: T): T | undefined | Promise<T | undefined>;
}

// -----------------------------------------------------------------------------
// View Provider
// -----------------------------------------------------------------------------

/**
 * ViewProvider interface for plugins to implement
 */
export interface ViewProvider {
  /**
   * Resolve view element - return React component or HTML
   */
  resolveView(viewId: string, options?: ViewOptions): ViewElement;

  /**
   * Called when view becomes visible
   */
  onDidShow?(): void;

  /**
   * Called when view becomes hidden
   */
  onDidHide?(): void;

  /**
   * Dispose resources
   */
  dispose?(): void;
}

export interface ViewOptions {
  [key: string]: unknown;
}

export interface ViewElement {
  type: 'react' | 'html' | 'iframe';
  content: unknown;  // React.ComponentType | string | URL
  props?: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Custom Editor Provider
// -----------------------------------------------------------------------------

/**
 * CustomEditorProvider interface for plugins to implement
 */
export interface CustomEditorProvider {
  /**
   * Resolve editor for a resource
   */
  resolveCustomEditor(
    resourceUri: string,
    viewType: string
  ): EditorElement;

  /**
   * Called when editor document changes
   */
  onDidChangeDocument?(resourceUri: string): void;

  /**
   * Save document
   */
  saveDocument?(resourceUri: string): Promise<void>;

  /**
   * Dispose resources
   */
  dispose?(): void;
}

export interface EditorElement {
  type: 'react' | 'html' | 'iframe';
  content: unknown;
  props?: Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Breadcrumb API
// -----------------------------------------------------------------------------

/**
 * BreadcrumbItem for navigation
 */
export interface BreadcrumbItem {
  id: string;
  label: string;
  icon?: string;
  tooltip?: string;
  command?: string;
  arguments?: unknown[];
}

// -----------------------------------------------------------------------------
// Extended Window API (nexus.window)
// -----------------------------------------------------------------------------

/**
 * Extended window API surface for Host/Plugin communication
 */
export interface WindowApi {
  // Tree management
  registerTreeDataProvider<T>(
    viewId: string,
    provider: TreeDataProvider<T>
  ): Disposable;
  refreshTreeView(viewId: string): void;

  // Breadcrumb management
  setBreadcrumb(items: BreadcrumbItem[]): void;
  onBreadcrumbClick(callback: (item: BreadcrumbItem) => void): Disposable;

  // View management
  registerViewProvider(viewId: string, provider: ViewProvider): Disposable;
  openView(viewId: string, options?: ViewOptions): Promise<void>;
  closeView(viewId: string): void;

  // Editor management
  registerCustomEditorProvider(
    viewType: string,
    provider: CustomEditorProvider
  ): Disposable;
  openEditor(resourceUri: string, viewType: string): Promise<void>;
  getActiveEditor(): { resourceUri: string; viewType: string } | undefined;

  // Open an HTTPS URL through the preload-owned, Main-process IPC adapter.
  openExternal(url: string): Promise<void>;
}
