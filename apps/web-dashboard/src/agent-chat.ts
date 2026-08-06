/**
 * TICKET_1237_4: Webui client for the BYOK agent loop (TICKET_1237_1).
 *
 * Typed wrappers around the 3 agent MCP tools plus a pure event reducer.
 * Free-text chat turns are started with send_agent_message; the loop
 * streams AgentEvents on /mcp/events (SSE event name "agent-event")
 * which the reducer folds into the turn's ChatMessage.
 *
 * TICKET_1310_2: a tool the registry declares visual also streams a
 * `tool_visualization` event carrying its parsed payload, which the reducer
 * folds into `visualization` -- so an agent turn renders the same interactive
 * component the button path renders, instead of LLM prose describing it.
 * Button-driven guided flows still originate in chat-router.ts, not here.
 */
import { callTool, McpToolError } from './mcp-client.ts'
import { submitAgentPermissionDecision } from './agent-control-client.ts'
import {
  AGENT_VISUALIZATION_KINDS,
  governanceAttributionV1Schema,
  NORMALIZED_AGENT_EVENT_CONTRACT_VERSION,
  NORMALIZED_AGENT_EVENT_TYPES,
  type GuideAgentRuntimeSnapshot,
  type AgentToolOutcomeV1,
  type NormalizedAgentEvent,
  type NormalizedAgentEventPayloadMap,
  type NormalizedAgentEventType,
} from '@StratCraft/types'
import {
  AGENT_EVENT_GAP_TIMEOUT_MS,
  AGENT_EVENT_ID_HISTORY_MAX,
  AGENT_EVENT_REORDER_BUFFER_MAX,
  AGENT_EVENT_SERIALIZED_MAX_CHARS,
  AGENT_EVENT_TEXT_MAX_CHARS,
} from './constants.ts'
import { isConfirmDecisionInFlight, isTerminalConfirmPhase } from './types.ts'
import type {
  AgentConfirmError,
  AgentConfirmPhase,
  AgentConfirmState,
  AgentEvent,
  AgentTurnState,
  ChatMessage,
  GuidedResponse,
  NonTerminalAgentConfirmPhase,
} from './types.ts'

// ── MCP tool wrappers ──────────────────────────────────────────────────

export interface AgentTurnHandle {
  turnId: string
  conversationId: number
  mode: 'byok' | 'plan'
  selectionFingerprint: string
  runtimeCapabilityHash: string
  turnAdmissionFingerprint: string
}

/**
 * Start an agent turn. Returns immediately with the turn handle; events
 * stream on /mcp/events. Omit conversationId to start a new conversation.
 */
export async function startAgentTurn(
  message: string,
  runtimeSnapshot: GuideAgentRuntimeSnapshot,
  conversationId?: number,
): Promise<AgentTurnHandle> {
  const clientRequestId = crypto.randomUUID()
  const args: Record<string, unknown> = {
    message,
    client_request_id: clientRequestId,
    selection_fingerprint: runtimeSnapshot.selectionFingerprint,
    selection_reference: runtimeSnapshot.selection,
    runtime_capability_hash: runtimeSnapshot.runtimeCapabilityHash,
  }
  if (typeof conversationId === 'number') args.conversation_id = conversationId
  let rawResult: unknown
  try {
    rawResult = await callTool('send_agent_message', args)
  } catch (reason) {
    if (reason instanceof McpToolError) throw reason
    // The server may have admitted the turn before the HTTP response was
    // interrupted. Reusing the same idempotency key retrieves that exact turn
    // handle instead of launching a second LLM request.
    rawResult = await callTool('send_agent_message', args)
  }
  const result = rawResult as {
    turn_id?: string
    conversation_id?: number
    mode?: 'byok' | 'plan'
    selection_fingerprint?: string
    runtime_capability_hash?: string
    turn_admission_fingerprint?: string
  }
  if (
    typeof result?.turn_id !== 'string'
    || typeof result?.conversation_id !== 'number'
    || (result.mode !== 'byok' && result.mode !== 'plan')
    || typeof result.selection_fingerprint !== 'string'
    || typeof result.runtime_capability_hash !== 'string'
    || typeof result.turn_admission_fingerprint !== 'string'
  ) {
    throw new Error(JSON.stringify(result))
  }
  return {
    turnId: result.turn_id,
    conversationId: result.conversation_id,
    mode: result.mode,
    selectionFingerprint: result.selection_fingerprint,
    runtimeCapabilityHash: result.runtime_capability_hash,
    turnAdmissionFingerprint: result.turn_admission_fingerprint,
  }
}

export async function cancelAgentTurn(turnId: string): Promise<void> {
  await callTool('cancel_agent_turn', { turn_id: turnId })
}

export async function confirmAgentAction(
  confirmationId: string,
  expectedPayloadHash: string,
  approved: boolean,
  _payload?: Record<string, unknown>,
  onPhase?: (
    phase: 'bootstrapping-authenticator' | 'awaiting-user-verification' | 'submitting'
  ) => void,
): Promise<void> {
  if (onPhase) {
    await submitAgentPermissionDecision(confirmationId, expectedPayloadHash, approved, onPhase)
  } else {
    await submitAgentPermissionDecision(confirmationId, expectedPayloadHash, approved)
  }
}

const AGENT_SNAPSHOT_REFRESH_ERROR_CODES = new Set([
  'selection_changed',
  'runtime_capability_changed',
  'entitlement_changed',
  'workspace_changed',
  'policy_changed',
  'tool_grant_changed',
])

export function requiresAgentSnapshotRefresh(err: unknown): boolean {
  return err instanceof McpToolError
    && typeof err.errorCode === 'string'
    && AGENT_SNAPSHOT_REFRESH_ERROR_CODES.has(err.errorCode)
}

export function extractAgentChangedFields(err: unknown): Array<{
  path: string
  oldPublicHash: string
  newPublicHash: string
}> {
  if (!(err instanceof McpToolError) || !Array.isArray(err.details?.changed_fields)) return []
  return err.details.changed_fields.flatMap((value) => {
    if (!isRecord(value)) return []
    if (
      typeof value.path !== 'string'
      || typeof value.oldPublicHash !== 'string'
      || typeof value.newPublicHash !== 'string'
      || !SHA256_PATTERN.test(value.oldPublicHash)
      || !SHA256_PATTERN.test(value.newPublicHash)
    ) return []
    return [{
      path: value.path,
      oldPublicHash: value.oldPublicHash,
      newPublicHash: value.newPublicHash,
    }]
  })
}

// ── Event validation ───────────────────────────────────────────────────

const AGENT_EVENT_TYPES = new Set<string>(NORMALIZED_AGENT_EVENT_TYPES)

/** TICKET_1310_2: closed renderable-kind set, shared with the MCP server. */
const AGENT_VISUALIZATION_KIND_SET = new Set<string>(AGENT_VISUALIZATION_KINDS)

const TERMINAL_CONTROL_PATTERN = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g
const FORBIDDEN_FIELD_PATTERN = /^(?:stderr|nativeEvent|providerNative|authorization|credential|password|secret|token|api[_-]?key|private[_-]?key)$/i
const POSIX_ABSOLUTE_PATH_PATTERN = /(?:^|[\s"'=(])\/(?:[^/\s]+\/)+[^/\s]*/
const WINDOWS_ABSOLUTE_PATH_PATTERN = /(?:^|[\s"'=(])[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]*/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

/**
 * TICKET_1310_2: the absolute-path filters exist to stop *filesystem* paths
 * from leaking into the browser. A same-origin static asset URL is not that,
 * but it is textually identical to one -- `/guide-thumbnails/backtest.png`
 * matches POSIX_ABSOLUTE_PATH_PATTERN exactly as `/home/user/x.png` does.
 *
 * Guided payloads legitimately carry such URLs, so the filter is narrowed to
 * its actual threat by exempting a closed allowlist of asset roots served by
 * this SPA. The exemption is deliberately a fixed prefix list, not a general
 * "looks like a URL" heuristic: anything outside these roots is still
 * rejected, so a real filesystem path cannot ride in on this exception.
 */
const BROWSER_ASSET_ROOTS = ['/guide-thumbnails/'] as const

function isBrowserAssetPath(value: string): boolean {
  return BROWSER_ASSET_ROOTS.some(root => value.startsWith(root))
    // Reject traversal outright -- an asset root prefix must not become a
    // vehicle for reaching outside it.
    && !value.includes('..')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeString(value: unknown, maxChars = AGENT_EVENT_TEXT_MAX_CHARS): string | null {
  if (typeof value !== 'string' || value.length > maxChars) return null
  if (POSIX_ABSOLUTE_PATH_PATTERN.test(value) || WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)) return null
  return value.replace(TERMINAL_CONTROL_PATTERN, '')
}

function containsForbiddenBrowserValue(value: unknown, depth = 0): boolean {
  if (depth > 8) return true
  if (typeof value === 'string') {
    if (isBrowserAssetPath(value)) return false
    return POSIX_ABSOLUTE_PATH_PATTERN.test(value) || WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)
  }
  if (Array.isArray(value)) return value.some(entry => containsForbiddenBrowserValue(entry, depth + 1))
  if (!isRecord(value)) return false
  return Object.entries(value).some(([key, entry]) =>
    FORBIDDEN_FIELD_PATTERN.test(key) || containsForbiddenBrowserValue(entry, depth + 1))
}

function stripTerminalControls(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(TERMINAL_CONTROL_PATTERN, '')
  if (Array.isArray(value)) return value.map(stripTerminalControls)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, stripTerminalControls(entry)]),
  )
}

function validCommonEnvelope(event: Record<string, unknown>): boolean {
  const runtime = event.runtime
  const task = event.task
  const workspace = event.workspace
  return event.contractVersion === NORMALIZED_AGENT_EVENT_CONTRACT_VERSION
    && typeof event.eventId === 'string'
    && typeof event.correlationId === 'string'
    && typeof event.mcpSessionId === 'string'
    && typeof event.subjectScopeHash === 'string'
    && SHA256_PATTERN.test(event.subjectScopeHash)
    && isRecord(runtime)
    && typeof runtime.runtimeId === 'string'
    && typeof runtime.adapterContractVersion === 'string'
    && typeof runtime.nativeVersion === 'string'
    && typeof runtime.protocolVersion === 'string'
    && typeof event.runtimeSessionId === 'string'
    && isRecord(task)
    && typeof task.taskId === 'string'
    && typeof task.taskSpecVersion === 'string'
    && typeof task.taskSpecContentHash === 'string'
    && isRecord(workspace)
    && typeof workspace.workspaceId === 'string'
    && typeof workspace.workspaceVersion === 'string'
    && typeof workspace.workspaceContentHash === 'string'
    && typeof event.conversationId === 'string'
    && typeof event.turnId === 'string'
    && Number.isSafeInteger(event.sequence)
    && (event.sequence as number) >= 0
    && typeof event.timestamp === 'string'
    && Number.isFinite(Date.parse(event.timestamp))
    && typeof event.admittedContextFingerprint === 'string'
    && SHA256_PATTERN.test(event.admittedContextFingerprint)
}

function validPermissionScope(value: unknown): boolean {
  return isRecord(value)
    && typeof value.mcpSessionId === 'string'
    && typeof value.taskId === 'string'
    && typeof value.turnId === 'string'
    && typeof value.workspaceId === 'string'
    && typeof value.requestId === 'string'
    && typeof value.capability === 'string'
    && typeof value.expectedPayloadHash === 'string'
    && SHA256_PATTERN.test(value.expectedPayloadHash)
}

const AGENT_EXECUTION_STATES = new Set(['succeeded', 'executed_failed', 'not_executed'])
const AGENT_TERMINAL_REASONS = new Set([
  'permission_denied',
  'permission_expired',
  'permission_cancelled',
  'user_cancelled',
  'session_cancelled',
  'tool_failed',
  'turn_failed',
])
const AGENT_OUTCOME_SEVERITIES = new Set(['info', 'warning', 'error'])
const AGENT_OUTCOME_KEY_PATTERN = /^agentOutcome\.[A-Za-z][A-Za-z0-9.]{0,127}$/

function validAgentOutcome(value: unknown): value is AgentToolOutcomeV1 {
  if (!isRecord(value) || typeof value.code !== 'string') return false
  if (!AGENT_EXECUTION_STATES.has(String(value.executionState))) return false
  if (value.terminalReason !== undefined && !AGENT_TERMINAL_REASONS.has(String(value.terminalReason))) {
    return false
  }
  if (value.executionState === 'succeeded' && value.terminalReason !== undefined) return false
  if (value.executionState !== 'succeeded' && value.terminalReason === undefined) return false
  if (!isRecord(value.presentation)) return false
  if (
    typeof value.presentation.messageKey !== 'string'
    || !AGENT_OUTCOME_KEY_PATTERN.test(value.presentation.messageKey)
    || !AGENT_OUTCOME_SEVERITIES.has(String(value.presentation.severity))
    || !isRecord(value.presentation.parameters)
  ) return false
  if (
    value.presentation.recoveryKey !== undefined
    && (
      typeof value.presentation.recoveryKey !== 'string'
      || !AGENT_OUTCOME_KEY_PATTERN.test(value.presentation.recoveryKey)
    )
  ) return false
  if (!Object.values(value.presentation.parameters).every(parameter =>
    (typeof parameter === 'string' && safeString(parameter) !== null)
    || (typeof parameter === 'number' && Number.isFinite(parameter)))) return false
  if (value.diagnostic !== undefined) {
    if (!isRecord(value.diagnostic)) return false
    if (value.diagnostic.safeSummary !== undefined && safeString(value.diagnostic.safeSummary) === null) return false
    if (value.diagnostic.correlationId !== undefined && typeof value.diagnostic.correlationId !== 'string') return false
  }
  return true
}

function protocolOutcome(code: string, messageKey: string, recoveryKey?: string): AgentToolOutcomeV1 {
  return {
    code,
    executionState: 'not_executed',
    terminalReason: 'turn_failed',
    presentation: {
      messageKey,
      parameters: {},
      ...(recoveryKey ? { recoveryKey } : {}),
      severity: 'error',
    },
  }
}

function presentationOnlyOutcome(outcome: AgentToolOutcomeV1): AgentToolOutcomeV1 {
  if (outcome.executionState === 'succeeded') {
    return {
      code: outcome.code,
      executionState: outcome.executionState,
      presentation: outcome.presentation,
    }
  }
  return {
    code: outcome.code,
    executionState: outcome.executionState,
    terminalReason: outcome.terminalReason,
    presentation: outcome.presentation,
  }
}

function validPayload(type: NormalizedAgentEventType, payload: Record<string, unknown>): boolean {
  switch (type) {
    case 'turn_started':
      return payload.status === 'admitted'
    case 'text_delta':
      return safeString(payload.text) !== null
    case 'thought_delta':
      return safeString(payload.text) !== null
        && (payload.visibility === 'visible' || payload.visibility === 'summary')
    case 'plan_updated':
      return Array.isArray(payload.items)
        && payload.items.length <= AGENT_EVENT_REORDER_BUFFER_MAX
        && payload.items.every(item => isRecord(item)
          && typeof item.id === 'string'
          && safeString(item.text) !== null
          && ['pending', 'in_progress', 'completed'].includes(String(item.status)))
    case 'tool_started':
      return typeof payload.callId === 'string'
        && typeof payload.toolName === 'string'
        && isRecord(payload.arguments)
    case 'tool_progress':
      return typeof payload.callId === 'string' && safeString(payload.message) !== null
    case 'tool_completed':
      return typeof payload.callId === 'string'
        && typeof payload.toolName === 'string'
        && validAgentOutcome(payload.outcome)
    case 'tool_visualization':
      // TICKET_1310_2: `kind` must be one of the contract's closed
      // discriminants -- the renderer dispatches on it, so an unknown value
      // must never enter browser state. The payload itself is validated
      // structurally only; its per-kind shape is the renderer's contract and
      // was already resolved and sanitized server-side.
      return typeof payload.callId === 'string'
        && typeof payload.toolName === 'string'
        && AGENT_VISUALIZATION_KIND_SET.has(String(payload.kind))
        && isRecord(payload.payload)
        && payload.payload.type === payload.kind
    case 'permission_requested':
      return validPermissionScope(payload.scope)
        && typeof payload.operation === 'string'
        && isRecord(payload.requestPayload)
        && ['low', 'medium', 'high'].includes(String(payload.riskTier))
        && typeof payload.expiresAt === 'string'
        && Number.isFinite(Date.parse(payload.expiresAt))
    case 'permission_resolved':
      return validPermissionScope(payload.scope)
        && ['approved', 'denied', 'expired', 'cancelled'].includes(String(payload.decision))
        && typeof payload.resolvedAt === 'string'
        && Number.isFinite(Date.parse(payload.resolvedAt))
    case 'governance_reported':
      return governanceAttributionV1Schema.safeParse(payload).success
    case 'file_change_proposed':
      return typeof payload.changeId === 'string'
        && typeof payload.relativePath === 'string'
        && !payload.relativePath.startsWith('/')
        && safeString(payload.diff) !== null
    case 'file_change_applied':
      return typeof payload.changeId === 'string'
        && typeof payload.relativePath === 'string'
        && typeof payload.contentHash === 'string'
        && SHA256_PATTERN.test(payload.contentHash)
    case 'usage_reported':
      return payload.contractVersion === '1.0.0'
        && typeof payload.taskId === 'string'
        && typeof payload.turnId === 'string'
        && typeof payload.runtimeId === 'string'
        && typeof payload.providerId === 'string'
        && typeof payload.modelId === 'string'
        && (
          (
            payload.source === 'unavailable'
            && payload.completeness === 'unavailable'
            && payload.providerEventId === undefined
          )
          || (
            ['provider_reported', 'server_reported'].includes(String(payload.source))
            && typeof payload.providerEventId === 'string'
          )
        )
    case 'candidate_artifact_ready':
      return typeof payload.candidateId === 'string'
        && (payload.artifactKind === 'strategy' || payload.artifactKind === 'signal')
        && typeof payload.manifestHash === 'string'
    case 'artifact_admission_started':
      return typeof payload.candidateId === 'string' && typeof payload.admissionId === 'string'
    case 'artifact_admission_stage':
      return typeof payload.admissionId === 'string'
        && typeof payload.stageId === 'string'
        && typeof payload.label === 'string'
        && ['pending', 'running', 'passed', 'failed'].includes(String(payload.status))
    case 'artifact_accepted':
      return typeof payload.admissionId === 'string'
        && typeof payload.artifactId === 'string'
        && typeof payload.artifactHash === 'string'
    case 'artifact_rejected':
      return typeof payload.admissionId === 'string'
        && typeof payload.stageId === 'string'
        && typeof payload.code === 'string'
        && safeString(payload.message) !== null
    case 'turn_failed':
      return [
        'tool_execution',
        'llm_inference',
        'turn_admission',
        'artifact_admission',
        'attribution_persistence',
        'internal',
      ].includes(String(payload.stage))
        && validAgentOutcome(payload.outcome)
    case 'turn_cancelled':
      return validAgentOutcome(payload.outcome)
    case 'turn_completed':
      return safeString(payload.text) !== null
        && Number.isSafeInteger(payload.toolCallCount)
        && (payload.toolCallCount as number) >= 0
  }
}

/** Validate the normalized SSE contract before any value enters browser state. */
export function parseAgentEvent(raw: unknown): AgentEvent | null {
  if (!isRecord(raw)) return null
  let serialized: string
  try {
    serialized = JSON.stringify(raw)
  } catch {
    return null
  }
  if (serialized.length > AGENT_EVENT_SERIALIZED_MAX_CHARS || containsForbiddenBrowserValue(raw)) return null
  if (typeof raw.type !== 'string' || !AGENT_EVENT_TYPES.has(raw.type)) return null
  if (!validCommonEnvelope(raw) || !isRecord(raw.payload)) return null
  if (!validPayload(raw.type as NormalizedAgentEventType, raw.payload)) return null
  return stripTerminalControls(raw) as AgentEvent
}

// ── Pure reducer: fold one AgentEvent into the turn's ChatMessage ──────

function reduceOrderedEvent(msg: ChatMessage, event: AgentEvent): ChatMessage {
  const agent = msg.agent!
  const next: AgentTurnState = {
    ...agent,
    lastSeq: event.sequence,
    seenEventIds: [...agent.seenEventIds, event.eventId].slice(-AGENT_EVENT_ID_HISTORY_MAX),
  }
  switch (event.type) {
    case 'turn_started':
      return {
        ...msg,
        agent: {
          ...next,
          mcpSessionId: event.mcpSessionId,
          subjectScopeHash: event.subjectScopeHash,
          runtimeSessionId: event.runtimeSessionId,
        },
      }
    case 'text_delta': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['text_delta']
      next.presentation = [
        ...agent.presentation.filter(item => item.kind !== 'summary'),
        { kind: 'summary', sequence: event.sequence },
      ]
      return { ...msg, agent: next, content: (msg.content + payload.text).slice(-AGENT_EVENT_TEXT_MAX_CHARS) }
    }
    case 'thought_delta': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['thought_delta']
      next.thoughts = (agent.thoughts + payload.text).slice(-AGENT_EVENT_TEXT_MAX_CHARS)
      return { ...msg, agent: next }
    }
    case 'plan_updated': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['plan_updated']
      next.plan = [...payload.items]
      return { ...msg, agent: next }
    }
    case 'tool_started': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['tool_started']
      next.trace = [
        ...agent.trace,
        { callId: payload.callId, toolName: payload.toolName, args: payload.arguments, status: 'running' },
      ]
      next.presentation = [
        ...agent.presentation,
        { kind: 'tool', callId: payload.callId, sequence: event.sequence },
      ]
      return { ...msg, agent: next }
    }
    case 'tool_progress':
      return { ...msg, agent: next }
    case 'tool_completed': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['tool_completed']
      const traceStatus = payload.outcome.executionState === 'executed_failed'
        ? 'error'
        : payload.outcome.executionState === 'not_executed' ? 'cancelled' : 'done'
      next.trace = agent.trace.map((entry) =>
        entry.callId === payload.callId
          ? { ...entry, status: traceStatus, outcome: presentationOnlyOutcome(payload.outcome) }
          : entry,
      )
      // A terminal tool event is durable evidence that the authority decision
      // was consumed (approved) or that the call was terminally refused. This
      // also makes event-log replay converge without browser-local ceremony
      // acknowledgement state.
      next.confirms = agent.confirms.map(confirm => {
        if (confirm.callId !== payload.callId || !confirm.authorityVerdict) return confirm
        const phase = confirm.authorityVerdict
        return { ...confirm, phase, error: undefined }
      })
      if (payload.outcome.executionState !== 'succeeded') {
        next.terminalOutcome = presentationOnlyOutcome(payload.outcome)
      }
      return { ...msg, agent: next }
    }
    case 'tool_visualization': {
      // TICKET_1310_2: a visual tool's payload reaches the renderer here. The
      // discriminant was resolved server-side, so this fold never inspects
      // the payload's shape -- it dispatches on `kind` exactly as the mount
      // path dispatches on `guided.type`, which is what keeps the two paths
      // rendering the same component for the same DB state (AC8).
      const payload = event.payload as NormalizedAgentEventPayloadMap['tool_visualization']
      return {
        ...msg,
        agent: next,
        // Single-field, last-write-wins: `visualization` has always carried
        // exactly one payload on the mount path. A turn invoking two visual
        // tools renders the last; each still gets its own trace row.
        visualization: {
          type: payload.kind,
          guided: payload.payload as unknown as GuidedResponse,
        },
      }
    }
    case 'permission_requested': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['permission_requested']
      const governedCall = [...agent.trace].reverse().find(entry =>
        entry.toolName === payload.operation
        && !agent.confirms.some(confirm => confirm.callId === entry.callId))
      next.confirms = [
        ...agent.confirms,
        {
          callId: governedCall?.callId,
          scope: payload.scope,
          operation: payload.operation,
          args: { ...payload.requestPayload },
          boundedTarget: payload.boundedTarget,
          riskTier: payload.riskTier,
          commandPreview: payload.commandPreview,
          diffPreview: payload.diffPreview,
          expiresAt: payload.expiresAt,
          phase: 'pending',
        },
      ]
      const presentationWithoutGovernedCall = governedCall
        ? agent.presentation.filter(item => item.kind !== 'tool' || item.callId !== governedCall.callId)
        : agent.presentation
      next.presentation = [
        ...presentationWithoutGovernedCall,
        { kind: 'confirm', requestId: payload.scope.requestId, sequence: event.sequence },
        ...(governedCall
          ? [{ kind: 'tool' as const, callId: governedCall.callId, sequence: event.sequence }]
          : []),
      ]
      return { ...msg, agent: next }
    }
    case 'permission_resolved': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['permission_resolved']
      next.confirms = agent.confirms.map(confirm => {
        if (!samePermissionScope(confirm.scope, payload.scope)) return confirm
        const authorityVerdict = payload.decision === 'denied' ? 'declined' : payload.decision
        return reconcileAuthorityVerdict({ ...confirm, authorityVerdict })
      })
      return { ...msg, agent: next }
    }
    case 'file_change_proposed': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['file_change_proposed']
      next.fileChanges = [...agent.fileChanges, {
        changeId: payload.changeId,
        relativePath: payload.relativePath,
        status: 'proposed',
        diff: payload.diff,
      }]
      return { ...msg, agent: next }
    }
    case 'file_change_applied': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['file_change_applied']
      next.fileChanges = agent.fileChanges.map(change => change.changeId === payload.changeId
        ? { ...change, status: 'applied', contentHash: payload.contentHash }
        : change)
      return { ...msg, agent: next }
    }
    case 'usage_reported': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['usage_reported']
      next.inferenceUsage = payload
      return { ...msg, agent: next }
    }
    case 'governance_reported': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['governance_reported']
      next.governanceAttribution = payload
      return { ...msg, agent: next }
    }
    case 'candidate_artifact_ready': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['candidate_artifact_ready']
      next.candidate = payload
      return { ...msg, agent: next }
    }
    case 'artifact_admission_started': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['artifact_admission_started']
      next.artifactAdmission = { admissionId: payload.admissionId, status: 'running', stages: [] }
      return { ...msg, agent: next }
    }
    case 'artifact_admission_stage': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['artifact_admission_stage']
      const current = agent.artifactAdmission
      if (!current || current.admissionId !== payload.admissionId) return { ...msg, agent: next }
      const stage = {
        stageId: payload.stageId,
        label: payload.label,
        status: payload.status,
        diagnostic: payload.diagnostic,
      }
      next.artifactAdmission = {
        ...current,
        stages: [...current.stages.filter(item => item.stageId !== payload.stageId), stage],
      }
      return { ...msg, agent: next }
    }
    case 'artifact_accepted': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['artifact_accepted']
      next.status = 'completed'
      next.artifactAdmission = {
        admissionId: payload.admissionId,
        status: 'accepted',
        stages: agent.artifactAdmission?.stages ?? [],
        artifactId: payload.artifactId,
        artifactHash: payload.artifactHash,
      }
      return { ...msg, agent: next }
    }
    case 'artifact_rejected': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['artifact_rejected']
      next.status = 'failed'
      next.artifactAdmission = {
        admissionId: payload.admissionId,
        status: 'rejected',
        stages: agent.artifactAdmission?.stages ?? [],
        rejectionMessage: payload.message,
      }
      return { ...msg, agent: next }
    }
    case 'turn_failed': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['turn_failed']
      // A preceding tool_completed event already owns the same terminal cause.
      // Keep that exact projection instead of replacing it with a generic turn
      // wrapper; either way MessageBubble renders this single state slot once.
      if (!agent.terminalOutcome) next.terminalOutcome = presentationOnlyOutcome(payload.outcome)
      next.errorStage = payload.stage
      next.status = 'failed'
      return { ...msg, agent: next }
    }
    case 'turn_cancelled': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['turn_cancelled']
      next.status = 'cancelled'
      if (!agent.terminalOutcome) next.terminalOutcome = presentationOnlyOutcome(payload.outcome)
      next.confirms = agent.confirms.map(confirm => isTerminalConfirmPhase(confirm.phase)
        ? confirm
        : { ...confirm, phase: 'cancelled', authorityVerdict: 'cancelled' })
      return { ...msg, agent: next }
    }
    case 'turn_completed': {
      const payload = event.payload as NormalizedAgentEventPayloadMap['turn_completed']
      if (!agent.candidate) next.status = 'completed'
      const content = payload.text && payload.text !== msg.content ? payload.text : msg.content
      next.presentation = [
        ...agent.presentation.filter(item => item.kind !== 'summary'),
        { kind: 'summary', sequence: event.sequence },
      ]
      return { ...msg, agent: next, content }
    }
  }
}

function wrongScope(agent: AgentTurnState, event: AgentEvent): boolean {
  return (agent.admittedContextFingerprint !== undefined
      && agent.admittedContextFingerprint !== event.admittedContextFingerprint)
    || (agent.runtimeId !== undefined && agent.runtimeId !== event.runtime.runtimeId)
    || (agent.taskId !== undefined && agent.taskId !== event.task.taskId)
    || (agent.workspaceId !== undefined && agent.workspaceId !== event.workspace.workspaceId)
    || (agent.mcpSessionId !== undefined && agent.mcpSessionId !== event.mcpSessionId)
    || (agent.subjectScopeHash !== undefined && agent.subjectScopeHash !== event.subjectScopeHash)
    || (agent.runtimeSessionId !== undefined && agent.runtimeSessionId !== event.runtimeSessionId)
}

export function applyAgentEvent(
  msg: ChatMessage,
  event: AgentEvent,
  receivedAt = Date.now(),
): ChatMessage {
  const agent = msg.agent
  if (!agent || agent.turnId !== event.turnId) return msg
  if (wrongScope(agent, event)) {
    return {
      ...msg,
      agent: {
        ...agent,
        status: 'failed',
        protocolError: protocolOutcome('protocol_wrong_scope', 'agentOutcome.protocolWrongScope', 'agentOutcome.refreshGuide'),
      },
    }
  }
  if (agent.seenEventIds.includes(event.eventId) || event.sequence <= agent.lastSeq) return msg
  if (event.sequence > agent.lastSeq + 1) {
    if (Object.keys(agent.pendingEvents).length >= AGENT_EVENT_REORDER_BUFFER_MAX) {
      return {
        ...msg,
        agent: {
          ...agent,
          status: 'failed',
          protocolError: protocolOutcome('protocol_buffer_exceeded', 'agentOutcome.protocolBufferExceeded', 'agentOutcome.refreshGuide'),
        },
      }
    }
    return {
      ...msg,
      agent: {
        ...agent,
        pendingEvents: { ...agent.pendingEvents, [event.sequence]: event },
        gapStartedAt: agent.gapStartedAt ?? receivedAt,
      },
    }
  }

  let reduced = reduceOrderedEvent(msg, event)
  while (reduced.agent) {
    const nextSequence = reduced.agent.lastSeq + 1
    const buffered = reduced.agent.pendingEvents[nextSequence]
    if (!buffered) break
    const { [nextSequence]: _removed, ...remaining } = reduced.agent.pendingEvents
    reduced = {
      ...reduced,
      agent: { ...reduced.agent, pendingEvents: remaining },
    }
    reduced = reduceOrderedEvent(reduced, buffered)
  }
  if (reduced.agent && Object.keys(reduced.agent.pendingEvents).length === 0) {
    reduced = { ...reduced, agent: { ...reduced.agent, gapStartedAt: undefined } }
  }
  return reduced
}

export function expireAgentEventGap(msg: ChatMessage, now = Date.now()): ChatMessage {
  const agent = msg.agent
  if (!agent?.gapStartedAt || now - agent.gapStartedAt < AGENT_EVENT_GAP_TIMEOUT_MS) return msg
  return {
    ...msg,
    agent: {
      ...agent,
      status: 'failed',
      protocolError: protocolOutcome('protocol_gap_timeout', 'agentOutcome.protocolGapTimeout', 'agentOutcome.refreshGuide'),
    },
  }
}

function samePermissionScope(
  left: AgentConfirmState['scope'],
  right: AgentConfirmState['scope'],
): boolean {
  return left.requestId === right.requestId
    && left.expectedPayloadHash === right.expectedPayloadHash
    && left.mcpSessionId === right.mcpSessionId
    && left.taskId === right.taskId
    && left.turnId === right.turnId
    && left.workspaceId === right.workspaceId
    && left.capability === right.capability
}

export { isTerminalConfirmPhase } from './types.ts'

function reconcileAuthorityVerdict(confirm: AgentConfirmState): AgentConfirmState {
  const authorityVerdict = confirm.authorityVerdict
  if (authorityVerdict === 'expired' || authorityVerdict === 'cancelled') {
    return { ...confirm, phase: authorityVerdict, error: undefined }
  }
  if (authorityVerdict && confirm.acknowledgedVerdict === authorityVerdict) {
    return { ...confirm, phase: authorityVerdict, error: undefined }
  }
  return confirm
}

function updateConfirm(
  msg: ChatMessage,
  confirmationId: string,
  update: (confirm: AgentConfirmState) => AgentConfirmState,
): ChatMessage {
  const agent = msg.agent
  if (!agent) return msg
  const confirms = agent.confirms.map((c) =>
    c.scope.requestId === confirmationId ? update(c) : c,
  )
  return { ...msg, agent: { ...agent, confirms } }
}

export function beginConfirmDecision(
  msg: ChatMessage,
  confirmationId: string,
  verdict: 'approved' | 'declined',
  now = Date.now(),
): ChatMessage {
  return updateConfirm(msg, confirmationId, confirm => {
    if (isTerminalConfirmPhase(confirm.phase) || isConfirmDecisionInFlight(confirm.phase)) return confirm
    if (Date.parse(confirm.expiresAt) <= now) {
      return {
        ...confirm,
        phase: 'pending',
        error: {
          code: 'permission_expired',
          message: 'The permission request expired. Wait for authority reconciliation.',
        },
      }
    }
    return {
      ...confirm,
      phase: 'checking-authenticator',
      attemptedVerdict: verdict,
      acknowledgedVerdict: undefined,
      error: undefined,
    }
  })
}

export function setConfirmPhase(
  msg: ChatMessage,
  confirmationId: string,
  phase: NonTerminalAgentConfirmPhase,
): ChatMessage {
  return updateConfirm(msg, confirmationId, confirm => isTerminalConfirmPhase(confirm.phase)
    ? confirm
    : { ...confirm, phase, error: undefined })
}

export function failConfirmDecision(
  msg: ChatMessage,
  confirmationId: string,
  phase: Extract<AgentConfirmPhase,
    'pending' | 'origin-ineligible' | 'authenticator-unavailable'>,
  error: AgentConfirmError,
): ChatMessage {
  return updateConfirm(msg, confirmationId, confirm => isTerminalConfirmPhase(confirm.phase)
    ? confirm
    : { ...confirm, phase, error, acknowledgedVerdict: undefined })
}

export function acknowledgeConfirmDecision(
  msg: ChatMessage,
  confirmationId: string,
  verdict: 'approved' | 'declined',
): ChatMessage {
  return updateConfirm(msg, confirmationId, confirm => {
    if (isTerminalConfirmPhase(confirm.phase) || confirm.attemptedVerdict !== verdict) return confirm
    return reconcileAuthorityVerdict({ ...confirm, acknowledgedVerdict: verdict, phase: 'submitting' })
  })
}

/** Fresh turn state for the placeholder assistant message (turn id unbound). */
export function createPendingTurnState(
  runtimeSnapshot?: GuideAgentRuntimeSnapshot,
): AgentTurnState {
  return {
    turnId: '',
    conversationId: 0,
    status: 'streaming',
    lastSeq: -1,
    admittedContextFingerprint: undefined,
    runtimeId: runtimeSnapshot?.selection.runtimeId,
    taskId: runtimeSnapshot?.selection.task.taskId,
    workspaceId: runtimeSnapshot?.selection.workspace.workspaceId,
    seenEventIds: [],
    pendingEvents: {},
    trace: [],
    confirms: [],
    presentation: [],
    thoughts: '',
    plan: [],
    fileChanges: [],
  }
}

export function bindPendingTurnState(
  state: AgentTurnState,
  handle: AgentTurnHandle,
): AgentTurnState {
  return {
    ...state,
    turnId: handle.turnId,
    conversationId: handle.conversationId,
    admittedContextFingerprint: handle.turnAdmissionFingerprint,
  }
}
