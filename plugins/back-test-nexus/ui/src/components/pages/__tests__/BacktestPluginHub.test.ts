/**
 * TICKET_499: BacktestPluginHub unit tests
 * Verifies AI Libero card is present in cockpit configurations.
 */
import { describe, it, expect } from 'vitest';

/**
 * Since BacktestPluginHub is a React component with JSX, we test the
 * configuration constants directly by inspecting the source.
 * This avoids needing a full React/DOM test environment for structural validation.
 */
describe('BacktestPluginHub COCKPIT_CONFIGS', () => {
  it('should include aiLibero cockpit in the configuration', async () => {
    // Read the source file to verify the configuration
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../BacktestPluginHub.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');

    // Verify AI Libero config entry exists
    expect(source).toContain("id: 'aiLibero'");
    expect(source).toContain("nameKey: 'cockpitSelector.aiLiberoCockpit'");
    expect(source).toContain("descKey: 'cockpitSelector.aiLiberoCockpitDesc'");
    expect(source).toContain("icon: BrainCircuitIcon");
    // TICKET_704: aiLibero tier changed from 'pro' to 'basic'
    expect(source).toContain("tier: 'basic'");
  });

  it('should have exactly 5 active cockpit entries (indicators, trader, catalog, aiLibero, aiStudio)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../BacktestPluginHub.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');

    const idMatches = source.match(/id: '(indicators|trader|catalog|aiLibero|aiStudio)'/g);
    expect(idMatches).toHaveLength(5);
  });

  it('should include catalog cockpit in the configuration', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../BacktestPluginHub.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');

    expect(source).toContain("id: 'catalog'");
    expect(source).toContain("nameKey: 'cockpitSelector.catalogCockpit'");
    expect(source).toContain("tier: 'free'");
  });

  it('should have BrainCircuitIcon SVG component defined', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../BacktestPluginHub.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');

    expect(source).toContain('const BrainCircuitIcon');
    expect(source).toContain('<svg');
  });
});

/**
 * TICKET_586: Verify mandatory workflow validation constants exist in BacktestPage
 */
describe('BacktestPage TICKET_586 mandatory workflow validation', () => {
  it('should define COCKPITS_WITH_MANDATORY_BOTH constant', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../BacktestPage.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');

    expect(source).toContain('COCKPITS_WITH_MANDATORY_BOTH');
    expect(source).toContain("'indicators'");
    expect(source).toContain("'kronos'");
  });

  it('should validate both analysisSelections and stepSelections for mandatory cockpits', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../BacktestPage.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');

    // Verify the validation block exists with AND logic
    expect(source).toContain('COCKPITS_WITH_MANDATORY_BOTH.has(cockpitMode)');
    expect(source).toContain('missingMarketAnalysis');
    expect(source).toContain('missingEntrySignal');
  });

  it('should validate workflow completeness in handleShowNamingDialog (before NamingDialog)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.resolve(__dirname, '../BacktestPage.tsx');
    const source = fs.readFileSync(filePath, 'utf-8');

    // Extract handleShowNamingDialog function body
    const showDialogStart = source.indexOf('const handleShowNamingDialog');
    const confirmStart = source.indexOf('const handleConfirmNaming');
    expect(showDialogStart).toBeGreaterThan(-1);
    expect(confirmStart).toBeGreaterThan(-1);
    const showDialogBody = source.slice(showDialogStart, confirmStart);

    // Verify TICKET_586 validation is in handleShowNamingDialog (before NamingDialog opens)
    expect(showDialogBody).toContain('COCKPITS_WITH_MANDATORY_BOTH.has(cockpitMode)');
    expect(showDialogBody).toContain('missingEntrySignal');
    expect(showDialogBody).toContain('missingMarketAnalysis');
    expect(showDialogBody).toContain('noWorkflowsConfigured');
  });

  it('should have i18n keys for missing workflow messages in all locales', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const locales = ['en_US', 'zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'de_DE', 'fr_FR', 'es_ES', 'pt_PT', 'it_IT'];
    for (const locale of locales) {
      const localePath = path.resolve(__dirname, `../../../../../locales/${locale}/backtest.json`);
      const data = JSON.parse(fs.readFileSync(localePath, 'utf-8'));
      expect(data.messages).toHaveProperty('missingMarketAnalysis');
      expect(data.messages).toHaveProperty('missingEntrySignal');
    }
  });
});

describe('BacktestPluginHub CockpitMode completeness', () => {
  it('should have matching i18n keys for all cockpit modes', async () => {
    const fs = await import('fs');
    const path = await import('path');

    // Read en_US locale
    const localePath = path.resolve(__dirname, '../../../../../locales/en_US/backtest.json');
    const locale = JSON.parse(fs.readFileSync(localePath, 'utf-8'));

    // Verify all cockpit modes have i18n keys
    const modes = ['indicators', 'kronos', 'trader', 'aiLibero', 'aiStudio', 'catalog'];
    for (const mode of modes) {
      expect(locale.cockpitSelector).toHaveProperty(`${mode}Cockpit`);
      expect(locale.cockpitSelector).toHaveProperty(`${mode}CockpitDesc`);
    }

    // Verify breadcrumb keys
    expect(locale.breadcrumb).toHaveProperty('indicatorsCockpit');
    expect(locale.breadcrumb).toHaveProperty('kronosCockpit');
    expect(locale.breadcrumb).toHaveProperty('traderCockpit');
    expect(locale.breadcrumb).toHaveProperty('aiLiberoCockpit');
    expect(locale.breadcrumb).toHaveProperty('aiStudioCockpit');
    expect(locale.breadcrumb).toHaveProperty('catalogCockpit');
  });
});
