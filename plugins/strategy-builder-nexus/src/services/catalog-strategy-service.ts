import i18n from 'i18next';
import type { GenerationResult } from '../hooks/useGenerateWorkflow';

export interface CatalogGenerationConfig {
  catalogId: string;
  strategyName: string;
  category: string;
  llmProvider?: string;
  llmModel?: string;
  customization?: {
    preference?: string;
    timeframe?: string;
    riskLevel?: string;
  };
}

export async function executeCatalogGeneration(
  config: CatalogGenerationConfig,
  signal?: AbortSignal,
): Promise<GenerationResult> {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }

  const result = await window.electronAPI.strategy.generateFromCatalog({
    catalogId: config.catalogId,
    strategyName: config.strategyName,
    llmProvider: config.llmProvider,
    llmModel: config.llmModel,
    customization: config.customization,
  });

  if (!result.success) {
    return {
      status: 'failed',
      error: result.error || 'MSG_GENERIC_ERROR',
    };
  }

  return {
    status: 'completed',
    strategy_code: result.strategy_code,
    strategy_id: result.algorithmId ? Number(result.algorithmId) : undefined,
    language: 'cpp',
  };
}

export function validateCatalogConfig(
  config: Partial<CatalogGenerationConfig>,
): { valid: boolean; error?: string; errorParams?: Record<string, unknown> } {
  if (!config.llmProvider) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_LLM_PROVIDER_REQUIRED' };
  }
  if (!config.catalogId) {
    return { valid: false, error: 'MSG_BUILDER_VALIDATION_CATALOG_ID_REQUIRED' };
  }
  return { valid: true };
}

const CATALOG_ERROR_CODES: ReadonlySet<string> = new Set([
  'CATALOG_NOT_FOUND',
  'GENERATION_TIMEOUT',
  'RATE_LIMIT_EXCEEDED',
]);

function resolveCatalogErrorCode(code: string | undefined): string | undefined {
  if (!code || !CATALOG_ERROR_CODES.has(code)) return undefined;
  return i18n.t(`errorCodes.${code}`, { ns: 'strategy-builder' });
}

export function getCatalogErrorMessage(result: { error?: string | { message?: string; code?: string } }): string {
  if (typeof result.error === 'object' && result.error?.code) {
    const resolved = resolveCatalogErrorCode(result.error.code);
    if (resolved) return resolved;
  }
  if (typeof result.error === 'string') return result.error;
  if (typeof result.error === 'object' && result.error?.message) return result.error.message;
  return 'MSG_GENERIC_ERROR';
}
