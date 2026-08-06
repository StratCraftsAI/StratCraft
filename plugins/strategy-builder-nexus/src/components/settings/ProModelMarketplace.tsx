/**
 * ProModelMarketplace - Model selection dialog for Pro Marketplace
 *
 * TICKET_483: Allows users to add third-party models to Pro provider.
 * Models are routed through backend using platform credit.
 *
 * @see TICKET_483 - Pro Model Marketplace Plugin Settings
 */

import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Check, ShoppingBag, RefreshCw } from 'lucide-react';
import {
  PRO_USER_MODELS_MAX,
  type ProMarketplaceModel,
} from '../../config/llm-provider-ui';

// =============================================================================
// Types
// =============================================================================

export interface ProModelMarketplaceProps {
  open: boolean;
  selectedModels: string[];
  onSave: (modelIds: string[]) => void;
  onClose: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function ProModelMarketplace({
  open,
  selectedModels,
  onSave,
  onClose,
}: ProModelMarketplaceProps): JSX.Element | null {
  const { t } = useTranslation('strategy-builder');
  const [localSelection, setLocalSelection] = useState<string[]>(selectedModels);
  const [catalog, setCatalog] = useState<ProMarketplaceModel[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch catalog from backend API when dialog opens
  useEffect(() => {
    if (!open) return;
    setLocalSelection(selectedModels);
    setLoading(true);

    (async () => {
      try {
        const result = await window.electronAPI.llmCatalog.getModels();
        if (result.success && result.data) {
          setCatalog(result.data);
        }
      } catch (e) {
        console.error('[E:SETTINGS:PRO_CATALOG_FETCH_FAILED] [ProModelMarketplace] Failed to fetch catalog:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, selectedModels]);

  // Group catalog by category
  const grouped = useMemo(() => {
    const groups: Record<string, ProMarketplaceModel[]> = {};
    for (const model of catalog) {
      if (!groups[model.category]) {
        groups[model.category] = [];
      }
      groups[model.category].push(model);
    }
    return groups;
  }, [catalog]);

  if (!open) return null;

  const handleToggle = (modelId: string) => {
    setLocalSelection(prev => {
      if (prev.includes(modelId)) {
        return prev.filter(id => id !== modelId);
      }
      if (prev.length >= PRO_USER_MODELS_MAX) {
        return prev; // Max reached
      }
      return [...prev, modelId];
    });
  };

  const handleSave = () => {
    onSave(localSelection);
  };

  const categories = Object.keys(grouped);

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      {/* Dialog */}
      <div className="w-full max-w-md rounded-lg border border-white/20 bg-color-terminal-panel shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-color-terminal-accent-teal" />
            <h3 className="text-sm font-medium">
              {t('llmSettings.nonaMarketplace.title')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Subtitle */}
        <div className="px-5 py-3 border-b border-white/5">
          <p className="text-xs text-muted-foreground">
            {t('llmSettings.nonaMarketplace.subtitle')}
          </p>
        </div>

        {/* Model List (scrollable) */}
        <div className="max-h-[400px] overflow-y-auto px-5 py-3 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && categories.map(category => (
            <div key={category}>
              {/* Category Header */}
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                {category}
              </div>

              {/* Models in Category */}
              <div className="space-y-1">
                {grouped[category].map(model => {
                  const isChecked = localSelection.includes(model.id);
                  const isDisabled = !isChecked && localSelection.length >= PRO_USER_MODELS_MAX;

                  return (
                    <button
                      key={model.id}
                      onClick={() => handleToggle(model.id)}
                      disabled={isDisabled}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                        isChecked
                          ? 'bg-color-terminal-accent-teal/10 text-foreground'
                          : isDisabled
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:bg-white/5 text-foreground'
                      }`}
                    >
                      {/* Checkbox */}
                      <div
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          isChecked
                            ? 'border-color-terminal-accent-teal bg-color-terminal-accent-teal'
                            : 'border-white/30'
                        }`}
                      >
                        {isChecked && <Check className="h-3 w-3 text-black" />}
                      </div>

                      {/* Model Name */}
                      <span className="flex-1 text-left">{model.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-white/10">
          {/* Counter */}
          <span className="text-xs text-muted-foreground">
            {t('llmSettings.nonaMarketplace.selected')}: {localSelection.length} / {PRO_USER_MODELS_MAX}
          </span>

          {/* Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-sm text-muted-foreground hover:bg-white/5 transition-colors"
            >
              {t('llmSettings.nonaMarketplace.cancel')}
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-1.5 rounded-lg text-sm bg-color-terminal-accent-teal text-black hover:bg-color-terminal-accent-teal/80 transition-colors"
            >
              {t('llmSettings.nonaMarketplace.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
