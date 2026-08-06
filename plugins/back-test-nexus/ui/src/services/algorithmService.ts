/**
 * Algorithm Service - Plugin Layer
 *
 * Provides typed access to nona_algorithms table via IPC.
 * Follows plugin architecture pattern - all data access through electronAPI.
 *
 * TICKET_168: Uses algorithmCodeRegistry to validate and supplement code fields
 * TICKET_210: Added signal_source prefix filtering for indicator_detector/indicator_entry workflows
 * TICKET_420: Replaced hardcoded userId='default' with authenticated user ID
 * TICKET_670: Algorithms are machine-scoped, no user_id filter needed
 * TICKET_716: Removed auth regression that blocked algorithm loading without login
 *
 * @see TICKET_077_COMPONENT7 - Data Integration
 * @see TICKET_168 - Centralized Algorithm Code Registry
 * @see TICKET_210 - Indicator Detector + Entry Workflow Mapping
 * @see TICKET_420 - TICKET_415 Layer 3 remnant fix
 */

import { algorithmCodeRegistry } from './algorithmCodeRegistry';
import { getCurrentUserIdOrLocal } from '../utils/auth-utils';
// TICKET_771 Step 2 / Layer 2b: import the canonical preload contract so any
// future change to the host signature surfaces as a compile error here instead
// of drifting silently like the userId omission TICKET_770 had to patch.
import type {
  GetAlgorithmsOptions,
  GetAlgorithmsRecord,
} from '@shared/types/algorithm';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface Algorithm {
  id: number;
  code: string;
  strategyName: string;
  strategyType: number;
  description?: string;
  classificationMetadata?: string;
  /** TICKET_650: C++ compilation status */
  compileStatus?: 'pending' | 'success' | 'error' | null;
}

export interface AlgorithmOption {
  id: number;
  code: string;
  strategyName: string;
  strategyType: number;
  description?: string;
  classificationMetadata?: string;
  /** TICKET_650: C++ compilation status */
  compileStatus?: 'pending' | 'success' | 'error' | null;
}

// Mirrors GetAlgorithmsResult from @shared/types/algorithm but adds the
// optional compileStatus field that the IPC handler attaches at runtime
// (TICKET_650). Keep the record list anchored on GetAlgorithmsRecord so the
// shared part stays in lock-step with the preload contract.
interface AlgorithmResponse {
  success: boolean;
  data?: Array<GetAlgorithmsRecord & { compileStatus?: string | null }>;
  error?: { code: string; message: string };
}

// -----------------------------------------------------------------------------
// Algorithm Service
// -----------------------------------------------------------------------------

export const algorithmService = {
  /**
   * Get Trend-Range algorithms (strategy_type = 9)
   */
  async getTrendRangeAlgorithms(): Promise<Algorithm[]> {
    const response = await getAlgorithms({ strategyType: 9 });

    if (!response.success || !response.data) {
      console.error('[E:BACKTEST:ALGO_FETCH_FAILED] [algorithmService] Failed to fetch trend-range algorithms:', response.error);
      return [];
    }

    return response.data.map(toAlgorithm);
  },

  /**
   * Get Pre-condition algorithms (strategy_type = 4)
   */
  async getPreConditionAlgorithms(): Promise<Algorithm[]> {
    const response = await getAlgorithms({ strategyType: 4 });

    if (!response.success || !response.data) {
      console.error('[E:BACKTEST:ALGO_FETCH_FAILED] [algorithmService] Failed to fetch pre-condition algorithms:', response.error);
      return [];
    }

    return response.data.map(toAlgorithm);
  },

  /**
   * Get Post-condition algorithms (strategy_type = 6)
   */
  async getPostConditionAlgorithms(): Promise<Algorithm[]> {
    const response = await getAlgorithms({ strategyType: 6 });

    if (!response.success || !response.data) {
      console.error('[E:BACKTEST:ALGO_FETCH_FAILED] [algorithmService] Failed to fetch post-condition algorithms:', response.error);
      return [];
    }

    return response.data.map(toAlgorithm);
  },

  /**
   * TICKET_210: Get Indicator Detector algorithms
   * signal_source starts with 'indicator_detector' (strategy_type = 9)
   */
  async getIndicatorDetectorAlgorithms(): Promise<Algorithm[]> {
    const response = await getAlgorithms({
      strategyType: 9,
      signalSourcePrefix: 'indicator_detector',
    });

    if (!response.success || !response.data) {
      console.error('[E:BACKTEST:ALGO_FETCH_FAILED] [algorithmService] Failed to fetch indicator-detector algorithms:', response.error);
      return [];
    }

    return response.data.map(toAlgorithm);
  },

  /**
   * TICKET_210: Get Indicator Entry algorithms
   * signal_source starts with 'indicator_entry' (strategy_type = 3)
   */
  async getIndicatorEntryAlgorithms(): Promise<Algorithm[]> {
    const response = await getAlgorithms({
      strategyType: 3,
      signalSourcePrefix: 'indicator_entry',
    });

    if (!response.success || !response.data) {
      console.error('[E:BACKTEST:ALGO_FETCH_FAILED] [algorithmService] Failed to fetch indicator-entry algorithms:', response.error);
      return [];
    }

    return response.data.map(toAlgorithm);
  },

  /**
   * Get Kronos Predictor algorithms for KronosCockpitPage (page42) Select Algorithm
   * Matches: strategy_type=9 (TYPE_ANALYSIS) + signal_source='kronos_prediction'
   * @see STRATEGY_TYPE_AND_SIGNAL_SOURCE_REFERENCE.md Section 9
   */
  async getKronosDetectorAlgorithms(): Promise<Algorithm[]> {
    const response = await getAlgorithms({
      strategyType: 9,
      signalSourcePrefix: 'kronos_prediction',
    });

    if (!response.success || !response.data) {
      console.error('[E:BACKTEST:ALGO_FETCH_FAILED] [algorithmService] Failed to fetch kronos-predictor algorithms:', response.error);
      return [];
    }

    return response.data.map(toAlgorithm);
  },

  /**
   * Get Kronos Indicator Entry algorithms for KronosCockpitPage (page42) Select Steps
   * Matches: strategy_type=1 (TYPE_EXECUTION) + signal_source='kronosIndicatorEntry'
   * @see STRATEGY_TYPE_AND_SIGNAL_SOURCE_REFERENCE.md Section 10
   */
  async getKronosEntryAlgorithms(): Promise<Algorithm[]> {
    const response = await getAlgorithms({
      strategyType: 1,
      signalSourcePrefix: 'kronosIndicatorEntry',
    });

    if (!response.success || !response.data) {
      console.error('[E:BACKTEST:ALGO_FETCH_FAILED] [algorithmService] Failed to fetch kronos-indicator-entry algorithms:', response.error);
      return [];
    }

    return response.data.map(toAlgorithm);
  },

  /**
   * Get Kronos AI Entry algorithms for KronosCockpitPage (page42) Select Steps
   * Matches: strategy_type=1 (TYPE_EXECUTION) + signal_source='kronos_llm_entry'
   * @see TICKET_210 - Kronos AI Entry (Page 34) uses kronos_llm_entry signal_source
   */
  async getKronosAIEntryAlgorithms(): Promise<Algorithm[]> {
    const response = await getAlgorithms({
      strategyType: 1,
      signalSourcePrefix: 'kronos_llm_entry',
    });

    if (!response.success || !response.data) {
      console.error('[E:BACKTEST:ALGO_FETCH_FAILED] [algorithmService] Failed to fetch kronos-ai-entry algorithms:', response.error);
      return [];
    }

    return response.data.map(toAlgorithm);
  },

  /**
   * TICKET_077_20: Get Watchlist algorithms for TraderCockpitPage (page43) Market Analysis
   * Matches: strategy_type=7 (TYPE_PRECONDITION) + signal_source='watchlist'
   * @see STRATEGY_TYPE_AND_SIGNAL_SOURCE_REFERENCE.md Section 1 (Watchlist)
   */
  async getWatchlistAlgorithms(): Promise<Algorithm[]> {
    const response = await getAlgorithms({
      strategyType: 7,
      signalSourcePrefix: 'watchlist',
    });

    if (!response.success || !response.data) {
      console.error('[E:BACKTEST:ALGO_FETCH_FAILED] [algorithmService] Failed to fetch watchlist algorithms:', response.error);
      return [];
    }

    return response.data.map(toAlgorithm);
  },

  /**
   * TICKET_077_20: Get LLM Trader algorithms for TraderCockpitPage (page43) Entry Signal
   * Matches: strategy_type=1 (TYPE_EXECUTION) + signal_source='llmtrader'
   * @see STRATEGY_TYPE_AND_SIGNAL_SOURCE_REFERENCE.md Section 4 (LLM Trader)
   */
  async getLLMTraderAlgorithms(): Promise<Algorithm[]> {
    const response = await getAlgorithms({
      strategyType: 1,
      signalSourcePrefix: 'llmtrader',
    });

    if (!response.success || !response.data) {
      console.error('[E:BACKTEST:ALGO_FETCH_FAILED] [algorithmService] Failed to fetch llmtrader algorithms:', response.error);
      return [];
    }

    return response.data.map(toAlgorithm);
  },

  /**
   * TICKET_499: Get AI Libero algorithms for AI Libero Cockpit Entry Signal
   * Matches: strategy_type=1 (TYPE_EXECUTION) + signal_source='aiLibero'
   */
  async getAILiberoAlgorithms(): Promise<Algorithm[]> {
    const response = await getAlgorithms({
      strategyType: 1,
      signalSourcePrefix: 'aiLibero',
    });

    if (!response.success || !response.data) {
      console.error('[E:BACKTEST:ALGO_FETCH_FAILED] [algorithmService] Failed to fetch ai-libero algorithms:', response.error);
      return [];
    }

    return response.data.map(toAlgorithm);
  },

  /**
   * TICKET_508: Get AI Studio algorithms for AI Studio Cockpit Entry Signal
   * Matches: strategy_type=1 (TYPE_EXECUTION) + signal_source='aiStudio'
   */
  async getAIStudioAlgorithms(): Promise<Algorithm[]> {
    const response = await getAlgorithms({
      strategyType: 1,
      signalSourcePrefix: 'aiStudio',
    });

    if (!response.success || !response.data) {
      console.error('[E:BACKTEST:ALGO_FETCH_FAILED] [algorithmService] Failed to fetch ai-studio algorithms:', response.error);
      return [];
    }

    return response.data.map(toAlgorithm);
  },

  async getCatalogAlgorithms(): Promise<Algorithm[]> {
    const response = await getAlgorithms({
      strategyType: 1,
      signalSourcePrefix: 'strategy_catalog_',
    });

    if (!response.success || !response.data) {
      console.error('[E:BACKTEST:ALGO_FETCH_FAILED] [algorithmService] Failed to fetch catalog algorithms:', response.error);
      return [];
    }

    return response.data.map(toAlgorithm);
  },
};

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

// TICKET_771 Step 2 / Layer 2b: the wrapper's parameter type is the canonical
// preload options minus the fields the wrapper itself injects (userId). If
// the host contract ever adds/renames a field, this Omit<> stops compiling
// here instead of at the IPC call site.
type GetAlgorithmsWrapperOptions = Omit<GetAlgorithmsOptions, 'userId'>;

async function getAlgorithms(
  options: GetAlgorithmsWrapperOptions,
): Promise<AlgorithmResponse> {
  // TICKET_716 + TICKET_670: algorithms are machine-scoped, so we always pass
  // an owner-or-'local' id. Per TICKET_670 the main-process side accepts
  // 'local' as the machine-scoped sentinel. Caller code stays auth-agnostic.
  const userId = await getCurrentUserIdOrLocal();
  return window.electronAPI.database.getAlgorithms({ ...options, userId });
}

/**
 * Convert database record to Algorithm
 * TICKET_168: Validates and supplements code using algorithmCodeRegistry
 */
function toAlgorithm(record: {
  id: number;
  code: string;
  strategyName: string;
  strategyType: number;
  description: string | null;
  classificationMetadata: string | null;
  compileStatus?: string | null;
}): Algorithm {
  // TICKET_168: Use registry to get valid code
  const validCode = algorithmCodeRegistry.getValidCode(record.strategyName, record.code);

  return {
    id: record.id,
    code: validCode || record.code,
    strategyName: record.strategyName,
    strategyType: record.strategyType,
    description: record.description || undefined,
    classificationMetadata: record.classificationMetadata || undefined,
    compileStatus: record.compileStatus as Algorithm['compileStatus'],
  };
}

/**
 * Convert Algorithm to AlgorithmOption (for WorkflowDropdown)
 */
export function toAlgorithmOption(algo: Algorithm): AlgorithmOption {
  return {
    id: algo.id,
    code: algo.code,
    strategyName: algo.strategyName,
    strategyType: algo.strategyType,
    description: algo.description,
    classificationMetadata: algo.classificationMetadata,
    compileStatus: algo.compileStatus,
  };
}
