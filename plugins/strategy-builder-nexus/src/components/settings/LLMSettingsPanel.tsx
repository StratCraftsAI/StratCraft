/**
 * LLMSettingsPanel - Custom LLM Settings Component for Strategy Builder Plugin
 *
 * Implements TICKET_089 (LLM Selector) and TICKET_090 (API Key Management):
 * - Provider filtering based on configured API keys
 * - Model selection per provider
 *
 * TICKET_809_4a Phase 3: Stripped local BYOK ProviderCard implementation
 * (inline API key input, show/hide, verify button, per-card test/save UI).
 * Credential interaction is now delegated to the host's shared
 * `<SecretsPanelModal>` via the `@host/secrets` externalisation contract.
 *
 * Builder retains ownership of:
 *   - Model selection per provider (writes to plugin.config)
 *   - PRO_CATALOG / Plan Credits surface (host-agnostic Builder feature)
 *   - Catalog snapshot/staleness banners (Builder owns the llm-catalog hook)
 *
 * BYOK credential management surfaces through the "Manage API Keys"
 * button -- one button, one modal, one renderer (the host's), shared
 * with System Settings -> Config -> LLM Providers.
 *
 * @see TICKET_089 - LLM Selector Component
 * @see TICKET_090 - LLM API Key Management
 * @see TICKET_081 - Plugin Settings Architecture (Custom Settings Component)
 * @see TICKET_092 - Code Placement (config extracted to llm-providers.ts)
 * @see TICKET_809_4a - Host UI exposure for plugin shells
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Key,
  Brain,
  Check,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  Plus,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import { LLM_CONFIG_KEYS } from '@StratCraft/types'; // TICKET_1023_6
import { SecretsPanelModal } from '@host/secrets';
import {
  BYOK_PROVIDERS_LIST,
  DEFAULT_PROVIDER_ID,
  DEFAULT_MODEL_ID,
  getProviderName,
  type ProMarketplaceModel,
} from '../../config/llm-provider-ui';
import { useLLMCatalog, type LLMCatalogModel } from '../../hooks/useLLMCatalog';
import { formatSnapshotTimestamp, isStoredModelStale } from './llm-settings-helpers';
import { ApiKeyPrivacyStatement } from './ApiKeyPrivacyStatement';
import { ProModelMarketplace } from './ProModelMarketplace';

/**
 * TICKET_809_2: Synthetic pluginId for global credentials (LLM API keys).
 * LLM keys are host-owned, not Builder-owned -- every plugin reads from the
 * same 'host' namespace. The `pluginId` prop is the *host plugin's identity*
 * (used for plugin.config namespace), distinct from credential ownership.
 * Renderer-side literal duplicates the host-process HOST_PLUGIN_ID constant
 * (renderer cannot import from main).
 */
const CREDENTIAL_PLUGIN_ID = 'host';

interface ProviderStatus {
  providerId: string;
  hasApiKey: boolean;
  isConfigured: boolean;
  isVerified: boolean;
}

type UserTier = 'pro' | 'gold' | 'basic' | 'free' | null;

interface LLMSettingsPanelProps {
  pluginId: string;
}

/**
 * Map Builder-side BYOK UI ids (uppercase: CLAUDE, OPENAI...) to lowercase
 * registry provider ids used by the host LLM contributions.
 */
function toRegistryProviderId(builderId: string): string {
  return builderId.toLowerCase();
}

// =============================================================================
// BYOK status row - thin per-provider summary with a model picker
// =============================================================================

interface ByokStatusRowProps {
  providerId: string;
  providerName: string;
  isSelected: boolean;
  hasApiKey: boolean;
  isVerified: boolean;
  selectedModel: string;
  catalogModels: LLMCatalogModel[];
  onModelChange: (providerId: string, modelId: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function ByokStatusRow({
  providerId,
  providerName,
  isSelected,
  hasApiKey,
  isVerified,
  selectedModel,
  catalogModels,
  onModelChange,
  t,
}: ByokStatusRowProps): JSX.Element {
  return (
    <div
      className={`rounded-lg border p-3 transition-all ${
        isSelected
          ? 'border-color-terminal-accent-teal bg-color-terminal-accent-teal/5'
          : 'border-white/20 hover:border-white/30'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{providerName}</span>
          {hasApiKey && isVerified && <Check className="h-3.5 w-3.5 text-green-500" />}
          {hasApiKey && !isVerified && (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
          )}
          {isSelected && hasApiKey && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-color-terminal-accent-teal/15 text-color-terminal-accent-teal border border-color-terminal-accent-teal/30">
              {t('llmSettings.activeBadge')}
            </span>
          )}
        </div>
        {!hasApiKey && (
          <span className="text-[10px] text-muted-foreground">
            {t('llmSettings.notConfigured')}
          </span>
        )}
      </div>

      {hasApiKey && catalogModels.length > 0 && (
        <div className="relative">
          <select
            value={isSelected ? selectedModel : ''}
            onChange={(e) => onModelChange(providerId, e.target.value)}
            className="w-full appearance-none rounded-lg border border-white/20 bg-black/50 px-3 py-1.5 pr-9 text-xs focus:border-color-terminal-accent-teal focus:outline-none"
          >
            {!isSelected && (
              <option value="" className="bg-color-terminal-panel">
                {t('llmSettings.selectModel')}
              </option>
            )}
            {catalogModels.map((m) => (
              <option key={m.id} value={m.id} className="bg-color-terminal-panel">
                {m.name}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        </div>
      )}
    </div>
  );
}

// =============================================================================
// PRO_CATALOG provider card (Plan Credits) -- unchanged from pre-refactor
// =============================================================================

interface ProProviderCardProps {
  pluginId: string;
  isSelected: boolean;
  selectedModel: string;
  onModelChange: (providerId: string, modelId: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function ProProviderCard({
  pluginId,
  isSelected,
  selectedModel,
  onModelChange,
  t,
}: ProProviderCardProps): JSX.Element {
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [userModels, setUserModels] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<ProMarketplaceModel[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [configResult, catalogResult] = await Promise.all([
          window.electronAPI.plugin.getConfig(pluginId),
          window.electronAPI.llmCatalog.getModels(),
        ]);
        if (configResult.success && configResult.config) {
          const models = configResult.config[LLM_CONFIG_KEYS.PRO_USER_MODELS];
          if (Array.isArray(models)) {
            setUserModels(models as string[]);
          }
        }
        if (catalogResult.success && catalogResult.data) {
          setCatalog(catalogResult.data);
        }
      } catch (e) {
        console.error('[E:SETTINGS:PRO_PROVIDER_LOAD_FAILED] [ProProviderCard] Failed to load data:', e);
      }
    })();
  }, [pluginId]);

  const handleSaveUserModels = async (modelIds: string[]) => {
    setUserModels(modelIds);
    setMarketplaceOpen(false);
    try {
      await window.electronAPI.plugin.setConfig(pluginId, LLM_CONFIG_KEYS.PRO_USER_MODELS, modelIds);
    } catch (e) {
      console.error('[E:SETTINGS:PRO_PROVIDER_SAVE_MODELS_FAILED] [ProProviderCard] Failed to save user models:', e);
    }
  };

  const handleRemoveUserModel = async (modelId: string) => {
    const updated = userModels.filter((id) => id !== modelId);
    setUserModels(updated);
    try {
      await window.electronAPI.plugin.setConfig(pluginId, LLM_CONFIG_KEYS.PRO_USER_MODELS, updated);
      if (selectedModel === modelId) {
        const fallback = updated[0];
        if (fallback) {
          onModelChange('PRO_CATALOG', fallback);
        }
      }
    } catch (e) {
      console.error('[E:SETTINGS:PRO_PROVIDER_REMOVE_MODEL_FAILED] [ProProviderCard] Failed to remove user model:', e);
    }
  };

  const userModelEntries = userModels
    .map((id) => catalog.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => m !== undefined);

  return (
    <>
      <div
        className={`rounded-lg border p-4 transition-all ${
          isSelected
            ? 'border-color-terminal-accent-teal bg-color-terminal-accent-teal/5'
            : 'border-white/20 hover:border-white/30'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-color-terminal-accent-teal/10">
              <Sparkles className="h-5 w-5 text-color-terminal-accent-teal" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{getProviderName('PRO_CATALOG')}</span>
                <Check className="h-4 w-4 text-green-500" />
                {isSelected && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-color-terminal-accent-teal/15 text-color-terminal-accent-teal border border-color-terminal-accent-teal/30">
                    {t('llmSettings.activeBadge')}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('llmSettings.platformProvider')}
              </div>
            </div>
          </div>
        </div>

        {userModelEntries.length > 0 && (
          <div className="mb-3">
            <div className="text-xs text-muted-foreground mb-1">
              {t('llmSettings.nonaUserModels')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {userModelEntries.map((model) => (
                <span
                  key={model.id}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                    isSelected && selectedModel === model.id
                      ? 'bg-color-terminal-accent-teal/20 text-color-terminal-accent-teal'
                      : 'bg-white/5 text-muted-foreground'
                  }`}
                >
                  {model.name}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveUserModel(model.id);
                    }}
                    className="hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => setMarketplaceOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-white/5 hover:bg-white/10 transition-colors"
          >
            <Plus className="h-4 w-4" />
            {t('llmSettings.addModels')}
          </button>
        </div>

        {userModelEntries.length > 0 && (
          <div className="pt-3 mt-3 border-t border-white/10">
            <label className="block text-xs text-muted-foreground mb-2">
              {t('llmSettings.model')}
            </label>
            <div className="relative">
              <select
                value={selectedModel}
                onChange={(e) => onModelChange('PRO_CATALOG', e.target.value)}
                className="w-full appearance-none rounded-lg border border-white/20 bg-black/50 px-3 py-2 pr-10 text-sm focus:border-color-terminal-accent-teal focus:outline-none"
              >
                {userModelEntries.map((model) => (
                  <option key={model.id} value={model.id} className="bg-color-terminal-panel">
                    {model.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>
        )}
      </div>

      <ProModelMarketplace
        open={marketplaceOpen}
        selectedModels={userModels}
        onSave={handleSaveUserModels}
        onClose={() => setMarketplaceOpen(false)}
      />
    </>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function LLMSettingsPanel({ pluginId }: LLMSettingsPanelProps): JSX.Element {
  const { t } = useTranslation('strategy-builder');
  const [loading, setLoading] = useState(true);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>(DEFAULT_PROVIDER_ID);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL_ID);
  const [userTier, setUserTier] = useState<UserTier>(null);
  const [secretsModalOpen, setSecretsModalOpen] = useState(false);

  const { getModels: getCatalogModels, refresh: refreshCatalog, catalogStatus } = useLLMCatalog();
  const catalogModelsForActive = useMemo(
    () => getCatalogModels(selectedProvider),
    [getCatalogModels, selectedProvider],
  );
  const stale = isStoredModelStale(selectedProvider, selectedModel, catalogModelsForActive);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const verifiedMap = new Map<string, boolean>();
      try {
        const providersWithStatus = await window.electronAPI.entitlement.getLLMProvidersWithStatus();
        if (providersWithStatus.success && providersWithStatus.data) {
          for (const p of providersWithStatus.data) {
            verifiedMap.set(p.id, p.status === 'verified' || p.status === 'platform');
          }
        }
      } catch (e) {
        console.error('[E:SETTINGS:LLM_VERIFICATION_LOAD_FAILED] [LLMSettingsPanel] Failed to load verification statuses:', e);
      }

      const statuses: ProviderStatus[] = [];
      statuses.push({
        providerId: 'PRO_CATALOG',
        hasApiKey: true,
        isConfigured: true,
        isVerified: true,
      });
      for (const provider of BYOK_PROVIDERS_LIST) {
        const hasResult = await window.electronAPI.credential.has(
          CREDENTIAL_PLUGIN_ID,
          provider.secretKey,
        );
        statuses.push({
          providerId: provider.id,
          hasApiKey: hasResult.exists,
          isConfigured: hasResult.exists,
          isVerified: verifiedMap.get(provider.id) === true,
        });
      }
      setProviderStatuses(statuses);

      const configResult = await window.electronAPI.plugin.getConfig(pluginId);
      if (configResult.success && configResult.config) {
        const config = configResult.config;
        if (config[LLM_CONFIG_KEYS.SELECTED_PROVIDER]) {
          setSelectedProvider(config[LLM_CONFIG_KEYS.SELECTED_PROVIDER] as string);
        }
        if (config[LLM_CONFIG_KEYS.SELECTED_MODEL]) {
          setSelectedModel(config[LLM_CONFIG_KEYS.SELECTED_MODEL] as string);
        }
      }

      try {
        const access = await window.electronAPI.entitlement.canAccessLLMFeatures();
        if (access.success && access.data) {
          setUserTier((access.data.userTier ?? null) as UserTier);
        }
      } catch (e) {
        console.error('[E:SETTINGS:LLM_USER_TIER_LOAD_FAILED] [LLMSettingsPanel] Failed to load user tier:', e);
      }
    } catch (e) {
      console.error('[E:SETTINGS:LLM_SETTINGS_LOAD_FAILED] Failed to load LLM settings:', e);
    } finally {
      setLoading(false);
    }
  }, [pluginId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleModelChange = async (providerId: string, modelId: string) => {
    setSelectedProvider(providerId);
    setSelectedModel(modelId);
    try {
      await window.electronAPI.plugin.setConfig(pluginId, LLM_CONFIG_KEYS.SELECTED_PROVIDER, providerId);
      await window.electronAPI.plugin.setConfig(pluginId, LLM_CONFIG_KEYS.SELECTED_MODEL, modelId);
    } catch (e) {
      console.error('[E:SETTINGS:LLM_SELECTION_SAVE_FAILED] Failed to save selection:', e);
    }
  };

  // When the host SecretsPanelModal closes, reload status + refresh catalog
  // so any newly-added key surfaces immediately in the BYOK rows below.
  const handleSecretsModalClose = useCallback(async () => {
    setSecretsModalOpen(false);
    await loadData();
    await refreshCatalog();
  }, [loadData, refreshCatalog]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const byokConfiguredCount = providerStatuses.filter(
    (s) => s.providerId !== 'PRO_CATALOG' && s.hasApiKey,
  ).length;
  const byokTotal = BYOK_PROVIDERS_LIST.length;

  const showPlanCredits = userTier === 'pro' || userTier === 'gold';
  const proProviderStatus = providerStatuses.find((s) => s.providerId === 'PRO_CATALOG');

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium flex items-center gap-2">
          <Brain className="h-5 w-5 text-color-terminal-accent-teal" />
          {t('llmSettings.title')}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">{t('llmSettings.subtitle')}</p>
      </div>

      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">
              {byokConfiguredCount} / {byokTotal} {t('llmSettings.providersConfigured')}
            </div>
            <div className="text-xs text-muted-foreground">
              {byokConfiguredCount === 0 && !showPlanCredits
                ? t('llmSettings.configureAtLeastOne')
                : `${t('llmSettings.active')} ${getProviderName(selectedProvider)}`}
            </div>
          </div>
          {byokConfiguredCount === 0 && !showPlanCredits && (
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
          )}
        </div>
      </div>

      {catalogStatus.source === 'snapshot' && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-xs flex-1">
            <div className="font-medium text-amber-500">
              {t('llmSettings.offlineCatalogBadge')}
            </div>
            <div className="text-amber-500/80 mt-0.5">
              {t('llmSettings.offlineCatalogTooltip', {
                timestamp: formatSnapshotTimestamp(catalogStatus.snapshotTimestamp),
              })}
            </div>
          </div>
          <button
            onClick={() => {
              void refreshCatalog();
            }}
            className="text-xs text-color-terminal-accent-teal hover:underline shrink-0"
          >
            {t('llmSettings.refreshCatalog')}
          </button>
        </div>
      )}

      {catalogStatus.source === 'empty' && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 flex items-start gap-2">
          <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <div className="text-xs flex-1">
            <div className="font-medium text-red-500">{t('llmSettings.catalogUnavailable')}</div>
            <div className="text-red-500/80 mt-0.5">
              {t('llmSettings.catalogUnavailableMessage')}
            </div>
          </div>
          <button
            onClick={() => {
              void refreshCatalog();
            }}
            className="text-xs text-color-terminal-accent-teal hover:underline shrink-0"
          >
            {t('llmSettings.retry')}
          </button>
        </div>
      )}

      {stale && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-xs">
            <div className="font-medium text-amber-500">{t('llmSettings.staleModelTitle')}</div>
            <div className="text-amber-500/80 mt-0.5">
              {t('llmSettings.staleModelMessage', {
                provider: getProviderName(selectedProvider),
                model: selectedModel,
              })}
            </div>
          </div>
          <button
            onClick={() => {
              void refreshCatalog();
            }}
            className="ml-auto text-xs text-color-terminal-accent-teal hover:underline"
          >
            {t('llmSettings.refreshCatalog')}
          </button>
        </div>
      )}

      {showPlanCredits && proProviderStatus && (
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-color-terminal-accent-teal flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              {t('llmSettings.planCreditsSection')}
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('llmSettings.planCreditsDescription')}
            </p>
          </div>
          <ProProviderCard
            key="PRO_CATALOG"
            pluginId={pluginId}
            isSelected={selectedProvider === 'PRO_CATALOG'}
            selectedModel={selectedProvider === 'PRO_CATALOG' ? selectedModel : ''}
            onModelChange={handleModelChange}
            t={t}
          />
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Key className="h-4 w-4" />
              {t('llmSettings.byokSection')}
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('llmSettings.byokDescription')}
            </p>
          </div>
          <button
            onClick={() => setSecretsModalOpen(true)}
            className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-color-terminal-accent-teal/15 text-color-terminal-accent-teal border border-color-terminal-accent-teal/30 hover:bg-color-terminal-accent-teal/25 transition-colors"
          >
            <Key className="h-4 w-4" />
            {t('llmSettings.manageApiKeys', { defaultValue: 'Manage API Keys' })}
          </button>
        </div>
        <div className="grid gap-2">
          {BYOK_PROVIDERS_LIST.map((provider) => {
            const status = providerStatuses.find((s) => s.providerId === provider.id);
            return (
              <ByokStatusRow
                key={provider.id}
                providerId={provider.id}
                providerName={provider.name}
                isSelected={selectedProvider === provider.id}
                hasApiKey={status?.hasApiKey ?? false}
                isVerified={status?.isVerified ?? false}
                selectedModel={selectedProvider === provider.id ? selectedModel : ''}
                catalogModels={getCatalogModels(provider.id)}
                onModelChange={handleModelChange}
                t={t}
              />
            );
          })}
        </div>
      </div>

      <ApiKeyPrivacyStatement compact />

      <SecretsPanelModal
        visible={secretsModalOpen}
        onClose={handleSecretsModalClose}
        filter={{ providerIds: BYOK_PROVIDERS_LIST.map((p) => toRegistryProviderId(p.id)) }}
        headingKey="settings:secretsPanel.modalTitle"
        autoCloseOnConfigured={false}
      />
    </div>
  );
}

export type { LLMSettingsPanelProps };
