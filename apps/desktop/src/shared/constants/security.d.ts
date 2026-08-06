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
export declare const CSP_CONNECT_SRC: string;
/**
 * Full CSP policy string
 */
export declare const CSP_POLICY: string;
/** Maximum log file size before rotation (10MB) */
export declare const LOG_FILE_MAX_SIZE: number;
//# sourceMappingURL=security.d.ts.map