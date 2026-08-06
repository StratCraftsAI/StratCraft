/**
 * TICKET_1335_1 AC12 -- navigation strings exist in EVERY Electron locale.
 *
 * Without this, a missing key is invisible in development (i18next falls back
 * to the key itself) and ships as a rail tooltip reading
 * `toolbar.researchEnvironment`. The locale set is read from disk rather than
 * hard-coded so adding a locale to the app cannot leave this entry behind.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES_DIR = path.resolve(__dirname, '../../../i18n/locales');

const locales = fs.readdirSync(LOCALES_DIR)
  .filter((entry) => fs.statSync(path.join(LOCALES_DIR, entry)).isDirectory());

function readUi(locale: string): Record<string, any> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, locale, 'ui.json'), 'utf-8'),
  );
}

describe('research environment navigation i18n', () => {
  it('discovers the full Electron locale set', () => {
    // Sanity floor: if this ever reads 1, the glob broke and every
    // per-locale assertion below would vacuously pass.
    expect(locales.length).toBeGreaterThanOrEqual(12);
    expect(locales).toContain('en_US');
  });

  it.each(locales)('%s carries the rail tooltip', (locale) => {
    const ui = readUi(locale);
    expect(typeof ui.toolbar?.researchEnvironment).toBe('string');
    expect(ui.toolbar.researchEnvironment.length).toBeGreaterThan(0);
  });

  it.each(locales)('%s carries the view label and short label', (locale) => {
    const entry = readUi(locale).viewRegistry?.researchEnvironment;
    expect(entry).toBeDefined();
    expect(typeof entry.label).toBe('string');
    expect(entry.label.length).toBeGreaterThan(0);
    expect(typeof entry.shortLabel).toBe('string');
    expect(entry.shortLabel.length).toBeGreaterThan(0);
  });
});
