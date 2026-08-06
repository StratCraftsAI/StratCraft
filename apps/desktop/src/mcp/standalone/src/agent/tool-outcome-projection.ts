import type {
  AgentFailureStage,
  AgentOutcomePresentationV1,
  AgentTerminalReason,
  AgentToolExecutionState,
  AgentToolOutcomeV1,
} from '@StratCraft/types';
import {
  AGENT_TOOL_OUTCOME_DIAGNOSTIC_MAX_CHARS,
  AGENT_TOOL_OUTCOME_DIAGNOSTIC_MAX_DEPTH,
  AGENT_TOOL_OUTCOME_DIAGNOSTIC_MAX_ITEMS,
  AGENT_TOOL_OUTCOME_PARAMETER_MAX_CHARS,
  AGENT_TOOL_OUTCOME_PARAMETER_MAX_ITEMS,
} from '../constants';
import type { McpToolResult } from '../handlers/tool-result';

const CODE_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;
const MESSAGE_KEY_PATTERN = /^agentOutcome\.[A-Za-z][A-Za-z0-9.]{0,127}$/;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SECRET_PARAMETER_PATTERN = /(?:authorization|assertion|challenge|cookie|credential|password|secret|token|api[_-]?key|csrf)/i;
const UNSAFE_DIAGNOSTIC_PROSE_PATTERN = /^(?:body|detail|error|html|message|response|stack)$/i;
const SAFE_DIAGNOSTIC_STRING_FIELD_PATTERN = /^(?:category|code|correlation_?id|errorCode|kind|status|type)$/;
const SAFE_DIAGNOSTIC_TOKEN_FIELD_PATTERN = /^(?:backend_code|failed_stage|task_id|validator_error_code)$/;
const SECRET_VALUE_PATTERN = /(?:Bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_]+|webauthn[-_: ](?:assertion|challenge)[-_: =][^\s,}"']+)/i;
const OMITTED_DIAGNOSTIC_TEXT = '[text-omitted]';
const OMITTED_UNSTRUCTURED_DIAGNOSTIC = '[unstructured-payload-omitted]';

interface StructuredToolEnvelope {
  readonly code?: unknown;
  readonly errorCode?: unknown;
  readonly correlation_id?: unknown;
  readonly correlationId?: unknown;
  readonly electronRequired?: unknown;
  readonly presentation?: unknown;
}

export interface ProjectToolOutcomeOptions {
  readonly executionState?: AgentToolExecutionState;
  readonly terminalReason?: AgentTerminalReason;
  readonly code?: string;
  readonly fallbackCode?: string;
}

export interface ProjectTurnOutcomeInput {
  readonly stage: AgentFailureStage;
  readonly code?: string;
  readonly terminalReason?: Extract<AgentTerminalReason, 'user_cancelled' | 'session_cancelled' | 'turn_failed'>;
  readonly diagnosticKind?: string;
}

export interface ProjectRuntimeToolOutcomeInput extends ProjectToolOutcomeOptions {
  readonly succeeded: boolean;
  readonly rawResult?: string;
}

export interface ProjectedAgentToolResult {
  readonly outcome: AgentToolOutcomeV1;
  readonly diagnosticResult?: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstText(result: McpToolResult): string {
  const text = result.content?.find(item => item.type === 'text')?.text;
  return typeof text === 'string' ? text : '';
}

function safeCode(value: unknown, fallback: string): string {
  return typeof value === 'string' && CODE_PATTERN.test(value) ? value : fallback;
}

function safeCorrelationId(value: unknown): string | undefined {
  return typeof value === 'string' && CORRELATION_ID_PATTERN.test(value)
    ? value
    : undefined;
}

function safeParameters(value: unknown): Readonly<Record<string, string | number>> | null {
  const source = record(value);
  if (!source) return null;
  const entries = Object.entries(source);
  if (entries.length > AGENT_TOOL_OUTCOME_PARAMETER_MAX_ITEMS) return null;
  const output: Record<string, string | number> = {};
  for (const [key, parameter] of entries) {
    if (!CODE_PATTERN.test(key) || SECRET_PARAMETER_PATTERN.test(key)) return null;
    if (typeof parameter === 'number') {
      if (!Number.isFinite(parameter)) return null;
      output[key] = parameter;
      continue;
    }
    if (typeof parameter !== 'string' || SECRET_VALUE_PATTERN.test(parameter)) return null;
    output[key] = parameter.slice(0, AGENT_TOOL_OUTCOME_PARAMETER_MAX_CHARS);
  }
  return output;
}

function producerPresentation(value: unknown): AgentOutcomePresentationV1 | null {
  const source = record(value);
  if (!source || typeof source.messageKey !== 'string' || !MESSAGE_KEY_PATTERN.test(source.messageKey)) {
    return null;
  }
  const parameters = safeParameters(source.parameters);
  if (!parameters) return null;
  if (
    source.recoveryKey !== undefined
    && (typeof source.recoveryKey !== 'string' || !MESSAGE_KEY_PATTERN.test(source.recoveryKey))
  ) return null;
  if (source.severity !== 'info' && source.severity !== 'warning' && source.severity !== 'error') {
    return null;
  }
  return {
    messageKey: source.messageKey,
    parameters,
    ...(typeof source.recoveryKey === 'string' ? { recoveryKey: source.recoveryKey } : {}),
    severity: source.severity,
  };
}

function terminalReasonFor(
  code: string,
  executionState: AgentToolExecutionState,
  explicit?: AgentTerminalReason,
): AgentTerminalReason | undefined {
  if (executionState === 'succeeded') return undefined;
  if (explicit) return explicit;
  if (code === 'permission_denied') return 'permission_denied';
  if (code === 'permission_expired') return 'permission_expired';
  if (code === 'permission_cancelled') return 'permission_cancelled';
  return executionState === 'executed_failed' ? 'tool_failed' : 'turn_failed';
}

function defaultPresentation(
  code: string,
  executionState: AgentToolExecutionState,
  terminalReason: AgentTerminalReason | undefined,
): AgentOutcomePresentationV1 {
  if (executionState === 'succeeded') {
    return {
      messageKey: 'agentOutcome.toolSucceeded',
      parameters: {},
      severity: 'info',
    };
  }
  switch (terminalReason) {
    case 'permission_denied':
      return {
        messageKey: 'agentOutcome.permissionDenied',
        parameters: {},
        recoveryKey: 'agentOutcome.retryRequest',
        severity: 'warning',
      };
    case 'permission_expired':
      return {
        messageKey: 'agentOutcome.permissionExpired',
        parameters: {},
        recoveryKey: 'agentOutcome.retryRequest',
        severity: 'warning',
      };
    case 'permission_cancelled':
      return {
        messageKey: 'agentOutcome.permissionCancelled',
        parameters: {},
        recoveryKey: 'agentOutcome.retryRequest',
        severity: 'warning',
      };
    case 'user_cancelled':
      return {
        messageKey: 'agentOutcome.userCancelled',
        parameters: {},
        severity: 'info',
      };
    case 'session_cancelled':
      return {
        messageKey: 'agentOutcome.sessionCancelled',
        parameters: {},
        recoveryKey: 'agentOutcome.startNewSession',
        severity: 'warning',
      };
    case 'tool_failed':
      if (code === 'no_byok_key') {
        return { messageKey: 'agentOutcome.noByokKey', parameters: {}, severity: 'error' };
      }
      if (code === 'electron_required') {
        return { messageKey: 'agentOutcome.electronRequired', parameters: {}, severity: 'error' };
      }
      return {
        messageKey: 'agentOutcome.toolFailed',
        parameters: {},
        recoveryKey: 'agentOutcome.reviewDiagnostics',
        severity: 'error',
      };
    case 'turn_failed':
    default:
      if (code === 'tool_cap_exceeded') {
        return { messageKey: 'agentOutcome.toolCapExceeded', parameters: {}, severity: 'error' };
      }
      if (code === 'llm_provider_temporarily_unavailable') {
        return {
          messageKey: 'agentOutcome.providerTemporarilyUnavailable',
          parameters: {},
          recoveryKey: 'agentOutcome.retryLater',
          severity: 'warning',
        };
      }
      return {
        messageKey: 'agentOutcome.turnFailed',
        parameters: {},
        recoveryKey: 'agentOutcome.reviewDiagnostics',
        severity: 'error',
      };
  }
}

function diagnosticSummary(
  code: string,
  kind: string,
  category?: McpToolResult['errorCategory'],
): string {
  return [
    `code=${code}`,
    `payload=${kind}`,
    ...(category ? [`category=${category}`] : []),
  ].join('; ').slice(0, AGENT_TOOL_OUTCOME_DIAGNOSTIC_MAX_CHARS);
}

function sanitizeDiagnosticValue(value: unknown, depth = 0, key?: string): unknown {
  if (depth >= AGENT_TOOL_OUTCOME_DIAGNOSTIC_MAX_DEPTH) return '[depth-limit]';
  if (typeof value === 'string') {
    if (
      key !== undefined
      && SAFE_DIAGNOSTIC_TOKEN_FIELD_PATTERN.test(key)
      && CORRELATION_ID_PATTERN.test(value)
      && !SECRET_VALUE_PATTERN.test(value)
    ) {
      return value;
    }
    if (
      key !== undefined
      && SAFE_DIAGNOSTIC_STRING_FIELD_PATTERN.test(key)
      && !SECRET_VALUE_PATTERN.test(value)
    ) {
      return value.slice(0, AGENT_TOOL_OUTCOME_PARAMETER_MAX_CHARS);
    }
    return OMITTED_DIAGNOSTIC_TEXT;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, AGENT_TOOL_OUTCOME_DIAGNOSTIC_MAX_ITEMS)
      .map(entry => sanitizeDiagnosticValue(entry, depth + 1));
  }
  const source = record(value);
  if (!source) return null;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)
    .slice(0, AGENT_TOOL_OUTCOME_DIAGNOSTIC_MAX_ITEMS)) {
    if (SECRET_PARAMETER_PATTERN.test(key) || UNSAFE_DIAGNOSTIC_PROSE_PATTERN.test(key)) continue;
    output[key] = sanitizeDiagnosticValue(entry, depth + 1, key);
  }
  return output;
}

function boundedDiagnosticResult(text: string, parsed: unknown): string | undefined {
  if (text === '') return undefined;
  const safe = parsed === undefined
    ? OMITTED_UNSTRUCTURED_DIAGNOSTIC
    : JSON.stringify(sanitizeDiagnosticValue(parsed));
  return safe.slice(0, AGENT_TOOL_OUTCOME_DIAGNOSTIC_MAX_CHARS);
}

/**
 * Parse a returned MCP result once and project its complete browser-safe
 * semantics. Raw payload text never leaves this boundary.
 */
export function projectAgentToolResult(
  result: McpToolResult,
  options: ProjectToolOutcomeOptions = {},
): ProjectedAgentToolResult {
  const text = firstText(result);
  let envelope: StructuredToolEnvelope | null = null;
  let parsedValue: unknown;
  let payloadKind = text === '' ? 'empty' : 'non_json';
  if (text !== '') {
    try {
      parsedValue = JSON.parse(text) as unknown;
      envelope = record(parsedValue);
      payloadKind = envelope ? 'object' : Array.isArray(parsedValue) ? 'array' : 'primitive';
    } catch {
      payloadKind = 'malformed';
    }
  }

  const envelopeCode = envelope?.code ?? envelope?.errorCode;
  const provisionalCode = safeCode(options.code ?? envelopeCode, '');
  const executionState = options.executionState
    ?? (provisionalCode === 'permission_denied'
      || provisionalCode === 'permission_expired'
      || provisionalCode === 'permission_cancelled'
      ? 'not_executed'
      : result.isError === true ? 'executed_failed' : 'succeeded');
  const fallbackCode = executionState === 'succeeded'
    ? 'tool_succeeded'
    : safeCode(options.fallbackCode, 'tool_execution_failed');
  const code = safeCode(
    options.code ?? envelopeCode ?? (envelope?.electronRequired === true ? 'electron_required' : undefined),
    fallbackCode,
  );
  const terminalReason = terminalReasonFor(code, executionState, options.terminalReason);
  const validatedPresentation = producerPresentation(envelope?.presentation);
  const presentation = validatedPresentation
    ?? defaultPresentation(code, executionState, terminalReason);
  const correlationId = safeCorrelationId(envelope?.correlation_id ?? envelope?.correlationId);
  const diagnosticResult = boundedDiagnosticResult(text, parsedValue);
  const outcome: AgentToolOutcomeV1 = executionState === 'succeeded'
    ? {
      code,
      executionState,
      presentation,
    }
    : {
      code,
      executionState,
      terminalReason: terminalReason!,
      presentation,
      diagnostic: {
        safeSummary: diagnosticSummary(code, payloadKind, result.errorCategory),
        ...(correlationId ? { correlationId } : {}),
      },
    };

  return {
    outcome,
    ...(diagnosticResult
      ? { diagnosticResult }
      : {}),
  };
}

export function projectAgentToolOutcome(
  result: McpToolResult,
  options: ProjectToolOutcomeOptions = {},
): AgentToolOutcomeV1 {
  return projectAgentToolResult(result, options).outcome;
}

/** Provider adapters use the same projector for native tool completion data. */
export function projectAgentRuntimeToolOutcome(
  input: ProjectRuntimeToolOutcomeInput,
): AgentToolOutcomeV1 {
  const result: McpToolResult = {
    content: [{ type: 'text', text: input.rawResult ?? '' }],
    ...(input.succeeded ? {} : { isError: true }),
  };
  return projectAgentToolOutcome(result, {
    ...(input.executionState ? { executionState: input.executionState } : {}),
    ...(input.terminalReason ? { terminalReason: input.terminalReason } : {}),
    ...(input.code ? { code: input.code } : {}),
    ...(input.fallbackCode ? { fallbackCode: input.fallbackCode } : {}),
  });
}

/** Project non-tool terminal conditions through the same presentation contract. */
export function projectAgentTurnOutcome(input: ProjectTurnOutcomeInput): AgentToolOutcomeV1 {
  const code = safeCode(input.code, 'turn_failed');
  const terminalReason = input.terminalReason ?? 'turn_failed';
  return {
    code,
    executionState: 'not_executed',
    terminalReason,
    presentation: defaultPresentation(code, 'not_executed', terminalReason),
    diagnostic: {
      safeSummary: diagnosticSummary(
        code,
        input.diagnosticKind ?? `turn_${input.stage}`,
      ),
    },
  };
}
