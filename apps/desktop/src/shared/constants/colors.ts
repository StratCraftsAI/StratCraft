/**
 * Design Token Colors
 *
 * TICKET_1023_1: Centralized color palette for the entire application.
 * TICKET_179: Unified Constants Management -- NO MAGIC NUMBERS.
 *
 * All hex color values used across the codebase must be defined here.
 * Import from this file instead of hardcoding hex strings.
 *
 * Naming convention follows Tailwind CSS color scale where applicable
 * (e.g. green-500 = #22c55e).
 */

// =============================================================================
// Semantic Colors -- status/outcome meanings
// =============================================================================

export const SEMANTIC_COLORS = {
  /** Green-500: success, profit, completed, bullish */
  SUCCESS: '#22c55e',
  /** Green-400: lighter success variant */
  SUCCESS_LIGHT: '#4ade80',
  /** Green-400 (emerald): fresh/stable indicator */
  SUCCESS_EMERALD: '#34d399',
  /** Red-500: error, loss, bearish, danger */
  ERROR: '#ef4444',
  /** Red-400: lighter error variant (cancelled, error text) */
  ERROR_LIGHT: '#f87171',
  /** Amber-500: warning, caution, cancelled */
  WARNING: '#f59e0b',
  /** Amber-400: lighter warning variant */
  WARNING_LIGHT: '#fbbf24',
  /** Orange-500: high-severity warning */
  WARNING_ORANGE: '#f97316',
  /** Blue-500: info, primary action, improving */
  INFO: '#3b82f6',
  /** Blue-400: lighter info variant */
  INFO_LIGHT: '#60a5fa',
  /** Slate-400: insufficient data, muted status */
  INSUFFICIENT: '#94a3b8',
  /** White: primary foreground on dark bg */
  WHITE: '#fff',
} as const;

// =============================================================================
// Chart Colors -- trading chart rendering
// =============================================================================

export const CHART_COLORS = {
  /** Bullish candle / profit (green-500) */
  PROFIT: '#22c55e',
  /** Bearish candle / loss (red-500) */
  LOSS: '#ef4444',
  /** Bullish candle with alpha (volume bars) */
  PROFIT_ALPHA: '#22c55e50',
  /** Bearish candle with alpha (volume bars) */
  LOSS_ALPHA: '#ef444450',
  /** Grid lines (gray-700) */
  GRID: '#374151',
  /** Chart text (gray-400) */
  TEXT: '#9ca3af',
  /** Volume bar / indicator line (blue-500) */
  VOLUME: '#3b82f6',
  /** Unprocessed candle (gray-600) */
  UNPROCESSED: '#4B5563',
  /** Equity curve profit (green-400) */
  EQUITY_PROFIT: '#4ade80',
  /** Equity curve loss (red-400) */
  EQUITY_LOSS: '#f87171',
} as const;

// =============================================================================
// Theme Colors -- dark theme surfaces and text
// =============================================================================

export const THEME_COLORS = {
  /** Deep navy background for inputs/dropdowns */
  INPUT_BG: '#112240',
  /** Input border color */
  INPUT_BORDER: '#233554',
  /** Input text color (light blue-white) */
  INPUT_TEXT: '#e6f1ff',
  /** Error hint background / search result dropdown bg */
  ERROR_HINT_BG: '#0a192f',
  /** Electron transparent background */
  TRANSPARENT_BG: '#00000000',
  /** GitHub-dark dropdown background */
  DROPDOWN_BG: '#0d1117',
  /** GitHub-dark sticky header background */
  DROPDOWN_HEADER_BG: '#161b22',
  /** Dropdown section label text (slate-blue) */
  SECTION_LABEL_TEXT: '#8892b0',
  /** Gray-500: disabled text, muted dots, placeholder */
  GRAY_500: '#6b7280',
  /** Dark teal: button text on teal accent bg */
  TEAL_BUTTON_TEXT: '#062b25',
  /** Line separator (dark border) */
  LINE_SEPARATOR: '#1e2840',
} as const;

// =============================================================================
// Dashboard Colors -- web dashboard diagram/UI palette
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
} as const;

// =============================================================================
// Status Plate Colors -- backtest execution status indicators
// =============================================================================

export const STATUS_PLATE_COLORS = {
  /** Testing state accent (teal-300) */
  TESTING: '#64ffda',
  /** Error/cancelled state (red-400) */
  ERROR: '#f87171',
  /** Completed state (green-400) */
  COMPLETED: '#4ade80',
  TESTING_BORDER: 'rgba(100, 255, 218, 0.4)',
  TESTING_SHADOW: 'rgba(100, 255, 218, 0.2)',
  ERROR_BORDER: 'rgba(239, 68, 68, 0.4)',
  ERROR_SHADOW: 'rgba(239, 68, 68, 0.2)',
  COMPLETED_BORDER: 'rgba(34, 197, 94, 0.4)',
  COMPLETED_SHADOW: 'rgba(34, 197, 94, 0.2)',
} as const;

// =============================================================================
// Staleness Colors -- data freshness indicators
// =============================================================================

export const STALENESS_COLORS = {
  /** Fresh data (emerald-400) */
  FRESH: '#34d399',
  /** Warning staleness (gray-400) */
  WARN: '#9ca3af',
  /** Stale data (red-500) */
  STALE: '#ef4444',
  /** Unknown staleness (gray-500) */
  UNKNOWN: '#6b7280',
  /** Sparkline path stroke (neutral-400) */
  PATH_STROKE: '#a3a3a3',
} as const;

// =============================================================================
// Saturation Colors -- discovery saturation levels
// =============================================================================

export const SATURATION_COLORS = {
  GREEN: '#22c55e',
  YELLOW: '#f59e0b',
  ORANGE: '#f97316',
  RED: '#ef4444',
} as const;

// =============================================================================
// Accent Colors -- UI accent highlights
// =============================================================================

export const ACCENT_COLORS = {
  /** Cyan-400: modal accent borders, focused inputs, action buttons */
  CYAN_400: '#22d3ee',
} as const;

// =============================================================================
// Algorithm Category Badge Colors (strategy-builder)
// =============================================================================

export const ALGORITHM_CATEGORY_COLORS = {
  indicator:      { text: '#60a5fa', border: 'rgba(59,130,246,0.3)',  bg: 'rgba(59,130,246,0.15)' },
  ML:             { text: '#fbbf24', border: 'rgba(245,158,11,0.3)',  bg: 'rgba(245,158,11,0.15)' },
  RL:             { text: '#fb923c', border: 'rgba(249,115,22,0.3)',  bg: 'rgba(249,115,22,0.15)' },
  breakout:       { text: '#22d3ee', border: 'rgba(6,182,212,0.3)',   bg: 'rgba(6,182,212,0.15)' },
  mean_reversion: { text: '#a78bfa', border: 'rgba(139,92,246,0.3)',  bg: 'rgba(139,92,246,0.15)' },
  momentum:       { text: '#38bdf8', border: 'rgba(14,165,233,0.3)',  bg: 'rgba(14,165,233,0.15)' },
  grid:           { text: '#2dd4bf', border: 'rgba(20,184,166,0.3)',  bg: 'rgba(20,184,166,0.15)' },
  trend_following: { text: '#818cf8', border: 'rgba(99,102,241,0.3)', bg: 'rgba(99,102,241,0.15)' },
  market_making:  { text: '#f472b6', border: 'rgba(236,72,153,0.3)',  bg: 'rgba(236,72,153,0.15)' },
  arbitrage:      { text: '#fb7185', border: 'rgba(244,63,94,0.3)',   bg: 'rgba(244,63,94,0.15)' },
  factor:         { text: '#facc15', border: 'rgba(234,179,8,0.3)',   bg: 'rgba(234,179,8,0.15)' },
  execution:      { text: '#9ca3af', border: 'rgba(107,114,128,0.3)', bg: 'rgba(107,114,128,0.15)' },
} as const;

export const ALGORITHM_DEFAULT_BADGE = {
  text: '#9ca3af',
  border: 'rgba(107,114,128,0.3)',
  bg: 'rgba(107,114,128,0.15)',
} as const;

export const CODE_READY_BADGE = {
  text: '#34d399',
  border: 'rgba(16,185,129,0.3)',
  bg: 'rgba(16,185,129,0.15)',
} as const;

export const REF_ONLY_BADGE = {
  text: '#9ca3af',
  border: 'rgba(107,114,128,0.25)',
  bg: 'rgba(107,114,128,0.10)',
} as const;

// =============================================================================
// Definition Rollup Chip Colors -- alpha decay / robustness
// =============================================================================

export const ALPHA_DECAY_CHIP_COLORS = {
  decaying:     { fg: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)',  border: 'rgba(239, 68, 68, 0.35)' },
  stable:       { fg: '#22c55e', bg: 'rgba(34, 197, 94, 0.12)',  border: 'rgba(34, 197, 94, 0.35)' },
  improving:    { fg: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.35)' },
  insufficient: { fg: '#94a3b8', bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.35)' },
} as const;

export const ROBUSTNESS_CHIP_COLORS = {
  robust:       { fg: '#22c55e', bg: 'rgba(34, 197, 94, 0.12)',  border: 'rgba(34, 197, 94, 0.35)' },
  variable:     { fg: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.35)' },
  fragile:      { fg: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)',  border: 'rgba(239, 68, 68, 0.35)' },
  insufficient: { fg: '#94a3b8', bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.35)' },
} as const;

// =============================================================================
// Bench Factory Override Colors -- custom CSS variable overrides
// =============================================================================

export const BENCH_FACTORY_COLORS = {
  TEXT_PRIMARY: '#fbbf24',
  ACCENT_PRIMARY: '#f59e0b',
} as const;

// =============================================================================
// Comparison Palette -- multi-strategy overlay colors (backtest comparison tab)
// =============================================================================

export const COMPARISON_PALETTE = [
  '#4ade80',  // green-400  (SUCCESS_LIGHT)
  '#60a5fa',  // blue-400   (INFO_LIGHT)
  '#f472b6',  // pink-400
  '#fbbf24',  // amber-400  (WARNING_LIGHT)
  '#a78bfa',  // violet-400
  '#2dd4bf',  // teal-400
] as const;

// =============================================================================
// CSS Variable Fallback Colors -- used as fallbacks in var(--css-var, #hex)
// These are the canonical fallback values for CSS custom properties.
// When a component uses inline styles with CSS variables, import the
// fallback from here instead of hardcoding the hex.
// =============================================================================

export const CSS_VAR_FALLBACKS = {
  // -- Text hierarchy --------------------------------------------------------
  /** Primary text on dark backgrounds */
  TEXT_PRIMARY: '#ccd6f6',
  /** Light blue-white text (headings, input text) */
  TEXT_PRIMARY_BRIGHT: '#e6f1ff',
  /** Secondary/muted text */
  TEXT_SECONDARY: '#8892b0',
  /** Tertiary text (disabled, placeholder) */
  TEXT_TERTIARY: '#666',
  /** Slate-400 text secondary */
  TEXT_SECONDARY_SLATE: '#9ca3af',
  /** Slate-500 text */
  TEXT_MUTED_SLATE: '#64748b',
  /** Subtle/deemphasized text */
  TEXT_SUBTLE: '#8a93a6',

  // -- Surfaces & backgrounds ------------------------------------------------
  /** Deep navy input/panel background */
  SURFACE_INPUT: '#112240',
  /** Secondary background (modals, elevated panels) */
  BG_SECONDARY: '#0a192f',
  /** GitHub-dark default background */
  BG_DEFAULT: '#0d1117',
  /** GitHub-dark elevated background */
  BG_ELEVATED: '#161b22',
  /** Dark panel background (near-black) */
  BG_DEEP: '#0a0a0a',
  /** Dark panel alt */
  BG_DARK_ALT: '#0f1626',
  /** Dark secondary alt surface */
  BG_SECONDARY_ALT: '#2a3140',
  /** Dark border subtle */
  BORDER_SUBTLE: '#2a2a35',
  /** Dark section surface */
  BG_SECTION: '#1a1a23',
  /** Deep dark surface */
  BG_DEEP_DARK: '#0a0e1a',

  // -- Borders ---------------------------------------------------------------
  /** Terminal-style border */
  BORDER_TERMINAL: '#233554',
  /** GitHub-dark default border */
  BORDER_DEFAULT: '#30363d',
  /** Dark border separator */
  BORDER_SEPARATOR: '#3a4252',
  /** Lighter border (slate-200) */
  BORDER_LIGHT: '#e2e8f0',

  // -- Status/semantic fallbacks ---------------------------------------------
  /** Success green (GitHub-dark) */
  SUCCESS: '#3fb950',
  /** Info blue (GitHub-dark) */
  INFO_ACCENT: '#58a6ff',
  /** Warning amber (GitHub-dark) */
  WARNING: '#d29922',
  /** Danger/error red (GitHub-dark) */
  DANGER: '#f85149',
  /** Caution orange (orange-400) */
  CAUTION: '#fb923c',
  /** Error generic (#ff6b6b coral) */
  ERROR_CORAL: '#ff6b6b',
  /** Warning gold (dark gold) */
  WARNING_GOLD: '#d4a017',
  /** Error red shorthand (#f44) */
  ERROR_SHORT: '#f44',

  // -- Accent ---------------------------------------------------------------
  /** Teal-300 accent (terminal teal) */
  ACCENT_TEAL: '#64ffda',
  /** Gold accent (D4AF37) */
  ACCENT_GOLD: '#D4AF37',
  /** Gold accent alt (d2a23f) */
  ACCENT_GOLD_ALT: '#d2a23f',
  /** Red danger alt */
  DANGER_ALT: '#d23f3f',
  /** Green success accent */
  SUCCESS_ALT: '#3fa860',
  /** Emerald-500 */
  EMERALD_500: '#10b981',
  /** Violet-500 */
  VIOLET_500: '#a855f7',
  /** Sky-400 accent (sky blue) */
  SKY_400: '#38bdf8',
  /** Link/accent blue (GitHub-dark) */
  LINK_BLUE: '#388bfd',
  /** Teal-400 accent */
  TEAL_400: '#2dd4bf',
} as const;

// =============================================================================
// Syntax Highlighting Fallback Colors -- chat + CodeDisplay token colors
// =============================================================================

/**
 * TICKET_1318: `SYNTAX_COLORS` is owned by `@StratCraft/chat-markdown`, which
 * also owns the token kinds and the canonical `token token-${kind}` class
 * contract these colors style. It is re-exported here so TICKET_179
 * single-source-of-truth holds and existing `@shared/constants/colors` import
 * paths keep resolving.
 */
export { SYNTAX_COLORS } from '@StratCraft/chat-markdown';

// =============================================================================
// Gray Scale -- neutral grayscale palette
// =============================================================================

export const GRAY_SCALE = {
  /** #1a1a1a -- near-black */
  GRAY_900: '#1a1a1a',
  /** #333333 -- very dark gray */
  GRAY_800: '#333333',
  /** #495670 -- dark slate */
  GRAY_700: '#495670',
  /** #666 -- medium gray */
  GRAY_600: '#666',
  /** #a0a0a0 -- medium-light gray */
  GRAY_500: '#a0a0a0',
  /** #b0b0b0 -- light-medium gray */
  GRAY_400: '#b0b0b0',
  /** #c0c0c0 -- silver */
  GRAY_300: '#c0c0c0',
  /** #d0d0d0 -- light gray */
  GRAY_200: '#d0d0d0',
  /** #d1d5db -- Tailwind gray-300 */
  GRAY_TW_300: '#d1d5db',
  /** #dcdcdc -- gainsboro */
  GRAY_150: '#dcdcdc',
  /** #e6e8ec -- very light gray */
  GRAY_100: '#e6e8ec',
  /** #e8e8e8 -- near-white gray */
  GRAY_75: '#e8e8e8',
  /** #ffffff -- pure white */
  WHITE: '#ffffff',
} as const;

// =============================================================================
// PerformanceOverviewChart Colors
// =============================================================================

export const PERFORMANCE_CHART_COLORS = {
  /** Teal line stroke for performance overview */
  LINE_STROKE: '#5EEADC',
} as const;

// =============================================================================
// Nameplate/StatusPlate Colors
// =============================================================================

export const NAMEPLATE_COLORS = {
  /** Error background tint */
  ERROR_BG: '#2d1212',
  /** Error border tint */
  ERROR_BORDER: '#4a1f1f',
  /** Error text (red-400 variant) */
  ERROR_TEXT: '#ff6b6b',
  /** Success background tint */
  SUCCESS_BG: '#0d200d',
  /** Success border tint */
  SUCCESS_BORDER: '#1a3a1a',
  /** Surface panel background */
  SURFACE_BG: '#0d2137',
  /** Panel border (dark blue) */
  PANEL_BORDER: '#1e3a5f',
  /** Secondary accent purple bg */
  ACCENT_BG: '#2a2a4a',
} as const;

// =============================================================================
// TICKET_1023_8: LSTM Fit-Quality Fallback Zone Color
// =============================================================================

export const FALLBACK_ZONE_COLOR = {
  bar: 'rgba(156,163,175,0.25)',
  border: 'rgba(156,163,175,0.3)',
  text: 'rgba(156,163,175,1)',
  marker: 'rgba(156,163,175,1)',
  glow: 'rgba(156,163,175,0.6)',
} as const;

// =============================================================================
// Service API external-runtime notice (TICKET_1334 P4 / D4 / AC5_1)
// =============================================================================

/**
 * Palette for the notice that labels Service API-backed launch controls as
 * served by an external runtime.
 *
 * INFORMATIONAL, not a warning, and that distinction is the whole design. D4
 * settled that when a headless runtime holds the Service API role the desktop
 * launch controls REMAIN USABLE -- disabling them was rejected because it removes
 * capability the user still has. Nothing is wrong, so the notice must not read as
 * a fault: warning amber next to a working button trains the user to expect a
 * failure that will not come, and would quietly re-introduce the
 * "something-is-broken" reading D4 rejected. Blue INFO tokens, matching the
 * `improving` triad above (`SEMANTIC_COLORS.INFO` at 0.12 fill / 0.35 border).
 */
export const EXTERNAL_RUNTIME_NOTICE_COLORS = {
  /** Foreground / icon. */
  FG: '#3b82f6',
  /** Fill. */
  BG: 'rgba(59, 130, 246, 0.12)',
  /** Border. */
  BORDER: 'rgba(59, 130, 246, 0.35)',
} as const;
