/**
 * useKronosPredictor Hook
 *
 * @deprecated TICKET_207: Use useGenerateWorkflow instead.
 * KronosPredictorPage now uses the unified workflow for algorithm storage.
 *
 * State management hook for Kronos AI Predictor page.
 * Handles model selection, prediction configuration, signal filters,
 * and API communication.
 *
 * @see TICKET_205 - Kronos Predictor Page Migration
 * @see TICKET_077_16 - SignalFilterPanel Component
 * @see TICKET_207 - Algorithm Storage Migration
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  SignalFilterConfig,
  DirectionMode,
  CombinationLogic,
} from '../components/ui/SignalFilterPanel';
import type { TimeRangeMode } from '../components/ui/TimeRangeSelector';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ModelOption {
  id: string;
  name: string;
  params: string;
  maxContext: number;
  recommended?: boolean;
}

export interface PresetConfig {
  lookback: number;
  predLen: number;
  temperature: number;
  topP: number;
  topK: number;
  sampleCount: number;
}

export interface KronosPredictorState {
  // Model selection
  selectedModel: string;

  // Prediction configuration
  lookback: number;
  predLen: number;

  // Advanced settings
  temperature: number;
  topP: number;
  topK: number;
  sampleCount: number;

  // Signal filter
  signalFilter: SignalFilterConfig;

  // Time range
  timeRangeMode: TimeRangeMode;
  customTime: string;

  // Strategy info
  strategyName: string;

  // UI state
  isGenerating: boolean;
  error: string | null;
  result: KronosPredictionResult | null;
}

export interface KronosPredictionResult {
  success: boolean;
  message?: string;
  // Strategy code generation result (from backend)
  strategy_code?: string;
  class_name?: string;
  strategy_name?: string;
  // Legacy prediction fields (may not be used)
  prediction?: {
    direction: 'buy' | 'sell' | 'hold';
    confidence: number;
    expectedReturn: number;
    magnitude: number;
  };
  signals?: Array<{
    timestamp: number;
    direction: 'buy' | 'sell';
    confidence: number;
    expectedReturn: number;
  }>;
}

export interface KronosPredictionRequest {
  model: string;
  lookback: number;
  pred_len: number;
  temperature: number;
  top_p: number;
  top_k: number;
  sample_count: number;
  time_range: TimeRangeMode;
  start_time?: string;
  strategy_name: string;
  locale?: string;
  signal_filter: {
    filters: {
      confidence: { enabled: boolean; min_value: number };
      expected_return: { enabled: boolean; min_value: number };
      direction_filter: { enabled: boolean; mode: DirectionMode };
      magnitude: { enabled: boolean; min_value: number };
      consistency: { enabled: boolean; min_value: number };
    };
    combination_logic: CombinationLogic;
  };
}

export interface UseKronosPredictorReturn {
  state: KronosPredictorState;
  actions: {
    setSelectedModel: (model: string) => void;
    setLookback: (value: number) => void;
    setPredLen: (value: number) => void;
    setTemperature: (value: number) => void;
    setTopP: (value: number) => void;
    setTopK: (value: number) => void;
    setSampleCount: (value: number) => void;
    setSignalFilter: (config: SignalFilterConfig) => void;
    setTimeRangeMode: (mode: TimeRangeMode) => void;
    setCustomTime: (time: string) => void;
    setStrategyName: (name: string) => void;
    applyPreset: (presetId: string) => void;
    runAnalysis: () => Promise<void>;
    reset: () => void;
  };
  computed: {
    maxLookback: number;
    canSubmit: boolean;
    activePreset: string;
  };
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

export const KRONOS_MODELS: ModelOption[] = [
  { id: 'kronos-mini', name: 'Kronos-mini', params: '4.1M', maxContext: 2048 },
  { id: 'kronos-small', name: 'Kronos-small', params: '24.7M', maxContext: 512, recommended: true },
  { id: 'kronos-base', name: 'Kronos-base', params: '102.3M', maxContext: 512 },
];

export const PRESETS: Record<string, PresetConfig> = {
  quick: { lookback: 100, predLen: 20, temperature: 1.0, topP: 0.9, topK: 0, sampleCount: 1 },
  standard: { lookback: 400, predLen: 120, temperature: 1.0, topP: 0.9, topK: 0, sampleCount: 1 },
  precision: { lookback: 500, predLen: 120, temperature: 0.8, topP: 0.95, topK: 0, sampleCount: 5 },
  explore: { lookback: 400, predLen: 120, temperature: 1.5, topP: 0.85, topK: 0, sampleCount: 3 },
};

const DEFAULT_SIGNAL_FILTER: SignalFilterConfig = {
  confidence: { enabled: true, value: 60 },
  expectedReturn: { enabled: true, value: 2 },
  direction: { enabled: false, mode: 'both' },
  magnitude: { enabled: false, value: 1 },
  consistency: { enabled: true, value: 70 },
  combinationLogic: 'AND',
};

function getCurrentDateTimeLocal(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const localDate = new Date(now.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
}

const INITIAL_STATE: KronosPredictorState = {
  selectedModel: 'kronos-small',
  lookback: 400,
  predLen: 120,
  temperature: 1.0,
  topP: 0.9,
  topK: 0,
  sampleCount: 1,
  signalFilter: DEFAULT_SIGNAL_FILTER,
  timeRangeMode: 'latest',
  customTime: getCurrentDateTimeLocal(),
  strategyName: '',
  isGenerating: false,
  error: null,
  result: null,
};

// -----------------------------------------------------------------------------
// Hook Implementation
// -----------------------------------------------------------------------------

export function useKronosPredictor(): UseKronosPredictorReturn {
  const { t: tErrors } = useTranslation('errors');
  const [state, setState] = useState<KronosPredictorState>(INITIAL_STATE);

  // ---------------------------------------------------------------------------
  // IPC Event Subscriptions
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Subscribe to prediction completion
    const unsubComplete = window.electronAPI.kronos.onComplete((data) => {
      console.debug('[KronosPredictor] Received completion:', data);
      if (data.result) {
        const result: KronosPredictionResult = {
          success: data.result.success ?? true,
          // Strategy code generation result
          strategy_code: data.result.strategy_code,
          class_name: data.result.class_name,
          strategy_name: data.result.strategy_name,
          // Legacy fields
          prediction: data.result.prediction,
          signals: data.result.signals,
        };
        setState(prev => ({ ...prev, result, isGenerating: false }));
      }
    });

    // Subscribe to prediction errors
    const unsubError = window.electronAPI.kronos.onError((data) => {
      console.error('[E:STRATEGY:KRONOS_PREDICTOR_FAILED] [KronosPredictor] Received error:', data);
      setState(prev => ({
        ...prev,
        error: data.message,
        isGenerating: false,
      }));
    });

    // Subscribe to prediction progress (optional, for future progress UI)
    const unsubProgress = window.electronAPI.kronos.onProgress((data) => {
      console.debug('[KronosPredictor] Progress:', data);
      // Could update a progress state here if needed
    });

    return () => {
      unsubComplete();
      unsubError();
      unsubProgress();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Computed Values
  // ---------------------------------------------------------------------------

  const maxLookback = useMemo(() => {
    const model = KRONOS_MODELS.find(m => m.id === state.selectedModel);
    return model?.maxContext || 512;
  }, [state.selectedModel]);

  const canSubmit = useMemo(() => {
    // Check if at least one filter is enabled
    const hasFilter =
      state.signalFilter.confidence.enabled ||
      state.signalFilter.expectedReturn.enabled ||
      state.signalFilter.direction.enabled ||
      state.signalFilter.magnitude.enabled ||
      state.signalFilter.consistency.enabled;

    return hasFilter && !state.isGenerating;
  }, [state.signalFilter, state.isGenerating]);

  const activePreset = useMemo(() => {
    for (const [presetId, preset] of Object.entries(PRESETS)) {
      if (
        state.lookback === preset.lookback &&
        state.predLen === preset.predLen &&
        state.temperature === preset.temperature &&
        state.topP === preset.topP &&
        state.topK === preset.topK &&
        state.sampleCount === preset.sampleCount
      ) {
        return presetId;
      }
    }
    return '';
  }, [state.lookback, state.predLen, state.temperature, state.topP, state.topK, state.sampleCount]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const setSelectedModel = useCallback((model: string) => {
    setState(prev => {
      const modelConfig = KRONOS_MODELS.find(m => m.id === model);
      const newMaxContext = modelConfig?.maxContext || 512;
      // Clamp lookback if it exceeds new model's max context
      const newLookback = Math.min(prev.lookback, newMaxContext);
      return { ...prev, selectedModel: model, lookback: newLookback };
    });
  }, []);

  const setLookback = useCallback((value: number) => {
    setState(prev => ({ ...prev, lookback: Math.min(value, maxLookback) }));
  }, [maxLookback]);

  const setPredLen = useCallback((value: number) => {
    setState(prev => ({ ...prev, predLen: value }));
  }, []);

  const setTemperature = useCallback((value: number) => {
    setState(prev => ({ ...prev, temperature: value }));
  }, []);

  const setTopP = useCallback((value: number) => {
    setState(prev => ({ ...prev, topP: value }));
  }, []);

  const setTopK = useCallback((value: number) => {
    setState(prev => ({ ...prev, topK: value }));
  }, []);

  const setSampleCount = useCallback((value: number) => {
    setState(prev => ({ ...prev, sampleCount: value }));
  }, []);

  const setSignalFilter = useCallback((config: SignalFilterConfig) => {
    setState(prev => ({ ...prev, signalFilter: config }));
  }, []);

  const setTimeRangeMode = useCallback((mode: TimeRangeMode) => {
    setState(prev => ({ ...prev, timeRangeMode: mode }));
  }, []);

  const setCustomTime = useCallback((time: string) => {
    setState(prev => ({ ...prev, customTime: time }));
  }, []);

  const setStrategyName = useCallback((name: string) => {
    setState(prev => ({ ...prev, strategyName: name }));
  }, []);

  const applyPreset = useCallback((presetId: string) => {
    const preset = PRESETS[presetId];
    if (!preset) return;

    setState(prev => ({
      ...prev,
      lookback: Math.min(preset.lookback, maxLookback),
      predLen: preset.predLen,
      temperature: preset.temperature,
      topP: preset.topP,
      topK: preset.topK,
      sampleCount: preset.sampleCount,
    }));
  }, [maxLookback]);

  const runAnalysis = useCallback(async () => {
    if (!canSubmit) return;

    console.log('[KronosPredictor] Setting isGenerating=true');
    setState(prev => ({ ...prev, isGenerating: true, error: null, result: null }));

    // Allow React to render the loading state before making API call
    await new Promise(resolve => setTimeout(resolve, 0));
    console.log('[KronosPredictor] After yield, starting API call');

    try {
      // Build request payload
      const request: KronosPredictionRequest = {
        model: state.selectedModel,
        lookback: state.lookback,
        pred_len: state.predLen,
        temperature: state.temperature,
        top_p: state.topP,
        top_k: state.topK,
        sample_count: state.sampleCount,
        time_range: state.timeRangeMode,
        start_time: state.timeRangeMode === 'custom' ? state.customTime : undefined,
        strategy_name: state.strategyName || `Kronos Strategy ${Date.now()}`,
        // TICKET_1220: code generation is always English-only (TICKET_850);
        // this renderer-provided locale wins over the main-process default
        // (kronos-handlers.ts `request.locale || 'en_US'`), so it must be
        // pinned here as well.
        locale: 'en_US',
        signal_filter: {
          filters: {
            confidence: {
              enabled: state.signalFilter.confidence.enabled,
              min_value: state.signalFilter.confidence.value / 100,
            },
            expected_return: {
              enabled: state.signalFilter.expectedReturn.enabled,
              min_value: state.signalFilter.expectedReturn.value / 100,
            },
            direction_filter: {
              enabled: state.signalFilter.direction.enabled,
              mode: state.signalFilter.direction.mode,
            },
            magnitude: {
              enabled: state.signalFilter.magnitude.enabled,
              min_value: state.signalFilter.magnitude.value / 100,
            },
            consistency: {
              enabled: state.signalFilter.consistency.enabled,
              min_value: state.signalFilter.consistency.value / 100,
            },
          },
          combination_logic: state.signalFilter.combinationLogic,
        },
      };

      console.debug('[KronosPredictor] Sending request:', request);

      // Call actual API via IPC
      const response = await window.electronAPI.kronos.predict(request);

      if (!response.success) {
        throw new Error(response.error || tErrors('MSG_KRONOS_PREDICTION_REQUEST_FAILED'));
      }

      // Handle synchronous result directly (TICKET_206: avoid React batching issues)
      // When backend returns strategy_code immediately, process it here instead of
      // waiting for IPC event to ensure isGenerating state is properly rendered
      if (response.strategyCode) {
        console.debug('[KronosPredictor] Handling synchronous result');
        const result: KronosPredictionResult = {
          success: true,
          strategy_code: response.strategyCode,
          class_name: response.className,
          strategy_name: response.strategyName,
        };
        setState(prev => ({ ...prev, result, isGenerating: false }));
        return;
      }

      // For async task (taskId returned), wait for completion via IPC events
      // The onComplete/onError handlers in useEffect will update state
      if (response.taskId) {
        console.debug('[KronosPredictor] Async task started:', response.taskId);
        // isGenerating remains true, onComplete/onError will set it to false
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : tErrors('MSG_UNKNOWN_ERROR');
      setState(prev => ({ ...prev, error: errorMessage, isGenerating: false }));
    }
  }, [state, canSubmit, tErrors]);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    state,
    actions: {
      setSelectedModel,
      setLookback,
      setPredLen,
      setTemperature,
      setTopP,
      setTopK,
      setSampleCount,
      setSignalFilter,
      setTimeRangeMode,
      setCustomTime,
      setStrategyName,
      applyPreset,
      runAnalysis,
      reset,
    },
    computed: {
      maxLookback,
      canSubmit,
      activePreset,
    },
  };
}

export default useKronosPredictor;
