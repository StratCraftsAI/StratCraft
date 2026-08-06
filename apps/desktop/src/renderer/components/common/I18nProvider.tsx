/**
 * I18nProvider - Internationalization Context Provider
 * TICKET_084: Internationalization System Design
 *
 * Initializes i18next and provides translation context to the app.
 * Fetches initial locale from main process (respects priority chain).
 */

import React, { useEffect, useState, useCallback } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n, { initI18n, changeLanguage, getCurrentLocale } from '../../../i18n';

interface I18nProviderProps {
  children: React.ReactNode;
}

interface I18nContextValue {
  locale: string;
  setLocale: (locale: string) => Promise<void>;
  isReady: boolean;
}

const I18nContext = React.createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: I18nProviderProps) {
  const [isReady, setIsReady] = useState(false);
  const [locale, setLocaleState] = useState<string>('en_US');

  // Initialize i18n on mount
  useEffect(() => {
    async function init() {
      try {
        // Get initial locale from main process (respects priority chain)
        const initialLocale = await window.electronAPI.locale.getInitial();
        console.info('[I18N] Initial locale from main:', initialLocale);

        // Initialize i18next with the locale
        await initI18n({ locale: initialLocale });
        setLocaleState(initialLocale);
        setIsReady(true);
      } catch (error) {
        console.error('[E:I18N:INIT_FAILED] Failed to initialize:', error);
        // Fallback: initialize with default locale
        await initI18n();
        setIsReady(true);
      }
    }

    init();
  }, []);

  // TICKET_1235_8 AC2: locale can change outside this renderer (MCP
  // set_locale persists via the same locale-service). Apply broadcasts so
  // the UI reflects the new locale without an app restart.
  useEffect(() => {
    if (!isReady) return;
    const unsubscribe = window.electronAPI.locale.onChanged(async (newLocale: string) => {
      if (newLocale === getCurrentLocale()) return;
      try {
        await changeLanguage(newLocale);
        setLocaleState(newLocale);
        console.info('[I18N] Locale changed externally to:', newLocale);
      } catch (error) {
        console.error('[E:I18N:CHANGE_FAILED] Failed to apply external locale change:', error);
      }
    });
    return unsubscribe;
  }, [isReady]);

  // Handle locale change
  const setLocale = useCallback(async (newLocale: string) => {
    try {
      // Update i18next
      await changeLanguage(newLocale);

      // Persist to main process
      const result = await window.electronAPI.locale.setUser(newLocale);
      if (result.success) {
        setLocaleState(newLocale);
        console.info('[I18N] Locale changed to:', newLocale);
      }
    } catch (error) {
      console.error('[E:I18N:CHANGE_FAILED] Failed to change locale:', error);
    }
  }, []);

  // Show loading state while initializing
  if (!isReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-color-terminal-bg-deep">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-color-terminal-accent-teal border-t-transparent" />
          <span className="text-xs text-color-terminal-text-muted uppercase tracking-wider">
            Initializing...
          </span>
        </div>
      </div>
    );
  }

  const contextValue: I18nContextValue = {
    locale,
    setLocale,
    isReady
  };

  return (
    <I18nContext.Provider value={contextValue}>
      <I18nextProvider i18n={i18n}>
        {children}
      </I18nextProvider>
    </I18nContext.Provider>
  );
}

/**
 * Hook to access i18n context
 */
export function useI18nContext(): I18nContextValue {
  const context = React.useContext(I18nContext);
  if (!context) {
    throw new Error('useI18nContext must be used within I18nProvider');
  }
  return context;
}

/**
 * Hook to get current locale
 */
export function useLocale(): string {
  const context = React.useContext(I18nContext);
  return context?.locale || getCurrentLocale();
}

export default I18nProvider;
