/**
 * LLM selection store -- canonical persisted LLM provider/model selection.
 *
 * TICKET_1265_5: single source of truth for "which LLM provider/model is
 * selected". The canonical store is the Strategy Builder plugin settings
 * file (`plugins/com.stratcraft.strategy-builder-nexus/config.json`, keys
 * `llm.selectedProvider` / `llm.selectedModel`) -- the store the desktop
 * Settings UI already writes via `plugin:setConfig` and the MCP standalone
 * agent loop already reads.
 *
 * Every other selection store is converged here:
 *   - host user-config `services.llm_selection` (TICKET_1245 parallel store)
 *     is migrated in once, then deleted.
 *   - ConfigService `llm_provider`/`llm_model` (dead keys read by
 *     /auth/handoff, never written) are replaced by reads of this store.
 */

import { isLlmProviderId, LLM_CONFIG_KEYS } from '@StratCraft/types';
import { appLog } from '../utils/logger';
import { mainT } from '../i18n/main-strings';
import { getCurrentMainLocale } from './locale-service';
import { readPluginSettings, updatePluginSettings } from './plugin-settings-file';
import { getPluginConfigManager } from './plugin-config-manager';

/**
 * Plugin filesystem identity for Strategy Builder. Same namespace note as
 * llm-key-resolver: credential routing uses HOST_PLUGIN_ID (= 'host'), but
 * plugin-config files live under Builder's plugin directory.
 */
export const STRATEGY_BUILDER_PLUGIN_DIR = 'com.stratcraft.strategy-builder-nexus';

/** Host plugin id owning user-config.json (legacy `services.llm_selection`). */
export const HOST_CONFIG_PLUGIN_ID = 'com.stratcraft.host';

export interface LlmSelection {
  provider: string;
  model: string;
}

let migrationDone = false;

/** Test-only: reset the one-time migration latch. */
export function resetLlmSelectionMigrationForTest(): void {
  migrationDone = false;
}

/**
 * One-time migration of the TICKET_1245 parallel store: if the canonical
 * selection is absent and host user-config carries `services.llm_selection`,
 * adopt it; then delete the superseded key so no stale parallel value can
 * shadow the canonical store again.
 */
async function migrateHostSelectionIfNeeded(): Promise<void> {
  if (migrationDone) return;

  try {
    const configMgr = getPluginConfigManager();
    const hostConfig = configMgr.loadUserConfig(HOST_CONFIG_PLUGIN_ID);
    const services = hostConfig.services as Record<string, unknown> | undefined;
    const legacy = services?.llm_selection as { provider?: string; model?: string } | undefined;

    if (!legacy) {
      migrationDone = true;
      return;
    }

    const canonical = readPluginSettings(STRATEGY_BUILDER_PLUGIN_DIR);
    const hasCanonical =
      typeof canonical[LLM_CONFIG_KEYS.SELECTED_PROVIDER] === 'string' &&
      (canonical[LLM_CONFIG_KEYS.SELECTED_PROVIDER] as string) !== '';

    if (!hasCanonical && typeof legacy.provider === 'string' && isLlmProviderId(legacy.provider)) {
      await updatePluginSettings(STRATEGY_BUILDER_PLUGIN_DIR, {
        [LLM_CONFIG_KEYS.SELECTED_PROVIDER]: legacy.provider,
        [LLM_CONFIG_KEYS.SELECTED_MODEL]: typeof legacy.model === 'string' ? legacy.model : '',
      });
      appLog.info(`[TICKET_1265_5] Migrated legacy host llm_selection (${legacy.provider}) to canonical store`);
    }

    if (services) {
      delete services.llm_selection;
      configMgr.saveUserConfig(HOST_CONFIG_PLUGIN_ID, hostConfig);
      appLog.info('[TICKET_1265_5] Removed superseded host services.llm_selection');
    }

    migrationDone = true;
  } catch (error) {
    // Leave the latch unset so the migration retries on the next read.
    appLog.error(`[TICKET_1265_5] llm_selection migration failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Read the canonical LLM selection. Returns null when no selection has
 * ever been persisted (first run).
 */
export async function getLlmSelection(): Promise<LlmSelection | null> {
  await migrateHostSelectionIfNeeded();

  const config = readPluginSettings(STRATEGY_BUILDER_PLUGIN_DIR);
  const provider = config[LLM_CONFIG_KEYS.SELECTED_PROVIDER];
  const model = config[LLM_CONFIG_KEYS.SELECTED_MODEL];

  if (typeof provider !== 'string' || provider === '') {
    return null;
  }
  return { provider, model: typeof model === 'string' ? model : '' };
}

/**
 * Persist the canonical LLM selection. Throws on unknown provider id
 * (TICKET_857 -- callers surface the error to their own layer).
 */
export async function setLlmSelection(provider: string, model: string): Promise<void> {
  if (!isLlmProviderId(provider)) {
    throw new Error(mainT(getCurrentMainLocale(), 'errors', 'main.llmSelection.unknownProvider', { provider }));
  }
  await migrateHostSelectionIfNeeded();
  await updatePluginSettings(STRATEGY_BUILDER_PLUGIN_DIR, {
    [LLM_CONFIG_KEYS.SELECTED_PROVIDER]: provider,
    [LLM_CONFIG_KEYS.SELECTED_MODEL]: model,
  });
}
