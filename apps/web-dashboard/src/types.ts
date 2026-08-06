import type {
  AgentPermissionScopeV1,
  AgentPlanItemV1,
  AgentToolOutcomeV1,
  AgentUsageV1,
  ArtifactAdmissionStageV1,
  GovernanceAttributionV1,
  NormalizedAgentEvent,
} from '@StratCraft/types'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  visualization?: Visualization
  toolCall?: ToolCallInfo
  /** TICKET_1237_4: present when this assistant message is an agent turn. */
  agent?: AgentTurnState
}

// The browser consumes the shared closed union directly. Provider-native
// adapter objects are intentionally not mirrored in renderer source.
export type AgentEvent = NormalizedAgentEvent

export interface AgentToolTraceEntry {
  callId: string
  toolName: string
  args: Record<string, unknown>
  status: 'running' | 'done' | 'error' | 'cancelled'
  /** Presentation-only projection; diagnostic evidence is not chat state. */
  outcome?: AgentToolOutcomeV1
}

export interface AgentConfirmState {
  /** Tool-call identity retained across the permission pause and resumed execution. */
  callId?: string
  scope: AgentPermissionScopeV1
  operation: string
  args: Record<string, unknown>
  boundedTarget?: string
  riskTier: 'low' | 'medium' | 'high'
  commandPreview?: string
  diffPreview?: string
  expiresAt: string
  /** Renderer ceremony state. Terminal decisions require authority reconciliation. */
  phase: AgentConfirmPhase
  attemptedVerdict?: 'approved' | 'declined'
  acknowledgedVerdict?: 'approved' | 'declined'
  authorityVerdict?: 'approved' | 'declined' | 'expired' | 'cancelled'
  error?: AgentConfirmError
}

export type AgentPresentationItem =
  | { kind: 'tool'; callId: string; sequence: number }
  | { kind: 'confirm'; requestId: string; sequence: number }
  | { kind: 'summary'; sequence: number }

export type AgentConfirmPhase =
  | 'pending'
  | 'checking-authenticator'
  | 'bootstrapping-authenticator'
  | 'origin-ineligible'
  | 'authenticator-unavailable'
  | 'awaiting-user-verification'
  | 'submitting'
  | 'approved'
  | 'declined'
  | 'expired'
  | 'cancelled'

export type NonTerminalAgentConfirmPhase = Exclude<
  AgentConfirmPhase,
  'approved' | 'declined' | 'expired' | 'cancelled'
>

export interface AgentConfirmError {
  code: string
  message: string
  status?: number
  details?: Readonly<Record<string, unknown>>
}

export function isTerminalConfirmPhase(phase: AgentConfirmPhase): boolean {
  return phase === 'approved'
    || phase === 'declined'
    || phase === 'expired'
    || phase === 'cancelled'
}

export function isConfirmDecisionInFlight(phase: AgentConfirmPhase): boolean {
  return phase === 'checking-authenticator'
    || phase === 'bootstrapping-authenticator'
    || phase === 'awaiting-user-verification'
    || phase === 'submitting'
}

export function isConfirmSubmissionAllowed(confirm: AgentConfirmState): boolean {
  return !isTerminalConfirmPhase(confirm.phase)
    && !isConfirmDecisionInFlight(confirm.phase)
    && confirm.error?.code !== 'permission_request_invalid'
    && confirm.error?.code !== 'permission_expired'
}

export type AgentTurnStatus = 'streaming' | 'cancelling' | 'completed' | 'cancelled' | 'failed'

export interface AgentTurnState {
  turnId: string
  conversationId: number
  status: AgentTurnStatus
  /** Highest applied event seq; events with seq <= lastSeq are dropped. */
  lastSeq: number
  admittedContextFingerprint?: string
  runtimeId?: string
  taskId?: string
  workspaceId?: string
  mcpSessionId?: string
  subjectScopeHash?: string
  runtimeSessionId?: string
  seenEventIds: string[]
  pendingEvents: Record<number, AgentEvent>
  gapStartedAt?: number
  trace: AgentToolTraceEntry[]
  confirms: AgentConfirmState[]
  /** Causal render order, derived only from the authoritative event sequence. */
  presentation: AgentPresentationItem[]
  thoughts: string
  plan: AgentPlanItemV1[]
  fileChanges: Array<{
    changeId: string
    relativePath: string
    status: 'proposed' | 'applied'
    diff?: string
    contentHash?: string
  }>
  inferenceUsage?: AgentUsageV1
  governanceAttribution?: GovernanceAttributionV1
  candidate?: {
    candidateId: string
    artifactKind: 'strategy' | 'signal'
    manifestHash: string
  }
  artifactAdmission?: {
    admissionId: string
    status: 'running' | 'accepted' | 'rejected'
    stages: ArtifactAdmissionStageV1[]
    artifactId?: string
    artifactHash?: string
    rejectionMessage?: string
  }
  terminalOutcome?: AgentToolOutcomeV1
  errorStage?: import('@StratCraft/types').AgentFailureStage
  protocolError?: AgentToolOutcomeV1
}

export interface Visualization {
  type: 'iframe' | 'json' | 'table' | 'choice_card' | 'wizard_step' | 'info_panel' | 'flow_diagram' | 'field_manifest' | 'workload_prelaunch_review' | 'ai_studio_action'
  src?: string
  data?: unknown
  title?: string
  height?: number
  guided?: GuidedResponse
  /**
   * TICKET_1370 AC16: a newer resolution of the same negotiation has replaced
   * this one. The card still renders as history, but must not be actionable --
   * acting on it would submit an obsolete plan fingerprint.
   */
  superseded?: boolean
}

/**
 * TICKET_1370 AC16: an edit round-trip returns a freshly resolved review that
 * replaces the one the user acted on. Marking the earlier card superseded is
 * what stops the stale card -- whose immutable `validationErrors` can never
 * clear -- from remaining actionable beside its own replacement.
 *
 * Scoped to `workload_prelaunch_review` because that is the only visualization
 * carrying a single-use plan fingerprint; other cards are independent.
 */
export function supersedeStalePrelaunchReviews(
  messages: ChatMessage[],
  replacement: ChatMessage,
): ChatMessage[] {
  if (replacement.visualization?.type !== 'workload_prelaunch_review') return messages
  return messages.map(message => (
    message.visualization?.type === 'workload_prelaunch_review'
      && !message.visualization.superseded
      ? { ...message, visualization: { ...message.visualization, superseded: true } }
      : message
  ))
}

export interface ToolCallInfo {
  name: string
  args: Record<string, unknown>
  result?: unknown
  status: 'pending' | 'done' | 'error'
}

export interface McpoTool {
  name: string
  description: string
  endpoint: string
}

/** Result returned to an interactive card after its guided action settles. */
export type GuidedActionDispatchResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string }

// ── TICKET_992_6: Guided Agent types ──────────────────────────────────

export type GuidedResponse =
  | GuidedChoiceCard
  | GuidedWizardStep
  | GuidedInfoPanel
  | GuidedToolCall
  | GuidedFlowDiagram
  | GuidedFieldManifest
  | GuidedWorkloadPrelaunchReview
  | GuidedAIStudioAction

export interface GuidedWorkloadPrelaunchReview {
  type: 'workload_prelaunch_review'
  review: {
    contractVersion: string
    specificationId: string
    specificationVersion: string
    derivedContextVersion: string
    // TICKET_1370 R9/R10: `visibleWhen` carries source-conditional presentation
    // and `dateBounds` the authoritative picker range, both decided by the
    // shared owner rather than by surface-local parameter-name logic.
    // TICKET_1370 R12/AC38: `label` is the authoritative user-facing name; `id`
    // is a contract identifier and must never reach the user as a label.
    parameters: Array<{ id: string; label: string; control: string; value: unknown; provenance: 'explicit' | 'persisted' | 'default' | 'derived'; defaultSource?: string; editable: boolean; impact: string[]; supportedChoices?: unknown[]; validation?: { minimum?: number; maximum?: number; step?: number }; visibleWhen?: { parameterId: string; equals: unknown[] }; dateBounds?: { minimumDate?: string; maximumDate?: string } }>
    missingRequired: Array<{ id: string; control: string; label: string; supportedChoices?: unknown[]; validationRequirements?: string; validation?: { minimum?: number; maximum?: number; step?: number }; visibleWhen?: { parameterId: string; equals: unknown[] }; dateBounds?: { minimumDate?: string; maximumDate?: string } }>
    // TICKET_1370 R12/AC37: inactive input modes of a conditional decision, so
    // switching the source reveals the other control without a round trip.
    // Optional on the wire: an older review document simply has no alternatives.
    availableAlternatives?: Array<{ id: string; control: string; label: string; supportedChoices?: unknown[]; validationRequirements?: string; validation?: { minimum?: number; maximum?: number; step?: number }; visibleWhen?: { parameterId: string; equals: unknown[] }; dateBounds?: { minimumDate?: string; maximumDate?: string } }>
    validationErrors: Array<{ code: string; parameterIds: string[]; message: string; remediation: string }>
    estimatedWork: Record<string, unknown>
    planFingerprint: string
    confirmationRequired: true
  }
}

export interface GuidedChoiceCard {
  type: 'choice_card'
  title: string
  subtitle?: string
  choices: GuidedChoice[]
}

export interface GuidedChoice {
  id: string
  title: string
  description: string
  icon: string
  badge?: string
  action: GuidedAction
}

export type GuidedAction =
  | { type: 'guided'; context: string }
  | { type: 'wizard'; wizard_id: string }
  | { type: 'tool'; tool_name: string; args: Record<string, unknown> }
  | { type: 'navigate'; page: string }

export interface GuidedWizardStep {
  type: 'wizard_step'
  wizard_id: string
  step_index: number
  total_steps: number
  title: string
  description?: string
  fields: WizardField[]
  back_enabled: boolean
  /** Accumulated wizard state from all previous steps. */
  accumulated_data?: Record<string, unknown>
  /** TICKET_1035_1: action to execute when user confirms the final step. */
  confirm_action?: GuidedAction
}

export type WizardField =
  | { type: 'select'; name: string; label: string; options: WizardOption[]; default?: string }
  | { type: 'multi_select'; name: string; label: string; options: WizardOption[]; default?: string[] }
  | { type: 'number'; name: string; label: string; min?: number; max?: number; default?: number }
  | { type: 'text'; name: string; label: string; placeholder?: string }
  | { type: 'info_row'; label: string; value: string }

export interface WizardOption {
  value: string
  label: string
  description?: string
}

export interface GuidedInfoPanel {
  type: 'info_panel'
  title: string
  sections: Array<{ heading: string; body: string }>
  iframe_url?: string
  iframe_height?: number
  next_action?: GuidedAction
}

export interface GuidedToolCall {
  type: 'tool_call'
  tool_name: string
  args: Record<string, unknown>
  explanation: string
}

export interface GuidedFlowDiagram {
  type: 'flow_diagram'
  title: string
  subtitle?: string
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface FlowNode {
  id: string
  label: string
  description?: string
  icon: string
  thumbnail?: string
  badge?: string
  status: 'recommended' | 'available' | 'completed' | 'locked'
  action?: GuidedAction
}

export interface FlowEdge {
  from: string
  to: string
  label?: string
  style: 'sequential' | 'branch'
}

// ── TICKET_1082 Phase 3: Field Manifest ─────────────────────────────

export interface GuidedFieldManifest {
  type: 'field_manifest'
  action_name: string
  explanation: string
  fields: ManifestField[]
}

export interface ManifestField {
  name: string
  label: string
  field_type: 'select' | 'multi_select' | 'number' | 'text' | 'date_range'
  required: boolean
  data_source: DataSource
  default_hint?: string
  description?: string
  depends_on?: string
}

export type DataSource =
  | { type: 'strategy_signals' }
  | { type: 'trained_signals' }
  | { type: 'available_providers' }
  | { type: 'provider_symbols'; provider_field: string }
  | { type: 'timeframes' }
  | { type: 'provider_date_range'; provider_field: string; symbol_field: string }
  | { type: 'strategies' }
  | { type: 'templates' }
  | { type: 'static'; options: Array<{ value: string; label: string }> }

// ── TICKET_1375: AI Studio Action Card ──────────────────────────────────

export interface GuidedAIStudioAction {
  type: 'ai_studio_action'
  session_id: string
  message?: string
  strategy_rules?: Record<string, unknown>
  available_actions: string[]
  strategy_code?: string
  class_name?: string
  metadata?: Record<string, unknown>
}
