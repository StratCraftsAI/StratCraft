/**
 * TICKET_646 Phase 4: Pure helpers for LLMSettingsPanel.
 *
 * Extracted for unit testing; mirrors the Phase 3 hook-helper pattern in
 * `useLLMCatalog.ts` (`buildProviderIndex` / `lookupModels`).
 */

import { getIntlLocale } from '@shared/utils/format-locale';
import type { LLMCatalogModel } from '../../hooks/useLLMCatalog';

/**
 * Resolve the model list to render in a BYOK provider card's dropdown.
 *
 * Priority:
 *  1. Catalog models from `useLLMCatalog().getModels(providerId)` when
 *     non-empty (authenticated + backend reachable).
 *  2. Empty array otherwise -- caller renders an "unavailable" hint.
 *
 * PRO_CATALOG never goes through this helper (its card uses
 * `getProCatalogModels` directly).
 */
export function resolveBYOKModelOptions(
  catalogModels: LLMCatalogModel[],
): LLMCatalogModel[] {
  return catalogModels.length > 0 ? catalogModels : [];
}

/**
 * Detect whether a saved (provider, model) pair is stale relative to the
 * current catalog. Returns `true` only when:
 *  - selectedProvider is non-empty, AND
 *  - selectedProvider is NOT 'PRO_CATALOG' (PRO_CATALOG has its own marketplace flow), AND
 *  - the catalog returned at least one model for that provider, AND
 *  - selectedModel is not in that model list.
 *
 * Returning `false` for the "catalog empty" case avoids spurious
 * warnings while loading or for unauthenticated users.
 */
export function isStoredModelStale(
  selectedProvider: string,
  selectedModel: string,
  catalogModels: LLMCatalogModel[],
): boolean {
  if (!selectedProvider || selectedProvider === 'PRO_CATALOG') return false;
  if (!selectedModel) return false;
  if (catalogModels.length === 0) return false;
  return !catalogModels.some((m) => m.id === selectedModel);
}

/**
 * TICKET_646_1 Phase 5: Validate a custom model ID string.
 *
 * Rules:
 *  - Non-empty
 *  - No whitespace
 *  - ASCII printable characters only (0x20-0x7E, but spaces excluded above)
 *
 * Returns null when valid; returns an error key (i18n) when invalid.
 */
export function validateCustomModelId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'llmSettings.customModelEmpty';
  if (/\s/.test(trimmed)) return 'llmSettings.customModelNoSpaces';
  // eslint-disable-next-line no-control-regex
  if (!/^[\x21-\x7E]+$/.test(trimmed)) return 'llmSettings.customModelAsciiOnly';
  return null;
}

/**
 * TICKET_646 Phase 5: Render a snapshot timestamp into a locale-aware string
 * for display in the offline-catalog badge.
 *
 * - Returns an em-dash placeholder when the timestamp is null (no snapshot
 *   has ever been written; should be unreachable when source==='snapshot'
 *   but kept defensive).
 * - Uses `Intl.DateTimeFormat` with `getIntlLocale()` per TICKET_315 so
 *   the user's selected i18n locale (not the OS default) drives format.
 */
export function formatSnapshotTimestamp(timestamp: number | null): string {
  if (timestamp === null) return '\u2014';
  try {
    return new Intl.DateTimeFormat(getIntlLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString();
  }
}
