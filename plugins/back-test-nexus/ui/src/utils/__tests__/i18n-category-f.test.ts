/**
 * TICKET_786_17 Category F: Backtester Engine & Tree Data i18n coverage
 *
 * Validates that all Category F i18n keys exist in every locale file,
 * and that the corresponding source files reference them via i18n.t().
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
// F1 -- BacktestTreeDataProvider.ts  (tree.* keys)
// ---------------------------------------------------------------------------
describe('F1: BacktestTreeDataProvider i18n', () => {
  it('source should use i18n.t for tree labels', async () => {
    const src = await readSource('providers/BacktestTreeDataProvider.ts');
    expect(src).toContain("i18n.t('tree.backtestWorkflow'");
    expect(src).toContain("i18n.t('tree.openWorkflow'");
    expect(src).toContain("i18n.t('tree.history'");
    expect(src).toContain("i18n.t('tree.backtestResultN'");
  });

  it('tree.* keys exist in all 12 locales', async () => {
    for (const locale of ALL_LOCALES) {
      const data = await loadLocale(locale);
      const tree = data.tree as Record<string, unknown>;
      expect(tree, `${locale} missing tree section`).toBeDefined();
      expect(tree).toHaveProperty('backtestWorkflow');
      expect(tree).toHaveProperty('openWorkflow');
      expect(tree).toHaveProperty('history');
      expect(tree).toHaveProperty('backtestResultN');
    }
  });
});

// ---------------------------------------------------------------------------
// F2 -- engine/executor.ts  (engine.strategies.* keys)
// ---------------------------------------------------------------------------
describe('F2: executor.ts strategy i18n', () => {
  it('source should use i18n.t for strategy definitions', async () => {
    const src = await readSource('engine/executor.ts');
    expect(src).toContain("i18n.t('engine.strategies.smaCrossover.name'");
    expect(src).toContain("i18n.t('engine.strategies.smaCrossover.description'");
    expect(src).toContain("i18n.t('engine.strategies.smaCrossover.fastPeriod'");
    expect(src).toContain("i18n.t('engine.strategies.smaCrossover.slowPeriod'");
    expect(src).toContain("i18n.t('engine.strategies.rsiMeanReversion.name'");
    expect(src).toContain("i18n.t('engine.strategies.rsiMeanReversion.description'");
    expect(src).toContain("i18n.t('engine.strategies.rsiMeanReversion.period'");
    expect(src).toContain("i18n.t('engine.strategies.rsiMeanReversion.oversold'");
    expect(src).toContain("i18n.t('engine.strategies.rsiMeanReversion.overbought'");
  });

  it('engine.strategies.* keys exist in all 12 locales', async () => {
    for (const locale of ALL_LOCALES) {
      const data = await loadLocale(locale);
      const engine = data.engine as Record<string, unknown>;
      expect(engine, `${locale} missing engine section`).toBeDefined();
      const strategies = engine.strategies as Record<string, Record<string, string>>;
      expect(strategies).toBeDefined();

      // SMA Crossover
      expect(strategies.smaCrossover).toHaveProperty('name');
      expect(strategies.smaCrossover).toHaveProperty('description');
      expect(strategies.smaCrossover).toHaveProperty('fastPeriod');
      expect(strategies.smaCrossover).toHaveProperty('slowPeriod');

      // RSI Mean Reversion
      expect(strategies.rsiMeanReversion).toHaveProperty('name');
      expect(strategies.rsiMeanReversion).toHaveProperty('description');
      expect(strategies.rsiMeanReversion).toHaveProperty('period');
      expect(strategies.rsiMeanReversion).toHaveProperty('oversold');
      expect(strategies.rsiMeanReversion).toHaveProperty('overbought');
    }
  });
});

// ---------------------------------------------------------------------------
// F3 -- engine/portfolio.ts  (engine.noPositionToSell)
// ---------------------------------------------------------------------------
describe('F3: portfolio.ts i18n', () => {
  it('source should use i18n.t for no-position-to-sell message', async () => {
    const src = await readSource('engine/portfolio.ts');
    expect(src).toContain("i18n.t('engine.noPositionToSell'");
    expect(src).not.toContain("'No position to sell (short selling disabled)'");
  });

  it('engine.noPositionToSell key exists in all 12 locales', async () => {
    for (const locale of ALL_LOCALES) {
      const data = await loadLocale(locale);
      const engine = data.engine as Record<string, unknown>;
      expect(engine).toHaveProperty('noPositionToSell');
    }
  });
});

// ---------------------------------------------------------------------------
// F4 -- engine/engine.ts  (engine.noDataInRange)
// ---------------------------------------------------------------------------
describe('F4: engine.ts i18n', () => {
  it('source should use i18n.t for no-data-in-range message', async () => {
    const src = await readSource('engine/engine.ts');
    expect(src).toContain("i18n.t('engine.noDataInRange'");
    expect(src).not.toContain("'No data in requested range'");
  });

  it('engine.noDataInRange key exists in all 12 locales', async () => {
    for (const locale of ALL_LOCALES) {
      const data = await loadLocale(locale);
      const engine = data.engine as Record<string, unknown>;
      expect(engine).toHaveProperty('noDataInRange');
    }
  });
});

// ---------------------------------------------------------------------------
// F5 -- ui/src/index.ts  (notification.* keys)
// ---------------------------------------------------------------------------
describe('F5: index.ts notification i18n', () => {
  it('source should use i18n.t for notification messages', async () => {
    const src = await readSource('index.ts');
    expect(src).toContain("i18n.t('notification.backtestCompletedReturn'");
    expect(src).toContain("i18n.t('notification.backtestFailed'");
    expect(src).toContain("i18n.t('notification.resultsCleared'");
    expect(src).toContain("i18n.t('notification.noDataSource'");
    expect(src).toContain("i18n.t('notification.noResultsToExport'");
  });

  it('source should NOT contain hardcoded notification strings', async () => {
    const src = await readSource('index.ts');
    expect(src).not.toContain("'Results cleared'");
    expect(src).not.toContain("'No results to export'");
    expect(src).not.toContain("'No data source available. Please configure a data provider.'");
  });

  it('notification.* keys exist in all 12 locales', async () => {
    for (const locale of ALL_LOCALES) {
      const data = await loadLocale(locale);
      const notification = data.notification as Record<string, unknown>;
      expect(notification, `${locale} missing notification section`).toBeDefined();
      expect(notification).toHaveProperty('backtestCompletedReturn');
      expect(notification).toHaveProperty('backtestFailed');
      expect(notification).toHaveProperty('resultsCleared');
      expect(notification).toHaveProperty('noDataSource');
      expect(notification).toHaveProperty('noResultsToExport');
    }
  });
});
