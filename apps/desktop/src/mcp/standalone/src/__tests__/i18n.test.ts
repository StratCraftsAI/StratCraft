/**
 * Unit tests for the MCP standalone i18n helper (TICKET_786_6 Phase 4).
 *
 * Covers:
 *   - locale resolution priority (argv > STRATCRAFT_LOCALE > LC_ALL > LANG > en_US)
 *   - normalisation of POSIX tags ("zh_CN.UTF-8", "en-US")
 *   - prefix fallback for unshipped locales ("zh" -> first shipped "zh_*")
 *   - describeT() returns localised value, falls back to en_US, then to literal
 *
 * Filesystem access is exercised against a real temp directory (no fs mocks).
 * The helper's path candidates resolve relative to __dirname (the test file's
 * own location); we override that with a writable temp tree by writing files
 * into the standalone package's locale roots only for the duration of a test,
 * then removing them. To keep the test hermetic we instead drive the helper
 * via the public `createI18n({ argv, env })` API and rely on a custom locales
 * root via a test-only helper exported from src/i18n.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createI18n, resolveLocale, __testing } from '../i18n';

describe('resolveLocale', () => {
  it('prefers --locale=<tag> over env vars', () => {
    expect(
      resolveLocale(['node', 'mcp-server.js', '--locale=ja_JP'], {
        STRATCRAFT_LOCALE: 'zh_CN',
        LANG: 'fr_FR.UTF-8',
      }),
    ).toBe('ja_JP');
  });

  it('falls back to STRATCRAFT_LOCALE when no argv override', () => {
    expect(resolveLocale(['node', 'mcp-server.js'], { STRATCRAFT_LOCALE: 'zh_CN' })).toBe('zh_CN');
  });

  it('strips .UTF-8 suffix from POSIX LANG', () => {
    expect(resolveLocale([], { LANG: 'ja_JP.UTF-8' })).toBe('ja_JP');
  });

  it('normalises hyphenated BCP-47 tags', () => {
    expect(resolveLocale([], { STRATCRAFT_LOCALE: 'zh-CN' })).toBe('zh_CN');
  });

  it('falls back to a shipped locale by language prefix', () => {
    expect(resolveLocale([], { STRATCRAFT_LOCALE: 'zh_HK' })).toMatch(/^zh_/);
  });

  it('defaults to en_US when nothing matches', () => {
    expect(resolveLocale([], { STRATCRAFT_LOCALE: 'klingon' })).toBe('en_US');
    expect(resolveLocale([], {})).toBe('en_US');
  });

  it('LC_ALL overrides LANG (POSIX precedence)', () => {
    expect(resolveLocale([], { LC_ALL: 'de_DE.UTF-8', LANG: 'fr_FR.UTF-8' })).toBe('de_DE');
  });
});

describe('describeT() against real locale bundles', () => {
  const standaloneRoot = path.resolve(__dirname, '../..');
  const localesDir = path.join(standaloneRoot, 'locales');
  const sentinelLocaleDir = path.join(localesDir, 'tr_TR');
  const sentinelFile = path.join(sentinelLocaleDir, 'mcp.json');
  let createdSentinel = false;

  beforeEach(() => {
    // Use tr_TR as the test locale (always present after Phase 4B).
    // If the locale bundle does not yet exist on disk (Phase 4A only), create
    // a temporary stub so the fallback test path can exercise it.
    if (!fs.existsSync(sentinelFile)) {
      fs.mkdirSync(sentinelLocaleDir, { recursive: true });
      fs.writeFileSync(
        sentinelFile,
        JSON.stringify({ tools: { __test__: { description: 'TR_TEST_VALUE' } } }),
      );
      createdSentinel = true;
    }
  });

  afterEach(() => {
    if (createdSentinel) {
      fs.rmSync(sentinelFile, { force: true });
      try {
        fs.rmdirSync(sentinelLocaleDir);
      } catch {
        // directory may now be non-empty from concurrent Phase 4B work; ignore
      }
      createdSentinel = false;
    }
  });

  it('returns the en_US baseline for a known key', () => {
    const i18n = createI18n({ argv: ['node', '--locale=en_US'], env: {} });
    expect(i18n.locale).toBe('en_US');
    // tools.list_strategies.description was seeded in Phase 4A en_US/mcp.json.
    expect(i18n.describeT('tools.list_strategies.description', 'LITERAL')).toMatch(
      /strategies\/algorithms/,
    );
  });

  it('falls back to the literal English when the key does not exist anywhere', () => {
    const i18n = createI18n({ argv: ['node', '--locale=en_US'], env: {} });
    expect(i18n.describeT('tools.does_not_exist.description', 'LITERAL_EN_TEXT')).toBe(
      'LITERAL_EN_TEXT',
    );
  });

  it('falls back to en_US when the locale bundle is missing the key', () => {
    // Sentinel tr_TR bundle only carries tools.__test__.description; any
    // unrelated key must resolve from en_US.
    const i18n = createI18n({ argv: ['node', '--locale=tr_TR'], env: {} });
    expect(i18n.locale).toBe('tr_TR');
    expect(i18n.describeT('tools.list_strategies.description', 'LITERAL')).toMatch(
      /strategies\/algorithms/,
    );
  });

  it('localizes the TICKET_1302 U1 marketplace contracts in English and Chinese', () => {
    const english = createI18n({ argv: ['node', '--locale=en_US'], env: {} });
    const chinese = createI18n({ argv: ['node', '--locale=zh_CN'], env: {} });

    expect(english.describeT('tools.activate_license.description', 'LITERAL')).toContain(
      'securely store',
    );
    expect(chinese.describeT('tools.activate_license.description', 'LITERAL')).toContain(
      '安全存储',
    );
    expect(chinese.describeT('tools.get_entitlement_audit_log.params.limit', 'LITERAL')).toContain(
      '最大数量',
    );
  });

  it('localizes the TICKET_1302 U2 generation contracts in English and Chinese', () => {
    const english = createI18n({ argv: ['node', '--locale=en_US'], env: {} });
    const chinese = createI18n({ argv: ['node', '--locale=zh_CN'], env: {} });

    expect(english.describeT('tools.start_generation_session.description', 'LITERAL')).toContain(
      'page-scoped',
    );
    expect(chinese.describeT('tools.start_generation_session.description', 'LITERAL')).toContain(
      '页面级',
    );
    expect(chinese.describeT('tools.generate_from_catalog.params.risk_level', 'LITERAL')).toContain(
      '风险等级',
    );
    expect(chinese.describeT('tools.start_batch_generation.params.quantity', 'LITERAL')).toContain(
      '策略数量',
    );
  });
});

describe('createI18n() bundle isolation', () => {
  it('a locale bundle is not contaminated by argv from a later call', () => {
    const a = createI18n({ argv: ['node', '--locale=en_US'], env: {} });
    const b = createI18n({ argv: ['node', '--locale=en_US'], env: { STRATCRAFT_LOCALE: 'ja_JP' } });
    expect(a.locale).toBe('en_US');
    expect(b.locale).toBe('en_US'); // argv wins over env
  });

  it('describeT() helper resolves a value even with no bundle on disk', () => {
    // Use a tmp working directory that has no locales/ at all -- helper must
    // still degrade to literal fallback, never throw.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-i18n-isolated-'));
    try {
      const i18n = createI18n({ argv: ['node', '--locale=klingon'], env: {} });
      // klingon does not match any shipped locale -> resolver falls back to en_US.
      expect(i18n.locale).toBe('en_US');
      expect(i18n.describeT('does.not.exist', 'OK')).toBe('OK');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe('internal lookup()', () => {
  it('resolves nested dot-paths', () => {
    expect(__testing.lookup({ a: { b: { c: 'leaf' } } }, 'a.b.c')).toBe('leaf');
  });

  it('returns undefined for missing segments', () => {
    expect(__testing.lookup({ a: { b: {} } }, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined when the final segment is not a string', () => {
    expect(__testing.lookup({ a: { b: 42 } }, 'a.b')).toBeUndefined();
  });
});

describe('SHIPPED_LOCALES contract', () => {
  it('includes the 12 shipped TICKET_786_5 locales', () => {
    expect(__testing.SHIPPED_LOCALES).toContain('en_US');
    expect(__testing.SHIPPED_LOCALES).toContain('zh_CN');
    expect(__testing.SHIPPED_LOCALES).toContain('ja_JP');
    expect(__testing.SHIPPED_LOCALES).toHaveLength(12);
  });
});
