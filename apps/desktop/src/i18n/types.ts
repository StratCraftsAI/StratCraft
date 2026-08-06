/**
 * I18N Type Definitions
 * TICKET_084: Internationalization System Design
 */

import type { CoreNamespace } from './config';

/**
 * Plugin i18n contribution in manifest
 */
export interface I18nContribution {
  /** Relative path to locales directory */
  path: string;
  /** Namespace identifiers for this plugin */
  namespaces: string[];
}

/**
 * Translation resource bundle
 */
export type TranslationResource = Record<string, string | Record<string, unknown>>;

/**
 * Loaded translations structure
 */
export interface LoadedTranslations {
  locale: string;
  namespace: string;
  resources: TranslationResource;
}

/**
 * I18n initialization options
 */
export interface I18nInitOptions {
  /** Initial locale code */
  locale?: string;
  /** Additional namespaces to load */
  namespaces?: string[];
  /** Enable debug mode */
  debug?: boolean;
}

/**
 * Locale change event
 */
export interface LocaleChangeEvent {
  previousLocale: string;
  newLocale: string;
}

/**
 * i18next resources structure
 */
export type I18nResources = Record<string, Record<CoreNamespace | string, TranslationResource>>;
