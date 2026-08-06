/**
 * Security Constants (TICKET_083, TICKET_091)
 *
 * Single source of truth for CSP and security-related configuration.
 * Both main process and renderer must use these values.
 *
 * TICKET_091: Desktop CSP Relaxation
 * - Allow plugins to directly access external HTTPS/WSS endpoints
 * - Follows VS Code pattern (user installs plugin = user trusts plugin)
 */

/**
 * CSP connect-src allowed origins
 * Controls which URLs the application can connect to via fetch/XHR/WebSocket
 *
 * TICKET_091: Relaxed for Desktop - allows all HTTPS and WSS connections
 * This enables plugins to call external APIs (LLM providers, etc.)
 */
export const CSP_CONNECT_SRC = [
  "'self'",
  'http://localhost:*',
  'http://127.0.0.1:*',
  'ws://localhost:*',
  'ws://127.0.0.1:*',
  // TICKET_091: Allow all secure external connections for plugins
  'https:',
  'wss:',
].join(' ');

/**
 * Full CSP policy string
 */
export const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `connect-src ${CSP_CONNECT_SRC}`,
  "img-src 'self' data: blob:",
  "font-src 'self'",
].join('; ');

// =============================================================================
// TICKET_476: Log File Limits
// =============================================================================

/** Maximum log file size before rotation (20MB) */
export const LOG_FILE_MAX_SIZE = 20 * 1024 * 1024;

/** Maximum number of rotated log file generations (TICKET_573) */
export const LOG_FILE_MAX_GENERATIONS = 5;
