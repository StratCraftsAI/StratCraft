import type { GovernanceAttributionV1 } from './agent-attribution';

export const AGENT_RUNTIME_CONTRACT_VERSION = '1.0.0' as const;
export const AGENT_FINGERPRINT_SCHEMA_VERSION = '1' as const;
/**
 * TICKET_1354: 2.1 adds the immutable governance_reported event. TICKET_1352
 * 2.0 removed unvalidated result/message strings from terminal
 * events and replaces them with the canonical Agent outcome contract. This is
 * intentionally a major contract change: an older consumer must not mistake
 * diagnostic transport text for user-facing prose.
 */
export const NORMALIZED_AGENT_EVENT_CONTRACT_VERSION = '2.1.0' as const;
export const AGENT_USAGE_CONTRACT_VERSION = '1.0.0' as const;
export const NORMALIZED_AGENT_EVENT_TYPES = [
  'turn_started',
  'text_delta',
  'thought_delta',
  'plan_updated',
  'tool_started',
  'tool_progress',
  'tool_completed',
  'tool_visualization',
  'permission_requested',
  'permission_resolved',
  'governance_reported',
  'file_change_proposed',
  'file_change_applied',
  'usage_reported',
  'candidate_artifact_ready',
  'artifact_admission_started',
  'artifact_admission_stage',
  'artifact_accepted',
  'artifact_rejected',
  'turn_failed',
  'turn_cancelled',
  'turn_completed',
] as const;

/**
 * TICKET_1310_2: the closed set of renderable payload discriminants an agent
 * tool may hand to the client. Mirrors the renderable arm of the MCP
 * `GuidedResponse` union; `tool_call` is deliberately absent -- it is an
 * execution instruction the mount path auto-runs, not something rendered as a
 * component, so it must not travel on this channel.
 */
export const AGENT_VISUALIZATION_KINDS = [
  'choice_card',
  'wizard_step',
  'info_panel',
  'flow_diagram',
  'field_manifest',
  'workload_prelaunch_review',
  'ai_studio_action',
] as const;

export type AgentVisualizationKind = typeof AGENT_VISUALIZATION_KINDS[number];

export type AgentToolExecutionState =
  | 'succeeded'
  | 'executed_failed'
  | 'not_executed';

export type AgentTerminalReason =
  | 'permission_denied'
  | 'permission_expired'
  | 'permission_cancelled'
  | 'user_cancelled'
  | 'session_cancelled'
  | 'tool_failed'
  | 'turn_failed';

export type AgentOutcomeSeverity = 'info' | 'warning' | 'error';
export type AgentOutcomeParameter = string | number;

export interface AgentOutcomePresentationV1 {
  readonly messageKey: string;
  readonly parameters: Readonly<Record<string, AgentOutcomeParameter>>;
  readonly recoveryKey?: string;
  readonly severity: AgentOutcomeSeverity;
}

/**
 * The only browser-facing semantic representation of a tool or terminal
 * outcome. Transport/provider text is never a presentation fallback.
 */
interface AgentToolOutcomeBaseV1 {
  readonly code: string;
  readonly presentation: AgentOutcomePresentationV1;
  readonly diagnostic?: {
    readonly safeSummary?: string;
    readonly correlationId?: string;
  };
}

export type AgentToolOutcomeV1 = AgentToolOutcomeBaseV1 & (
  | {
      readonly executionState: 'succeeded';
      readonly terminalReason?: never;
    }
  | {
      readonly executionState: Exclude<AgentToolExecutionState, 'succeeded'>;
      readonly terminalReason: AgentTerminalReason;
    }
);

export const AGENT_RUNTIME_IDS = [
  'stratcraft',
  'acp',
  'codex',
  'github-copilot',
  'claude-agent',
] as const;
export type AgentRuntimeId = typeof AGENT_RUNTIME_IDS[number];

export const AGENT_ENTITLEMENT_SOURCES = [
  'stratcraft-plan',
  'provider-api-key',
  'provider-subscription',
  'local',
] as const;
export type EntitlementSource = typeof AGENT_ENTITLEMENT_SOURCES[number];

export type AgentRuntimeAuthMethod =
  | 'none'
  | 'stratcraft-session'
  | 'api-key'
  | 'provider-login'
  | 'cloud-provider';

export type AgentRuntimeOperatingSystem = 'linux' | 'darwin' | 'win32';

export interface AgentRuntimeDescriptor {
  readonly runtimeId: AgentRuntimeId;
  readonly displayName: string;
  readonly adapterContractVersion: string;
  readonly supportedOperatingSystems: readonly AgentRuntimeOperatingSystem[];
  readonly allowedAuthMethods: readonly AgentRuntimeAuthMethod[];
}

export interface AgentRuntimeCapabilities {
  readonly contractVersion: typeof AGENT_RUNTIME_CONTRACT_VERSION;
  readonly nativeVersion: string;
  readonly protocolVersion: string;
  readonly resume: boolean;
  readonly permissions: boolean;
  readonly filesystem: 'none' | 'workspace';
  readonly terminal: boolean;
  readonly mcp: boolean;
  readonly plan: boolean;
  readonly usage: boolean;
  readonly fileDiff: boolean;
}

interface AgentRuntimeStatusBase {
  readonly runtimeId: AgentRuntimeId;
  readonly checkedAt: string;
  readonly correlationId: string;
}

export type AgentRuntimeStatus =
  | (AgentRuntimeStatusBase & {
      readonly status: 'ready';
      readonly capabilities: AgentRuntimeCapabilities;
    })
  | (AgentRuntimeStatusBase & {
      readonly status:
        | 'not_installed'
        | 'auth_required'
        | 'unsupported_version'
        | 'unavailable';
      readonly remediation: string;
    });

export interface VersionedContentReference {
  readonly id: string;
  readonly version: string;
  readonly contentHash: string;
}

export interface PermissionPolicyReference extends VersionedContentReference {
  readonly kind: 'permission-policy';
}

export interface ResearchPolicyReference extends VersionedContentReference {
  readonly kind: 'research-policy';
}

export interface CapabilityProfileReference extends VersionedContentReference {
  readonly kind: 'capability-profile';
}

export interface TaskWorkspaceIdentity {
  readonly workspaceId: string;
  readonly workspaceVersion: string;
  readonly workspaceContentHash: string;
}

export interface ResearchTaskIdentity {
  readonly taskId: string;
  readonly taskSpecVersion: string;
  readonly taskSpecContentHash: string;
}

export interface ToolCapabilityRequest {
  readonly capabilityProfile: CapabilityProfileReference;
  /**
   * Semantic capability names are policy inputs. Exact tool IDs are resolved
   * only from the live registry during admission.
   */
  readonly semanticCapabilities: readonly string[];
}

export interface AdmittedToolDefinition {
  readonly toolId: string;
  readonly jsonSchemaHash: string;
}

export interface ToolCapabilityGrant {
  readonly tools: readonly AdmittedToolDefinition[];
  readonly toolGrantHash: string;
}

export interface AgentInferenceRoute {
  readonly runtimeProviderId: string;
  readonly catalogProviderId?: string;
  readonly modelId: string;
}

export interface GuideAgentSelection {
  readonly fingerprintSchemaVersion: typeof AGENT_FINGERPRINT_SCHEMA_VERSION;
  readonly runtimeId: AgentRuntimeId;
  readonly entitlementSource: EntitlementSource;
  readonly inferenceRoute: AgentInferenceRoute;
  readonly locale: string;
  readonly task: ResearchTaskIdentity;
  readonly workspace: TaskWorkspaceIdentity;
  readonly permissionPolicy: PermissionPolicyReference;
  readonly researchPolicy: ResearchPolicyReference;
  readonly capabilityProfile: CapabilityProfileReference;
}

export interface GuideAgentRuntimeSnapshot {
  readonly selection: GuideAgentSelection;
  readonly selectionFingerprint: string;
  readonly runtimeCapabilityHash: string;
  readonly runtimeStatus: AgentRuntimeStatus;
  readonly snapshotRevision: number;
  readonly selectionInvalidated: boolean;
  readonly resubmissionRequired: boolean;
  readonly capabilityDelta: readonly AgentAdmissionFieldDelta[];
  readonly choices: GuideAgentChoiceCatalog;
}

export type GuideAgentChoiceAvailability = 'selectable' | 'unavailable';

export interface GuideAgentChoice<T> {
  readonly id: string;
  readonly label: string;
  readonly availability: GuideAgentChoiceAvailability;
  readonly unavailableReason?: string;
  readonly remediationAction?: string;
  readonly value: T;
}

export interface GuideAgentRuntimeChoice {
  readonly descriptor: AgentRuntimeDescriptor;
  readonly status: AgentRuntimeStatus;
  readonly availability: GuideAgentChoiceAvailability;
  readonly unavailableReason?: string;
  readonly remediationAction?: string;
}

export interface GuideAgentChoiceCatalog {
  readonly runtimes: readonly GuideAgentRuntimeChoice[];
  readonly entitlements: readonly GuideAgentChoice<EntitlementSource>[];
  readonly workspaces: readonly GuideAgentChoice<TaskWorkspaceIdentity>[];
  readonly permissionPolicies: readonly GuideAgentChoice<PermissionPolicyReference>[];
  readonly tasks: readonly GuideAgentChoice<ResearchTaskIdentity>[];
  readonly researchPolicies: readonly GuideAgentChoice<ResearchPolicyReference>[];
  readonly capabilityProfiles: readonly GuideAgentChoice<CapabilityProfileReference>[];
  readonly projects: readonly GuideAgentChoice<{ readonly projectId: string }>[];
  readonly dataCapabilities: readonly GuideAgentChoice<VersionedContentReference>[];
  readonly commandPolicies: readonly GuideAgentChoice<VersionedContentReference>[];
  readonly resourcePolicies: readonly GuideAgentChoice<VersionedContentReference>[];
  readonly acceptanceProfiles: readonly GuideAgentChoice<VersionedContentReference>[];
  readonly inputArtifacts: readonly GuideAgentChoice<ArtifactReferenceV1>[];
}

export type AgentUsageSource =
  | 'provider_reported'
  | 'server_reported'
  | 'unavailable';
export type AgentUsageCompleteness = 'complete' | 'partial' | 'unavailable';
export type AgentInferencePayerClass =
  | 'user'
  | 'stratcraft'
  | 'provider'
  | 'local';

/** The owning stage that produced a terminal Agent turn failure. */
export type AgentFailureStage =
  | 'tool_execution'
  | 'llm_inference'
  | 'turn_admission'
  | 'artifact_admission'
  | 'attribution_persistence'
  /**
   * TICKET_1303_1_3: a delegated (self-driving) runtime failed while executing
   * the turn it owns. Distinct from `llm_inference`, which attributes the
   * failure to the host's own inference call -- for a delegated runtime the
   * host makes no such call, so reusing that stage would misdirect every
   * diagnostic for acp/codex/github-copilot/claude-agent.
   */
  | 'runtime_execution'
  | 'internal';

/**
 * Provider-neutral usage projection. TICKET_1303_1_8 remains the owner of
 * persistence and attribution ledgers; this public event payload prevents the
 * browser from inferring payer or route from provider-native responses.
 */
export interface AgentUsageV1 {
  readonly contractVersion: typeof AGENT_USAGE_CONTRACT_VERSION;
  readonly providerEventId?: string;
  readonly taskId: string;
  readonly turnId: string;
  readonly admissionFingerprint: string;
  readonly runtimeId: AgentRuntimeId;
  readonly entitlementSource: EntitlementSource;
  readonly payerClass: AgentInferencePayerClass;
  readonly providerId: string;
  readonly modelId: string;
  readonly source: AgentUsageSource;
  readonly completeness: AgentUsageCompleteness;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly providerCost?: string;
  readonly currency?: string;
  readonly pricingReference?: string;
}

export interface NormalizedAgentEventEnvelope {
  readonly contractVersion: typeof NORMALIZED_AGENT_EVENT_CONTRACT_VERSION;
  readonly eventId: string;
  readonly correlationId: string;
  readonly mcpSessionId: string;
  /** One-way digest of the admitted subject; never a bearer or provider identity object. */
  readonly subjectScopeHash: string;
  readonly runtime: {
    readonly runtimeId: AgentRuntimeId;
    readonly adapterContractVersion: string;
    readonly nativeVersion: string;
    readonly protocolVersion: string;
  };
  readonly runtimeSessionId: string;
  readonly task: ResearchTaskIdentity;
  readonly workspace: TaskWorkspaceIdentity;
  readonly conversationId: string;
  readonly turnId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly admittedContextFingerprint: string;
}

export interface AgentPlanItemV1 {
  readonly id: string;
  readonly text: string;
  readonly status: 'pending' | 'in_progress' | 'completed';
}

export interface AgentPermissionScopeV1 {
  readonly mcpSessionId: string;
  readonly taskId: string;
  readonly turnId: string;
  readonly workspaceId: string;
  readonly requestId: string;
  readonly capability: string;
  readonly expectedPayloadHash: string;
}

export interface ArtifactAdmissionStageV1 {
  readonly stageId: string;
  readonly label: string;
  readonly status: 'pending' | 'running' | 'passed' | 'failed';
  readonly diagnostic?: string;
}

export type NormalizedAgentEventPayloadMap = {
  turn_started: {
    readonly status: 'admitted';
  };
  text_delta: {
    readonly text: string;
  };
  thought_delta: {
    readonly text: string;
    readonly visibility: 'visible' | 'summary';
  };
  plan_updated: {
    readonly items: readonly AgentPlanItemV1[];
  };
  tool_started: {
    readonly callId: string;
    readonly toolName: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  };
  tool_progress: {
    readonly callId: string;
    readonly message: string;
    readonly completed?: number;
    readonly total?: number;
  };
  tool_completed: {
    readonly callId: string;
    readonly toolName: string;
    readonly outcome: AgentToolOutcomeV1;
  };
  /**
   * TICKET_1310_2: a tool declared visual in the registry returned a payload
   * the client can render as a component. Emitted in addition to -- never
   * instead of -- `tool_completed`, so the diagnostic trace is unaffected.
   *
   * `kind` is resolved server-side from the parsed payload's discriminant; the
   * client dispatches on it and never sniffs `payload`'s shape.
   */
  tool_visualization: {
    readonly callId: string;
    readonly toolName: string;
    readonly kind: AgentVisualizationKind;
    readonly payload: Readonly<Record<string, unknown>>;
  };
  permission_requested: {
    readonly scope: AgentPermissionScopeV1;
    readonly operation: string;
    readonly requestPayload: Readonly<Record<string, unknown>>;
    readonly boundedTarget?: string;
    readonly riskTier: 'low' | 'medium' | 'high';
    readonly commandPreview?: string;
    readonly diffPreview?: string;
    readonly expiresAt: string;
  };
  permission_resolved: {
    readonly scope: AgentPermissionScopeV1;
    readonly decision: 'approved' | 'denied' | 'expired' | 'cancelled';
    readonly resolvedAt: string;
  };
  /** Exact immutable local governance record produced by the decision owner. */
  governance_reported: GovernanceAttributionV1;
  file_change_proposed: {
    readonly changeId: string;
    readonly relativePath: string;
    readonly diff: string;
  };
  file_change_applied: {
    readonly changeId: string;
    readonly relativePath: string;
    readonly contentHash: string;
  };
  usage_reported: AgentUsageV1;
  candidate_artifact_ready: {
    readonly candidateId: string;
    readonly artifactKind: 'strategy' | 'signal';
    readonly manifestHash: string;
  };
  artifact_admission_started: {
    readonly candidateId: string;
    readonly admissionId: string;
  };
  artifact_admission_stage: ArtifactAdmissionStageV1 & {
    readonly admissionId: string;
  };
  artifact_accepted: {
    readonly admissionId: string;
    readonly artifactId: string;
    readonly artifactHash: string;
  };
  artifact_rejected: {
    readonly admissionId: string;
    readonly stageId: string;
    readonly code: string;
    readonly message: string;
  };
  turn_failed: {
    readonly stage: AgentFailureStage;
    readonly outcome: AgentToolOutcomeV1;
  };
  turn_cancelled: {
    readonly outcome: AgentToolOutcomeV1;
  };
  turn_completed: {
    readonly text: string;
    readonly toolCallCount: number;
  };
};

export type NormalizedAgentEventType = typeof NORMALIZED_AGENT_EVENT_TYPES[number];
export type NormalizedAgentEvent<
  T extends NormalizedAgentEventType = NormalizedAgentEventType,
> = NormalizedAgentEventEnvelope & {
  readonly type: T;
  readonly payload: NormalizedAgentEventPayloadMap[T];
};

/**
 * The single contract every producer of normalized Agent events satisfies.
 *
 * TICKET_1303_1_3 root cause: each adapter previously declared its own
 * structurally identical sink (`CodexNormalizedEventSink`,
 * `AcpNormalizedEventSink`). Because no shared interface existed, nothing
 * forced an adapter to emit the full Artifact lifecycle, and the ACP path
 * silently shipped without a terminal `artifact_accepted`/`artifact_rejected`
 * -- which leaves the browser reducer pending forever, since candidate
 * completion stays non-terminal until an admission result arrives. Adapter
 * sinks now extend this type so the obligation is expressed in one place.
 */
export interface NormalizedAgentEventSink {
  emit<T extends NormalizedAgentEventType>(
    type: T,
    payload: NormalizedAgentEventPayloadMap[T],
  ): void;
}

export interface AdmittedAgentTurnContext {
  readonly fingerprintSchemaVersion: typeof AGENT_FINGERPRINT_SCHEMA_VERSION;
  readonly mcpSessionId: string;
  readonly subjectId: string;
  readonly task: ResearchTaskIdentity;
  readonly turnId: string;
  /**
   * The owning Guide conversation, or `null` for the first turn of a NEW
   * conversation.
   *
   * TICKET_1317 root cause: this value is NOT knowable at admission. A new
   * conversation's id is minted by a post-admission write (the conversation row
   * cannot be created before admission, because the row's `user_id` is derived
   * from the admitted `mode`/`subjectId`). Admission previously substituted a
   * synthetic `new:<turnId>` placeholder and never reconciled it, so state
   * committed on turn 1 was keyed under a string that no later turn could ever
   * reproduce.
   *
   * It is therefore modelled honestly as nullable and bound exactly once by
   * `bindAdmittedConversationId` immediately after the row exists. Consumers
   * that need a durable owner MUST fail closed on `null` rather than inventing
   * a key.
   */
  readonly conversationId: string | null;
  readonly workspace: TaskWorkspaceIdentity;
  readonly runtimeId: AgentRuntimeId;
  readonly adapterContractVersion: string;
  readonly nativeVersion: string;
  readonly protocolVersion: string;
  readonly normalizedCapabilityHash: string;
  readonly entitlementSource: EntitlementSource;
  readonly inferenceRoute: AgentInferenceRoute;
  readonly permissionPolicy: PermissionPolicyReference;
  readonly researchPolicy: ResearchPolicyReference;
  readonly capabilityProfile: CapabilityProfileReference;
  readonly toolGrant: ToolCapabilityGrant;
  readonly selectionFingerprint: string;
  readonly turnAdmissionFingerprint: string;
  readonly admittedAt: string;
  readonly correlationId: string;
}

export type AgentAdmissionErrorCode =
  | 'selection_changed'
  | 'runtime_capability_changed'
  | 'runtime_not_installed'
  | 'runtime_auth_required'
  | 'runtime_version_unsupported'
  | 'runtime_unavailable'
  | 'entitlement_changed'
  | 'workspace_changed'
  | 'policy_changed'
  | 'tool_grant_changed'
  | 'session_required'
  | 'selection_required'
  | 'selection_invalid'
  | 'no_byok_key'
  | 'auth_required'
  | 'identity_changed';

export interface AgentAdmissionFieldDelta {
  readonly path: string;
  readonly oldPublicHash: string;
  readonly newPublicHash: string;
}

export interface AgentAdmissionErrorDetail {
  readonly code: AgentAdmissionErrorCode;
  readonly message: string;
  readonly correlationId: string;
  readonly changedFields: readonly AgentAdmissionFieldDelta[];
  readonly refreshRequired: boolean;
  readonly resubmissionRequired: boolean;
}

export interface AgentRuntimeSession {
  readonly runtimeId: AgentRuntimeId;
  readonly nativeSessionId: string;
  readonly admittedContext: AdmittedAgentTurnContext;
}

export interface AgentRuntimeTurnRequest {
  readonly turnId: string;
  readonly message: string;
}

export interface AgentRuntimeAdapter<
  TSession extends AgentRuntimeSession = AgentRuntimeSession,
  TTurnRequest = AgentRuntimeTurnRequest,
  TTurnResult = void,
  TSessionOptions = void,
> {
  readonly descriptor: AgentRuntimeDescriptor;
  probe(correlationId: string): Promise<AgentRuntimeStatus>;
  createSession(
    context: AdmittedAgentTurnContext,
    options: TSessionOptions,
  ): Promise<TSession>;
  resumeSession(
    context: AdmittedAgentTurnContext,
    nativeSessionId: string,
    options: TSessionOptions,
  ): Promise<TSession>;
  runTurn(session: TSession, request: TTurnRequest): Promise<TTurnResult>;
  respondToPermission(
    session: TSession,
    confirmationId: string,
    approved: boolean,
    payload?: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  cancel(session: TSession): Promise<void>;
  close(session: TSession): Promise<void>;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON does not support non-finite numbers.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) {
      if (object[key] !== undefined) result[key] = canonicalize(object[key]);
    }
    return result;
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value} values.`);
}

/**
 * Deterministic UTF-8 JSON input for SHA-256. Callers must sort arrays that
 * represent sets before invoking this function.
 */
export function canonicalAgentJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
import type { ArtifactReferenceV1 } from './research-task';
