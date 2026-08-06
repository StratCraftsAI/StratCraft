/**
 * Formatting Constants
 *
 * TICKET_179: Unified Constants Management
 *
 * Constants for display formatting, percentage conversion, and log truncation.
 */

/** Multiplier to convert decimal fraction to percentage (0.5 -> 50%) */
export const PERCENTAGE_MULTIPLIER = 100;

/** Threshold for K-suffix formatting (e.g., 1500 -> "1.5K") */
export const NUMBER_FORMAT_K_THRESHOLD = 1000;

/** Maximum characters to include in general log messages */
export const LOG_TRUNCATE_LENGTH = 100;

/** Maximum characters to include in SQL log messages */
export const SQL_LOG_TRUNCATE_LENGTH = 100;
