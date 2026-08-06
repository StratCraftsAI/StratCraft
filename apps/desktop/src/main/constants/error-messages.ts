/**
 * Centralized Error Message Constants
 * TICKET_535 Root Cause Fix: Single source of truth for error messages
 *
 * All error messages in the application should use these constants instead of
 * hardcoded strings. This ensures:
 * - Consistency between production and test code
 * - Easy refactoring (change once, apply everywhere)
 * - TypeScript compile-time safety
 * - i18n support in the future
 *
 * Usage in production code:
 * ```typescript
 * import { ERROR_MESSAGES } from '../constants/error-messages';
 * throw new Error(ERROR_MESSAGES.PLUGIN_ACCESS_DENIED);
 * ```
 *
 * Usage in tests:
 * ```typescript
 * import { ERROR_MESSAGES } from '../../../constants/error-messages';
 * expect(() => fn()).toThrow(ERROR_MESSAGES.PLUGIN_ACCESS_DENIED);
 * ```
 */

/**
 * Error message constants
 * All messages follow the pattern: MSG_<CATEGORY>_<ERROR_TYPE>
 */
export const ERROR_MESSAGES = {
  // =========================================================================
  // Plugin System Errors
  // =========================================================================

  /** Path access denied - requested path is not in allowed list */
  PLUGIN_ACCESS_DENIED: 'MSG_PLUGIN_ACCESS_DENIED',

  /** Plugin not found - plugin directory or manifest doesn't exist */
  PLUGIN_NOT_FOUND: 'MSG_PLUGIN_NOT_FOUND',

  /** Plugin feature not implemented - placeholder for future functionality */
  PLUGIN_NOT_IMPLEMENTED: 'MSG_PLUGIN_NOT_IMPLEMENTED',

  /** Plugin task not found - task ID doesn't exist in executor tasks map */
  PLUGIN_TASK_NOT_FOUND: 'MSG_PLUGIN_TASK_NOT_FOUND',

  /** Plugin manifest invalid - manifest.json is malformed or missing required fields */
  PLUGIN_MANIFEST_INVALID: 'MSG_PLUGIN_MANIFEST_INVALID',

  /** Plugin already registered - attempting to register a plugin that's already loaded */
  PLUGIN_ALREADY_REGISTERED: 'MSG_PLUGIN_ALREADY_REGISTERED',

  /** Plugin load failed - error during plugin initialization */
  PLUGIN_LOAD_FAILED: 'MSG_PLUGIN_LOAD_FAILED',

  /** Plugin read failed - file read error */
  PLUGIN_READ_FAILED: 'MSG_PLUGIN_READ_FAILED',

  /** Plugin manifest failed - manifest parsing error */
  PLUGIN_MANIFEST_FAILED: 'MSG_PLUGIN_MANIFEST_FAILED',

  /** Plugin config read failed - config file read error */
  PLUGIN_CONFIG_READ_FAILED: 'MSG_PLUGIN_CONFIG_READ_FAILED',

  /** Plugin config write failed - config file write error */
  PLUGIN_CONFIG_WRITE_FAILED: 'MSG_PLUGIN_CONFIG_WRITE_FAILED',

  /** Plugin check failed - install check failed */
  PLUGIN_CHECK_FAILED: 'MSG_PLUGIN_CHECK_FAILED',

  /** Plugin task not running - attempted operation on non-running task */
  PLUGIN_TASK_NOT_RUNNING: 'MSG_PLUGIN_TASK_NOT_RUNNING',

  /** Plugin task running - attempted operation on running task */
  PLUGIN_TASK_RUNNING: 'MSG_PLUGIN_TASK_RUNNING',

  /** Plugin cancel failed - task cancellation failed */
  PLUGIN_CANCEL_FAILED: 'MSG_PLUGIN_CANCEL_FAILED',

  // =========================================================================
  // Executor Errors
  // =========================================================================

  /** Executor not running - attempted operation requires executor to be active */
  EXECUTOR_NOT_RUNNING: 'MSG_EXECUTOR_NOT_RUNNING',

  /** Executor timeout - operation exceeded time limit */
  EXECUTOR_TIMEOUT: 'MSG_EXECUTOR_TIMEOUT',

  /** Executor config invalid - configuration validation failed */
  EXECUTOR_CONFIG_INVALID: 'MSG_EXECUTOR_CONFIG_INVALID',

  /** Executor task failed - task completed but with errors */
  EXECUTOR_TASK_FAILED: 'MSG_EXECUTOR_TASK_FAILED',

  /** Executor task not found - task ID doesn't exist */
  EXECUTOR_TASK_NOT_FOUND: 'MSG_EXECUTOR_TASK_NOT_FOUND',

  /** Executor already running - attempted to start when already active */
  EXECUTOR_ALREADY_RUNNING: 'MSG_EXECUTOR_ALREADY_RUNNING',

  // =========================================================================
  // Data Provider Errors
  // =========================================================================

  /** Data provider unauthorized - authentication failed or token expired */
  DATA_PROVIDER_UNAUTHORIZED: 'MSG_DATA_PROVIDER_UNAUTHORIZED',

  /** Data provider not found - provider name doesn't match any registered provider */
  DATA_PROVIDER_NOT_FOUND: 'MSG_DATA_PROVIDER_NOT_FOUND',

  /** Data provider connection failed - network or service unavailable */
  DATA_PROVIDER_CONNECTION_FAILED: 'MSG_DATA_PROVIDER_CONNECTION_FAILED',

  /** Data provider rate limited - too many requests */
  DATA_PROVIDER_RATE_LIMITED: 'MSG_DATA_PROVIDER_RATE_LIMITED',

  /** Data provider invalid symbol - symbol not supported by provider */
  DATA_PROVIDER_INVALID_SYMBOL: 'MSG_DATA_PROVIDER_INVALID_SYMBOL',

  /** Data provider no data - query returned no results */
  DATA_PROVIDER_NO_DATA: 'MSG_DATA_PROVIDER_NO_DATA',

  // =========================================================================
  // Strategy Generation Errors
  // =========================================================================

  /** Strategy generation failed - LLM API error or generation timeout */
  STRATEGY_GENERATION_FAILED: 'MSG_STRATEGY_GENERATION_FAILED',

  /** Strategy validation failed - generated code doesn't pass validation */
  STRATEGY_VALIDATION_FAILED: 'MSG_STRATEGY_VALIDATION_FAILED',

  /** Strategy save failed - file system error during save */
  STRATEGY_SAVE_FAILED: 'MSG_STRATEGY_SAVE_FAILED',

  /** Strategy not found - strategy ID doesn't exist in database */
  STRATEGY_NOT_FOUND: 'MSG_STRATEGY_NOT_FOUND',

  // =========================================================================
  // Database Errors
  // =========================================================================

  /** Database connection failed - SQLite connection error */
  DATABASE_CONNECTION_FAILED: 'MSG_DATABASE_CONNECTION_FAILED',

  /** Database query failed - SQL execution error */
  DATABASE_QUERY_FAILED: 'MSG_DATABASE_QUERY_FAILED',

  /** Database transaction failed - transaction rollback occurred */
  DATABASE_TRANSACTION_FAILED: 'MSG_DATABASE_TRANSACTION_FAILED',

  /** Database migration failed - migration script error */
  DATABASE_MIGRATION_FAILED: 'MSG_DATABASE_MIGRATION_FAILED',

  // =========================================================================
  // Authentication Errors
  // =========================================================================

  /** Auth token expired - user needs to re-authenticate */
  AUTH_TOKEN_EXPIRED: 'MSG_AUTH_TOKEN_EXPIRED',

  /** Auth invalid credentials - username/password incorrect */
  AUTH_INVALID_CREDENTIALS: 'MSG_AUTH_INVALID_CREDENTIALS',

  /** Auth unauthorized - user doesn't have permission for requested operation */
  AUTH_UNAUTHORIZED: 'MSG_AUTH_UNAUTHORIZED',

  /** Auth session not found - session ID invalid or expired */
  AUTH_SESSION_NOT_FOUND: 'MSG_AUTH_SESSION_NOT_FOUND',

  // =========================================================================
  // File System Errors
  // =========================================================================

  /** File not found - requested file doesn't exist */
  FILE_NOT_FOUND: 'MSG_FILE_NOT_FOUND',

  /** File access denied - insufficient permissions to read/write file */
  FILE_ACCESS_DENIED: 'MSG_FILE_ACCESS_DENIED',

  /** File already exists - attempted to create file that exists */
  FILE_ALREADY_EXISTS: 'MSG_FILE_ALREADY_EXISTS',

  /** File write failed - disk full or I/O error */
  FILE_WRITE_FAILED: 'MSG_FILE_WRITE_FAILED',

  /** File read failed - I/O error during read */
  FILE_READ_FAILED: 'MSG_FILE_READ_FAILED',

  // =========================================================================
  // Validation Errors
  // =========================================================================

  /** Validation required field missing - required parameter not provided */
  VALIDATION_REQUIRED_FIELD_MISSING: 'MSG_VALIDATION_REQUIRED_FIELD_MISSING',

  /** Validation invalid format - value doesn't match expected format */
  VALIDATION_INVALID_FORMAT: 'MSG_VALIDATION_INVALID_FORMAT',

  /** Validation out of range - numeric value outside allowed range */
  VALIDATION_OUT_OF_RANGE: 'MSG_VALIDATION_OUT_OF_RANGE',

  /** Validation invalid type - value is not of expected type */
  VALIDATION_INVALID_TYPE: 'MSG_VALIDATION_INVALID_TYPE',

  // =========================================================================
  // Network Errors
  // =========================================================================

  /** Network request failed - HTTP request error */
  NETWORK_REQUEST_FAILED: 'MSG_NETWORK_REQUEST_FAILED',

  /** Network timeout - request exceeded time limit */
  NETWORK_TIMEOUT: 'MSG_NETWORK_TIMEOUT',

  /** Network offline - no internet connection */
  NETWORK_OFFLINE: 'MSG_NETWORK_OFFLINE',

} as const;

/**
 * Type-safe error message type
 * Use this to ensure only valid error messages are used
 */
export type ErrorMessage = typeof ERROR_MESSAGES[keyof typeof ERROR_MESSAGES];

/**
 * Helper function to check if a string is a valid error message constant
 */
export function isErrorMessage(value: string): value is ErrorMessage {
  return Object.values(ERROR_MESSAGES).includes(value as ErrorMessage);
}

/**
 * Error categories for grouping and filtering
 */
export const ERROR_CATEGORIES = {
  PLUGIN: [
    ERROR_MESSAGES.PLUGIN_ACCESS_DENIED,
    ERROR_MESSAGES.PLUGIN_NOT_FOUND,
    ERROR_MESSAGES.PLUGIN_NOT_IMPLEMENTED,
    ERROR_MESSAGES.PLUGIN_TASK_NOT_FOUND,
    ERROR_MESSAGES.PLUGIN_MANIFEST_INVALID,
    ERROR_MESSAGES.PLUGIN_ALREADY_REGISTERED,
    ERROR_MESSAGES.PLUGIN_LOAD_FAILED,
  ],
  EXECUTOR: [
    ERROR_MESSAGES.EXECUTOR_NOT_RUNNING,
    ERROR_MESSAGES.EXECUTOR_TIMEOUT,
    ERROR_MESSAGES.EXECUTOR_CONFIG_INVALID,
    ERROR_MESSAGES.EXECUTOR_TASK_FAILED,
    ERROR_MESSAGES.EXECUTOR_TASK_NOT_FOUND,
    ERROR_MESSAGES.EXECUTOR_ALREADY_RUNNING,
  ],
  DATA_PROVIDER: [
    ERROR_MESSAGES.DATA_PROVIDER_UNAUTHORIZED,
    ERROR_MESSAGES.DATA_PROVIDER_NOT_FOUND,
    ERROR_MESSAGES.DATA_PROVIDER_CONNECTION_FAILED,
    ERROR_MESSAGES.DATA_PROVIDER_RATE_LIMITED,
    ERROR_MESSAGES.DATA_PROVIDER_INVALID_SYMBOL,
    ERROR_MESSAGES.DATA_PROVIDER_NO_DATA,
  ],
  STRATEGY: [
    ERROR_MESSAGES.STRATEGY_GENERATION_FAILED,
    ERROR_MESSAGES.STRATEGY_VALIDATION_FAILED,
    ERROR_MESSAGES.STRATEGY_SAVE_FAILED,
    ERROR_MESSAGES.STRATEGY_NOT_FOUND,
  ],
  DATABASE: [
    ERROR_MESSAGES.DATABASE_CONNECTION_FAILED,
    ERROR_MESSAGES.DATABASE_QUERY_FAILED,
    ERROR_MESSAGES.DATABASE_TRANSACTION_FAILED,
    ERROR_MESSAGES.DATABASE_MIGRATION_FAILED,
  ],
  AUTH: [
    ERROR_MESSAGES.AUTH_TOKEN_EXPIRED,
    ERROR_MESSAGES.AUTH_INVALID_CREDENTIALS,
    ERROR_MESSAGES.AUTH_UNAUTHORIZED,
    ERROR_MESSAGES.AUTH_SESSION_NOT_FOUND,
  ],
  FILE: [
    ERROR_MESSAGES.FILE_NOT_FOUND,
    ERROR_MESSAGES.FILE_ACCESS_DENIED,
    ERROR_MESSAGES.FILE_ALREADY_EXISTS,
    ERROR_MESSAGES.FILE_WRITE_FAILED,
    ERROR_MESSAGES.FILE_READ_FAILED,
  ],
  VALIDATION: [
    ERROR_MESSAGES.VALIDATION_REQUIRED_FIELD_MISSING,
    ERROR_MESSAGES.VALIDATION_INVALID_FORMAT,
    ERROR_MESSAGES.VALIDATION_OUT_OF_RANGE,
    ERROR_MESSAGES.VALIDATION_INVALID_TYPE,
  ],
  NETWORK: [
    ERROR_MESSAGES.NETWORK_REQUEST_FAILED,
    ERROR_MESSAGES.NETWORK_TIMEOUT,
    ERROR_MESSAGES.NETWORK_OFFLINE,
  ],
} as const;
