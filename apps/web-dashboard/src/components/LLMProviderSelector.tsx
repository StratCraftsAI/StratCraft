import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { GuideToolbarProvider } from '@StratCraft/types'
import { useGuideToolbar } from '../guide-toolbar-context.tsx'
import { credentialHealthI18nKey } from '../credential-health-i18n.ts'

interface Props {
  onConfigureProvider: (providerId?: string) => void
}

function providerLabel(
  provider: GuideToolbarProvider,
  needsCredential: string,
  credentialError: string,
  notEntitled: string,
): string {
  if (provider.availability === 'needs_credential') return `${provider.name} - ${needsCredential}`
  if (provider.availability === 'credential_error') {
    return `${provider.name} - ${credentialError}`
  }
  if (provider.availability === 'not_entitled') return `${provider.name} - ${notEntitled}`
  return provider.name
}

export function LLMProviderSelector({ onConfigureProvider }: Props) {
  const { t } = useTranslation('dashboard')
  const {
    config,
    loading,
    refreshing,
    loadError,
    selectionError,
    selectionSaving,
    selectLlm,
  } = useGuideToolbar()
  const providerRows = useMemo(
    () => config?.llm.groups.flatMap(group => group.providers.map(provider => ({
      provider,
      optionId: `${group.kind}:${provider.id}`,
    }))) ?? [],
    [config],
  )
  const selectedVisibleProviderId = config?.llm.selected?.catalogProviderId
    ?? config?.llm.selected?.providerId
  const selectedOptionId = providerRows.find(({ provider }) =>
    provider.id === selectedVisibleProviderId
    && (provider.runtimeProviderId ?? provider.id) === config?.llm.selected?.providerId)?.optionId
  const currentProvider = providerRows.find(row => row.optionId === selectedOptionId)?.provider
  const visibleError = selectionError ?? loadError

  const chooseProvider = (optionId: string) => {
    const row = providerRows.find(r => r.optionId === optionId)
    if (!row) return
    const { provider } = row
    if (provider.availability === 'credential_error'
      || provider.availability === 'needs_credential') {
      onConfigureProvider(provider.id)
      return
    }
    if (provider.availability !== 'selectable') return
    const modelId = provider.recommendedModelId ?? provider.models[0]?.id
    if (modelId) {
      void selectLlm(
        provider.runtimeProviderId ?? provider.id,
        modelId,
        provider.runtimeProviderId ? provider.id : undefined,
      )
    }
  }

  if (!config) {
    return (
      <div className="toolbar-control-slot" data-testid="llm-selector">
        <span
          className="llm-select toolbar-status-control"
          aria-busy={loading}
          data-testid={visibleError ? 'llm-provider-load-error' : 'llm-provider-loading'}
          title={visibleError ?? undefined}
        >
          {visibleError ? t('llm.providersLoadFailed') : t('llm.loading')}
        </span>
      </div>
    )
  }

  return (
    <div className="llm-selector toolbar-control-slot" data-testid="llm-selector">
      <select
        value={selectedOptionId ?? ''}
        onChange={event => chooseProvider(event.target.value)}
        disabled={selectionSaving || refreshing}
        className="llm-select toolbar-provider-select"
        aria-label={t('llm.selectProvider')}
        title={t('llm.selectProvider')}
        data-testid="llm-provider-select"
      >
        <option value="" disabled>{t('llm.noSelection')}</option>
        {config.llm.groups.map(group => (
          <optgroup key={group.kind} label={t(`llm.groups.${group.kind}`, { defaultValue: group.label })}>
            {group.providers.map(provider => (
              <option
                key={provider.id}
                value={`${group.kind}:${provider.id}`}
                disabled={provider.availability === 'not_entitled'}
              >
                {providerLabel(
                  provider,
                  t('llm.needsCredential'),
                  t(credentialHealthI18nKey(provider.credentialHealth?.state)),
                  t('llm.notEntitled'),
                )}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <select
        value={config.llm.selected?.modelId ?? ''}
        onChange={event => {
          if (currentProvider) {
            void selectLlm(
              currentProvider.runtimeProviderId ?? currentProvider.id,
              event.target.value,
              currentProvider.runtimeProviderId ? currentProvider.id : undefined,
            )
          }
        }}
        disabled={!currentProvider || currentProvider.models.length === 0 || selectionSaving || refreshing}
        className="llm-select llm-model-select toolbar-model-select"
        aria-label={t('llm.selectModel')}
        title={t('llm.selectModel')}
        data-testid="llm-model-select"
      >
        {!currentProvider && <option value="">{t('llm.noSelection')}</option>}
        {currentProvider?.models.map(model => (
          <option key={model.id} value={model.id}>{model.name}</option>
        ))}
      </select>

      {(config.llm.selectionInvalidated || visibleError) && (
        <span
          className="toolbar-error-indicator"
          role="alert"
          title={visibleError ?? t('llm.selectionInvalidated')}
          data-testid="llm-selection-error"
        >
          {t(config.llm.selectionInvalidated ? 'llm.selectionInvalidated' : 'llm.selectionFailed')}
        </span>
      )}


    </div>
  )
}
