/**
 * Hardware Constants
 *
 * TICKET_542: Executor Queue Hardware Cap Fix
 * TICKET_179: Unified Constants Management
 */

// =============================================================================
// Executor Concurrency
// =============================================================================

/** Minimum concurrent executor tasks regardless of CPU count */
export const MIN_EXECUTOR_HARDWARE_CAP = 2;

// =============================================================================
// Queue Depth Limits (TICKET_641_2)
// =============================================================================

/** Maximum number of pending/queued tasks before enqueue is rejected */
export const MAX_QUEUE_DEPTH = 100;

/** Ratio of MAX_QUEUE_DEPTH at which a warning is logged (80%) */
export const QUEUE_WARNING_THRESHOLD_RATIO = 0.8;
