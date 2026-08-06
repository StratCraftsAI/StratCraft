/**
 * Global Type Declarations for Strategy Builder Plugin
 *
 * Extends Window interface to include electronAPI types
 * that are exposed by the Host's preload script.
 */

interface CredentialResult {
  success: boolean;
  error?: string;
}

interface CredentialGetResult extends CredentialResult {
  value?: string;
}

interface CredentialHasResult {
  exists: boolean;
}

interface CredentialListResult extends CredentialResult {
  keys: string[];
}

interface PluginConfigResult {
  success: boolean;
  config?: Record<string, unknown>;
  error?: string;
}

interface CredentialAuditEntry {
  timestampMillis: number;
  action: string;
  key: string;
  success: boolean;
}

interface CredentialAuditResult extends CredentialResult {
  entries: CredentialAuditEntry[];
}

// TICKET_192: API Key Validation Result
interface ApiKeyValidationData {
  valid: boolean;
  error?: string;
  errorCode?: 'INVALID_FORMAT' | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'TIMEOUT' | 'UNKNOWN';
  provider: string;
}

interface ApiKeyValidationResult {
  success: boolean;
  data?: ApiKeyValidationData;
  errorMessage?: string;
}

interface ElectronCredentialAPI {
  get(pluginId: string, key: string): Promise<CredentialGetResult>;
  set(pluginId: string, key: string, value: string): Promise<CredentialResult>;
  delete(pluginId: string, key: string): Promise<CredentialResult>;
  has(pluginId: string, key: string): Promise<CredentialHasResult>;
  list(pluginId: string): Promise<CredentialListResult>;
  getAuditLog(pluginId: string, maxEntries?: number): Promise<CredentialAuditResult>;
  // TICKET_192: API Key Validation
  validateApiKey(provider: string, apiKey: string): Promise<ApiKeyValidationResult>;
}

interface PluginManifestResult {
  success: boolean;
  manifest?: unknown;
  error?: string;
}

interface ElectronPluginAPI {
  getManifest(pluginId: string): Promise<PluginManifestResult>;
  getConfig(pluginId: string): Promise<PluginConfigResult>;
  setConfig(pluginId: string, key: string, value: unknown): Promise<CredentialResult>;
}

interface HubEntityResult {
  success: boolean;
  data?: any;
  error?: {
    code: string;
    message: string;
  };
}

interface ElectronHubAPI {
  invokeEntity(action: string, entity: string, payload: any, pluginId: string): Promise<HubEntityResult>;
  transaction(operations: any[], pluginId: string): Promise<HubEntityResult>;
  setState(key: string, value: any, pluginId: string): void;
  getState(key: string): Promise<any>;
  getAllState(): Promise<any>;
  onStateChanged(callback: (data: any) => void): () => void;
  emit(type: string, payload: any, pluginId: string): void;
  replay(type: string): Promise<any>;
  onEvent(callback: (data: any) => void): () => void;
  findFiles(query: any, pluginId: string): Promise<any>;
  resolveFile(fileId: string, pluginId: string): Promise<any>;
  removeFile(fileId: string, deleteFile: boolean, pluginId: string): Promise<any>;
}

// TICKET_184: Auth API for JWT token injection
interface ElectronAuthAPI {
  getAccessToken(): Promise<{ success: boolean; data?: string | null; error?: string }>;
  getUser(): Promise<{
    success: boolean;
    data?: {
      id: string;
      email: string;
      name: string;
      avatar?: string;
      plan: 'FREE' | 'PRO' | 'GOLD';
    } | null;
    error?: string;
  }>;
  refresh(): Promise<{ success: boolean; error?: string }>;
  login(providerName?: string): Promise<{ success: boolean; data?: { authUrl: string }; error?: string }>;
  logout(): Promise<{ success: boolean; error?: string }>;
}

// TICKET_190: LLM Access Result
interface LLMAccessResult {
  allowed: boolean;
  source: 'platform' | 'byok' | 'none';
  reason: 'platform_key' | 'byok_configured' | 'no_key' | 'default_provider' | 'no_provider_configured' | 'selected_provider_not_configured';
  requiresBYOK: boolean;
  userTier: string | null;
  configuredProvider?: string;
}

// TICKET_194/195: LLM Provider Info with verification status and models
interface LLMProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  status: 'platform' | 'verified' | 'unverified';
  defaultModel: string;
  models: Array<{ id: string; name: string }>; // TICKET_195
}

// TICKET_193: API Key Resolution Result
interface ApiKeyResolution {
  source: 'platform' | 'byok' | 'none';
  key?: string;
  providerId: string;
}

// TICKET_190: Entitlement API
// TICKET_194: Added setLLMProviderValidationStatus, getLLMProvidersWithStatus
// TICKET_193: Added resolveLLMApiKey
interface ElectronEntitlementAPI {
  canAccessLLMFeatures(selectedProvider?: string): Promise<{ success: boolean; data?: LLMAccessResult; error?: string }>;
  getConfiguredBYOKProviders(): Promise<{ success: boolean; data?: string[]; error?: string }>;
  getLLMProvidersWithStatus(): Promise<{ success: boolean; data?: LLMProviderInfo[]; error?: string }>;
  setLLMProviderValidationStatus(providerId: string, validated: boolean): Promise<{ success: boolean; error?: string }>;
  resolveLLMApiKey(providerId: string): Promise<{ success: boolean; data?: ApiKeyResolution; error?: string }>;
}

// TICKET_646 Phase 5: Catalog source for offline-badge UI gating.
type LLMCatalogSource = 'live' | 'snapshot' | 'empty';

interface LLMCatalogStatus {
  source: LLMCatalogSource;
  snapshotTimestamp: number | null;
  lastFetchAttempt: number | null;
}

// TICKET_646 Phase 3: Unified LLM Catalog API
interface ElectronLLMCatalogAPI {
  /** Returns full provider catalog (thin wrapper over getProAvailableProviders). */
  getProviders(): Promise<{
    success: boolean;
    data?: Array<{
      id: string;
      name: string;
      defaultModel: string;
      models: Array<{ id: string; name: string }>;
    }>;
    error?: string;
  }>;
  /**
   * Returns models, optionally filtered by provider id (canonical upper-case)
   * or display name. When omitted, returns the full flat model list.
   */
  getModels(providerId?: string): Promise<{
    success: boolean;
    data?: Array<{ id: string; name: string; category: string; tier?: string }>;
    error?: string;
  }>;
  /** Invalidates the in-process catalog cache; next read re-fetches. */
  refresh(): Promise<{ success: boolean; error?: string }>;
  /** TICKET_646 Phase 5: Current catalog source + snapshot metadata. */
  getStatus(): Promise<{
    success: boolean;
    data?: LLMCatalogStatus;
    error?: string;
  }>;
  /** TICKET_646 Phase 5: Subscribe to source transitions; returns unsubscribe. */
  onStatusChanged(handler: (status: LLMCatalogStatus) => void): () => void;
}

// TICKET_646_1 Phase 3: BYOK Model Discovery API
interface ElectronBYOKAPI {
  /** Fetch available models from the provider's own API using stored BYOK key. */
  getModels(providerId: string, forceRefresh?: boolean): Promise<{
    success: boolean;
    data?: Array<{ id: string; name: string }>;
    error?: string;
  }>;
}

// TICKET_205: Kronos Predictor API
interface KronosPredictionRequest {
  model: string;
  lookback: number;
  pred_len: number;
  temperature: number;
  top_p: number;
  top_k: number;
  sample_count: number;
  time_range: 'latest' | 'custom';
  start_time?: string;
  strategy_name: string;
  signal_filter: {
    filters: {
      confidence: { enabled: boolean; min_value: number };
      expected_return: { enabled: boolean; min_value: number };
      direction_filter: { enabled: boolean; mode: string };
      magnitude: { enabled: boolean; min_value: number };
      consistency: { enabled: boolean; min_value: number };
    };
    combination_logic: 'AND' | 'OR';
  };
}

interface KronosPrediction {
  direction: 'buy' | 'sell' | 'hold';
  confidence: number;
  expectedReturn: number;
  magnitude: number;
}

interface KronosSignal {
  timestamp: number;
  direction: 'buy' | 'sell';
  confidence: number;
  expectedReturn: number;
}

interface ElectronKronosAPI {
  predict(request: KronosPredictionRequest): Promise<{
    success: boolean;
    taskId?: string;
    // Synchronous result fields (TICKET_206)
    strategyCode?: string;
    className?: string;
    strategyName?: string;
    // Legacy prediction fields
    prediction?: KronosPrediction;
    error?: string;
  }>;
  cancel(taskId: string): Promise<{
    success: boolean;
    taskId?: string;
    error?: string;
  }>;
  getModels(): Promise<{
    success: boolean;
    models?: Array<{
      id: string;
      name: string;
      params: string;
      maxContext: number;
    }>;
    error?: string;
  }>;
  onProgress(callback: (data: {
    taskId: string;
    status: string;
    progress: number;
  }) => void): () => void;
  onComplete(callback: (data: {
    taskId: string;
    result: {
      success: boolean;
      // Strategy code generation result (from backend)
      strategy_code?: string;
      class_name?: string;
      strategy_name?: string;
      // Legacy prediction fields
      prediction?: KronosPrediction;
      signals?: KronosSignal[];
    };
  }) => void): () => void;
  onError(callback: (data: {
    taskId?: string;
    message: string;
  }) => void): () => void;
}

// TICKET_212: Database API for algorithm queries
// TICKET_771 Step 7: Collapse local redeclaration onto canonical shared types
// (mirrors back-test-nexus Step 2 fix). The local snake_case ambient drifted
// from the host preload (`GetAlgorithmsResult` is camelCase); plugin services
// already access camelCase fields so the ambient was the wrong one.
type AlgorithmRecord = import('@shared/types/algorithm').GetAlgorithmsRecord;

interface ElectronDatabaseAPI {
  getAlgorithms: (
    params: import('@shared/types/algorithm').GetAlgorithmsOptions,
  ) => Promise<import('@shared/types/algorithm').GetAlgorithmsResult>;
}

// TICKET_077_19: AI Conversation API
interface ConversationRecord {
  id: number;
  user_id: string;
  title: string;
  preview: string | null;
  message_count: number;
  token_usage: number;
  token_limit: number;
  strategy_rules: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface MessageRecord {
  id: number;
  conversation_id: number;
  type: 'user' | 'assistant' | 'system';
  content: string;
  token_count: number;
  metadata: string | null;
  created_at: string;
}

interface ElectronConversationAPI {
  create(data: {
    user_id: string;
    title?: string;
    preview?: string;
    token_limit?: number;
    strategy_rules?: string;
  }): Promise<{
    success: boolean;
    data?: ConversationRecord;
    error?: { code: string; message: string };
  }>;
  get(id: number): Promise<{
    success: boolean;
    data?: ConversationRecord;
    error?: { code: string; message: string };
  }>;
  list(options: {
    userId: string;
    limit?: number;
    offset?: number;
    status?: string;
  }): Promise<{
    success: boolean;
    data?: ConversationRecord[];
    error?: { code: string; message: string };
  }>;
  update(id: number, data: {
    title?: string;
    preview?: string;
    message_count?: number;
    token_usage?: number;
    token_limit?: number;
    strategy_rules?: string;
    status?: 'active' | 'archived' | 'deleted';
  }): Promise<{
    success: boolean;
    data?: ConversationRecord;
    error?: { code: string; message: string };
  }>;
  delete(id: number): Promise<{
    success: boolean;
    error?: { code: string; message: string };
  }>;
  search(userId: string, query: string, limit?: number): Promise<{
    success: boolean;
    data?: ConversationRecord[];
    error?: { code: string; message: string };
  }>;
}

interface ElectronMessageAPI {
  add(data: {
    conversation_id: number;
    type: 'user' | 'assistant' | 'system';
    content: string;
    token_count?: number;
    metadata?: string;
  }): Promise<{
    success: boolean;
    data?: {
      messageId: number;
      conversation: ConversationRecord;
    };
    error?: { code: string; message: string };
  }>;
  list(conversationId: number, options?: {
    limit?: number;
    offset?: number;
  }): Promise<{
    success: boolean;
    data?: MessageRecord[];
    error?: { code: string; message: string };
  }>;
  delete(messageId: number): Promise<{
    success: boolean;
    error?: { code: string; message: string };
  }>;
}

interface ElectronAPI {
  credential: ElectronCredentialAPI;
  plugin: ElectronPluginAPI;
  hub: ElectronHubAPI;
  strategy: {
    list(): Promise<unknown>;
    get(id: string): Promise<unknown>;
    save(data: unknown): Promise<unknown>;
    delete(id: string): Promise<unknown>;
    generate(config: unknown): Promise<{ success: boolean; strategy_code?: string; algorithmId?: string; error?: string }>;
    generateFromCatalog(config: unknown): Promise<{ success: boolean; strategy_code?: string; algorithmId?: string; error?: string }>;
    cancel(taskId: string): Promise<unknown>;
    onProgress(callback: (event: unknown, data: unknown) => void): () => void;
    onComplete(callback: (event: unknown, data: unknown) => void): () => void;
    onError(callback: (event: unknown, data: unknown) => void): () => void;
  };
  // TICKET_1208_1: Strategy Generation Background Persistence
  // Mirrors apps/desktop/src/preload/index.ts `generation` exposure.
  generation: {
    start(config: {
      pageId: string;
      strategyName: string;
      startEndpoint: string;
      pollEndpoint: string;
      requestBody: Record<string, unknown>;
      pollInterval?: number;
      timeout?: number;
    }): Promise<{ success: boolean; error?: string }>;
    cancel(pageId: string): Promise<{ success: boolean }>;
    getState(pageId: string): Promise<{
      pageId: string;
      status: 'idle' | 'generating' | 'completed' | 'failed';
      result: unknown | null;
      error: string | null;
      strategyName: string;
      startedAt: number;
    } | null>;
    onComplete(callback: (data: {
      pageId: string;
      status: string;
      strategy_code?: string;
      strategy_id?: number;
      reason_code?: string;
      language?: 'python' | 'cpp';
      includes?: string[];
      strategy_class?: string;
      error?: unknown;
    }) => void): () => void;
    onError(callback: (data: {
      pageId: string;
      errorCode: string;
      errorMessage: string;
    }) => void): () => void;
    onStatus(callback: (data: {
      pageId: string;
      status: 'idle' | 'generating' | 'completed' | 'failed';
      strategyName: string;
    }) => void): () => void;
  };
  executor?: {
    compileAlgorithm?(request: {
      algorithmId: number | string;
      sourceCode?: string;
      strategyName?: string;
    }): Promise<{
      success: boolean;
      algorithmId: string;
      status: 'pending' | 'success' | 'error';
      artifactPath?: string;
      sourceHash?: string;
      error?: string;
    }>;
    getCompilationStatus?(algorithmId: number): Promise<{
      success: boolean;
      data?: {
        algorithmId: string;
        status: string;
        error?: string;
      };
      error?: string;
    }>;
    onCompilationStatus?(callback: (data: {
      algorithmId: string;
      status: 'compiling' | 'success' | 'error';
      error?: string;
      parsedErrors?: {
        summary: string;
        errors: Array<{ line: number; column: number; severity: string; message: string }>;
        errorCount: number;
        warningCount: number;
        rawOutput: string;
      };
    }) => void): () => void;
    getValidationReport?(algorithmId: number): Promise<{
      success: boolean;
      data?: {
        task_id: string;
        code_kind: 'cpp' | 'python';
        status: 'ok' | 'fail' | 'skip';
        failed_layer?: 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';
        error_code?: string;
        error_message?: string;
        stderr_excerpt?: string;
        validation_layers: Partial<Record<
          'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6',
          {
            status: 'pass' | 'fail' | 'skip';
            errors?: string[];
            compile_time_ms?: number;
          }
        >>;
      } | null;
      error?: string;
    }>;
  };
  auth?: ElectronAuthAPI;
  entitlement: ElectronEntitlementAPI; // TICKET_190
  llmCatalog: ElectronLLMCatalogAPI; // TICKET_646 Phase 3
  byok: ElectronBYOKAPI; // TICKET_646_1 Phase 3
  kronos: ElectronKronosAPI; // TICKET_205
  database: ElectronDatabaseAPI; // TICKET_212
  conversation: ElectronConversationAPI; // TICKET_077_19
  message: ElectronMessageAPI; // TICKET_077_19
  api: {
    proxy: (req: {
      endpoint: string;
      method: string;
      body?: unknown;
      skipAuth?: boolean;
    }) => Promise<{
      status: number;
      body: string;
    }>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }

  // Host-injected nexus API (TICKET_096)
  // eslint-disable-next-line no-var
  var nexus: {
    window?: {
      showAlert(message: string, options?: { title?: string; action?: string }): Promise<void>;
      showConfirm(message: string, options?: { title?: string }): Promise<boolean>;
      showNotification(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void;
      openExternal?(url: string): void; // TICKET_190
      openView(viewId: string, options?: Record<string, unknown>): Promise<void>; // TICKET_298
      // TICKET_300_1: setBreadcrumb removed - breadcrumbs derived from VIEW_REGISTRY by Host
    };
  } | undefined;
}

export {};
