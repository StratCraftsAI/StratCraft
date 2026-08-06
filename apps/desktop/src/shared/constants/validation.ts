/**
 * Validation Constants
 *
 * TICKET_179: Unified Constants Management
 *
 * Shared validation thresholds used across the application.
 */

/** Minimum characters before triggering symbol search */
export const SYMBOL_SEARCH_MIN_QUERY_LENGTH = 2;

/** Symbol search debounce delay (ms) */
export const SYMBOL_SEARCH_DEBOUNCE_MS = 300;

/** Maximum audit log entries before pruning */
export const AUDIT_LOG_MAX_ENTRIES = 1000;

/** Maximum length for strategy names (TICKET_641_7) */
export { MAX_STRATEGY_NAME_LENGTH } from '@StratCraft/types';

/** Maximum bars per get_market_data call (TICKET_1235_9 F4 guardrail) */
export const MARKET_DATA_MAX_BARS = 50000;
