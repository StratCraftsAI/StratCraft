/**
 * MCP Streamable HTTP port.
 *
 * Canonical source: apps/desktop/src/shared/constants/network.ts
 * Duplicated here because web-dashboard is a separate package and cannot
 * import from apps/desktop (different compilation unit).
 */
export const MCP_STREAMABLE_HTTP_PORT = 7789;

// =============================================================================
// Dashboard Color Tokens (TICKET_1023_1)
//
// Canonical source: apps/desktop/src/shared/constants/colors.ts (DASHBOARD_COLORS)
// Duplicated here because web-dashboard is a separate Vite app.
// =============================================================================

export const DASHBOARD_COLORS = {
  /** Teal accent (primary brand color for dashboard) */
  TEAL: '#5dd4c2',
  /** Teal highlight text */
  TEAL_TEXT_LIGHT: '#d8f5ee',
  /** Teal muted text */
  TEAL_TEXT_MUTED: '#8fc7bd',
  /** Teal dark background */
  TEAL_BG_DARK: '#0a1620',
  /** Primary blue-purple accent */
  PRIMARY: '#7a8fff',
  /** Primary text (light) */
  PRIMARY_TEXT: '#e8edf5',
  /** Amber accent (MCP server) */
  AMBER: '#f5b04a',
  /** Amber muted text */
  AMBER_TEXT_MUTED: '#d8a45c',
  /** Amber cream text */
  AMBER_TEXT_CREAM: '#fff4dc',
  /** Muted text (blue-gray) */
  TEXT_MUTED: '#7d89a6',
  /** Secondary muted text */
  TEXT_SECONDARY_MUTED: '#5a6480',
  /** Body text (light blue-gray) */
  TEXT_BODY: '#b8c4d8',
  /** Card border */
  CARD_BORDER: '#2a3450',
  /** Dark surface background */
  SURFACE_DARK: '#0a0f1c',
  /** Input surface background */
  INPUT_SURFACE: '#0f1628',
  /** Locked node border */
  NODE_BORDER_LOCKED: '#3a4060',
  /** White */
  WHITE: '#fff',
  /** Success green (green-400) -- completed nodes */
  SUCCESS_GREEN: '#4ade80',
  /** Info line separator (dark border) */
  LINE_SEPARATOR: '#1e2840',
  /** Gray-500: disabled text, muted dots */
  GRAY_500: '#6b7280',
  /** Dark teal: button text on teal accent bg */
  TEAL_BUTTON_TEXT: '#062b25',
} as const;

// =============================================================================
// TICKET_1023_8: Diagram Gradient Color Tokens
//
// SVG-specific gradient stop values used in WelcomeDiagram.tsx.
// Extracted from inline hex literals for design-token consistency.
// =============================================================================

export const DIAGRAM_GRADIENT_COLORS = {
  /** Page background gradient start (deep navy) */
  BG_START: '#131a2c',
  /** Page background gradient end / card gradient end */
  BG_END: '#1a2238',
  /** Card gradient start (dark blue-gray) */
  CARD_START: '#232c45',
  /** Teal card gradient start */
  TEAL_CARD_START: '#102e30',
  /** Teal card gradient end */
  TEAL_CARD_END: '#0c2024',
  /** Amber card gradient start */
  AMBER_CARD_START: '#2a1f10',
  /** Amber card gradient end */
  AMBER_CARD_END: '#1a1508',
  /** Dashboard circle radial center */
  CIRCLE_CENTER: '#252d50',
  /** Dashboard circle radial edge */
  CIRCLE_EDGE: '#141a30',
  /** Primary card gradient start (blue-gray) */
  PRIMARY_CARD_START: '#1d2641',
  /** MCP orb radial mid */
  MCP_ORB_MID: '#3a2b14',
  /** MCP orb radial outer */
  MCP_ORB_OUTER: '#221710',
  /** MCP orb radial edge */
  MCP_ORB_EDGE: '#14100a',
  /** MCP inner icon radial edge */
  MCP_ICON_EDGE: '#0e0a06',
} as const;

// =============================================================================
// TICKET_1023_8: Dashboard Timing Constants
//
// Canonical source: apps/desktop/src/shared/constants/timing.ts
// Duplicated here because web-dashboard is a separate Vite app.
// =============================================================================

/** Health-check / tool-count poll interval (ms) */
export const WEB_DASHBOARD_POLL_INTERVAL_MS = 30000;

/** TICKET_1236_3: download queue poll interval while queue tab is visible (ms) */
export const DATA_QUEUE_POLL_INTERVAL_MS = 5000;

// =============================================================================
// TICKET_1232 / TICKET_1233: Auth session refresh constants
// =============================================================================

/** TICKET_1232 F1: an access token expiring within this margin is treated as
 * already expired, so a refresh fires before the server would reject it. */
export const TOKEN_EXPIRY_SKEW_MS = 30_000;

/** TICKET_1232 F4: window event dispatched when the auth session is cleared
 * after a failed/impossible refresh; App shows the login UI in response. */
export const SESSION_EXPIRED_EVENT = 'stratcraft:session-expired';

/** First HTTP client-error status (4xx lower bound) */
export const HTTP_STATUS_BAD_REQUEST = 400;
/** First HTTP server-error status (4xx upper bound, exclusive) */
export const HTTP_STATUS_INTERNAL_SERVER_ERROR = 500;

/** Milliseconds per second (expires_in seconds -> epoch ms) */
export const MS_PER_SECOND = 1000;

// =============================================================================
// TICKET_1030_5: Z-Index Layer Constants
//
// Canonical source: apps/desktop/src/shared/constants/z-index.ts
// Duplicated here because web-dashboard is a separate Vite app.
// =============================================================================

// =============================================================================
// TICKET_1236_7: SSE Event Stream Constants
// =============================================================================

/** Initial reconnect delay after SSE connection drops (ms) */
export const SSE_RECONNECT_INITIAL_MS = 1_000;
/** Maximum reconnect delay cap (ms) */
export const SSE_RECONNECT_MAX_MS = 30_000;
/** Exponential backoff multiplier */
export const SSE_RECONNECT_MULTIPLIER = 2;
/** Fallback polling interval when SSE is degraded (ms) */
export const SSE_FALLBACK_POLL_INTERVAL_MS = 5_000;
/** Backtest queue poll interval while queue section is visible (ms) */
export const BACKTEST_QUEUE_POLL_INTERVAL_MS = 5_000;

/** TICKET_1303_1_3 normalized Agent event reducer bounds. */
export const AGENT_EVENT_TEXT_MAX_CHARS = 32_768;
export const AGENT_EVENT_SERIALIZED_MAX_CHARS = 131_072;
export const AGENT_EVENT_REORDER_BUFFER_MAX = 64;
export const AGENT_EVENT_ID_HISTORY_MAX = 256;
export const AGENT_EVENT_GAP_TIMEOUT_MS = 5_000;
export const AGENT_EVENT_GAP_CHECK_INTERVAL_MS = 1_000;
// =============================================================================
// TICKET_1030_5: Z-Index Layer Constants
//
// Canonical source: apps/desktop/src/shared/constants/z-index.ts
// Duplicated here because web-dashboard is a separate Vite app.
// =============================================================================

/** Dropdown overlay (e.g., WorkflowDropdown) */
export const Z_INDEX_DROPDOWN = 1000;

// =============================================================================
// TICKET_1030_13: Info Panel Default Height
//
// Canonical source: apps/desktop/src/shared/constants/timing.ts
// Duplicated here because web-dashboard is a separate Vite app.
// =============================================================================

/** Default info panel / iframe embed height (px) */
export const DEFAULT_INFO_PANEL_HEIGHT_PX = 600;

// =============================================================================
// TICKET_1318: Chat code-block copy affordance
//
// Canonical source: apps/desktop/src/shared/constants/timing.ts
// Duplicated here because web-dashboard is a separate Vite app.
// =============================================================================

/** How long the code-block copy button shows its "copied" state (ms). */
export const COPY_FEEDBACK_DURATION_MS = 2_000;

// =============================================================================
// TICKET_1281: System Monitor Sidebar Panel
//
// Poll interval mirrors the desktop resource-monitor / MCP SSE cadence (2s).
// Canonical source: apps/desktop/src/shared/constants/system-monitor.ts
// Duplicated here because web-dashboard is a separate Vite app.
// =============================================================================

/** Degraded-mode fallback poll interval for the system monitor (ms). */
export const SYSTEM_MONITOR_POLL_INTERVAL_MS = 2_000;

/**
 * Gauge colour thresholds (utilisation %). At or above WARN -> amber,
 * at or above CRIT -> red; below WARN -> green/accent. Applied to CPU cores,
 * memory, GPU, and per-workload CPU bars alike.
 */
export const GAUGE_WARN_PERCENT = 70;
export const GAUGE_CRIT_PERCENT = 90;

/** Ordered workload row identifiers (must match the backend WorkloadStats ids). */
export const WORKLOAD_IDS = ['sweep', 'mining', 'lstm', 'research-env'] as const;
export type WorkloadRowId = (typeof WORKLOAD_IDS)[number];
