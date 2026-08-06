/**
 * TICKET_786_20 Category G: Backtest plugin error fallback i18n coverage
 *
 * Validates that all Category G i18n keys exist in every locale file,
 * and that the corresponding source files reference them via i18n.t() or t().
 */
import { describe, it, expect } from 'vitest';

const ALL_LOCALES = [
  'en_US', 'zh_CN', 'zh_TW', 'ja_JP', 'ko_KR',
  'de_DE', 'fr_FR', 'es_ES', 'pt_PT', 'it_IT', 'ru_RU', 'tr_TR',
];

/** Helper: load locale JSON for a given locale code. */
async function loadLocale(locale: string): Promise<Record<string, unknown>> {
  const fs = await import('fs');
  const path = await import('path');
  const localePath = path.resolve(
    __dirname,
    `../../../../locales/${locale}/backtest.json`,
  );
  return JSON.parse(fs.readFileSync(localePath, 'utf-8'));
}

/** Helper: read a source file relative to ui/src/. */
async function readSource(relPath: string): Promise<string> {
  const fs = await import('fs');
  const path = await import('path');
  const filePath = path.resolve(__dirname, '../../', relPath);
  return fs.readFileSync(filePath, 'utf-8');
}

// ---------------------------------------------------------------------------
// G4-G7 -- index.ts  (errors.fetchMarketDataFailed, resultNotFound, fetchDataFailed)
// ---------------------------------------------------------------------------
describe('G4-G7: index.ts error fallback i18n', () => {
  it('source should use i18n.t for error fallback strings', async () => {
    const src = await readSource('index.ts');
    expect(src).toContain("i18n.t('errors.fetchMarketDataFailed'");
    expect(src).toContain("i18n.t('errors.resultNotFound'");
    expect(src).toContain("i18n.t('errors.fetchDataFailed'");
  });

  it('source should NOT contain hardcoded error strings', async () => {
    const src = await readSource('index.ts');
    expect(src).not.toContain("'Failed to fetch market data'");
    expect(src).not.toContain("'Result not found'");
    // 'Failed to fetch data' could appear as a substring in other messages,
    // so check the exact throw patterns
    expect(src).not.toMatch(/throw new Error\('Failed to fetch data'\)/);
    expect(src).not.toMatch(/\|\| 'Failed to fetch data'/);
  });
});

// ---------------------------------------------------------------------------
// G8 -- utils/auth-utils.ts  (errors.userNotAuthenticated)
// ---------------------------------------------------------------------------
describe('G8: auth-utils.ts error i18n', () => {
  it('source should use i18n.t for auth error', async () => {
    const src = await readSource('utils/auth-utils.ts');
    expect(src).toContain("i18n.t('errors.userNotAuthenticated'");
  });

  it('source should NOT contain hardcoded auth error string', async () => {
    const src = await readSource('utils/auth-utils.ts');
    expect(src).not.toContain("'User not authenticated. Please log in.'");
  });
});

// ---------------------------------------------------------------------------
// G9-G10 -- engine/engine.ts  (errors.backtestAlreadyRunning, maxDrawdownReached)
// ---------------------------------------------------------------------------
describe('G9-G10: engine.ts error fallback i18n', () => {
  it('source should use i18n.t for engine error strings', async () => {
    const src = await readSource('engine/engine.ts');
    expect(src).toContain("i18n.t('errors.backtestAlreadyRunning'");
    expect(src).toContain("i18n.t('errors.maxDrawdownReached'");
  });

  it('source should NOT contain hardcoded engine error strings', async () => {
    const src = await readSource('engine/engine.ts');
    expect(src).not.toContain("'Backtest already running'");
    expect(src).not.toContain("'Max drawdown reached'");
  });
});

// ---------------------------------------------------------------------------
// G11 -- hooks/useExportToQuantLab.ts  (errors.exportFallback)
// ---------------------------------------------------------------------------
describe('G11: useExportToQuantLab.ts error fallback i18n', () => {
  it('source should use i18n.t for export error fallback', async () => {
    const src = await readSource('hooks/useExportToQuantLab.ts');
    expect(src).toContain("i18n.t('errors.exportFallback'");
  });

  it('source should NOT contain hardcoded export error string', async () => {
    const src = await readSource('hooks/useExportToQuantLab.ts');
    expect(src).not.toContain("'Export failed'");
  });
});

// ---------------------------------------------------------------------------
// G12-G13 -- components/pages/BacktestPage.tsx  (errors.resumeFailed, startBacktestFailed)
// ---------------------------------------------------------------------------
describe('G12-G13: BacktestPage.tsx error fallback i18n', () => {
  it('source should use t() for error fallback strings', async () => {
    const src = await readSource('components/pages/BacktestPage.tsx');
    expect(src).toContain("t('errors.resumeFailed')");
    expect(src).toContain("t('errors.startBacktestFailed')");
  });

  it('source should NOT contain hardcoded error strings', async () => {
    const src = await readSource('components/pages/BacktestPage.tsx');
    expect(src).not.toContain("'Resume failed'");
    expect(src).not.toContain("'Failed to start backtest'");
  });
});

// ---------------------------------------------------------------------------
// All errors.* keys exist in every locale
// ---------------------------------------------------------------------------
describe('Category G: errors.* keys in all 12 locales', () => {
  const REQUIRED_KEYS = [
    'searchFailed',
    'coverageCheckFailed',
    'downloadFailed',
    'fetchMarketDataFailed',
    'resultNotFound',
    'fetchDataFailed',
    'userNotAuthenticated',
    'backtestAlreadyRunning',
    'maxDrawdownReached',
    'exportFallback',
    'resumeFailed',
    'startBacktestFailed',
  ];

  it('errors.* keys exist in all 12 locales', async () => {
    for (const locale of ALL_LOCALES) {
      const data = await loadLocale(locale);
      const errors = data.errors as Record<string, unknown>;
      expect(errors, `${locale} missing errors section`).toBeDefined();
      for (const key of REQUIRED_KEYS) {
        expect(errors, `${locale} missing errors.${key}`).toHaveProperty(key);
      }
    }
  });
});
