/**
 * Vibing Chat Protocol — shared types, constants, and pure extraction logic.
 *
 * TICKET_1315 Block D: single source of truth consumed by both the Electron
 * Main batch path (ai-studio-api.ts) and the plugin UI path
 * (vibing-chat-service.ts / api-client.ts).
 */

// =============================================================================
// Backend error-code contract
// =============================================================================

/**
 * Codes nona_server may attach to a failed `vibing_chat` task.
 *
 * TICKET_1376 step 1: this set is the single declaration site for the backend
 * error vocabulary. It previously lived inside the Electron plugin
 * (`vibing-chat-service.ts`), which meant the second surface -- the Guide
 * WebUI / MCP path -- had no way to consume it and discarded backend failures
 * as unstructured prose instead (`payload=malformed`).
 *
 * Only the whitelist and its validator are shared. i18n *resolution* stays
 * per-surface by design: the plugin resolves through `i18n.t` against its
 * `strategy-builder` namespace, the MCP/Guide surface through the
 * `agentOutcome.vibingChat.*` presentation keys. Shared operation,
 * surface-local adapter -- the CLAUDE.md surface-layer rule.
 *
 * These are remote-origin tokens. They are deliberately NOT used as the MCP
 * outcome `code` (which is validated lowercase-only as a browser-safety
 * boundary); they cross to the browser through the validated `presentation`
 * channel. See `vibingChatPresentationKey()`.
 */
export const VIBING_CHAT_ERROR_CODES: ReadonlySet<string> = new Set([
  'LLM_ERROR',
  'CODE_GENERATION_ERROR',
  'TIMEOUT',
  'NETWORK_ERROR',
  'RATE_LIMIT',
  'INVALID_SESSION',
  'AUTH_REQUIRED',
]);

/**
 * Validate a backend-supplied code against the shared whitelist.
 *
 * Returns false for unknown codes so callers degrade to their own generic
 * message rather than rendering unvalidated backend prose to the user.
 */
export function isKnownVibingChatErrorCode(code: string | undefined): boolean {
  return typeof code === 'string' && VIBING_CHAT_ERROR_CODES.has(code);
}

/**
 * Presentation key prefix for the Guide WebUI surface. Kept adjacent to the
 * whitelist so the two cannot drift.
 */
export const VIBING_CHAT_PRESENTATION_PREFIX = 'agentOutcome.vibingChat.';

/**
 * Backend code -> i18n key segment.
 *
 * The segment is camelCase for two reasons, both load-bearing:
 *
 * 1. The projector's `MESSAGE_KEY_PATTERN`
 *    (`/^agentOutcome\.[A-Za-z][A-Za-z0-9.]{0,127}$/`) admits no underscore,
 *    so `agentOutcome.vibingChat.AUTH_REQUIRED` would be REJECTED by
 *    `producerPresentation()` and silently degrade to the generic
 *    `agentOutcome.toolFailed` -- reintroducing the very bug this ticket
 *    fixes, for six of the seven codes.
 * 2. It matches the existing key convention in `dashboard.json`
 *    (`toolFailed`, `reviewDiagnostics`, ...).
 */
const VIBING_CHAT_PRESENTATION_SEGMENTS: Readonly<Record<string, string>> = {
  LLM_ERROR: 'llmError',
  CODE_GENERATION_ERROR: 'codeGenerationError',
  TIMEOUT: 'timeout',
  NETWORK_ERROR: 'networkError',
  RATE_LIMIT: 'rateLimit',
  INVALID_SESSION: 'invalidSession',
  AUTH_REQUIRED: 'authRequired',
};

/**
 * Map a backend code to the MCP surface's presentation key, or undefined when
 * the code is not in the shared whitelist.
 *
 * The resulting key matches the projector's `MESSAGE_KEY_PATTERN`, so it
 * survives the browser-safety boundary intact and is rendered by the dashboard
 * via `t()`. An unknown code yields undefined, so the caller emits no
 * presentation and the projector applies its generic fallback.
 */
export function vibingChatPresentationKey(code: string | undefined): string | undefined {
  if (!isKnownVibingChatErrorCode(code)) return undefined;
  const segment = VIBING_CHAT_PRESENTATION_SEGMENTS[code!];
  return segment ? `${VIBING_CHAT_PRESENTATION_PREFIX}${segment}` : undefined;
}

// =============================================================================
// Action constants
// =============================================================================

export type VibingChatAction = 'generate_code' | 'save_strategy' | 'run_backtest';

export const VIBING_CHAT_ACTIONS = {
  GENERATE_CODE: 'generate_code',
  SAVE_STRATEGY: 'save_strategy',
  RUN_BACKTEST: 'run_backtest',
} as const satisfies Record<string, VibingChatAction>;

export function actionToMessage(action: VibingChatAction): string {
  return `<${action}>`;
}

// =============================================================================
// Strategy rules sub-types
// =============================================================================

export interface EntryCondition {
  type: string;
  condition: string;
  action?: string;
}

export interface ExitCondition {
  type: string;
  condition: string;
  action?: string;
}

export interface StrategyIndicator {
  name: string;
  params: string;
  description?: string;
}

export interface RiskManagement {
  stop_loss_pct?: number;
  take_profit_pct?: number;
  position_size_pct?: number;
}

export interface StrategyRulesResponse {
  entry_conditions?: EntryCondition[];
  exit_conditions?: ExitCondition[];
  risk_management?: RiskManagement;
  indicators?: StrategyIndicator[];
  filters?: string[];
  status?: 'PARTIAL' | 'COMPLETE';
  missing_fields?: string[];
  completeness_score?: number;
  detected_language?: string;
  is_llm_driven?: boolean;
}

// =============================================================================
// Result type
// =============================================================================

export interface OpensourceAlgorithm {
  name: string;
  id: string;
  strategy_type: string;
  rule_extractable: boolean;
}

export interface VibingChatResultMetadata {
  opensource_algorithms?: OpensourceAlgorithm[];
  [key: string]: unknown;
}

export interface VibingChatResult {
  status?: string;
  type?: 'strategy_code' | 'text' | string;
  content?: string;
  language?: string | null;
  explanation?: string;
  strategy_id?: string | null;
  strategy_name?: string;
  strategy_type?: number;
  strategy_code?: string;
  strategyCode?: string;
  class_name?: string;
  description?: string;
  trading_style?: string;
  classification_metadata?: {
    role?: string;
    style?: string;
    source?: string;
  };
  created_at?: string;
  strategy_rules?: StrategyRulesResponse;
  available_actions?: string[];
  suggested_title?: string;
  error?: { code: string; message: string };
  metadata?: VibingChatResultMetadata;
  [key: string]: unknown;
}

// =============================================================================
// Strategy code extraction
// =============================================================================

/**
 * Extract strategy code from a vibing chat result.
 *
 * The vibing chat API returns code differently from other builder APIs:
 * - Vibing chat: `result.content` when `result.type === "strategy_code"`
 * - Other builders: `result.strategy_code` (dedicated field)
 *
 * Falls back to `strategy_code` / `strategyCode` for compatibility.
 */
export function extractStrategyCode(result: VibingChatResult): string | null {
  if (result.type === 'strategy_code' && result.content) {
    return result.content;
  }
  if (result.strategy_code) return result.strategy_code;
  if (result.strategyCode) return result.strategyCode;
  return null;
}

// =============================================================================
// Request payload building
// =============================================================================

export interface VibingChatPayloadParams {
  taskId?: string;
  sessionId: string;
  message: string;
  strategyName: string;
  llmProvider: string;
  llmModel: string;
  locale?: string;
  currentStrategyRules?: Partial<StrategyRulesResponse>;
  messageId?: string;
  strategyId?: string;
  outputFormat?: string;
  storageMode?: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

export function buildVibingChatPayload(params: VibingChatPayloadParams): Record<string, unknown> {
  const taskId = params.taskId || `vibing_chat_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  const payload: Record<string, unknown> = {
    task_id: taskId,
    session_id: params.sessionId,
    message: params.message,
    locale: params.locale || 'en_US',
    model: params.llmProvider,
    llm_model: params.llmModel,
    output_format: params.outputFormat || 'v3',
    storage_mode: params.storageMode || 'local',
    strategy_name: params.strategyName,
    metadata: params.metadata || { mode: 'generator' },
  };

  if (params.messageId) {
    payload.message_id = params.messageId;
  }
  if (params.strategyId) {
    payload.strategy_id = params.strategyId;
  }
  if (params.language) {
    payload.language = params.language;
  }
  if (params.currentStrategyRules) {
    payload.current_strategy_rules = params.currentStrategyRules;
  }

  return payload;
}

/**
 * Check whether the server response permits a given action.
 */
export function isActionAvailable(
  availableActions: string[] | undefined,
  action: VibingChatAction,
): boolean {
  return Array.isArray(availableActions) && availableActions.includes(action);
}
