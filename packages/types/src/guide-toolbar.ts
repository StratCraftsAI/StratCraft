export type GuideProviderKind = 'plan' | 'byok' | 'local';
export type GuideProviderAvailability =
  | 'selectable'
  | 'needs_credential'
  | 'credential_error'
  | 'not_entitled';

export interface GuideToolbarProvider {
  /** Stable row identity. Plan rows use the backend catalog provider id. */
  id: string;
  name: string;
  /** Canonical runtime route when it differs from the visible row identity. */
  runtimeProviderId?: string;
  availability: GuideProviderAvailability;
  unavailableReason?: string;
  credentialHealth?: Exclude<import('./secure-store-health').CredentialHealth, { state: 'usable' | 'missing' }>;
  models: Array<{ id: string; name: string }>;
  recommendedModelId?: string;
}

export interface GuideToolbarGroup {
  kind: GuideProviderKind;
  label: string;
  providers: GuideToolbarProvider[];
}

export interface GuideLlmSelection {
  providerId: string;
  modelId: string;
  catalogProviderId?: string;
}

export interface GuideToolbarConfig {
  /** Monotonic server-owned revision for all canonical Guide configuration. */
  snapshotRevision: number;
  locale: {
    current: string;
    supported: Array<{ code: string; nativeLabel: string }>;
  };
  llm: {
    selected: GuideLlmSelection | null;
    /**
     * Persisted selection rejected by current credential, entitlement, or
     * catalog resolution. This is a non-secret recovery reference only.
     */
    invalidatedSelection?: GuideLlmSelection;
    /** SHA-256 of the canonical selected route; null when no selection is admitted. */
    selectionFingerprint: string | null;
    groups: GuideToolbarGroup[];
    selectionInvalidated?: boolean;
  };
  /** Canonical provider-neutral Agent runtime selection and probe result. */
  agent: import('./agent-runtime').GuideAgentRuntimeSnapshot | null;
}

export interface SetLlmSelectionResult {
  success: true;
  selected: GuideLlmSelection;
  selectionFingerprint: string;
  agent: import('./agent-runtime').GuideAgentRuntimeSnapshot;
  snapshot: GuideToolbarConfig;
}

export type GuideCredentialValidationStatus = 'valid' | 'invalid' | 'unknown';

export interface GuideLlmSettingsProvider {
  id: string;
  name: string;
  kind: Exclude<GuideProviderKind, 'plan'>;
  configured: boolean;
  availability: GuideProviderAvailability;
  unavailableReason?: string;
  credentialHealth?: Exclude<import('./secure-store-health').CredentialHealth, { state: 'usable' | 'missing' }>;
  credential: import('./llm-credential-meta').LLMCredentialMeta;
  validationStatus: GuideCredentialValidationStatus;
  validationMessage?: string;
  discoveredModels: Array<{ id: string; name: string }>;
  enabledModelIds: string[];
  recommendedModelId?: string;
  modelSelectionSupported: boolean;
}

export interface GuideLlmSettingsConfig {
  planProviders: GuideToolbarProvider[];
  providers: GuideLlmSettingsProvider[];
}

export interface SetLlmCredentialInput {
  provider: string;
  value: string;
  extraCredentials?: Record<string, string>;
}

export interface LlmSettingsMutationResult {
  success: true;
  providerId: string;
  toolbarRevision: number;
}

export interface SetLlmCredentialResult extends LlmSettingsMutationResult {
  models: Array<{ id: string; name: string }>;
}

export interface RefreshLlmModelsResult extends LlmSettingsMutationResult {
  models: Array<{ id: string; name: string }>;
}
