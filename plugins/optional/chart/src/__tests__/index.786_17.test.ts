/**
 * TICKET_786_17 Category K -- Chart plugin notification i18n.
 *
 * Source-structure assertions verifying that the hardcoded "Indicator added"
 * notification has been replaced with an i18n call, and that the
 * corresponding key exists in every locale file.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const sourcePath = path.join(__dirname, '..', 'index.ts');
const source = readFileSync(sourcePath, 'utf8');

// Plugin-root locales dir (plugins/optional/chart/locales/<loc>/chart.json)
const localesRoot = path.join(__dirname, '..', '..', 'locales');
const locales = readdirSync(localesRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

// ---------------------------------------------------------------------------
// K1: Notification uses i18n key instead of hardcoded English string
// ---------------------------------------------------------------------------

describe('TICKET_786_17 K1: addIndicator notification uses i18n', () => {
  it('imports i18n from i18next', () => {
    expect(source).toContain("import i18n from 'i18next'");
  });

  it('does not contain the hardcoded English notification string', () => {
    expect(source).not.toContain('`Indicator added: ${indicator}`');
  });

  it('uses i18n.t() with the notification.indicatorAdded key', () => {
    expect(source).toContain("i18n.t('notification.indicatorAdded'");
  });

  it("passes { ns: 'chart' } to scope the key to the chart namespace", () => {
    expect(source).toContain("ns: 'chart'");
  });

  it('passes the indicator interpolation variable', () => {
    // The call should include `indicator` in the options object
    expect(source).toMatch(/i18n\.t\('notification\.indicatorAdded',\s*\{[^}]*indicator[^}]*\}/);
  });
});

// ---------------------------------------------------------------------------
// K2: Every locale file carries the notification.indicatorAdded key
// ---------------------------------------------------------------------------

describe('TICKET_786_17 K2: all locales carry notification.indicatorAdded', () => {
  it('has at least 12 locale directories', () => {
    expect(locales.length).toBeGreaterThanOrEqual(12);
  });

  it.each(locales)('%s carries notification.indicatorAdded key', (loc: string) => {
    const json = JSON.parse(
      readFileSync(path.join(localesRoot, loc, 'chart.json'), 'utf8'),
    ) as { notification?: { indicatorAdded?: string } };
    expect(
      json.notification?.indicatorAdded,
      `${loc} missing notification.indicatorAdded`,
    ).toBeTruthy();
  });

  it.each(locales)('%s notification.indicatorAdded contains {{indicator}} interpolation', (loc: string) => {
    const json = JSON.parse(
      readFileSync(path.join(localesRoot, loc, 'chart.json'), 'utf8'),
    ) as { notification?: { indicatorAdded?: string } };
    expect(
      json.notification?.indicatorAdded,
      `${loc} notification.indicatorAdded missing {{indicator}} placeholder`,
    ).toContain('{{indicator}}');
  });
});
