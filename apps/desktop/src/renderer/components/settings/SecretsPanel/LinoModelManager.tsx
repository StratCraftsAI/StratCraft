import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { LLM_CONFIG_KEYS } from '@StratCraft/types';
import { PLUGIN_IDS } from '../../../../shared/constants';
import { cn } from '../../../lib/utils';
import { filterLinoModels } from '../../../lib/lino-model-selection';

interface LinoModel {
  id: string;
  name: string;
}

export function LinoModelManager(): JSX.Element {
  const { t } = useTranslation('settings');
  const [models, setModels] = useState<LinoModel[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const loadEnabled = useCallback(async () => {
    const result = await window.electronAPI.plugin.getConfig(PLUGIN_IDS.STRATEGY);
    const stored = result.success && result.config
      ? result.config[LLM_CONFIG_KEYS.LINO_USER_MODELS]
      : undefined;
    setEnabled(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []);
  }, []);

  useEffect(() => {
    void loadEnabled();
  }, [loadEnabled]);

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await window.electronAPI.byok.getModels('LINO', true);
      if (!result.success) throw new Error(result.error ?? 'Unable to load LinoAPI models');
      setModels(result.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleToggleOpen = useCallback(() => {
    setOpen(current => {
      if (!current && models.length === 0) void loadModels();
      return !current;
    });
  }, [loadModels, models.length]);

  const persist = useCallback(async (next: string[]) => {
    const result = await window.electronAPI.plugin.setConfig(
      PLUGIN_IDS.STRATEGY,
      LLM_CONFIG_KEYS.LINO_USER_MODELS,
      next,
    );
    if (!result.success) {
      throw new Error(result.error ?? 'Unable to save enabled LinoAPI models');
    }
    const config = await window.electronAPI.plugin.getConfig(PLUGIN_IDS.STRATEGY);
    if (config.success && config.config?.[LLM_CONFIG_KEYS.SELECTED_PROVIDER] === 'LINO') {
      const activeModel = config.config[LLM_CONFIG_KEYS.SELECTED_MODEL];
      if (typeof activeModel === 'string' && !next.includes(activeModel)) {
        const replacement = next[0] ?? '';
        await window.electronAPI.plugin.setConfig(
          PLUGIN_IDS.STRATEGY,
          LLM_CONFIG_KEYS.SELECTED_MODEL,
          replacement,
        );
        window.dispatchEvent(new CustomEvent('llm-selection-changed', {
          detail: { provider: 'LINO', model: replacement },
        }));
      }
    }
    setEnabled(next);
    window.dispatchEvent(new CustomEvent('lino-models-changed'));
  }, []);

  const toggleModel = useCallback(async (modelId: string) => {
    setError(undefined);
    const next = enabled.includes(modelId)
      ? enabled.filter(id => id !== modelId)
      : [...enabled, modelId];
    try {
      await persist(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [enabled, persist]);

  const visibleModels = useMemo(() => filterLinoModels(models, query), [models, query]);
  const names = useMemo(() => new Map(models.map(model => [model.id, model.name])), [models]);

  return (
    <div className="flex flex-col gap-2 border-t border-color-terminal-border pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] text-color-terminal-text-muted">
          {t('secretsPanel.providers.lino.enabledModels', { defaultValue: 'Enabled models' })}
        </span>
        <button
          type="button"
          onClick={handleToggleOpen}
          className="inline-flex items-center gap-1 rounded border border-color-terminal-accent-teal px-2 py-1 font-mono text-[11px] text-color-terminal-accent-teal"
          aria-expanded={open}
        >
          {t('secretsPanel.providers.lino.addModels', { defaultValue: 'Add models' })}
          <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {enabled.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {enabled.map(id => (
            <span key={id} className="inline-flex items-center gap-1 rounded border border-color-terminal-border px-2 py-1 font-mono text-[10px]">
              {names.get(id) ?? id}
              <button type="button" onClick={() => void toggleModel(id)} aria-label={`Remove ${id}`}>
                <X className="h-3 w-3 text-color-terminal-text-muted" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="font-mono text-[10px] text-color-terminal-text-muted">
          {t('secretsPanel.providers.lino.noEnabledModels', {
            defaultValue: 'Add models to show them in the model picker',
          })}
        </p>
      )}

      {open ? (
        <div className="rounded border border-color-terminal-border bg-color-terminal-background p-2">
          <label className="relative block">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-color-terminal-text-muted" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('secretsPanel.providers.lino.modelSearchPlaceholder', {
                defaultValue: 'Search LinoAPI models...',
              })}
              className="w-full rounded border border-color-terminal-border bg-transparent py-1.5 pl-7 pr-2 font-mono text-[11px] outline-none focus:border-color-terminal-accent-teal"
              autoFocus
            />
          </label>
          <div className="mt-2 max-h-56 overflow-y-auto">
            {loading ? (
              <p className="p-2 font-mono text-[10px] text-color-terminal-text-muted">Loading...</p>
            ) : visibleModels.length > 0 ? visibleModels.map(model => {
              const checked = enabled.includes(model.id);
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => void toggleModel(model.id)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-white/5"
                >
                  <span className={cn('flex h-4 w-4 items-center justify-center rounded border', checked && 'border-color-terminal-accent-teal bg-color-terminal-accent-teal/10')}>
                    {checked ? <Check className="h-3 w-3 text-color-terminal-accent-teal" /> : null}
                  </span>
                  <span className="font-mono text-[11px]">{model.name}</span>
                  <span className="ml-auto font-mono text-[9px] text-color-terminal-text-muted">{model.id}</span>
                </button>
              );
            }) : (
              <p className="p-2 font-mono text-[10px] text-color-terminal-text-muted">No matching models</p>
            )}
          </div>
        </div>
      ) : null}

      {error ? <p className="font-mono text-[11px] text-color-terminal-accent-red">{error}</p> : null}
    </div>
  );
}
