/**
 * TICKET_786_17 Category A: i18n Strategy Builder Service Error Code Messages
 *
 * Verifies that all 7 service files:
 * 1. Import i18n from 'i18next'
 * 2. Use i18n.t() via resolveErrorCode() for error messages (no hardcoded English strings)
 * 3. All 12 locale files contain the `errorCodes` section with all required keys
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVICES_DIR = path.resolve(__dirname, '..');
const LOCALES_DIR = path.resolve(__dirname, '..', '..', '..', 'locales');
const SHARED_PROTOCOL_FILE = path.resolve(
  __dirname, '..', '..', '..', '..', '..',
  'packages', 'ai-studio-operations', 'src', 'vibing-chat-protocol.ts',
);

const SERVICE_FILES = [
  'trader-ai-entry-service.ts',
  'ai-libero-service.ts',
  'kronos-ai-entry-service.ts',
  'kronos-indicator-entry-service.ts',
  'regime-indicator-entry-service.ts',
  'market-observer-service.ts',
  'market-regime-service.ts',
  'risk-override-exit-service.ts',
  'catalog-strategy-service.ts',
  'vibing-chat-service.ts',
];

const LOCALE_IDS = [
  'en_US', 'zh_CN', 'zh_TW', 'ja_JP', 'ko_KR',
  'de_DE', 'fr_FR', 'es_ES', 'it_IT', 'pt_PT', 'ru_RU', 'tr_TR',
];

/**
 * Union of all error codes referenced across the 7 services.
 * Each service declares a ReadonlySet<string> of known codes;
 * the locale files must cover the full union.
 */
const ALL_ERROR_CODES = [
  // Shared across most services
  'SECURITY_VIOLATION',
  'INVALID',
  'TIMEOUT',
  'NETWORK_ERROR',
  'TASK_FAILED',
  'LLM_ERROR',
  'GENERATION_FAILED',
  // AI/prompt-based services (trader-ai, ai-libero, kronos-ai)
  'INVALID_PROMPT',
  'PROMPT_TOO_SHORT',
  'PROMPT_TOO_LONG',
  'INVALID_PRESET',
  'INVALID_BESPOKE_CONFIG',
  'LLM_RATE_LIMIT',
  'LLM_CONTEXT_LENGTH',
  'SPEC_NOT_TRADING_ALGORITHM',
  'UNSUPPORTED_PROVIDER',
  // ai-libero only
  'INVALID_PREDICTION_CONFIG',
  // Indicator-based services (kronos-indicator, regime-indicator, market-observer, market-regime)
  'SYNTAX_ERROR',
  'UNKNOWN_INDICATOR',
  'UNSUPPORTED_OPERATOR',
  // market-observer only
  'STRATEGY_CONFIG_INVALID',
  'AUTH_ERROR',
  'QUOTA_EXCEEDED',
  'LLM_PROVIDER_ERROR',
  // risk-override-exit-service
  'NO_RULES_ENABLED',
  'INVALID_RULE_CONFIG',
  // catalog-strategy-service
  'CATALOG_NOT_FOUND',
  'GENERATION_TIMEOUT',
  'RATE_LIMIT_EXCEEDED',
  // vibing-chat-service
  'CODE_GENERATION_ERROR',
  'RATE_LIMIT',
  'INVALID_SESSION',
  'AUTH_REQUIRED',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readServiceSource(filename: string): string {
  return fs.readFileSync(path.join(SERVICES_DIR, filename), 'utf-8');
}

/**
 * TICKET_1376: single declaration site of the vibing-chat backend error-code
 * whitelist, shared by the Electron plugin and the Guide WebUI / MCP surface.
 */
function readSharedProtocolSource(): string {
  return fs.readFileSync(SHARED_PROTOCOL_FILE, 'utf-8');
}

function readLocaleJson(localeId: string): Record<string, unknown> {
  const filePath = path.join(LOCALES_DIR, localeId, 'strategy-builder.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TICKET_786_17 Category A: i18n error code messages', () => {
  // -------------------------------------------------------------------------
  // 1. All 7 service files import i18n
  // -------------------------------------------------------------------------
  describe('i18n import', () => {
    for (const file of SERVICE_FILES) {
      it(`${file} imports i18n from i18next`, () => {
        const source = readServiceSource(file);
        expect(source).toMatch(/import\s+i18n\s+from\s+['"]i18next['"]/);
      });
    }
  });

  // -------------------------------------------------------------------------
  // 2. No hardcoded English error message strings in ERROR_CODE_MESSAGES
  //    dictionaries. All services must use resolveErrorCode() -> i18n.t().
  // -------------------------------------------------------------------------
  describe('no hardcoded error message dictionaries', () => {
    for (const file of SERVICE_FILES) {
      it(`${file} does not contain ERROR_CODE_MESSAGES dictionary`, () => {
        const source = readServiceSource(file);
        // The old pattern was: const ERROR_CODE_MESSAGES: Record<string, string> = { ... }
        // or similar hardcoded dictionary objects.
        expect(source).not.toMatch(/ERROR_CODE_MESSAGES\s*[:=]/);
      });

      it(`${file} uses i18n.t() for error code resolution`, () => {
        const source = readServiceSource(file);
        // Every service must have a resolveErrorCode function that calls i18n.t()
        expect(source).toMatch(/i18n\.t\(\s*`errorCodes\.\$\{/);
      });

      it(`${file} has no hardcoded English error strings in error code section`, () => {
        const source = readServiceSource(file);
        // Check that the known error code identifiers are NOT used as dictionary
        // values with hardcoded English strings. The pattern we are looking for is
        // something like: 'SECURITY_VIOLATION': 'Security violation detected...'
        // If such a pattern exists, i18n migration is incomplete.
        const hardcodedPattern = /['"]SECURITY_VIOLATION['"]\s*:\s*['"][A-Z][a-z]/;
        expect(source).not.toMatch(hardcodedPattern);
      });
    }
  });

  // -------------------------------------------------------------------------
  // 3. All 12 locale files contain errorCodes section with all required keys
  // -------------------------------------------------------------------------
  describe('locale file completeness', () => {
    for (const localeId of LOCALE_IDS) {
      describe(`${localeId}/strategy-builder.json`, () => {
        it('has errorCodes section', () => {
          const data = readLocaleJson(localeId);
          expect(data).toHaveProperty('errorCodes');
          expect(typeof data.errorCodes).toBe('object');
        });

        it('contains all required error code keys', () => {
          const data = readLocaleJson(localeId);
          const errorCodes = data.errorCodes as Record<string, string>;

          for (const code of ALL_ERROR_CODES) {
            expect(errorCodes).toHaveProperty(code);
            // Value must be a non-empty string
            expect(typeof errorCodes[code]).toBe('string');
            expect(errorCodes[code].length).toBeGreaterThan(0);
          }
        });

        it('has no extra keys beyond the defined set', () => {
          const data = readLocaleJson(localeId);
          const errorCodes = data.errorCodes as Record<string, string>;
          const expectedSet = new Set(ALL_ERROR_CODES);
          const actualKeys = Object.keys(errorCodes);

          for (const key of actualKeys) {
            expect(expectedSet.has(key as typeof ALL_ERROR_CODES[number])).toBe(true);
          }
        });
      });
    }
  });

  // -------------------------------------------------------------------------
  // 4. Cross-check: each service's error code set is a subset of ALL_ERROR_CODES
  // -------------------------------------------------------------------------
  describe('service error code sets are subsets of locale keys', () => {
    const expectedSet = new Set(ALL_ERROR_CODES);

    for (const file of SERVICE_FILES) {
      it(`${file} error codes are all covered by locale keys`, () => {
        // TICKET_1376 step 2: `vibing-chat-service.ts` no longer declares its
        // whitelist locally -- it was promoted to the shared
        // `@StratCraft/ai-studio-operations` package so the Guide WebUI surface
        // resolves the identical backend codes. The guarantee this test gives
        // is unchanged (every resolvable code is translated in all 12 locales);
        // only the declaration site moved, so read it from its new owner.
        const source = file === 'vibing-chat-service.ts'
          ? readSharedProtocolSource()
          : readServiceSource(file);
        // Extract all string literals from ReadonlySet declarations
        const setMatch = source.match(/new Set\(\[\s*([\s\S]*?)\]\)/);
        expect(setMatch).not.toBeNull();

        const codesInSource = setMatch![1]
          .match(/'([A-Z_]+)'/g)
          ?.map(s => s.replace(/'/g, '')) ?? [];

        expect(codesInSource.length).toBeGreaterThan(0);

        for (const code of codesInSource) {
          expect(expectedSet.has(code as typeof ALL_ERROR_CODES[number])).toBe(true);
        }
      });
    }
  });
});
