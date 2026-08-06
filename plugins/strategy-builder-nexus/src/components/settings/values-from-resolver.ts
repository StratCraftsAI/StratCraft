/**
 * TICKET_646 Phase 6: Generic `valuesFrom` resolution for plugin config fields.
 *
 * Maps manifest `valuesFrom` strings to concrete option lists derived from
 * the LLM catalog (or future data sources). Designed as pure functions so
 * the logic is testable without React rendering.
 */

import type { LLMCatalogModel, LLMCatalogProvider } from '../../hooks/useLLMCatalog';

// =============================================================================
// Types
// =============================================================================

export interface ResolvedOption {
  value: string;
  label: string;
}

export interface ValuesFromResult {
  options: ResolvedOption[];
  loading: boolean;
}

// =============================================================================
// Argument interpolation
// =============================================================================

/**
 * Interpolate `{key.path}` placeholders in valuesFromArgs values against
 * the current config values map.
 *
 * Example: `{ provider: "{llm.selectedProvider}" }` with
 * `currentValues = { "llm.selectedProvider": "OPENAI" }` -> `{ provider: "OPENAI" }`
 */
export function interpolateArgs(
  args: Record<string, string> | undefined,
  currentValues: Record<string, unknown>,
): Record<string, string> {
  if (!args) return {};
  const result: Record<string, string> = {};
  for (const [key, template] of Object.entries(args)) {
    const match = template.match(/^\{(.+)\}$/);
    if (match) {
      const configKey = match[1];
      result[key] = String(currentValues[configKey] ?? '');
    } else {
      result[key] = template;
    }
  }
  return result;
}

// =============================================================================
// Resolver
// =============================================================================

/**
 * Resolve a `valuesFrom` source string to a list of options.
 *
 * Supported sources:
 * - `"llm-catalog:providers"` -- all available providers from the catalog
 * - `"llm-catalog:models"` -- models for a specific provider (requires
 *   `resolvedArgs.provider`)
 *
 * Returns `null` for unknown sources (field falls back to static enum or text input).
 */
export function resolveValuesFrom(
  valuesFrom: string | undefined,
  resolvedArgs: Record<string, string>,
  providers: LLMCatalogProvider[],
  getModels: (providerId: string) => LLMCatalogModel[],
  catalogLoading: boolean,
): ValuesFromResult | null {
  if (!valuesFrom) return null;

  switch (valuesFrom) {
    case 'llm-catalog:providers':
      return {
        options: providers.map((p) => ({ value: p.id, label: p.name })),
        loading: catalogLoading,
      };

    case 'llm-catalog:models': {
      const providerId = resolvedArgs.provider || '';
      if (!providerId) {
        return { options: [], loading: false };
      }
      const models = getModels(providerId);
      return {
        options: models.map((m) => ({ value: m.id, label: m.name })),
        loading: catalogLoading,
      };
    }

    default:
      return null;
  }
}
