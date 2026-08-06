/**
 * TICKET_786_17 Category I: i18n LSTM fit-quality contract labels.
 *
 * Verifies that:
 * 1. The contract returns i18n keys (not hardcoded English) for label/detail.
 * 2. The contract FitQuality type includes detailParams for interpolation.
 * 3. FitQualityGauge uses useTranslation to render translated strings.
 * 4. All 12 locale files contain the fitQuality section.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const gaugePath = resolve(__dirname, '..', 'FitQualityGauge.tsx');
const contractPath = resolve(
  __dirname,
  '..', '..', '..', '..', '..', '..', '..',
  'packages', 'types', 'src', 'lstm-fit-quality-contract.ts',
);
const localesDir = resolve(__dirname, '..', '..', '..', '..', '..', 'locales');

function readFile(p: string): string {
  return readFileSync(p, 'utf8');
}

const LOCALES = [
  'de_DE', 'en_US', 'es_ES', 'fr_FR', 'it_IT', 'ja_JP',
  'ko_KR', 'pt_PT', 'ru_RU', 'tr_TR', 'zh_CN', 'zh_TW',
];

const FIT_QUALITY_KEYS = [
  'insufficientData',
  'needTwoFoldResults',
  'dataStarved',
  'dataSufficiency',
  'needRatio',
  'modelFitQuality',
];

// ---------------------------------------------------------------------------
// Contract: i18n keys instead of hardcoded English
// ---------------------------------------------------------------------------

describe('TICKET_786_17 Cat I: contract returns i18n keys', () => {
  it('FitQuality type has detailParams field', () => {
    const src = readFile(contractPath);
    expect(src).toContain('detailParams?: Record<string, string | number>');
  });

  it('insufficient-data branch returns i18n key for label', () => {
    const src = readFile(contractPath);
    expect(src).toContain("label: 'fitQuality.insufficientData'");
  });

  it('insufficient-data branch returns i18n key for detail', () => {
    const src = readFile(contractPath);
    expect(src).toContain("detail: 'fitQuality.needTwoFoldResults'");
  });

  it('data-starved branch returns i18n key for detail', () => {
    const src = readFile(contractPath);
    expect(src).toContain("detail: 'fitQuality.dataStarved'");
  });

  it('data-starved branch populates detailParams', () => {
    const src = readFile(contractPath);
    expect(src).toContain('detailParams: {');
    expect(src).toContain('sampleCount:');
    expect(src).toContain('paramCount:');
    expect(src).toContain('ratio:');
    expect(src).toContain('targetRatio:');
  });

  it('does NOT contain hardcoded "Insufficient Data" string', () => {
    const src = readFile(contractPath);
    expect(src).not.toContain("'Insufficient Data'");
    expect(src).not.toContain('"Insufficient Data"');
  });

  it('does NOT contain hardcoded "Need 2+ fold results" string', () => {
    const src = readFile(contractPath);
    expect(src).not.toContain("'Need 2+ fold results'");
    expect(src).not.toContain('"Need 2+ fold results"');
  });

  it('does NOT contain hardcoded "data starved" template literal', () => {
    const src = readFile(contractPath);
    expect(src).not.toContain('`data starved');
  });
});

// ---------------------------------------------------------------------------
// FitQualityGauge: uses useTranslation
// ---------------------------------------------------------------------------

describe('TICKET_786_17 Cat I: FitQualityGauge i18n', () => {
  it('imports useTranslation from react-i18next', () => {
    const src = readFile(gaugePath);
    expect(src).toContain("import { useTranslation } from 'react-i18next'");
  });

  it('calls useTranslation with data namespace', () => {
    const src = readFile(gaugePath);
    expect(src).toContain("useTranslation('data')");
  });

  it('translates fit.label via t()', () => {
    const src = readFile(gaugePath);
    expect(src).toContain('t(fit.label)');
  });

  it('translates fit.detail with detailParams via t()', () => {
    const src = readFile(gaugePath);
    expect(src).toContain('t(fit.detail, fit.detailParams)');
  });

  it('translates dataSufficiency heading via t()', () => {
    const src = readFile(gaugePath);
    expect(src).toContain("t('fitQuality.dataSufficiency')");
  });

  it('translates modelFitQuality heading via t()', () => {
    const src = readFile(gaugePath);
    expect(src).toContain("t('fitQuality.modelFitQuality')");
  });

  it('translates needRatio via t() with interpolation', () => {
    const src = readFile(gaugePath);
    expect(src).toContain("t('fitQuality.needRatio'");
    expect(src).toContain('targetRatio:');
    expect(src).toContain('currentRatio:');
  });

  it('does NOT contain hardcoded "Data Sufficiency" text', () => {
    const src = readFile(gaugePath);
    const withoutImports = src.replace(/import .*/g, '');
    expect(withoutImports).not.toContain('>Data Sufficiency<');
    expect(withoutImports).not.toMatch(/>\s*Data Sufficiency\s*</);
  });

  it('does NOT contain hardcoded "Model Fit Quality" text', () => {
    const src = readFile(gaugePath);
    const withoutImports = src.replace(/import .*/g, '');
    expect(withoutImports).not.toContain('>Model Fit Quality<');
    expect(withoutImports).not.toMatch(/>\s*Model Fit Quality\s*</);
  });
});

// ---------------------------------------------------------------------------
// Locale files: fitQuality section in all 12 locales
// ---------------------------------------------------------------------------

describe('TICKET_786_17 Cat I: locale files contain fitQuality keys', () => {
  for (const locale of LOCALES) {
    describe(`locale ${locale}`, () => {
      const filePath = resolve(localesDir, locale, 'data.json');

      it('data.json exists and parses', () => {
        const json = JSON.parse(readFile(filePath));
        expect(json).toBeDefined();
      });

      it('has fitQuality section', () => {
        const json = JSON.parse(readFile(filePath));
        expect(json.fitQuality).toBeDefined();
        expect(typeof json.fitQuality).toBe('object');
      });

      for (const key of FIT_QUALITY_KEYS) {
        it(`has fitQuality.${key}`, () => {
          const json = JSON.parse(readFile(filePath));
          expect(json.fitQuality[key]).toBeDefined();
          expect(typeof json.fitQuality[key]).toBe('string');
          expect(json.fitQuality[key].length).toBeGreaterThan(0);
        });
      }

      it('dataStarved has interpolation placeholders', () => {
        const json = JSON.parse(readFile(filePath));
        const val = json.fitQuality.dataStarved;
        expect(val).toContain('{{sampleCount}}');
        expect(val).toContain('{{paramCount}}');
        expect(val).toContain('{{ratio}}');
        expect(val).toContain('{{targetRatio}}');
      });

      it('needRatio has interpolation placeholders', () => {
        const json = JSON.parse(readFile(filePath));
        const val = json.fitQuality.needRatio;
        expect(val).toContain('{{targetRatio}}');
        expect(val).toContain('{{currentRatio}}');
      });
    });
  }
});
