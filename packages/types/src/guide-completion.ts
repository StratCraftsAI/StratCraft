import {
  GUIDE_COMPLETION_CONTRACT_VERSION,
  GUIDE_COMPLETION_ARTIFACT_SHA256,
  GUIDE_COMPLETION_ERROR_CODES,
} from './guide-completion.generated';

export const GUIDE_COMPLETION_PATH = '/api/v1/llm/completions' as const;
export const GUIDE_COMPLETION_CONTRACT_SHA256 = GUIDE_COMPLETION_ARTIFACT_SHA256;
export const GUIDE_COMPLETION_BACKEND_SOURCE_SHA256 =
  '767ea545ad8047ce76943b8a57f72f14d2ab3a234fb07c51691e42e467391e8f' as const;

export { GUIDE_COMPLETION_CONTRACT_VERSION };
export type GuideCompletionErrorCode = typeof GUIDE_COMPLETION_ERROR_CODES[number];

export interface GuideCompletionRoute {
  runtime_provider_id: 'PRO_CATALOG';
  catalog_provider_id: string;
  model_id: string;
}

export type GuideCompletionContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean };

export interface GuideCompletionMessage {
  role: 'user' | 'assistant';
  content: GuideCompletionContentBlock[];
}

export interface GuideCompletionTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface GuideCompletionRequest {
  contract_version: typeof GUIDE_COMPLETION_CONTRACT_VERSION;
  request_id: string;
  turn_id: string;
  invocation_index: number;
  route: GuideCompletionRoute;
  system: string;
  messages: GuideCompletionMessage[];
  tools: GuideCompletionTool[];
  max_tokens: number;
  stream: true;
}

export interface GuideCompletionError {
  code: GuideCompletionErrorCode;
  message: string;
  request_id: string;
  retryable: boolean;
  retry_after_ms?: number | null;
}

export type GuideCompletionEvent =
  | {
    type: 'response_started';
    request_id: string;
    turn_id: string;
    invocation_index: number;
    route: GuideCompletionRoute;
  }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'usage'; input_tokens: number; output_tokens: number }
  | { type: 'completed'; stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' }
  | { type: 'error'; error: GuideCompletionError };

const ERROR_CODES = new Set<GuideCompletionErrorCode>(GUIDE_COMPLETION_ERROR_CODES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRoute(value: unknown): value is GuideCompletionRoute {
  return isRecord(value)
    && value.runtime_provider_id === 'PRO_CATALOG'
    && typeof value.catalog_provider_id === 'string'
    && value.catalog_provider_id.length > 0
    && typeof value.model_id === 'string'
    && value.model_id.length > 0;
}

/** Runtime validator generated from guide-completion-v1.openapi.json. */
export function parseGuideCompletionEvent(value: unknown): GuideCompletionEvent {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('Guide completion event must be an object with a type');
  }
  switch (value.type) {
    case 'response_started':
      if (
        typeof value.request_id === 'string'
        && typeof value.turn_id === 'string'
        && Number.isInteger(value.invocation_index)
        && isRoute(value.route)
      ) return value as unknown as GuideCompletionEvent;
      break;
    case 'text_delta':
      if (typeof value.text === 'string' && value.text.length > 0) {
        return value as unknown as GuideCompletionEvent;
      }
      break;
    case 'tool_use':
      if (
        typeof value.id === 'string'
        && value.id.length > 0
        && typeof value.name === 'string'
        && value.name.length > 0
        && isRecord(value.input)
      ) return value as unknown as GuideCompletionEvent;
      break;
    case 'usage':
      if (
        Number.isInteger(value.input_tokens)
        && (value.input_tokens as number) >= 0
        && Number.isInteger(value.output_tokens)
        && (value.output_tokens as number) >= 0
      ) return value as unknown as GuideCompletionEvent;
      break;
    case 'completed':
      if (value.stop_reason === 'end_turn' || value.stop_reason === 'tool_use' || value.stop_reason === 'max_tokens') {
        return value as unknown as GuideCompletionEvent;
      }
      break;
    case 'error': {
      const error = value.error;
      if (
        isRecord(error)
        && typeof error.code === 'string'
        && ERROR_CODES.has(error.code as GuideCompletionErrorCode)
        && typeof error.message === 'string'
        && typeof error.request_id === 'string'
        && typeof error.retryable === 'boolean'
        && (error.retry_after_ms === undefined || error.retry_after_ms === null || (
          Number.isInteger(error.retry_after_ms) && (error.retry_after_ms as number) >= 0
        ))
      ) return value as unknown as GuideCompletionEvent;
      break;
    }
  }
  throw new Error(`Invalid Guide completion '${value.type}' event`);
}

/** Runtime validator for pre-stream JSON error envelopes. */
export function parseGuideCompletionError(value: unknown): GuideCompletionError {
  const envelope = isRecord(value) && isRecord(value.error) ? value.error : value;
  const event = parseGuideCompletionEvent({ type: 'error', error: envelope });
  return (event as Extract<GuideCompletionEvent, { type: 'error' }>).error;
}
