/**
 * useGenerateWorkflow - Unified Generate Workflow Hook
 *
 * Consolidates the common "Start Generate" flow used by Builder pages:
 * 1. LLM access check
 * 2. Input validation
 * 3. NamingDialog
 * 4. API execution
 * 5. Algorithm storage
 * 6. Error handling
 *
 * @see TICKET_077_D2_UNIFIED_GENERATE_WORKFLOW.md
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AUTH_PRICING_URL } from '@StratCraft/types';
import { useLLMAccess, UseLLMAccessReturn } from './useLLMAccess';
import { useEventWatchdog } from '@StratCraft/shared-ui';
import { useGenerateWorkflowStore } from './useGenerateWorkflowStore';
import { useValidateBeforeGenerate } from '../components/ui/ValidateInputBeforeGenerate';
import {
  getAlgorithmStorageService,
  AlgorithmSaveRequest,
} from '../services';
import { UI_WATCHDOG_GENERATION_MS } from '@shared/constants/timing';

/**
 * TICKET_640: Pages that do not require LLM access check.
 * Free strategy types use backend system key -- no user API key or login required.
 * Centralized here so no page needs to manually set skipLLMAccessCheck.
 *
 * Aligned with FREE_ENDPOINTS in api-client.ts and isFreeSignalSource() in
 * shared/constants/strategy-types.ts.
 */
const FREE_PAGE_IDS = new Set([
  'regime-detector-page',       // Regime Detector (indicator_detector_*)
  'entry-signal-page',          // Entry Signal (indicator_entry_*)
  'market-observer-page',       // Market Observer
  'strategy-catalog-page',      // Strategy Catalog (strategy_catalog_*)
]);

function isFreePageId(pageId: string): boolean {
  return FREE_PAGE_IDS.has(pageId);
}

/**
 * TICKET_727: Detect errors that indicate BYOK API key configuration is needed.
 * Matches backend error codes and message patterns for Basic-tier BYOK requirement.
 */
function isByokRequiredError(errorCode: string | undefined, errorMsg: string): boolean {
  if (errorCode === 'BYOK_REQUIRED' || errorCode === 'API_KEY_REQUIRED') {
    return true;
  }
  const lowerMsg = errorMsg.toLowerCase();
  return lowerMsg.includes('own llm api key') || lowerMsg.includes('own api key') || lowerMsg.includes('byok');
}

function isMessageCode(message: string): boolean {
  return /^MSG_[A-Z0-9_]+$/.test(message);
}

// =============================================================================
// Types
// =============================================================================

/**
 * Generation result from API (common structure across all endpoints)
 */
export interface GenerationResult {
  status: 'completed' | 'failed' | 'rejected' | 'processing';
  strategy_code?: string;
  strategy_id?: number;
  reason_code?: string;
  /** TICKET_010: C++23 stratforge:: code generation support */
  language?: 'python' | 'cpp';
  includes?: string[];
  strategy_class?: string;
  error?: string | { error_code?: string; error_message?: string; code?: string; message?: string };
}

/**
 * Internal generate result state
 */
export interface GenerateResultState {
  code?: string;
  error?: string;
  /** TICKET_010: C++23 stratforge:: code generation support */
  language?: 'python' | 'cpp';
}

/**
 * CodeDisplay state type
 */
export type CodeDisplayState = 'idle' | 'loading' | 'success' | 'error';

/**
 * Workflow configuration - defines how the workflow behaves for a specific page
 */
export interface GenerateWorkflowConfig<TConfig, TState> {
  /** Page identifier for analytics and session tracking */
  pageId: string;

  /** LLM provider setting */
  llmProvider: string;

  /** LLM model setting */
  llmModel: string;

  /** Default strategy name */
  defaultStrategyName?: string;

  /** Validation error message */
  validationErrorMessage?: string;

  /** Build API config from current state and strategy name */
  buildConfig: (state: TState, strategyName: string) => TConfig;

  /**
   * Validate config before API call.
   * `error` is an i18n key (e.g., `MSG_BUILDER_VALIDATION_PROMPT_MIN_LEN`)
   * resolved against the `errors` namespace; `errorParams` is passed to
   * i18next for interpolation (e.g., `{ field: 'macd' }`).
   */
  validateConfig: (config: TConfig) => {
    valid: boolean;
    error?: string;
    errorParams?: Record<string, unknown>;
  };

  /**
   * Execute API call (signal enables caller-driven cancellation).
   * @deprecated Use buildGenerationRequest for background-safe generation (TICKET_1208_1).
   * Kept for backward compatibility — pages that provide buildGenerationRequest
   * do not need executeApi.
   */
  executeApi?: (config: TConfig, signal?: AbortSignal) => Promise<GenerationResult>;

  /**
   * TICKET_1208_1: Build a generation request for the main process service.
   * Returns endpoint info + request body. The main process owns the HTTP
   * polling lifecycle, so generation survives navigation.
   */
  buildGenerationRequest?: (config: TConfig) => {
    startEndpoint: string;
    pollEndpoint: string;
    requestBody: Record<string, unknown>;
  };

  /** Build storage request from result */
  buildStorageRequest: (
    result: GenerationResult,
    state: TState,
    strategyName: string
  ) => AlgorithmSaveRequest | Promise<AlgorithmSaveRequest>;

  /**
   * Error code to message mapping.
   * @deprecated Kept for backward compatibility; new pages should omit this
   * field -- the hook now resolves error codes via i18n
   * (strategy-builder:errorCodes.XXX) automatically.
   */
  errorMessages?: Record<string, string>;

  /** Get user-friendly error message from result */
  getErrorMessage: (result: GenerationResult) => string;
}

/**
 * Workflow callbacks - optional handlers for workflow events
 */
export interface GenerateWorkflowCallbacks {
  /** Called on successful generation */
  onSuccess?: (code: string) => void;

  /** Called on generation error */
  onError?: (error: string) => void;

  /** Called when algorithm is saved */
  onSaved?: () => void;

  /** Open settings callback (for LLM access, tab param for direct navigation) */
  onSettingsClick?: (tab?: string) => void;
}

/**
 * Workflow state - returned by hook for UI binding
 */
export interface GenerateWorkflowState {
  /** Is generation in progress */
  isGenerating: boolean;

  /** Generation result */
  generateResult: GenerateResultState | null;

  /** Is naming dialog visible */
  namingDialogVisible: boolean;

  /** Is algorithm saved */
  isSaved: boolean;

  /** Current strategy name */
  strategyName: string;

  /** TICKET_650: Saved algorithm ID for compilation status tracking */
  savedAlgorithmId: number | null;

  /** TICKET_650: Whether the generated strategy is C++ */
  isCpp: boolean;

}

/**
 * Workflow actions - returned by hook for UI interaction
 */
export interface GenerateWorkflowActions {
  /** Handle button click - starts the flow (access check -> validate -> dialog) */
  handleStartGenerate: () => Promise<void>;

  /** Handle naming dialog cancel */
  handleCancelNaming: () => void;

  /** Handle naming dialog confirm - triggers actual generation */
  handleConfirmNaming: (name: string) => void;

  /** TICKET_701: Cancel in-flight generation (aborts API request, resets state) */
  cancelGeneration: () => void;

  /** Update strategy name (for sidebar input binding) */
  setStrategyName: (name: string) => void;

  /** Get CodeDisplay state */
  getCodeDisplayState: () => CodeDisplayState;

  /** Check if has previous successful result */
  hasResult: boolean;

  /** TICKET_1208_3: Reset workflow state for a fresh strategy */
  resetNewStrategy: () => void;
}

/**
 * LLM access state subset - returned by hook for ApiKeyPrompt binding
 */
export interface GenerateWorkflowLLMAccess {
  showPrompt: boolean;
  /** TICKET_518: Whether the BYOK setup dialog is showing */
  showSetupDialog: boolean;
  userTier: string | null;
  closePrompt: () => void;
  /** TICKET_518: Close setup dialog (with dismiss flag) */
  closeSetupDialog: () => void;
  /** TICKET_518: Called after setup dialog saves config */
  onSetupComplete: () => Promise<boolean>;
  openSettings: () => void;
  triggerUpgrade: () => void;
  triggerLogin: () => void;
}

/**
 * Full hook return type
 */
export interface UseGenerateWorkflowReturn {
  state: GenerateWorkflowState;
  actions: GenerateWorkflowActions;
  llmAccess: GenerateWorkflowLLMAccess;
  codeDisplayRef: React.RefObject<HTMLDivElement>;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * useGenerateWorkflow
 *
 * Unified hook for the "Start Generate" flow in Builder pages.
 *
 * @param config - Workflow configuration (API executor, validators, etc.)
 * @param callbacks - Optional event callbacks
 * @param currentState - Current page state (passed to config builders)
 * @param validationItems - Items to validate (indicators, factors, expressions)
 *
 * @example
 * ```tsx
 * const { state, actions, llmAccess, codeDisplayRef } = useGenerateWorkflow(
 *   workflowConfig,
 *   { onSettingsClick },
 *   { selectedRegime, indicatorBlocks, factorBlocks, strategies, storageMode },
 *   allRules
 * );
 *
 * // Button
 * <button onClick={actions.handleStartGenerate}>
 *   {state.isGenerating ? 'Generating...' : actions.hasResult ? 'Regenerate' : 'Start Generate'}
 * </button>
 *
 * // NamingDialog
 * <NamingDialog
 *   visible={state.namingDialogVisible}
 *   onConfirm={actions.handleConfirmNaming}
 *   onCancel={actions.handleCancelNaming}
 * />
 *
 * // ApiKeyPrompt
 * <ApiKeyPrompt
 *   isOpen={llmAccess.showPrompt}
 *   userTier={llmAccess.userTier}
 *   onConfigure={llmAccess.openSettings}
 *   onUpgrade={llmAccess.triggerUpgrade}
 *   onLogin={llmAccess.triggerLogin}
 *   onDismiss={llmAccess.closePrompt}
 * />
 *
 * // CodeDisplay
 * <div ref={codeDisplayRef}>
 *   <CodeDisplay
 *     code={state.generateResult?.code || ''}
 *     state={actions.getCodeDisplayState()}
 *     errorMessage={state.generateResult?.error}
 *   />
 * </div>
 * ```
 */
export function useGenerateWorkflow<TConfig, TState>(
  config: GenerateWorkflowConfig<TConfig, TState>,
  callbacks: GenerateWorkflowCallbacks,
  currentState: TState,
  validationItems: unknown[]
): UseGenerateWorkflowReturn {
  // TICKET_786 D.1: translate auth-utils sentinel codes to user-facing strings
  const { t: tErrors } = useTranslation('errors');
  const { t: tBuilder } = useTranslation('strategy-builder');

  const resolveMessage = useCallback((message: string): string => (
    isMessageCode(message) ? tErrors(message) : message
  ), [tErrors]);

  // ---------------------------------------------------------------------------
  // State — TICKET_1208 P6: preserved fields in Zustand, transient in useState
  // ---------------------------------------------------------------------------

  const defaultName = config.defaultStrategyName || tBuilder('common.newStrategy');
  const store = useGenerateWorkflowStore();
  const pageState = store.getPage(config.pageId, defaultName);

  const strategyName = pageState.strategyName;
  const generateResult = pageState.generateResult;
  const isSaved = pageState.isSaved;
  const savedAlgorithmId = pageState.savedAlgorithmId;

  const setStrategyName = useCallback(
    (name: string) => store.setStrategyName(config.pageId, name),
    [store, config.pageId]
  );
  const setGenerateResult = useCallback(
    (result: GenerateResultState | null) => store.setGenerateResult(config.pageId, result),
    [store, config.pageId]
  );
  const setIsSaved = useCallback(
    (saved: boolean) => store.setIsSaved(config.pageId, saved),
    [store, config.pageId]
  );
  const setSavedAlgorithmId = useCallback(
    (id: number | null) => store.setSavedAlgorithmId(config.pageId, id),
    [store, config.pageId]
  );

  // Transient state — resets on unmount (not worth preserving)
  const [isGenerating, setIsGenerating] = useState(false);
  const [namingDialogVisible, setNamingDialogVisible] = useState(false);
  // TICKET_661: All new generation produces C++ only
  const isCpp = true;

  // TICKET_701: AbortController for in-flight generation cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Refs for IPC complete handler — the useEffect subscribing to IPC events
  // runs once (deps: [useIpcGeneration, config.pageId]) so its closure would
  // capture stale values of strategyName / currentState / callbacks.  Keep refs
  // in sync with each render so the async callback always reads the latest.
  const strategyNameRef = useRef(strategyName);
  strategyNameRef.current = strategyName;
  const currentStateRef = useRef(currentState);
  currentStateRef.current = currentState;
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Ref for auto-scroll to code display
  const codeDisplayRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------------
  // LLM Access Hook
  // ---------------------------------------------------------------------------

  // TICKET_640: Auto-detect free pages
  // TICKET_644: Free pages still check LLM access on button click (handleStartGenerate),
  // but skip the automatic page-entry modal (checkOnMount) to avoid prompting immediately.
  const isFreePage = isFreePageId(config.pageId);
  const llmAccessHook: UseLLMAccessReturn = useLLMAccess({
    llmProvider: config.llmProvider,
    checkOnMount: !isFreePage,
    pageId: config.pageId,
    onOpenSettings: callbacks.onSettingsClick,
    onUpgrade: () => {
      console.log(`[GenerateWorkflow:${config.pageId}] Upgrade requested`);
      globalThis.nexus?.window?.openExternal?.(AUTH_PRICING_URL);
    },
    onLogin: () => {
      console.log(`[GenerateWorkflow:${config.pageId}] Login requested`);
      window.electronAPI.auth?.login();
    },
  });

  // ---------------------------------------------------------------------------
  // Validation Hook
  // ---------------------------------------------------------------------------

  const { validate } = useValidateBeforeGenerate({
    items: validationItems,
    errorMessage: config.validationErrorMessage || tErrors('MSG_BUILDER_VALIDATION_AT_LEAST_ONE_RULE'),
    onValidationFail: (message) => {
      console.warn(`[W:STRATEGY:VALIDATION_FAILED] [GenerateWorkflow:${config.pageId}] Validation failed:`, message);
      globalThis.nexus?.window?.showAlert(message);
    },
  });

  // ---------------------------------------------------------------------------
  // Auto-scroll Effect (TICKET_077_D3: scroll when generation starts)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Scroll to code display area when generation starts (not after completion)
    if (isGenerating && codeDisplayRef.current) {
      codeDisplayRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }
  }, [isGenerating]);

  // ---------------------------------------------------------------------------
  // TICKET_1208_1: If using IPC generation, recover state on mount + subscribe
  // ---------------------------------------------------------------------------

  const useIpcGeneration = Boolean(config.buildGenerationRequest);

  useEffect(() => {
    if (!useIpcGeneration) return;

    // Recover in-progress or completed state from main process
    window.electronAPI.generation.getState(config.pageId).then((slot) => {
      if (!slot) return;
      if (slot.status === 'generating') {
        setIsGenerating(true);
      } else if (slot.status === 'completed' && slot.result) {
        const genResult = slot.result as GenerationResult;
        if (genResult.strategy_code) {
          setGenerateResult({ code: genResult.strategy_code, language: genResult.language });
        }
        setIsGenerating(false);
      } else if (slot.status === 'failed' && slot.error) {
        setGenerateResult({ error: slot.error as string });
        setIsGenerating(false);
      }
    }).catch(() => { /* main process not ready yet */ });

    // Subscribe to IPC events
    const unsubComplete = window.electronAPI.generation.onComplete((data) => {
      if (data.pageId !== config.pageId) return;
      if (data.strategy_code) {
        setGenerateResult({ code: data.strategy_code, language: data.language });
        setIsGenerating(false);
        callbacksRef.current.onSuccess?.(data.strategy_code);

        // Algorithm save — read refs for the latest values (the useEffect
        // closure captures mount-time snapshots; refs track each render).
        (async () => {
          try {
            const storageService = getAlgorithmStorageService();
            const result: GenerationResult = {
              status: 'completed',
              strategy_code: data.strategy_code,
              strategy_id: data.strategy_id,
              language: data.language,
              includes: data.includes,
              strategy_class: data.strategy_class,
            };
            const saveRequest = await config.buildStorageRequest(result, currentStateRef.current, strategyNameRef.current);
            const saveResult = await storageService.save(saveRequest);
            if (saveResult.success) {
              setIsSaved(true);
              callbacksRef.current.onSaved?.();
              if (saveResult.data?.id) {
                setSavedAlgorithmId(saveResult.data.id);
              }
            }
          } catch (saveError) {
            console.error(`[E:STRATEGY:SAVE_EXCEPTION] [GenerateWorkflow:${config.pageId}]`, saveError);
          }
        })();
      }
    });

    const unsubError = window.electronAPI.generation.onError((data) => {
      if (data.pageId !== config.pageId) return;
      setIsGenerating(false);
      const errorMsg = resolveMessage(data.errorMessage || tErrors('MSG_UNKNOWN_ERROR'));
      setGenerateResult({ error: errorMsg });
      globalThis.nexus?.window?.showAlert(errorMsg);
      callbacksRef.current.onError?.(errorMsg);
    });

    const unsubStatus = window.electronAPI.generation.onStatus((data) => {
      if (data.pageId !== config.pageId) return;
      if (data.status === 'generating') {
        setIsGenerating(true);
      } else if (data.status === 'idle') {
        setIsGenerating(false);
      }
    });

    return () => {
      unsubComplete();
      unsubError();
      unsubStatus();
    };
  }, [useIpcGeneration, config.pageId]);

  // ---------------------------------------------------------------------------
  // TICKET_701: Abort on unmount (only for legacy executeApi path)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (useIpcGeneration) return;
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [useIpcGeneration]);

  // ---------------------------------------------------------------------------
  // TICKET_701 Phase 3: Dispatch generation busy state to host via CustomEvent
  // ---------------------------------------------------------------------------

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('nexus:generation-busy', { detail: { busy: isGenerating } })
    );
  }, [isGenerating]);

  // Cleanup: ensure busy=false dispatched on unmount
  useEffect(() => {
    return () => {
      window.dispatchEvent(
        new CustomEvent('nexus:generation-busy', { detail: { busy: false } })
      );
    };
  }, []);

  // ---------------------------------------------------------------------------
  // CodeDisplay State Helper
  // ---------------------------------------------------------------------------

  const getCodeDisplayState = useCallback((): CodeDisplayState => {
    if (isGenerating) return 'loading';
    if (generateResult?.error) return 'error';
    if (generateResult?.code) return 'success';
    return 'idle';
  }, [isGenerating, generateResult]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * TICKET_701 + TICKET_1208_1: Cancel in-flight generation.
   * IPC path: requests main process to abort.
   * Legacy path: aborts local AbortController.
   */
  const cancelGeneration = useCallback(() => {
    if (useIpcGeneration) {
      window.electronAPI.generation.cancel(config.pageId);
    } else {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
  }, [useIpcGeneration, config.pageId]);

  const resetNewStrategy = useCallback(() => {
    store.resetPage(config.pageId);
    setIsGenerating(false);
  }, [store, config.pageId]);

  // ---------------------------------------------------------------------------
  // TICKET_701 Phase 2: Esc key cancels in-flight generation
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!isGenerating) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelGeneration();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isGenerating, cancelGeneration]);

  // ---------------------------------------------------------------------------
  // TICKET_701 Phase 3: Listen for host cancel request
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleHostCancel = () => {
      cancelGeneration();
    };
    window.addEventListener('nexus:generation-cancel', handleHostCancel);
    return () => window.removeEventListener('nexus:generation-cancel', handleHostCancel);
  }, [cancelGeneration]);

  // ---------------------------------------------------------------------------
  // TICKET_755 Phase 6: UI watchdog (legacy path only).
  // IPC path: main process GenerationService handles its own timeout.
  // ---------------------------------------------------------------------------
  useEventWatchdog({
    active: isGenerating && !useIpcGeneration,
    timeoutMs: UI_WATCHDOG_GENERATION_MS,
    resetSignals: [],
    onTimeout: () => {
      const seconds = Math.round(UI_WATCHDOG_GENERATION_MS / 1000);
      const message = `Strategy generation watchdog: no response for ${seconds}s. Backend may be unresponsive. Try again or check logs.`;
      console.error(`[E:STRATEGY:GENERATION_WATCHDOG_TIMEOUT] [GenerateWorkflow:${config.pageId}]`, message);
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
      setGenerateResult({ error: message });
      globalThis.nexus?.window?.showAlert(message);
      callbacks.onError?.(message);
    },
  });

  /**
   * Handle Start Generate button click
   * Flow: Access check -> Validation -> Show NamingDialog
   */
  const handleStartGenerate = useCallback(async () => {
    // Step 1: Check LLM access
    // TICKET_644: Always check LLM access, including free pages.
    // Free pages skip auth (handled by api-client skipAuth), but still need
    // a valid LLM provider configured (BYOK key). checkAccess() will show
    // the BYOK setup dialog if no provider is available.
    console.log(`[GenerateWorkflow:${config.pageId}] handleStartGenerate called, isFreePage=${isFreePage}, provider=${config.llmProvider}`);
    const hasAccess = await llmAccessHook.checkAccess();
    console.log(`[GenerateWorkflow:${config.pageId}] checkAccess result: ${hasAccess}`);
    if (!hasAccess) {
      console.warn(`[W:STRATEGY:ACCESS_BLOCKED] [GenerateWorkflow:${config.pageId}] checkAccess returned false - BLOCKED HERE, no API call will be made`);
      return;
    }

    // Step 2: Validate inputs (rule count etc.)
    if (!validate()) {
      return;
    }

    // Step 3: Validate config (asset, field-level checks)
    const apiConfig = config.buildConfig(currentState, strategyName);
    const validation = config.validateConfig(apiConfig);
    if (!validation.valid) {
      const translatedError = validation.error
        ? tErrors(validation.error, validation.errorParams ?? {})
        : tErrors('MSG_GENERIC_ERROR');
      console.warn(`[W:STRATEGY:CONFIG_VALIDATION_FAILED] [GenerateWorkflow:${config.pageId}] Config validation failed:`, validation.error);
      globalThis.nexus?.window?.showAlert(translatedError);
      return;
    }

    // Step 4: Show naming dialog
    setNamingDialogVisible(true);
  }, [llmAccessHook, validate, config, currentState, strategyName, tErrors]);

  /**
   * Handle naming dialog cancel
   */
  const handleCancelNaming = useCallback(() => {
    setNamingDialogVisible(false);
  }, []);

  /**
   * Handle naming dialog confirm - executes the actual generation
   */
  const handleConfirmNaming = useCallback(async (finalName: string) => {
    setNamingDialogVisible(false);
    setStrategyName(finalName);

    // Build API config
    const apiConfig = config.buildConfig(currentState, finalName);

    // Validate config
    const validation = config.validateConfig(apiConfig);
    if (!validation.valid) {
      const translatedError = validation.error
        ? tErrors(validation.error, validation.errorParams ?? {})
        : tErrors('MSG_GENERIC_ERROR');
      console.warn(`[W:STRATEGY:CONFIG_VALIDATION_FAILED] [GenerateWorkflow:${config.pageId}] Config validation failed:`, validation.error);
      globalThis.nexus?.window?.showAlert(translatedError);
      setGenerateResult({ error: translatedError });
      return;
    }

    // Set loading state
    setIsGenerating(true);
    setGenerateResult(null);

    // -----------------------------------------------------------------------
    // TICKET_1208_1: IPC path — delegate to main process GenerationService
    // -----------------------------------------------------------------------
    if (config.buildGenerationRequest) {
      const genReq = config.buildGenerationRequest(apiConfig);
      console.debug(`[GenerateWorkflow:${config.pageId}] Starting IPC generation → ${genReq.startEndpoint}`);

      const startResult = await window.electronAPI.generation.start({
        pageId: config.pageId,
        strategyName: finalName,
        startEndpoint: genReq.startEndpoint,
        pollEndpoint: genReq.pollEndpoint,
        requestBody: genReq.requestBody,
      });

      if (!startResult.success) {
        setIsGenerating(false);
        const errorMsg = resolveMessage(startResult.error || tErrors('MSG_STRATEGY_GENERATION_FAILED'));
        setGenerateResult({ error: errorMsg });
        globalThis.nexus?.window?.showAlert(errorMsg);
        callbacks.onError?.(errorMsg);
      }
      // Result arrives via IPC event subscription (see useEffect above)
      return;
    }

    // -----------------------------------------------------------------------
    // Legacy path — renderer-owned HTTP (pages that haven't migrated yet)
    // -----------------------------------------------------------------------
    if (!config.executeApi) {
      setIsGenerating(false);
      setGenerateResult({ error: 'No generation method configured' });
      return;
    }

    // TICKET_701: Create AbortController for this generation request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      console.debug(`[GenerateWorkflow:${config.pageId}] Calling API (legacy path)...`);
      const result = await config.executeApi(apiConfig, abortController.signal);

      console.log(`[GenerateWorkflow:${config.pageId}] API result status:`, result.status);
      console.log(`[GenerateWorkflow:${config.pageId}] strategy_code length:`, result.strategy_code?.length);

      if (result.status === 'completed' && result.strategy_code) {
        // Success
        console.log(`[GenerateWorkflow:${config.pageId}] Generation successful`);
        setGenerateResult({ code: result.strategy_code, language: result.language });
        callbacks.onSuccess?.(result.strategy_code);

        // Save algorithm
        try {
          console.log(`[GenerateWorkflow:${config.pageId}] Saving algorithm...`);
          const storageService = getAlgorithmStorageService();
          const saveRequest = await config.buildStorageRequest(result, currentState, finalName);
          const saveResult = await storageService.save(saveRequest);

          if (saveResult.success) {
            console.log(`[GenerateWorkflow:${config.pageId}] Algorithm saved:`, saveResult.data);
            setIsSaved(true);
            callbacks.onSaved?.();

            // TICKET_650: Track saved algorithm for compilation status badge
            if (saveResult.data?.id) {
              setSavedAlgorithmId(saveResult.data.id);
            }
          } else {
            console.error(`[E:STRATEGY:SAVE_FAILED] [GenerateWorkflow:${config.pageId}] Save failed:`, saveResult.error);
          }
        } catch (saveError) {
          console.error(`[E:STRATEGY:SAVE_EXCEPTION] [GenerateWorkflow:${config.pageId}] Save exception:`, saveError);
        }
      } else if (result.status === 'failed' || result.status === 'rejected') {
        // API returned error
        const rawErrorMsg = typeof result.error === 'string'
          ? result.error
          : config.getErrorMessage(result);
        const errorMsg = resolveMessage(rawErrorMsg);
        console.error(`[E:STRATEGY:GENERATION_FAILED] [GenerateWorkflow:${config.pageId}] Generation failed:`, result.reason_code || result.error);
        setGenerateResult({ error: errorMsg });
        globalThis.nexus?.window?.showAlert(errorMsg);
        callbacks.onError?.(errorMsg);
      } else {
        // Unexpected status
        setGenerateResult({ error: tErrors('MSG_UNKNOWN_ERROR') });
      }
    } catch (error) {
      // TICKET_701: Silently handle abort (user-initiated cancellation)
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.log(`[GenerateWorkflow:${config.pageId}] Generation cancelled by user`);
        return;
      }

      // Exception during API call
      console.error(`[E:STRATEGY:GENERATION_EXCEPTION] [GenerateWorkflow:${config.pageId}] Exception:`, error);

      const err = error as Error & { code?: string; reasonCode?: string };
      const errorCode = err.code || err.reasonCode;

      // AUTH_REQUIRED already shows modal in api-client, skip duplicate
      if (err.message === 'AUTH_REQUIRED') {
        setGenerateResult({ error: tErrors('MSG_BUILDER_LOGIN_REQUIRED_BODY') });
        return;
      }

      // Map error code to user-friendly message
      let errorMsg: string;
      if (err.message === 'AUTH_API_UNAVAILABLE') {
        errorMsg = tErrors('MSG_AUTH_API_UNAVAILABLE');
      } else if (err.message === 'AUTH_NOT_AUTHENTICATED') {
        errorMsg = tErrors('MSG_AUTH_NOT_AUTHENTICATED');
      } else if (err.message === 'TASK_NO_ID') {
        errorMsg = tErrors('MSG_TASK_NO_ID');
      } else if (err.message === 'TASK_NO_RESULT') {
        errorMsg = tErrors('MSG_TASK_NO_RESULT');
      } else if (err.message === 'TASK_TIMEOUT') {
        const timeoutMs = (err as Error & { timeoutMs?: number }).timeoutMs;
        errorMsg = tErrors('MSG_TASK_TIMEOUT', { timeoutMs });
      } else if (errorCode) {
        const i18nKey = `errorCodes.${errorCode}`;
        const resolved = tBuilder(i18nKey);
        if (resolved !== i18nKey) {
          errorMsg = resolved;
        } else if (config.errorMessages?.[errorCode]) {
          errorMsg = config.errorMessages[errorCode];
        } else {
          errorMsg = resolveMessage(err.message || tErrors('MSG_UNKNOWN_ERROR'));
        }
      } else {
        errorMsg = resolveMessage(err.message || tErrors('MSG_UNKNOWN_ERROR'));
      }

      setGenerateResult({ error: errorMsg });
      let alertOptions: { action: string } | undefined;
      if (errorCode === 'ANONYMOUS_QUOTA_EXCEEDED') {
        alertOptions = { action: 'auth-required' };
      } else if (isByokRequiredError(errorCode, errorMsg)) {
        alertOptions = { action: 'byok-required' };
      }
      globalThis.nexus?.window?.showAlert(errorMsg, alertOptions);
      callbacks.onError?.(errorMsg);
    } finally {
      setIsGenerating(false);
    }
  }, [config, currentState, callbacks, tErrors, tBuilder, resolveMessage, pageState.strategyName]);

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    state: {
      isGenerating,
      generateResult,
      namingDialogVisible,
      isSaved,
      strategyName,
      savedAlgorithmId,
      isCpp,
    },
    actions: {
      handleStartGenerate,
      handleCancelNaming,
      handleConfirmNaming,
      cancelGeneration,
      setStrategyName,
      getCodeDisplayState,
      hasResult: Boolean(generateResult?.code),
      resetNewStrategy,
    },
    llmAccess: {
      showPrompt: llmAccessHook.showPrompt,
      showSetupDialog: llmAccessHook.showSetupDialog,
      userTier: llmAccessHook.userTier,
      closePrompt: llmAccessHook.closePrompt,
      closeSetupDialog: llmAccessHook.closeSetupDialog,
      onSetupComplete: llmAccessHook.onSetupComplete,
      openSettings: llmAccessHook.openSettings,
      triggerUpgrade: llmAccessHook.triggerUpgrade,
      triggerLogin: llmAccessHook.triggerLogin,
    },
    codeDisplayRef,
  };
}

export default useGenerateWorkflow;
