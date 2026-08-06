/**
 * ConfigSettings consolidated-sections verification (TICKET_875)
 *
 * TICKET_875 removed the CONFIG/ADVANCED tab switcher and folded the useful
 * ADVANCED sections (Backtest, Diagnostics, Onboarding, Privacy, Developer
 * Mode) into ConfigSettings' left-nav scroll layout. AdvancedSettings.tsx was
 * deleted.
 *
 * This is a source-string verification test (the predecessor,
 * AdvancedSettings.test.ts from TICKET_573 Phase 4A, read AdvancedSettings.tsx
 * the same way). It now reads ConfigSettings.tsx and asserts the moved
 * functionality survived the consolidation, plus pins the new section ids.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const configSource = fs.readFileSync(
  path.resolve(__dirname, '../ConfigSettings.tsx'),
  'utf-8'
);

const settingsPageSource = fs.readFileSync(
  path.resolve(__dirname, '../SettingsPage.tsx'),
  'utf-8'
);

describe('ConfigSettings consolidated sections (TICKET_875)', () => {
  describe('tab switcher removed from SettingsPage', () => {
    it('SettingsPage no longer imports AdvancedSettings', () => {
      expect(settingsPageSource).not.toContain('AdvancedSettings');
    });

    it('SettingsPage no longer defines a SettingsTab / tab switcher', () => {
      expect(settingsPageSource).not.toContain('SettingsTab');
      expect(settingsPageSource).not.toContain('TabButton');
      expect(settingsPageSource).not.toContain('activeTab');
    });

    it('SettingsPage renders ConfigSettings directly', () => {
      expect(settingsPageSource).toContain('<ConfigSettings />');
    });
  });

  describe('AdvancedSettings.tsx is deleted', () => {
    it('the old component file no longer exists', () => {
      const advPath = path.resolve(__dirname, '../AdvancedSettings.tsx');
      expect(fs.existsSync(advPath)).toBe(false);
    });
  });

  describe('new section ids present in CONFIG nav + body', () => {
    for (const id of ['diagnostics', 'onboarding', 'privacy']) {
      it(`has section id="${id}"`, () => {
        expect(configSource).toContain(`id="${id}"`);
        expect(configSource).toContain(`id: '${id}'`);
      });
    }
  });

  // TICKET_877_1: the Backtest twin (shadowed maxParallelTasks duplicate) and
  // Developer Mode (undeclared key, zero reads, security-misleading
  // allowUnsigned) sections were deleted as dead config. Pin their removal.
  describe('dead sections removed (TICKET_877_1)', () => {
    for (const id of ['backtest', 'developer']) {
      it(`no longer has section id="${id}"`, () => {
        expect(configSource).not.toContain(`id="${id}"`);
        expect(configSource).not.toContain(`id: '${id}'`);
      });
    }
    it('no longer uses the backtest status store twin', () => {
      expect(configSource).not.toContain('useBacktestStatusStore');
      expect(configSource).not.toContain('maxParallelTasks');
    });
    it('no longer references developer-mode config or the allowUnsigned toggle', () => {
      expect(configSource).not.toContain('developerMode');
      expect(configSource).not.toContain('allowUnsigned');
    });
  });

  describe('Diagnostics moved over', () => {
    it('still contains open log folder', () => {
      expect(configSource).toContain('openLogFolder');
    });
    it('still references the diagnostics i18n title', () => {
      expect(configSource).toContain('advanced.diagnostics.title');
    });
  });

  describe('Onboarding moved over', () => {
    it('uses onboarding + assistant state', () => {
      expect(configSource).toContain('useOnboarding');
      expect(configSource).toContain('assistantEnabled');
      expect(configSource).toContain('resetOnboarding');
    });
  });

  describe('Privacy moved over', () => {
    it('retains analytics consent state, not a crash consent toggle', () => {
      expect(configSource).toContain('analyticsConsent');
      expect(configSource).not.toContain('setCrashConsent');
      expect(configSource).not.toContain('handleCrashConsentChange');
    });

    it('shows crash reports as always-on', () => {
      expect(configSource).toContain('advanced.privacy.crashReportsAlwaysOn');
      expect(configSource).toContain('advanced.privacy.alwaysOn');
    });

    it('references the consent API', () => {
      expect(configSource).toContain('consent.getStatus');
      expect(configSource).toContain('consent.setConsent');
    });

    it('contains privacy i18n keys', () => {
      expect(configSource).toContain('advanced.privacy.title');
      expect(configSource).toContain('advanced.privacy.crashReports');
      expect(configSource).toContain('advanced.privacy.analytics');
    });
  });

  // TICKET_1283: Resource Governance section (per-workload CPU/mem caps).
  describe('Resource Governance section (TICKET_1283)', () => {
    it('has nav entry + section id="resourceGovernance"', () => {
      expect(configSource).toContain(`id="resourceGovernance"`);
      expect(configSource).toContain(`id: 'resourceGovernance'`);
    });

    it('binds the master toggle + three cap inputs to persistence handlers', () => {
      expect(configSource).toContain("handleChange('resourceGovernance.enabled'");
      expect(configSource).toContain("handleChange('resourceGovernance.sweep.capPercent'");
      expect(configSource).toContain("handleChange('resourceGovernance.mining.capPercent'");
      expect(configSource).toContain("handleChange('resourceGovernance.lstm.capPercent'");
    });

    it('uses the shared cap bounds constants (no magic numbers)', () => {
      expect(configSource).toContain('RESOURCE_CAP_MIN');
      expect(configSource).toContain('RESOURCE_CAP_MAX');
      expect(configSource).toContain('RESOURCE_CAP_AGGREGATE_MAX');
    });

    it('references the governance i18n keys incl. the apply-on-next-launch note', () => {
      expect(configSource).toContain('config.resourceGovernance.title');
      expect(configSource).toContain('config.resourceGovernance.applyNote');
      expect(configSource).toContain('config.resourceGovernance.aggregateExceeded');
      expect(configSource).toContain('config.nav.resourceGovernance');
    });

    it('binds the cross-workload admission ceiling to shared 50-95 bounds (AC8)', () => {
      expect(configSource).toContain(
        "handleChange('resourceGovernance.admissionCeilingPercent'",
      );
      expect(configSource).toContain('WORKLOAD_ADMISSION_CEILING_MIN_PERCENT');
      expect(configSource).toContain('WORKLOAD_ADMISSION_CEILING_MAX_PERCENT');
      expect(configSource).toContain('config.resourceGovernance.admissionCeiling');
    });
  });

  describe('no diagnostic-export dead code reintroduced (TICKET_573 Phase 4A)', () => {
    it('does not import DiagnosticExportDialog', () => {
      expect(configSource).not.toContain('DiagnosticExportDialog');
    });
    it('does not reference exportDiagnosticPackage', () => {
      expect(configSource).not.toContain('exportDiagnosticPackage');
    });
  });
});
