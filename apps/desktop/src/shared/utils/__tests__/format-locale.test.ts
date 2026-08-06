import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('i18next', () => ({
  default: {
    language: 'en_US',
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  },
}));

import i18n from 'i18next';
import {
  getIntlLocale,
  getApiLocale,
  formatDate,
  formatDateTime,
  formatTimestamp,
  formatNumber,
  getDateFormatHint,
} from '../format-locale';

function setLanguage(lang: string) {
  (i18n as { language: string }).language = lang;
}

describe('getIntlLocale', () => {
  beforeEach(() => setLanguage('en_US'));

  it('maps zh_CN to zh-CN', () => {
    setLanguage('zh_CN');
    expect(getIntlLocale()).toBe('zh-CN');
  });

  it('maps de_DE to de-DE', () => {
    setLanguage('de_DE');
    expect(getIntlLocale()).toBe('de-DE');
  });

  it('maps ja_JP to ja-JP', () => {
    setLanguage('ja_JP');
    expect(getIntlLocale()).toBe('ja-JP');
  });

  it('canonicalizes a regional locale not listed in the translation catalog', () => {
    setLanguage('en_GB');
    expect(getIntlLocale()).toBe('en-GB');
  });

  it('falls back to en-US for unmapped locale', () => {
    setLanguage('unknown');
    expect(getIntlLocale()).toBe('en-US');
  });
});

describe('getApiLocale', () => {
  beforeEach(() => setLanguage('en_US'));

  it('returns underscore format for known locale', () => {
    setLanguage('zh_CN');
    expect(getApiLocale()).toBe('zh_CN');
  });

  it('returns de_DE for German', () => {
    setLanguage('de_DE');
    expect(getApiLocale()).toBe('de_DE');
  });

  it('returns ja_JP for Japanese', () => {
    setLanguage('ja_JP');
    expect(getApiLocale()).toBe('ja_JP');
  });

  it('falls back to en_US for unmapped locale', () => {
    setLanguage('unknown');
    expect(getApiLocale()).toBe('en_US');
  });

  it('returns en_US for en_US', () => {
    setLanguage('en_US');
    expect(getApiLocale()).toBe('en_US');
  });
});

describe('formatDate', () => {
  beforeEach(() => setLanguage('en_US'));

  it('formats Date object', () => {
    const result = formatDate(new Date('2024-01-15T00:00:00Z'));
    expect(result).toMatch(/01.*15.*2024/);
  });

  it('formats string input', () => {
    const result = formatDate('2024-06-01');
    expect(result).toMatch(/06.*01.*2024/);
  });

  it('keeps a canonical calendar date stable in an extreme host timezone', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'Etc/GMT+12';
    setLanguage('en_GB');
    expect(formatDate('2026-06-26')).toBe('26/06/2026');
    process.env.TZ = originalTimezone;
  });

  it('formats number (timestamp ms) input', () => {
    const ts = new Date('2024-03-20T00:00:00Z').getTime();
    const result = formatDate(ts);
    expect(result).toMatch(/03.*20.*2024/);
  });
});

describe('formatDateTime', () => {
  beforeEach(() => setLanguage('en_US'));

  it('treats number as unix timestamp in seconds', () => {
    // 2024-01-15 12:30:00 UTC = 1705318200
    const result = formatDateTime(1705318200);
    expect(result).toMatch(/Jan/);
    expect(result).toMatch(/15/);
    expect(result).toMatch(/2024/);
  });

  it('formats Date object', () => {
    const result = formatDateTime(new Date('2024-07-04T15:00:00Z'));
    expect(result).toMatch(/Jul/);
    expect(result).toMatch(/4/);
    expect(result).toMatch(/2024/);
  });
});

describe('formatTimestamp', () => {
  beforeEach(() => setLanguage('en_US'));

  it('shows time only for today', () => {
    const now = new Date();
    now.setHours(now.getHours() - 1);
    const result = formatTimestamp(now);
    // Should contain time-like pattern (HH:MM)
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it('shows "Yesterday" for yesterday', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const result = formatTimestamp(yesterday);
    expect(result).toBe('Yesterday');
  });

  it('shows weekday for < 7 days ago', () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    threeDaysAgo.setHours(0, 0, 0, 0);
    const result = formatTimestamp(threeDaysAgo);
    // Short weekday like "Mon", "Tue", etc.
    expect(result).toMatch(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/);
  });

  it('shows month+day for older dates', () => {
    const result = formatTimestamp(new Date('2023-03-15T12:00:00'));
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/15/);
  });

  it('accepts string input', () => {
    const result = formatTimestamp('2023-01-01T00:00:00');
    expect(result).toMatch(/Jan/);
  });
});

describe('formatNumber', () => {
  beforeEach(() => setLanguage('en_US'));

  it('formats basic number', () => {
    const result = formatNumber(1234567.89);
    expect(result).toMatch(/1,234,567/);
  });

  it('formats with currency option', () => {
    const result = formatNumber(42.5, { style: 'currency', currency: 'USD' });
    expect(result).toMatch(/\$42\.50/);
  });

  it('formats with percent option', () => {
    const result = formatNumber(0.75, { style: 'percent' });
    expect(result).toMatch(/75%/);
  });
});

describe('getDateFormatHint', () => {
  it('returns MM/DD/YYYY for en-US', () => {
    setLanguage('en_US');
    expect(getDateFormatHint()).toBe('MM/DD/YYYY');
  });

  it('returns DD.MM.YYYY for de-DE', () => {
    setLanguage('de_DE');
    expect(getDateFormatHint()).toBe('DD.MM.YYYY');
  });

  it('returns YYYY/MM/DD for zh-CN', () => {
    setLanguage('zh_CN');
    expect(getDateFormatHint()).toBe('YYYY/MM/DD');
  });

  it('returns YYYY.MM.DD for ko-KR', () => {
    setLanguage('ko_KR');
    expect(getDateFormatHint()).toBe('YYYY.MM.DD');
  });

  it('falls back to MM/DD/YYYY for unknown locale', () => {
    setLanguage('xx_XX');
    expect(getDateFormatHint()).toBe('MM/DD/YYYY');
  });
});
