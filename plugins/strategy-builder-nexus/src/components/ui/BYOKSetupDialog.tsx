/**
 * BYOKSetupDialog - First-Run BYOK Provider Setup Dialog
 *
 * TICKET_518: In-place setup dialog for configuring LLM provider + API key + model
 * without navigating away from the current page.
 *
 * Shown when user has no valid LLM configuration and hasn't dismissed the dialog before.
 * After dismissal, falls back to the existing ApiKeyPrompt (TICKET_190).
 *
 * TICKET_809_4a Phase 2: Stripped inline credential UI -- credential input,
 * verification, and show/hide toggle are now delegated to the host's shared
 * `<SecretsPanelModal>` via the `@host/secrets` externalisation contract.
 * Builder retains ownership of provider + model selection (Builder business
 * state) and the post-save plugin.config writes.
 *
 * @see TICKET_518 - BYOK First-Run Setup Dialog
 * @see TICKET_190 - BYOK Guest Mode and API Key Privacy
 * @see TICKET_809_4a - Host UI exposure for plugin shells
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Key, X, ShieldCheck, ChevronDown } from 'lucide-react';
import { SecretsPanelModal } from '@host/secrets';
import { LLM_CONFIG_KEYS } from '@StratCraft/types'; // TICKET_1023_6
import { cn } from '../../lib/utils';
import { BYOK_PROVIDERS_LIST, type BYOKProviderUIConfig } from '../../config/llm-provider-ui';
import { useLLMCatalog, type LLMCatalogModel } from '../../hooks/useLLMCatalog';

/**
 * Plugin identity (for plugin.config namespace -- Builder owns the
 * llm.selectedProvider / llm.selectedModel state).
 */
const PLUGIN_ID = 'com.stratcraft.strategy-builder-nexus';

/**
 * Map Builder-side UI ids (uppercase: CLAUDE, OPENAI...) to the lowercase
 * provider ids used by the host credentialRegistry's LLM contributions
 * (see apps/desktop/src/renderer/services/llm-contributions.ts).
 */
function toRegistryProviderId(builderId: string): string {
  return builderId.toLowerCase();
}

export interface BYOKSetupDialogProps {
  /** Whether the dialog is visible */
  isOpen: boolean;
  /** Callback when setup is completed successfully */
  onComplete: () => Promise<boolean>;
  /** Callback when user dismisses the dialog */
  onDismiss: () => void;
  /** Additional CSS classes */
  className?: string;
}

export function BYOKSetupDialog({
  isOpen,
  onComplete,
  onDismiss,
  className,
}: BYOKSetupDialogProps): JSX.Element | null {
  const { t } = useTranslation('strategy-builder');

  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [showSecretsModal, setShowSecretsModal] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  const { getModels: getCatalogModels } = useLLMCatalog();

  const selectedProvider: BYOKProviderUIConfig | undefined = useMemo(
    () => BYOK_PROVIDERS_LIST.find((p) => p.id === selectedProviderId),
    [selectedProviderId],
  );

  const models: LLMCatalogModel[] = useMemo(
    () => getCatalogModels(selectedProviderId),
    [getCatalogModels, selectedProviderId],
  );

  const canContinue = selectedProviderId !== '' && selectedModelId !== '';

  const handleProviderChange = useCallback(
    (providerId: string) => {
      setSelectedProviderId(providerId);
      setAccessError(null);
      const catalogModels = getCatalogModels(providerId);
      setSelectedModelId(catalogModels[0]?.id ?? '');
    },
    [getCatalogModels],
  );

  const persistBuilderConfig = useCallback(async () => {
    await window.electronAPI.plugin.setConfig(
      PLUGIN_ID,
      LLM_CONFIG_KEYS.SELECTED_PROVIDER,
      selectedProviderId,
    );
    await window.electronAPI.plugin.setConfig(
      PLUGIN_ID,
      LLM_CONFIG_KEYS.SELECTED_MODEL,
      selectedModelId,
    );
  }, [selectedProviderId, selectedModelId]);

  // SecretsPanelModal closes itself on successful save (autoCloseOnConfigured=true).
  // We then persist the Builder-owned selection and re-check access.
  const handleModalClose = useCallback(async () => {
    setShowSecretsModal(false);
    if (!selectedProvider) return;
    try {
      await persistBuilderConfig();
      const accessGranted = await onComplete();
      if (!accessGranted) {
        setAccessError(t('byokSetup.accessCheckFailed'));
      }
    } catch (err) {
      setAccessError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedProvider, persistBuilderConfig, onComplete, t]);

  useEffect(() => {
    if (!isOpen) {
      setShowSecretsModal(false);
      setAccessError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  if (showSecretsModal && selectedProvider) {
    return (
      <SecretsPanelModal
        visible
        onClose={handleModalClose}
        filter={{ providerIds: [toRegistryProviderId(selectedProvider.id)] }}
        headingKey="settings:secretsPanel.modalTitle"
      />
    );
  }

  return (
    <div className={cn('fixed inset-0 z-[10000] flex items-center justify-center', className)}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onDismiss} />

      <div className="relative w-full max-w-lg mx-4 rounded-xl border border-white/10 bg-color-terminal-panel shadow-2xl">
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 p-1 text-color-terminal-text-muted hover:text-color-terminal-text rounded transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6">
          <div className="flex justify-center mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-color-terminal-accent-teal/10">
              <Key className="h-6 w-6 text-color-terminal-accent-teal" />
            </div>
          </div>

          <h2 className="text-xl font-bold text-center mb-1">{t('byokSetup.title')}</h2>
          <p className="text-sm text-color-terminal-text-muted text-center mb-6">
            {t('byokSetup.subtitle')}
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-color-terminal-text-muted mb-1.5">
                {t('byokSetup.provider')}
              </label>
              <div className="relative">
                <select
                  value={selectedProviderId}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-white/10 bg-color-terminal-surface px-3 py-2.5 pr-8 text-sm text-color-terminal-text focus:border-color-terminal-accent-teal focus:outline-none"
                >
                  <option value="">{t('byokSetup.selectProvider')}</option>
                  {BYOK_PROVIDERS_LIST.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-color-terminal-text-muted pointer-events-none" />
              </div>
            </div>

            {selectedProvider && models.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-color-terminal-text-muted mb-1.5">
                  {t('byokSetup.model')}
                </label>
                <div className="relative">
                  <select
                    value={selectedModelId}
                    onChange={(e) => setSelectedModelId(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-white/10 bg-color-terminal-surface px-3 py-2.5 pr-8 text-sm text-color-terminal-text focus:border-color-terminal-accent-teal focus:outline-none"
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-color-terminal-text-muted pointer-events-none" />
                </div>
              </div>
            )}

            {accessError && <p className="text-xs text-red-400">{accessError}</p>}
          </div>

          <div className="mt-6 space-y-3">
            <button
              onClick={() => {
                setAccessError(null);
                setShowSecretsModal(true);
              }}
              disabled={!canContinue}
              className={cn(
                'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors',
                canContinue
                  ? 'bg-color-terminal-accent-teal text-black hover:bg-color-terminal-accent-teal/90'
                  : 'bg-color-terminal-accent-teal/30 text-color-terminal-text-muted cursor-not-allowed',
              )}
            >
              {t('byokSetup.saveAndContinue')}
            </button>

            <button
              onClick={onDismiss}
              className="w-full text-sm text-color-terminal-text-muted hover:text-color-terminal-text transition-colors py-1"
            >
              {t('byokSetup.maybeLater')}
            </button>
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-color-terminal-text-muted mt-4">
            <ShieldCheck className="h-3.5 w-3.5 text-color-terminal-accent-teal" />
            <span>{t('byokSetup.privacyNote')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BYOKSetupDialog;
