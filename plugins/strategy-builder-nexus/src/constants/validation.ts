/**
 * Strategy Builder Validation Constants
 *
 * TICKET_179: Unified Constants Management
 *
 * Plugin-layer validation thresholds for strategy generation parameters.
 * These constants stay in the plugin (not shared) to respect tier boundaries.
 */

// =============================================================================
// Prompt Validation
// =============================================================================

/** Minimum prompt length for strategy generation */
export const MIN_PROMPT_LENGTH = 10;

/** Maximum prompt length for strategy generation */
export const MAX_PROMPT_LENGTH = 10_000;

// =============================================================================
// Lookback / Backtest Config Bounds
// =============================================================================

/** Minimum lookback bars */
export const MIN_LOOKBACK_BARS = 20;

/** Maximum lookback bars */
export const MAX_LOOKBACK_BARS = 200;

/** Minimum max drawdown percentage */
export const MIN_MAX_DRAWDOWN = 1;

/** Maximum max drawdown percentage */
export const MAX_MAX_DRAWDOWN = 90;

// =============================================================================
// ML-Specific Bounds (AI Libero)
// =============================================================================

/** Minimum batch size for ML training */
export const MIN_BATCH_SIZE = 50;

/** Maximum batch size for ML training */
export const MAX_BATCH_SIZE = 500;

/** Minimum warmup period */
export const MIN_WARMUP_PERIOD = 50;

/** Maximum warmup period */
export const MAX_WARMUP_PERIOD = 500;

// =============================================================================
// Risk / Frequency Level Thresholds
// =============================================================================

/** Max drawdown threshold for Low risk classification */
export const RISK_LEVEL_LOW_THRESHOLD = 10;

/** Max drawdown threshold for Medium risk classification */
export const RISK_LEVEL_MEDIUM_THRESHOLD = 30;

/** Trading frequency threshold for Low classification */
export const FREQ_LEVEL_LOW_THRESHOLD = 10;

/** Trading frequency threshold for Medium classification */
export const FREQ_LEVEL_MEDIUM_THRESHOLD = 100;
