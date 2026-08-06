/**
 * LLMProviderSelector Component
 *
 * TICKET_194: LLM Provider Selector in Status Bar
 * TICKET_195: Model Selection for BYOK providers
 *
 * Dropdown selector for switching between configured LLM providers and models.
 * Shows verification status with icons.
 *
 * TICKET_696: NONA removed; PRO_CATALOG sentinel for Pro plan selections
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Circle, CheckCircle2, AlertTriangle, ChevronDown, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { LLM_CONFIG_KEYS, LLM_PROVIDER_PRO_CATALOG, LLM_PROVIDER_NONA } from '@StratCraft/types';
import { PLUGIN_IDS } from '@shared/constants';
import { selectCostPreferredProvider, getProviderRecord } from '@shared/constants/llm-providers';
import { useAuthPlan, useAuthState, useHasPlan } from '@/hooks/useAuth';
import { useDropdown } from '../../hooks/useDropdown';
import {
  applyLinoUserModelSelection,
  shouldExposeProviderModels,
} from '@/lib/lino-model-selection';

// =============================================================================
// Types
// =============================================================================

export interface LLMModel {
  id: string;
  name: string;
  // TICKET_1265_3_1 (Round 2): curated INTERSECT discovered. Internal-only now
  // (does not drive UI grouping -- the list is already curated-only or fallback).
  recommended?: boolean;
}

export interface LLMProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  status: 'platform' | 'verified' | 'unverified';
  defaultModel: string;
  models: LLMModel[]; // TICKET_195
  // TICKET_1267 D3: server-recommended model when defaultModel is retired upstream
  recommendedModel?: string;
}

// =============================================================================
// Component
// =============================================================================

export function LLMProviderSelector() {
  const { t } = useTranslation('ui');
  const [providers, setProviders] = useState<LLMProviderInfo[]>([]);
  // TICKET_646_1 Phase 6: All Pro catalog providers from backend
  const [proCatalogProviders, setProCatalogProviders] = useState<Array<{
    id: string;
    name: string;
    defaultModel: string;
    models: Array<{ id: string; name: string }>;
  }>>([]);
  // TICKET_638: Default to empty -- resolved from config or first available BYOK provider
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>(''); // TICKET_516: nona-fast removed
  // TICKET_1266_1: the Pro catalog provider that owns selectedModel when
  // selectedProvider is PRO_CATALOG. Model ids are NOT unique across the Pro
  // catalog, so the provider dimension is persisted, never derived by scanning
  // model lists. Only consulted while PRO_CATALOG is selected; stale values
  // from an earlier Pro selection are inert during BYOK selections.
  const [selectedProProvider, setSelectedProProvider] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const { isOpen, toggle, close, triggerRef, dropdownRef, triggerProps } = useDropdown<HTMLButtonElement, HTMLDivElement>();

  // TICKET_693: Mutual exclusion between Pro and BYOK model list expansion
  const [expandedSection, setExpandedSection] = useState<'pro' | 'byok' | null>(null);
  const [expandedProProvider, setExpandedProProvider] = useState<string | null>(null);

  // TICKET_194_1: Get user plan to filter NONA for FREE users
  const userPlan = useAuthPlan();
  // TICKET_702: Use auth state to detect confirmed unauthenticated user
  const { isAuthenticated, isLoading: authIsLoading } = useAuthState();
  // TICKET_706: Pro catalog requires PRO or GOLD tier (BASIC = BYOK-only per TICKET_704)
  const hasProCatalogAccess = useHasPlan('PRO');

  // ---------------------------------------------------------------------------
  // TICKET_1267 D2: BYOK model discovery moved server-side into
  // getProvidersWithStatus(). provider.models now arrives already enriched with
  // the provider's real API model list, so the renderer reads it directly --
  // the old byokModelsMap / fetchAllByokModels / getEffectiveModels machinery
  // is gone. Stale-default reconciliation is driven by provider.recommendedModel.
  // ---------------------------------------------------------------------------

  // Reconcile selectedModel using the server-computed recommendation.
  // The hardcoded defaultModel (e.g. 'deepseek-chat') may reference a model ID
  // the provider's API no longer serves. The server sets recommendedModel to the
  // first available model in that case; adopt it so UI and persisted config stay valid.
  useEffect(() => {
    if (!selectedProvider || selectedProvider === LLM_PROVIDER_PRO_CATALOG) return;
    const provider = providers.find(p => p.id === selectedProvider);
    if (!provider || provider.models.length === 0) return;
    if (provider.models.some(m => m.id === selectedModel)) return;
    // selectedModel is not in the enriched model list — auto-correct to the
    // server recommendation (falls back to first model if unset).
    const corrected = provider.recommendedModel ?? provider.models[0].id;
    setSelectedModel(corrected);
    void window.electronAPI.plugin.setConfig(
      PLUGIN_IDS.STRATEGY, LLM_CONFIG_KEYS.SELECTED_MODEL, corrected
    );
    window.dispatchEvent(new CustomEvent('llm-selection-changed', {
      detail: { provider: selectedProvider, model: corrected }
    }));
  }, [providers, selectedProvider, selectedModel]);

  // TICKET_706: Filter providers based on user plan -- only PRO/GOLD see Pro catalog
  const filteredProviders = useMemo(() => {
    if (!hasProCatalogAccess) {
      return providers.filter(p => p.id !== LLM_PROVIDER_PRO_CATALOG);
    }
    return providers;
  }, [providers, hasProCatalogAccess]);

  // Load providers and current selection
  const loadData = useCallback(async () => {
    try {
      // Get providers with status (TICKET_483: includes user-added Nona marketplace models)
      const result = await window.electronAPI.entitlement.getLLMProvidersWithStatus();
      let effectiveProviders = result.success && result.data ? result.data : [];

      // TICKET_646_1 Phase 6: Fetch all Pro catalog providers from backend
      const catalogResult = await window.electronAPI.llmCatalog.getProviders();
      if (catalogResult.success && catalogResult.data && catalogResult.data.length > 0) {
        setProCatalogProviders(catalogResult.data);
      } else {
        setProCatalogProviders([]);
      }

      // Track resolved values for initial event dispatch (TICKET_568_3_2)
      let resolvedProvider = '';
      let resolvedModel = '';

      // Get current selection from plugin config
      let provider = '';
      let model = '';
      const configResult = await window.electronAPI.plugin.getConfig(PLUGIN_IDS.STRATEGY);
      if (configResult.success && configResult.config) {
        provider = configResult.config[LLM_CONFIG_KEYS.SELECTED_PROVIDER] as string || '';
        model = configResult.config[LLM_CONFIG_KEYS.SELECTED_MODEL] as string || ''; // TICKET_195
        // TICKET_1266_1: owning Pro catalog provider (empty for configs written
        // before this key existed -- the owner memo then falls back once).
        setSelectedProProvider(
          configResult.config[LLM_CONFIG_KEYS.SELECTED_PRO_PROVIDER] as string || ''
        );
        effectiveProviders = applyLinoUserModelSelection(
          effectiveProviders,
          configResult.config[LLM_CONFIG_KEYS.LINO_USER_MODELS],
        );
      }
      // TICKET_1266: the Settings-curated Lino subset is the sole source for
      // bottom-bar Lino models. An absent config intentionally means none.
      if (!configResult.success || !configResult.config) {
        effectiveProviders = applyLinoUserModelSelection(effectiveProviders, []);
      }
      setProviders(effectiveProviders);

      // TICKET_702: Use isAuthenticated + authIsLoading instead of userPlan to detect
      // confirmed unauthenticated users. userPlan is null for both "still loading" and
      // "logged out" states, but authIsLoading distinguishes them.
      const authResolved = !authIsLoading;
      const isFree = authResolved && !isAuthenticated;

      // TICKET_639: Auto-select first configured BYOK provider when config is empty,
      // config read failed, or user without Pro catalog access has stale PRO_CATALOG selection.
      // TICKET_696: Also migrate persisted LLM_PROVIDER_NONA to auto-select.
      // TICKET_702: Also clear PRO_CATALOG when confirmed unauthenticated (not just plan === FREE).
      // TICKET_706: Also clear PRO_CATALOG for BASIC users (BYOK-only tier).
      const needsAutoSelect = !provider || provider === LLM_PROVIDER_NONA || (authResolved && (isFree || !hasProCatalogAccess) && provider === LLM_PROVIDER_PRO_CATALOG);

      if (needsAutoSelect && effectiveProviders.length > 0) {
        // TICKET_695: Use cost-aware selection instead of array-order first match.
        // TICKET_1265_7 D1: Ollama is now always listed (configured=true, no key),
        // but a keyless provider must NOT become the silent first-launch default
        // (it may point at a local Ollama that is not running). Exclude
        // required:false providers from AUTO-SELECT only -- they remain fully
        // selectable in the dropdown. This keeps desktop first-launch behavior
        // unchanged (AC5): no BYOK key -> empty selection -> setup prompt.
        const configuredIds = new Set(
          effectiveProviders
            .filter((p: LLMProviderInfo) =>
              p.id !== LLM_PROVIDER_PRO_CATALOG &&
              p.configured &&
              p.models.length > 0 &&
              (getProviderRecord(p.id)?.credential.required ?? true))
            .map((p: LLMProviderInfo) => p.id)
        );
        const preferred = selectCostPreferredProvider(configuredIds);
        if (preferred) {
          setSelectedProvider(preferred.providerId);
          resolvedProvider = preferred.providerId;
          setSelectedModel(preferred.modelId);
          resolvedModel = preferred.modelId;
          await window.electronAPI.plugin.setConfig(PLUGIN_IDS.STRATEGY, LLM_CONFIG_KEYS.SELECTED_PROVIDER, preferred.providerId);
          await window.electronAPI.plugin.setConfig(PLUGIN_IDS.STRATEGY, LLM_CONFIG_KEYS.SELECTED_MODEL, preferred.modelId);
        }
        // else: no BYOK configured -- leave empty, selector will show setup prompt
      } else if (provider) {
        setSelectedProvider(provider);
        resolvedProvider = provider;

        // Validate model belongs to selected provider; fix stale cross-provider model.
        // TICKET_646_1 fix: Only reset if the model positively belongs to a DIFFERENT
        // provider's static list (cross-provider stale). Models not found in any static
        // list are valid (BYOK-discovered or custom model IDs) and must be preserved.
        if (model && effectiveProviders.length > 0) {
          const providerInfo = effectiveProviders.find((p: LLMProviderInfo) => p.id === provider);
          if (providerInfo) {
            const belongsToCurrent = providerInfo.models.some((m: LLMModel) => m.id === model);
            const belongsToOther = !belongsToCurrent && effectiveProviders.some(
              (p: LLMProviderInfo) => p.id !== provider && p.models.some((m: LLMModel) => m.id === model)
            );
            if (belongsToOther) {
              // Model is from a different provider's static list - reset to current default
              setSelectedModel(providerInfo.defaultModel);
              resolvedModel = providerInfo.defaultModel;
              await window.electronAPI.plugin.setConfig(
                PLUGIN_IDS.STRATEGY, LLM_CONFIG_KEYS.SELECTED_MODEL, providerInfo.defaultModel
              );
            } else {
              // Model belongs to current provider (static, BYOK-discovered, or custom)
              setSelectedModel(model);
              resolvedModel = model;
            }
          } else {
            setSelectedModel(model);
            resolvedModel = model;
          }
        } else if (model) {
          setSelectedModel(model);
          resolvedModel = model;
        }
      }

      // TICKET_568_3_2: Dispatch initial LLM selection event so all listeners
      // (Signal Discovery, Strategy Builder, etc.) receive the current selection on mount
      if (resolvedProvider && resolvedModel) {
        window.dispatchEvent(new CustomEvent('llm-selection-changed', {
          detail: { provider: resolvedProvider, model: resolvedModel }
        }));
      }
    } catch (error) {
      console.error('[E:UI:LLM_PROVIDER_LOAD_FAILED] Failed to load:', error);
    } finally {
      setLoading(false);
    }
  }, [userPlan, isAuthenticated, authIsLoading, hasProCatalogAccess]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const refresh = () => { void loadData(); };
    window.addEventListener('lino-models-changed', refresh);
    return () => window.removeEventListener('lino-models-changed', refresh);
  }, [loadData]);

  // TICKET_194_1: Listen for validation status changes and refresh
  useEffect(() => {
    const unsubscribe = window.electronAPI.entitlement.onLLMProviderStatusChanged(() => {
      loadData();
    });
    return unsubscribe;
  }, [loadData]);

  // TICKET_1276 AC7: an external process (MCP standalone serving the webui)
  // wrote the shared selection file or credentials store -- re-fetch so the
  // in-app picker reflects it within one watcher tick.
  useEffect(() => {
    const unsubscribe = window.electronAPI.entitlement.onLLMExternalStoreChanged(() => {
      loadData();
    });
    return unsubscribe;
  }, [loadData]);

  // Handle provider selection - keep menu open if provider has multiple models
  const handleSelectProvider = async (providerId: string, defaultModel: string) => {
    const provider = filteredProviders.find(p => p.id === providerId);
    const models = provider?.models ?? [];
    const exposesModelChoices = provider ? shouldExposeProviderModels(provider) : false;

    // Resolve the actual model: prefer the (server-enriched) discovered list over
    // the hardcoded defaultModel, which may reference a retired upstream model ID
    // (e.g. deepseek-chat after DeepSeek retired it in favour of v4 models).
    // TICKET_1267 D3: recommendedModel is the server's stale-default correction.
    const resolvedModel = models.length > 0
      ? (models.find(m => m.id === defaultModel)?.id ?? provider?.recommendedModel ?? models[0].id)
      : defaultModel;

    setSelectedProvider(providerId);
    setSelectedModel(resolvedModel);

    // Only close if provider has single model (no further selection needed)
    if (!exposesModelChoices) {
      close();
    }

    // Save to plugin config
    try {
      await window.electronAPI.plugin.setConfig(PLUGIN_IDS.STRATEGY, LLM_CONFIG_KEYS.SELECTED_PROVIDER, providerId);
      await window.electronAPI.plugin.setConfig(PLUGIN_IDS.STRATEGY, LLM_CONFIG_KEYS.SELECTED_MODEL, resolvedModel);
      // TICKET_196: Notify listeners of LLM selection change
      window.dispatchEvent(new CustomEvent('llm-selection-changed', {
        detail: { provider: providerId, model: resolvedModel }
      }));
    } catch (error) {
      console.error('[E:UI:LLM_SELECTION_SAVE_FAILED] Failed to save selection:', error);
    }
  };

  // TICKET_195: Handle model selection - always close menu after model selection
  const handleSelectModel = async (modelId: string) => {
    setSelectedModel(modelId);
    close(); // Close after final selection

    // Save to plugin config
    try {
      await window.electronAPI.plugin.setConfig(PLUGIN_IDS.STRATEGY, LLM_CONFIG_KEYS.SELECTED_MODEL, modelId);
      // TICKET_196: Notify listeners of LLM selection change
      window.dispatchEvent(new CustomEvent('llm-selection-changed', {
        detail: { provider: selectedProvider, model: modelId }
      }));
    } catch (error) {
      console.error('[E:UI:LLM_MODEL_SAVE_FAILED] Failed to save model:', error);
    }
  };

  // TICKET_1265_3_1 F4 (Round 2, curated-only): render a BYOK provider's model
  // sub-items as a single flat list. When curation is active `models` is already
  // the curated intersection (only recommended entries); when curation is absent
  // it is the discovery + F5 fallback. Either way there is no "Recommended" /
  // "All models" split -- the group headers were removed with AC10.
  const renderModelButtons = (models: LLMModel[]) => {
    const modelButton = (model: LLMModel) => (
      <button
        key={model.id}
        onClick={() => handleSelectModel(model.id)}
        className={cn(
          'w-full flex items-center gap-2 pl-8 pr-3 py-1 text-[10px] text-left hover:bg-white/5 transition-colors',
          model.id === selectedModel ? 'text-primary' : 'text-muted-foreground'
        )}
      >
        <span className="flex-1">{model.name}</span>
        {model.id === selectedModel && (
          <Circle className="w-1.5 h-1.5 fill-current text-primary" />
        )}
      </button>
    );

    return <>{models.map(modelButton)}</>;
  };

  // Get status icon
  const getStatusIcon = (status: LLMProviderInfo['status']) => {
    switch (status) {
      case 'platform':
        return <Sparkles className="w-3 h-3 text-color-terminal-text-muted" />;
      case 'verified':
        return <CheckCircle2 className="w-3 h-3 text-color-terminal-accent-teal" />;
      case 'unverified':
        return <AlertTriangle className="w-3 h-3 text-color-terminal-accent-gold" />;
    }
  };

  // Get tooltip text
  const getTooltip = (status: LLMProviderInfo['status']) => {
    switch (status) {
      case 'platform':
        return t('llmSelector.platformProvider');
      case 'verified':
        return t('llmSelector.verified');
      case 'unverified':
        return t('llmSelector.unverified');
    }
  };

  // Find current provider info -- only show a provider that is actually selected (persisted)
  // TICKET_639: Do NOT fall back to filteredProviders[0] to avoid UI/config desync
  const currentProvider = selectedProvider ? filteredProviders.find(p => p.id === selectedProvider) : undefined;

  // PRO_CATALOG is a sentinel ID not present in filteredProviders (which only has BYOK providers).
  // Resolve the display name and model from proCatalogProviders when PRO_CATALOG is selected.
  const isProCatalogSelected = selectedProvider === LLM_PROVIDER_PRO_CATALOG;

  // TICKET_1266_1: which Pro catalog provider owns the current selection.
  // The persisted id is authoritative; scanning model lists is ONLY the
  // migration fallback for configs written before SELECTED_PRO_PROVIDER
  // existed (model ids are not unique across the catalog).
  const proSelectionOwnerId = useMemo(() => {
    if (!isProCatalogSelected) return null;
    if (selectedProProvider && proCatalogProviders.some(p => p.id === selectedProProvider)) {
      return selectedProProvider;
    }
    return proCatalogProviders.find(p => p.models.some(m => m.id === selectedModel))?.id ?? null;
  }, [isProCatalogSelected, selectedProProvider, proCatalogProviders, selectedModel]);

  // Resolve Pro catalog display info from the owning provider (TICKET_1266_1)
  const proCatalogDisplay = useMemo(() => {
    if (!isProCatalogSelected || proCatalogProviders.length === 0) return null;
    const owner = proSelectionOwnerId
      ? proCatalogProviders.find(p => p.id === proSelectionOwnerId)
      : undefined;
    const ownedModel = owner?.models.find(m => m.id === selectedModel);
    if (owner && ownedModel) {
      return { providerName: owner.name, modelName: ownedModel.name };
    }
    // Model not found under the owning provider -- show raw model ID as fallback
    return { providerName: t('llmSelector.proFallback'), modelName: selectedModel };
  }, [isProCatalogSelected, proSelectionOwnerId, proCatalogProviders, selectedModel]);

  // TICKET_195 + TICKET_646_1 Phase 6: Find current model name.
  // For Pro catalog, search proCatalogProviders; for BYOK, use provider.models
  // (server-enriched with the provider's real API model list -- TICKET_1267 D2).
  const currentModelName = useMemo(() => {
    if (isProCatalogSelected) {
      return proCatalogDisplay?.modelName || selectedModel;
    }
    if (!currentProvider) return '';
    const model = currentProvider.models.find(m => m.id === selectedModel);
    return model?.name || selectedModel;
  }, [isProCatalogSelected, proCatalogDisplay, currentProvider, selectedModel]);

  // TICKET_195: Check if provider has multiple models (show model selector)
  const hasMultipleModels = isProCatalogSelected
    ? proCatalogProviders.some(p => p.models.length > 0)
    : currentProvider && currentProvider.models.length > 1;

  // TICKET_646_1 Phase 6: Pro section shows ALL backend catalog providers.
  // proCatalogProviders comes from llmCatalog.getProviders() (full backend catalog).

  // TICKET_194_1: Don't render if no providers available (FREE user with no BYOK and no Pro catalog)
  if (loading || (filteredProviders.length === 0 && proCatalogProviders.length === 0)) {
    return null;
  }

  return (
    <div className="relative flex items-center h-full gap-1">
      {/* Provider Selector Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          const opening = !isOpen;
          toggle();
          // TICKET_693: Reset expansion state when opening dropdown
          if (opening) {
            setExpandedSection(null);
            setExpandedProProvider(null);
          }
        }}
        className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
        title={isProCatalogSelected ? t('llmSelector.platformProvider') : (currentProvider ? getTooltip(currentProvider.status) : t('llmSelector.selectProvider'))}
        {...triggerProps}
      >
        {/* Status Icon */}
        {isProCatalogSelected
          ? <Sparkles className="w-3 h-3 text-color-terminal-text-muted" />
          : currentProvider && getStatusIcon(currentProvider.status)
        }

        {/* Provider Name */}
        <span>{isProCatalogSelected
          ? (proCatalogDisplay?.providerName || t('llmSelector.proFallback'))
          : (currentProvider?.name || 'LLM')
        }</span>

        {/* TICKET_195: Show model name if multiple models */}
        {hasMultipleModels && currentModelName && (
          <span className="text-muted-foreground/60">/ {currentModelName}</span>
        )}

        {/* Caret */}
        <ChevronDown
          className={cn(
            'w-2.5 h-2.5 transition-transform',
            isOpen && 'rotate-180'
          )}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div ref={dropdownRef} role="listbox" className="absolute bottom-full left-0 mb-1 min-w-[220px] max-h-[70vh] overflow-y-auto rounded-md border border-border bg-card shadow-lg z-50">
          {/* TICKET_646_1 Phase 6: Pro section - ALL backend catalog providers */}
          {/* TICKET_706: Only PRO/GOLD users see Pro catalog section */}
          {hasProCatalogAccess && proCatalogProviders.length > 0 && (
            <>
              {/* Pro header */}
              <div className="w-full flex items-center gap-2 px-3 py-2 text-[11px] border-b border-border">
                <span className="w-4 flex justify-center">
                  <Sparkles className="w-3 h-3 text-color-terminal-text-muted" />
                </span>
                <span className="flex-1 font-medium text-foreground">{t('llmProvider.badge.pro')}</span>
              </div>
              {/* All Pro providers from backend catalog with model sub-items */}
              {/* TICKET_693: Per-provider expand/collapse, mutual exclusion with BYOK */}
              <div className="py-1 border-b border-border">
                {proCatalogProviders.map((catProvider) => {
                  const isExpanded = expandedSection === 'pro' && expandedProProvider === catProvider.id;
                  return (
                    <React.Fragment key={`pro-${catProvider.id}`}>
                      <button
                        onClick={async () => {
                          // TICKET_693: Toggle this provider's model list; collapse BYOK section.
                          // Do NOT call handleSelectProvider here -- it closes the dropdown when
                          // NONA has no models in filteredProviders (Pro models live in proCatalogProviders).
                          // Instead, persist selection inline and keep dropdown open for model pick.
                          if (isExpanded) {
                            setExpandedProProvider(null);
                            setExpandedSection(null);
                          } else {
                            setExpandedSection('pro');
                            setExpandedProProvider(catProvider.id);
                          }
                          setSelectedProvider(LLM_PROVIDER_PRO_CATALOG);
                          setSelectedModel(catProvider.defaultModel);
                          // TICKET_1266_1: persist the owning catalog provider --
                          // model ids alone cannot identify it (relay duplicates).
                          setSelectedProProvider(catProvider.id);
                          await window.electronAPI.plugin.setConfig(PLUGIN_IDS.STRATEGY, LLM_CONFIG_KEYS.SELECTED_PROVIDER, LLM_PROVIDER_PRO_CATALOG);
                          await window.electronAPI.plugin.setConfig(PLUGIN_IDS.STRATEGY, LLM_CONFIG_KEYS.SELECTED_MODEL, catProvider.defaultModel);
                          await window.electronAPI.plugin.setConfig(PLUGIN_IDS.STRATEGY, LLM_CONFIG_KEYS.SELECTED_PRO_PROVIDER, catProvider.id);
                          window.dispatchEvent(new CustomEvent('llm-selection-changed', {
                            detail: { provider: LLM_PROVIDER_PRO_CATALOG, model: catProvider.defaultModel }
                          }));
                        }}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left hover:bg-white/5 transition-colors',
                          proSelectionOwnerId === catProvider.id
                            ? 'text-primary' : 'text-foreground'
                        )}
                        title={t('llmSelector.platformProvider')}
                      >
                        <span className="w-4 flex justify-center">
                          <Sparkles className="w-3 h-3 text-color-terminal-text-muted" />
                        </span>
                        <span className="flex-1">{catProvider.name}</span>
                        {proSelectionOwnerId === catProvider.id && (
                          <Circle className="w-2 h-2 fill-current text-primary" />
                        )}
                      </button>
                      {/* Model sub-items: only shown when this provider is expanded */}
                      {isExpanded && catProvider.models.map((model) => (
                        <button
                          key={model.id}
                          onClick={async () => {
                            setSelectedProvider(LLM_PROVIDER_PRO_CATALOG);
                            setSelectedModel(model.id);
                            // TICKET_1266_1: the clicked row's provider is the owner.
                            setSelectedProProvider(catProvider.id);
                            close();
                            await window.electronAPI.plugin.setConfig(PLUGIN_IDS.STRATEGY, LLM_CONFIG_KEYS.SELECTED_PROVIDER, LLM_PROVIDER_PRO_CATALOG);
                            await window.electronAPI.plugin.setConfig(PLUGIN_IDS.STRATEGY, LLM_CONFIG_KEYS.SELECTED_MODEL, model.id);
                            await window.electronAPI.plugin.setConfig(PLUGIN_IDS.STRATEGY, LLM_CONFIG_KEYS.SELECTED_PRO_PROVIDER, catProvider.id);
                            window.dispatchEvent(new CustomEvent('llm-selection-changed', {
                              detail: { provider: LLM_PROVIDER_PRO_CATALOG, model: model.id }
                            }));
                          }}
                          className={cn(
                            'w-full flex items-center gap-2 pl-8 pr-3 py-1 text-[10px] text-left hover:bg-white/5 transition-colors',
                            proSelectionOwnerId === catProvider.id && model.id === selectedModel ? 'text-primary' : 'text-muted-foreground'
                          )}
                        >
                          <span className="flex-1">{model.name}</span>
                          {proSelectionOwnerId === catProvider.id && model.id === selectedModel && (
                            <Circle className="w-1.5 h-1.5 fill-current text-primary" />
                          )}
                        </button>
                      ))}
                    </React.Fragment>
                  );
                })}
              </div>
            </>
          )}

          {/* Non-Pro users: flat provider list (no header, no Pro section) */}
          {/* TICKET_706: FREE and BASIC users both see flat BYOK-only list */}
          {!hasProCatalogAccess && filteredProviders.length > 0 && (
            <div className="py-1">
              {filteredProviders.map((provider) => (
                <React.Fragment key={provider.id}>
                  <button
                    onClick={() => handleSelectProvider(provider.id, provider.defaultModel)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left hover:bg-white/5 transition-colors',
                      provider.id === selectedProvider ? 'text-primary' : 'text-foreground'
                    )}
                    title={getTooltip(provider.status)}
                  >
                    <span className="w-4 flex justify-center">
                      {getStatusIcon(provider.status)}
                    </span>
                    <span className="flex-1">{provider.name}</span>
                    {provider.id === selectedProvider && (
                      <Circle className="w-2 h-2 fill-current text-primary" />
                    )}
                  </button>
                  {provider.id === selectedProvider && shouldExposeProviderModels(provider) && (
                    renderModelButtons(provider.models)
                  )}
                </React.Fragment>
              ))}
            </div>
          )}

          {/* BYOK section with header (Pro users only - distinguishes Pro vs BYOK) */}
          {/* TICKET_693: Mutual exclusion - BYOK models only shown when expandedSection === 'byok' */}
          {/* TICKET_706: BYOK header only needed when Pro section is also shown */}
          {hasProCatalogAccess && filteredProviders.filter(p => p.id !== LLM_PROVIDER_PRO_CATALOG).length > 0 && (
            <>
              <div className="w-full flex items-center gap-2 px-3 py-2 text-[11px] border-t border-border">
                <span className="w-4 flex justify-center">
                  <Sparkles className="w-3 h-3 text-color-terminal-text-muted" />
                </span>
                <span className="flex-1 font-medium text-muted-foreground">{t('llmProvider.badge.byok')}</span>
              </div>
              <div className="py-1">
                {filteredProviders.filter(p => p.id !== LLM_PROVIDER_PRO_CATALOG).map((provider) => (
                  <React.Fragment key={`byok-${provider.id}`}>
                    <button
                      onClick={() => {
                        // TICKET_693: Switch to BYOK section, collapse Pro models
                        setExpandedSection('byok');
                        setExpandedProProvider(null);
                        handleSelectProvider(provider.id, provider.defaultModel);
                      }}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left hover:bg-white/5 transition-colors',
                        provider.id === selectedProvider ? 'text-primary' : 'text-foreground'
                      )}
                      title={getTooltip(provider.status)}
                    >
                      <span className="w-4 flex justify-center">
                        {getStatusIcon(provider.status)}
                      </span>
                      <span className="flex-1">{provider.name}</span>
                      {provider.id === selectedProvider && (
                        <Circle className="w-2 h-2 fill-current text-primary" />
                      )}
                    </button>
                    {expandedSection === 'byok' && provider.id === selectedProvider && shouldExposeProviderModels(provider) && (
                      renderModelButtons(provider.models)
                    )}
                  </React.Fragment>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default LLMProviderSelector;
