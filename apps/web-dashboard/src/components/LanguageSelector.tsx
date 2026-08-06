import { useTranslation } from 'react-i18next'
import { useGuideToolbar } from '../guide-toolbar-context.tsx'

export function LanguageSelector() {
  const { t } = useTranslation('dashboard')
  const {
    config,
    loadError,
    localeError,
    localeSaving,
    refreshing,
    setLocale,
  } = useGuideToolbar()
  const visibleError = localeError ?? loadError

  return (
    <div className="toolbar-language-slot">
      <select
        value={config?.locale.current ?? ''}
        onChange={event => void setLocale(event.target.value)}
        disabled={!config || localeSaving || refreshing}
        className="llm-select toolbar-language-select"
        aria-label={t('lang.selectLanguage')}
        aria-invalid={visibleError ? true : undefined}
        title={visibleError ?? t('lang.selectLanguage')}
        data-testid="language-selector"
      >
        {!config && <option value="">{t('lang.unavailable')}</option>}
        {config?.locale.supported.map(locale => (
          <option key={locale.code} value={locale.code}>{locale.nativeLabel}</option>
        ))}
      </select>
      {visibleError && (
        <span className="toolbar-error-indicator" role="alert" title={visibleError} data-testid="language-selector-error">
          {t(localeError ? 'lang.saveFailed' : 'lang.loadFailed')}
        </span>
      )}
    </div>
  )
}
