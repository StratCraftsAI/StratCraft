/**
 * System Configuration Types
 *
 * TICKET_046: System-Level Configuration Implementation
 * Defines types for the first layer of the three-tier configuration architecture.
 */

// =============================================================================
// Path Configuration
// =============================================================================

export interface PathsConfig {
  /** Plugin directories (array for multiple sources) */
  plugins: string[];
}

// =============================================================================
// Performance Configuration
// =============================================================================

export interface PerformanceConfig {
  /** Maximum concurrent backtest tasks */
  maxBacktestTasks: number;
}

// =============================================================================
// Sync Configuration
// =============================================================================

export interface SyncConfig {
  /** User-selected sync folder path */
  targetDir: string;
  /** ISO timestamp of last successful sync, null if never synced */
  lastSyncedAt: string | null;
  /** UUID of machine that last performed sync */
  lastSyncedMachineId: string;
}

// =============================================================================
// Scoreboard Configuration (TICKET_196_6 Phase 5)
// =============================================================================

export interface ScoreboardConfig {
  /**
   * Rolling window size in bars for IC / Sharpe / hit-rate computation.
   * Clamped to [20, 500] per TICKET_196_6 Resolution Q1. Read at recompute
   * time so changes take effect on the next refresh, not on app restart.
   */
  windowBars: number;
}

// =============================================================================
// LSTM Configuration (TICKET_1195)
// =============================================================================

export interface LstmConfig {
  /**
   * Kill switch for the automatic LSTM Combinator training triggered after
   * sweep / Run Backtest completion. Default false: auto-train has repeatedly
   * OOM-killed the Electron app (TICKET_1195, TICKET_1139). Manual training
   * enqueued from the UI is NOT gated by this flag. Read at trigger time,
   * so changes take effect without restart.
   */
  autoTrainEnabled: boolean;
}

// =============================================================================
// Resource Governance Configuration (TICKET_1283)
// =============================================================================

export interface ResourceGovernanceWorkloadConfig {
  /**
   * Per-workload cap as a percentage of machine resources on the tighter of
   * {CPU, memory} axes. Feeds both the cooperative headroom gate threshold and
   * the systemd cgroup hard cap. Clamped to [RESOURCE_CAP_MIN, RESOURCE_CAP_MAX].
   */
  capPercent: number;
}

export interface ResourceGovernanceConfig {
  /** Sweep workload cap (default 30) */
  sweep: ResourceGovernanceWorkloadConfig;
  /** Factor-mining workload cap (default 30) */
  mining: ResourceGovernanceWorkloadConfig;
  /** LSTM training workload cap (default 30) */
  lstm: ResourceGovernanceWorkloadConfig;
  /** Master toggle for the whole governance layer (default true) */
  enabled: boolean;
  /**
   * Whole-system RAM ceiling for combined running + candidate workload peak
   * admission. Independent of the per-workload cgroup caps.
   */
  admissionCeilingPercent: number;
}

// =============================================================================
// Hot-Reload Configuration
// =============================================================================

export interface HotReloadConfig {
  /** Config keys that can be hot-reloaded without restart */
  allowedKeys: string[];
}

// =============================================================================
// Main System Configuration
// =============================================================================

export interface SystemConfig {
  /** Schema identifier */
  $schema: string;
  /** Config version for migration */
  version: number;

  /** Path settings */
  paths: PathsConfig;
  /** Performance tuning */
  performance: PerformanceConfig;
  /** Hot-reload settings */
  hotReload: HotReloadConfig;
  /** Workspace sync settings */
  sync: SyncConfig;
  /** Signal Scoreboard settings (TICKET_196_6 Phase 5) */
  scoreboard: ScoreboardConfig;
  /** LSTM training settings (TICKET_1195) */
  lstm: LstmConfig;
  /** Per-workload resource governance settings (TICKET_1283) */
  resourceGovernance: ResourceGovernanceConfig;
}

// =============================================================================
// Path Variables
// =============================================================================

export type PathVariable =
  | '${APP_DATA}'
  | '${USER_HOME}'
  | '${USER_DOCUMENTS}'
  | '${APP_PATH}';

export interface ResolvedPaths {
  appData: string;
  userHome: string;
  userDocuments: string;
  appPath: string;
}

// =============================================================================
// Config Service Types
// =============================================================================

export interface ConfigChangeEvent {
  path: string;
  oldValue: unknown;
  newValue: unknown;
  requiresRestart: boolean;
}

export interface ConfigValidationError {
  path: string;
  message: string;
  value: unknown;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
}

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  $schema: 'StratCraft://config/v1',
  version: 1,

  paths: {
    plugins: ['${APP_DATA}/plugins'],
  },

  performance: {
    maxBacktestTasks: 3,
  },

  hotReload: {
    allowedKeys: [
      'performance.maxBacktestTasks',
      // TICKET_1283 -- gate thresholds hot-reload; cgroup caps apply on next launch
      'resourceGovernance.sweep.capPercent',
      'resourceGovernance.mining.capPercent',
      'resourceGovernance.lstm.capPercent',
      'resourceGovernance.enabled',
      'resourceGovernance.admissionCeilingPercent',
    ],
  },

  sync: {
    targetDir: '',
    lastSyncedAt: null,
    lastSyncedMachineId: '',
  },

  scoreboard: {
    windowBars: 60,
  },

  lstm: {
    autoTrainEnabled: true,
  },

  resourceGovernance: {
    sweep: { capPercent: 30 },
    mining: { capPercent: 30 },
    lstm: { capPercent: 30 },
    enabled: true,
    admissionCeilingPercent: 85,
  },
};

// =============================================================================
// Scoreboard Validation Bounds (TICKET_196_6 Phase 5)
// =============================================================================

export const SCOREBOARD_WINDOW_BARS_MIN = 20;
export const SCOREBOARD_WINDOW_BARS_MAX = 500;
// =============================================================================
// Resource Governance Validation Bounds (TICKET_1283)
// =============================================================================

export const RESOURCE_CAP_MIN = 10;
export const RESOURCE_CAP_MAX = 90;
export const RESOURCE_CAP_AGGREGATE_MAX = 90;
export const RESUME_HYSTERESIS_PCT = 10;

// =============================================================================
// Hot-Reload Keys (requires restart if not in this list)
// =============================================================================

export const HOT_RELOAD_ALLOWED_KEYS = [
  'performance.maxBacktestTasks',
  'hotReload.allowedKeys',
  'sync.targetDir',
  // TICKET_196_6 Phase 5 -- consumed at recompute / refresh time
  'scoreboard.windowBars',
  // TICKET_1195 F1 -- consumed at auto-train trigger time
  'lstm.autoTrainEnabled',
  // TICKET_1283 -- gate thresholds hot-reload; cgroup caps apply on next launch
  'resourceGovernance.sweep.capPercent',
  'resourceGovernance.mining.capPercent',
  'resourceGovernance.lstm.capPercent',
  'resourceGovernance.enabled',
  'resourceGovernance.admissionCeilingPercent',
];

export const REQUIRES_RESTART_KEYS = [
  'paths.plugins',
];
