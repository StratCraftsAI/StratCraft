/**
 * Web Dashboard I18N Initialization
 * TICKET_786_10: Web Dashboard i18n bootstrap
 *
 * Independent i18n setup for the web dashboard.
 * Single namespace: 'dashboard'
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Static imports for all locales (web dashboard is small enough for eager loading)
import en_US from './locales/en_US/dashboard.json';
import zh_CN from './locales/zh_CN/dashboard.json';
import zh_TW from './locales/zh_TW/dashboard.json';
import ja_JP from './locales/ja_JP/dashboard.json';
import ko_KR from './locales/ko_KR/dashboard.json';
import de_DE from './locales/de_DE/dashboard.json';
import es_ES from './locales/es_ES/dashboard.json';
import fr_FR from './locales/fr_FR/dashboard.json';
import it_IT from './locales/it_IT/dashboard.json';
import pt_PT from './locales/pt_PT/dashboard.json';
import ru_RU from './locales/ru_RU/dashboard.json';
import tr_TR from './locales/tr_TR/dashboard.json';

const SUPPORTED_LOCALES = [
  'en_US', 'zh_CN', 'zh_TW', 'ja_JP', 'ko_KR',
  'de_DE', 'es_ES', 'fr_FR', 'it_IT', 'pt_PT', 'ru_RU', 'tr_TR',
] as const;

const resources = {
  en_US: { dashboard: en_US },
  zh_CN: { dashboard: zh_CN },
  zh_TW: { dashboard: zh_TW },
  ja_JP: { dashboard: ja_JP },
  ko_KR: { dashboard: ko_KR },
  de_DE: { dashboard: de_DE },
  es_ES: { dashboard: es_ES },
  fr_FR: { dashboard: fr_FR },
  it_IT: { dashboard: it_IT },
  pt_PT: { dashboard: pt_PT },
  ru_RU: { dashboard: ru_RU },
  tr_TR: { dashboard: tr_TR },
};

/**
 * Detect browser locale and map to supported locale code.
 */
function detectLocale(): string {
  const browserLang = navigator.language || 'en';

  // Direct match (e.g. "ja" -> "ja_JP")
  const mapping: Record<string, string> = {
    en: 'en_US',
    zh: 'zh_CN',
    'zh-TW': 'zh_TW',
    'zh-HK': 'zh_TW',
    ja: 'ja_JP',
    ko: 'ko_KR',
    de: 'de_DE',
    es: 'es_ES',
    fr: 'fr_FR',
    it: 'it_IT',
    pt: 'pt_PT',
    ru: 'ru_RU',
    tr: 'tr_TR',
  };

  // Try exact match first (e.g. "zh-TW")
  if (mapping[browserLang]) return mapping[browserLang];

  // Try base language (e.g. "en-GB" -> "en")
  const base = browserLang.split('-')[0];
  if (mapping[base]) return mapping[base];

  return 'en_US';
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: detectLocale(),
    fallbackLng: 'en_US',
    ns: ['dashboard'],
    defaultNS: 'dashboard',

    interpolation: {
      escapeValue: false, // React already escapes
    },

    react: {
      useSuspense: false,
    },

    keySeparator: '.',
    nsSeparator: ':',

    returnEmptyString: false,
  });

export { SUPPORTED_LOCALES };
export default i18n;
