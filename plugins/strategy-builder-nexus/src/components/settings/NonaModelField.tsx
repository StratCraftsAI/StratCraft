/**
 * NonaModelField - Custom model management widget for PRO_CATALOG provider
 *
 * TICKET_483_1: Replaces generic <select> in ConfigTab when provider=PRO_CATALOG.
 * Two-zone layout:
 *   Zone A: Custom dropdown to browse/add catalog models
 *   Zone B: Current model chips + active model selector
 *
 * Reads/writes same config key as ProProviderCard (llm.pro.userModels).
 *
 * @see TICKET_483_1 - ConfigTab Pro Model Management Widget
 * @see TICKET_483 - Pro Model Marketplace
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Plus, Check, X, AlertTriangle } from 'lucide-react';
import { LLM_CONFIG_KEYS } from '@StratCraft/types'; // TICKET_1023_6
import { THEME_COLORS } from '@shared/constants/colors';
import { PRO_USER_MODELS_MAX, type ProMarketplaceModel } from '../../config/llm-provider-ui';

// =============================================================================
// Types
// =============================================================================

interface NonaModelFieldProps {
  pluginId: string;
  selectedModel: string;
  onModelChange: (modelId: string) => void;
}

// =============================================================================
// Constants
// =============================================================================

/** TICKET_516: Fixed models removed. All models are user-added. */
const PRO_FIXED_MODEL_IDS = new Set<string>();
const PRO_DEFAULT_MODEL = '';

// =============================================================================
// Component
// =============================================================================

export function NonaModelField({ pluginId, selectedModel, onModelChange }: NonaModelFieldProps): JSX.Element {
  const { t } = useTranslation('strategy-builder');
  const [userModels, setUserModels] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<ProMarketplaceModel[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // -------------------------------------------------------------------------
  // Data Loading
  // -------------------------------------------------------------------------

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
      } catch {
        // Catalog unavailable - show fixed models only
      } finally {
        setLoading(false);
      }
    })();
  }, [pluginId]);

  // -------------------------------------------------------------------------
  // Derived State
  // -------------------------------------------------------------------------

  const userModelSet = useMemo(() => new Set(userModels), [userModels]);

  const catalogMap = useMemo(() => {
    const map = new Map<string, ProMarketplaceModel>();
    for (const m of catalog) {
      map.set(m.id, m);
    }
    return map;
  }, [catalog]);

  // Catalog grouped by category for Zone A
  const groupedCatalog = useMemo(() => {
    const groups: Record<string, ProMarketplaceModel[]> = {};
    for (const model of catalog) {
      if (!groups[model.category]) {
        groups[model.category] = [];
      }
      groups[model.category].push(model);
    }
    return groups;
  }, [catalog]);

  // Current model pool entries (user-added only; TICKET_516 removed fixed models)
  const currentModelEntries = useMemo(() => {
    const entries: Array<{ id: string; name: string; fixed: boolean }> = [];
    for (const id of userModels) {
      const catalogEntry = catalogMap.get(id);
      entries.push({ id, name: catalogEntry?.name || id, fixed: false });
    }
    return entries;
  }, [userModels, catalogMap]);

  const limitReached = userModels.length >= PRO_USER_MODELS_MAX;

  // -------------------------------------------------------------------------
  // Close dropdown on outside click
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [dropdownOpen]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const saveUserModels = useCallback(async (updated: string[]) => {
    setUserModels(updated);
    try {
      await window.electronAPI.plugin.setConfig(pluginId, LLM_CONFIG_KEYS.PRO_USER_MODELS, updated);
    } catch (e) {
      console.error('[E:SETTINGS:NONA_MODEL_SAVE_FAILED] [NonaModelField] Failed to save user models:', e);
    }
  }, [pluginId]);

  const handleToggleCatalogModel = useCallback(async (modelId: string) => {
    if (userModelSet.has(modelId)) {
      // Remove
      const updated = userModels.filter(id => id !== modelId);
      await saveUserModels(updated);
      // If removed model was selected, reset to default
      if (selectedModel === modelId) {
        onModelChange(PRO_DEFAULT_MODEL);
      }
    } else {
      // Add (respect limit)
      if (limitReached) return;
      const updated = [...userModels, modelId];
      await saveUserModels(updated);
    }
  }, [userModels, userModelSet, limitReached, selectedModel, onModelChange, saveUserModels]);

  const handleRemoveUserModel = useCallback(async (modelId: string) => {
    const updated = userModels.filter(id => id !== modelId);
    await saveUserModels(updated);
    if (selectedModel === modelId) {
      onModelChange(PRO_DEFAULT_MODEL);
    }
  }, [userModels, selectedModel, onModelChange, saveUserModels]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">{t('ui.nonaModelField.selectedModel')}</label>
      <p className="text-xs text-muted-foreground">
        {t('ui.nonaModelField.subtitle')}
      </p>

      {/* Zone A: Catalog Dropdown */}
      <div ref={dropdownRef} className="relative">
        <button
          type="button"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="w-full flex items-center justify-between rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm hover:border-white/20 transition-colors"
        >
          <span className="text-muted-foreground">{t('ui.nonaModelField.browseModels')}</span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {dropdownOpen && (
          <div className="absolute z-50 mt-1 w-full rounded-lg border border-white/10 shadow-lg max-h-72 overflow-y-auto" style={{ backgroundColor: THEME_COLORS.DROPDOWN_BG }}>
            {loading ? (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                {t('ui.nonaModelField.loadingCatalog')}
              </div>
            ) : Object.keys(groupedCatalog).length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center flex items-center justify-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {t('ui.nonaModelField.catalogUnavailable')}
              </div>
            ) : (
              <>
                {limitReached && (
                  <div className="px-3 py-2 text-xs text-amber-500 border-b border-white/10">
                    {t('ui.nonaModelField.limitReached', { max: PRO_USER_MODELS_MAX })}
                  </div>
                )}
                {Object.entries(groupedCatalog).map(([category, models]) => (
                  <div key={category}>
                    <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider sticky top-0" style={{ backgroundColor: THEME_COLORS.DROPDOWN_HEADER_BG }}>
                      {category}
                    </div>
                    {models.map(model => {
                      const isAdded = userModelSet.has(model.id);
                      const isFixed = PRO_FIXED_MODEL_IDS.has(model.id);
                      const isDisabled = !isAdded && limitReached;

                      // Skip fixed models in catalog (they are always present)
                      if (isFixed) return null;

                      return (
                        <button
                          key={model.id}
                          type="button"
                          disabled={isDisabled}
                          onClick={() => handleToggleCatalogModel(model.id)}
                          className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                            isDisabled
                              ? 'opacity-40 cursor-not-allowed'
                              : 'hover:bg-white/5 cursor-pointer'
                          }`}
                        >
                          <span>{model.name}</span>
                          {isAdded ? (
                            <Check className="h-4 w-4 text-color-terminal-accent-teal" />
                          ) : (
                            <Plus className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Zone B: Current Model Chips + Active Selector */}
      <div className="space-y-2">
        <span className="text-xs text-muted-foreground">{t('ui.nonaModelField.currentModels')}</span>
        <div className="flex flex-wrap gap-1.5">
          {/* User-added model chips (TICKET_516: fixed models removed) */}
          {userModels.map(modelId => {
            const entry = catalogMap.get(modelId);
            return (
              <span
                key={modelId}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-white/10 bg-white/5"
              >
                {entry?.name || modelId}
                <button
                  type="button"
                  onClick={() => handleRemoveUserModel(modelId)}
                  className="hover:text-red-400 transition-colors"
                  title={t('ui.nonaModelField.removeModel')}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>

        {/* Active model selector */}
        <select
          value={selectedModel}
          onChange={(e) => onModelChange(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm focus:border-color-terminal-accent-teal focus:outline-none"
        >
          {currentModelEntries.map(entry => (
            <option key={entry.id} value={entry.id} className="bg-color-terminal-panel">
              {entry.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default NonaModelField;
