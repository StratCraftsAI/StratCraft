export interface SupportedLocaleRecord {
  code: string;
  shortCode: string;
  nativeLabel: string;
  englishLabel: string;
}

export const DEFAULT_LOCALE = 'en_US';
export const SUPPORTED_LOCALE_RECORDS: readonly SupportedLocaleRecord[] = [
  { code: 'en_US', shortCode: 'en', nativeLabel: 'English', englishLabel: 'English' },
  { code: 'de_DE', shortCode: 'de', nativeLabel: 'Deutsch', englishLabel: 'German' },
  { code: 'es_ES', shortCode: 'es', nativeLabel: 'Espanol', englishLabel: 'Spanish' },
  { code: 'fr_FR', shortCode: 'fr', nativeLabel: 'Francais', englishLabel: 'French' },
  { code: 'it_IT', shortCode: 'it', nativeLabel: 'Italiano', englishLabel: 'Italian' },
  { code: 'ja_JP', shortCode: 'ja', nativeLabel: '\u65E5\u672C\u8A9E', englishLabel: 'Japanese' },
  { code: 'ko_KR', shortCode: 'ko', nativeLabel: '\uD55C\uAD6D\uC5B4', englishLabel: 'Korean' },
  { code: 'pt_PT', shortCode: 'pt', nativeLabel: 'Portugues', englishLabel: 'Portuguese' },
  { code: 'zh_CN', shortCode: 'zh', nativeLabel: '\u7B80\u4F53\u4E2D\u6587', englishLabel: 'Simplified Chinese' },
  { code: 'zh_TW', shortCode: 'zh-TW', nativeLabel: '\u7E41\u9AD4\u4E2D\u6587', englishLabel: 'Traditional Chinese' },
  { code: 'ru_RU', shortCode: 'ru', nativeLabel: '\u0420\u0443\u0441\u0441\u043A\u0438\u0439', englishLabel: 'Russian' },
  { code: 'tr_TR', shortCode: 'tr', nativeLabel: 'T\u00FCrk\u00E7e', englishLabel: 'Turkish' },
] as const;

export function normalizeSupportedLocale(value: string): string | null {
  const normalized = value.replace('-', '_');
  const exact = SUPPORTED_LOCALE_RECORDS.find(locale => locale.code === normalized);
  if (exact) return exact.code;
  const language = normalized.split('_')[0]?.toLowerCase();
  return SUPPORTED_LOCALE_RECORDS.find(locale => locale.code.split('_')[0].toLowerCase() === language)?.code ?? null;
}
