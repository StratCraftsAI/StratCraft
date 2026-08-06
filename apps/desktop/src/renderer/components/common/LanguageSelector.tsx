/**
 * LanguageSelector Component
 * TICKET_084: Internationalization System Design
 *
 * Language selection button with dropdown menu.
 * Based on nonassa bottom-toolbar__language-container pattern.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useI18nContext } from './I18nProvider';
import { SUPPORTED_LOCALES, getSortedLocales } from '../../../i18n/config';
import { useDropdown } from '../../hooks/useDropdown';

export function LanguageSelector() {
  const { locale, setLocale } = useI18nContext();
  const { t } = useTranslation('settings');
  const { isOpen, toggle, close, triggerRef, dropdownRef, triggerProps } = useDropdown<HTMLButtonElement, HTMLDivElement>();

  // Get current locale config and sorted locales
  const currentConfig = SUPPORTED_LOCALES[locale] || SUPPORTED_LOCALES['en_US'];
  const sortedLocales = getSortedLocales();

  // Handle language selection
  const handleSelect = async (localeCode: string) => {
    await setLocale(localeCode);
    close();
  };

  return (
    <div className="relative flex items-center h-full">
      {/* Language Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
        title={t('language.title')}
        {...triggerProps}
      >
        {/* Globe Icon */}
        <svg
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
          />
        </svg>

        {/* Current Language */}
        <span>{currentConfig.shortCode.toUpperCase()}</span>

        {/* Caret */}
        <svg
          className={`w-2.5 h-2.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div ref={dropdownRef} role="listbox" className="absolute bottom-full left-0 mb-1 min-w-[160px] rounded-md border border-border bg-card shadow-lg z-50">
          {sortedLocales.map((config) => (
            <button
              key={config.code}
              onClick={() => handleSelect(config.code)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left hover:bg-white/5 transition-colors ${
                config.code === locale ? 'text-primary' : 'text-foreground'
              }`}
            >
              {/* Checkmark for selected */}
              <span className={`w-3 ${config.code === locale ? 'opacity-100' : 'opacity-0'}`}>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>

              {/* Language Name (native) */}
              <span className="flex-1">{config.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default LanguageSelector;
