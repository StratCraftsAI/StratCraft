/**
 * Network Constants
 *
 * TICKET_179: Unified Constants Management
 *
 * All network-related constants: ports, hosts, connection settings.
 */

// =============================================================================
// Port Numbers
// =============================================================================

/** ClickHouse default HTTPS port */
export const CLICKHOUSE_DEFAULT_PORT = 8443;

/** Python server port */
export const PYTHON_SERVER_PORT = 8765;

/** Core engine gRPC port */
export const CORE_ENGINE_PORT = 50051;

// =============================================================================
// Loopback Server (OAuth)
// =============================================================================

/** Loopback port range start (ephemeral ports) */
export const LOOPBACK_PORT_RANGE_START = 49152;

/** Loopback port range end */
export const LOOPBACK_PORT_RANGE_END = 65535;

// =============================================================================
// Connection Settings
// =============================================================================

/** Max startup wait for plugin (seconds) */
export const PLUGIN_MAX_STARTUP_WAIT_SECONDS = 30;

/** MCP Streamable HTTP port (CLAUDE.md: "MCP Streamable HTTP: 7789") */
export const MCP_STREAMABLE_HTTP_PORT = 7789;

/** Web Dashboard dev server port (Vite) */
export const WEB_DASHBOARD_PORT = 7790;

/** gRPC reconnect interval (ms) */
export const GRPC_RECONNECT_INTERVAL_MS = 5000;

// =============================================================================
// Service API Server (TICKET_425: Unified Service API Layer)
// =============================================================================

/** Service API loopback host */
export const SERVICE_API_HOST = '127.0.0.1';

/** Service API auth token length (bytes) */
export const SERVICE_API_TOKEN_BYTES = 32;

/** Service API discovery file: port */
export const SERVICE_API_PORT_FILE = 'api-port';

/** Service API discovery file: auth token */
export const SERVICE_API_TOKEN_FILE = 'api-token';

/**
 * TICKET_1334 P0: Service API runtime-role claim file.
 *
 * Lives in the SAME directory as the two discovery files above, deliberately:
 * the claim exists to decide who is entitled to write those files, so a claim
 * resolved from a different root could not guarantee that the claim holder and
 * the discovery-file writer are the same process.
 */
export const SERVICE_API_RUNTIME_CLAIM_FILE = 'api-runtime.lock';

/** TICKET_464: OAuth access token discovery file for direct backend testing */
export const OAUTH_TOKEN_FILE = 'oauth-token';
