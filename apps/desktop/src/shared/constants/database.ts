/**
 * Database Constants
 *
 * TICKET_476: Magic Number Elimination
 * TICKET_179: Unified Constants Management
 *
 * SQLite configuration constants.
 */

// =============================================================================
// SQLite Performance Settings
// =============================================================================

/** SQLite mmap cap — actual mmap_size is min(db_file_size, this cap). TICKET_1099: 30GB blanket caused SIGSEGV after 19h sustained writes. */
export const SQLITE_MMAP_SIZE_CAP = 2_000_000_000;

/** Skip PRAGMA quick_check when DB file exceeds this size (bytes). quick_check reads every B-tree page; on a 20GB DB it blocks the main thread for minutes. */
export const DB_INTEGRITY_CHECK_MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB
