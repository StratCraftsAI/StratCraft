/**
 * TICKET_1376: shared vibing-chat backend error-code contract.
 *
 * The reported incident was a `generate_code` failure that rendered as
 * "The tool could not complete the operation. Review the diagnostic log and
 * try again." on the Guide WebUI while the *same* backend failure rendered as
 * "Failed to generate strategy code. Please try again." in Electron. The cause
 * was not missing error handling -- it was error handling that existed on one
 * surface only, so the second surface had no code vocabulary to resolve.
 *
 * These tests pin the properties that keep the two surfaces from drifting
 * again:
 *   1. exactly one declaration site for the code set;
 *   2. both surfaces translate every code in it, in all 12 locales;
 *   3. the presentation key the MCP surface mints survives the projector's
 *      browser-safety validator.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  VIBING_CHAT_ERROR_CODES,
  VIBING_CHAT_PRESENTATION_PREFIX,
  isKnownVibingChatErrorCode,
  vibingChatPresentationKey,
} from './vibing-chat-protocol';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const PLUGIN_LOCALES = path.join(REPO_ROOT, 'plugins', 'strategy-builder-nexus', 'locales');
const DASHBOARD_LOCALES = path.join(
  REPO_ROOT, 'apps', 'web-dashboard', 'src', 'i18n', 'locales',
);

const LOCALE_IDS = [
  'en_US', 'zh_CN', 'zh_TW', 'ja_JP', 'ko_KR',
  'de_DE', 'fr_FR', 'es_ES', 'it_IT', 'pt_PT', 'ru_RU', 'tr_TR',
];

/** The projector's producer-presentation validator (tool-outcome-projection.ts). */
const MESSAGE_KEY_PATTERN = /^agentOutcome\.[A-Za-z][A-Za-z0-9.]{0,127}$/;

/** The projector's outcome-code validator -- deliberately lowercase-only. */
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;

const CODES = [...VIBING_CHAT_ERROR_CODES];

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 1. Single declaration site
// ---------------------------------------------------------------------------

describe('single declaration site', () => {
  it('declares the whitelist in the shared package', () => {
    expect(CODES.sort()).toEqual([
      'AUTH_REQUIRED',
      'CODE_GENERATION_ERROR',
      'INVALID_SESSION',
      'LLM_ERROR',
      'NETWORK_ERROR',
      'RATE_LIMIT',
      'TIMEOUT',
    ]);
  });

  it('is not re-declared inside either surface', () => {
    // A second `new Set([...])` of these codes anywhere in a consuming surface
    // is the exact regression this ticket fixes: two vocabularies drifting.
    //
    // TICKET_1380: the guarantee quantifies over the consumer surfaces that
    // exist in the distribution under test. The MCP strategies handler is
    // matrix-classified commercial, so the public StratCraft tree runs this
    // test without it; the plugin surfaces are public and must always be
    // present, which the existence assertions below pin down so a moved or
    // mistyped path can never silently skip a surface.
    const alwaysPresentConsumers = [
      path.join(REPO_ROOT, 'plugins', 'strategy-builder-nexus', 'src', 'services', 'vibing-chat-service.ts'),
      path.join(REPO_ROOT, 'plugins', 'strategy-builder-nexus', 'src', 'services', 'api-client.ts'),
    ];
    const distributionDependentConsumers = [
      path.join(REPO_ROOT, 'apps', 'desktop', 'src', 'mcp', 'standalone', 'src', 'handlers', 'strategies.ts'),
    ];
    for (const file of alwaysPresentConsumers) {
      expect(fs.existsSync(file), `missing consumer surface: ${file}`).toBe(true);
    }
    const consumers = [
      ...alwaysPresentConsumers,
      ...distributionDependentConsumers.filter((file) => fs.existsSync(file)),
    ];
    for (const file of consumers) {
      const source = fs.readFileSync(file, 'utf-8');
      expect(source).not.toMatch(/CODE_GENERATION_ERROR'\s*,/);
    }
  });

  it('removed the shadow getVibingChatErrorMessage from api-client', () => {
    // TICKET_1376 step 3 / TICKET_524 R8: one name must not mean two things.
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'plugins', 'strategy-builder-nexus', 'src', 'services', 'api-client.ts'),
      'utf-8',
    );
    expect(source).not.toContain('export function getVibingChatErrorMessage');
  });
});

// ---------------------------------------------------------------------------
// 2. Validator behaviour
// ---------------------------------------------------------------------------

describe('isKnownVibingChatErrorCode', () => {
  for (const code of CODES) {
    it(`accepts ${code}`, () => {
      expect(isKnownVibingChatErrorCode(code)).toBe(true);
    });
  }

  it('rejects unknown, empty, and undefined codes', () => {
    expect(isKnownVibingChatErrorCode('SOMETHING_ELSE')).toBe(false);
    expect(isKnownVibingChatErrorCode('')).toBe(false);
    expect(isKnownVibingChatErrorCode(undefined)).toBe(false);
  });

  it('is case-sensitive so lowercased backend prose cannot pass', () => {
    expect(isKnownVibingChatErrorCode('code_generation_error')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Presentation key crosses the browser-safety boundary intact
// ---------------------------------------------------------------------------

describe('vibingChatPresentationKey', () => {
  for (const code of CODES) {
    it(`${code} yields a key the projector's validator accepts`, () => {
      const key = vibingChatPresentationKey(code);
      expect(key).toBeDefined();
      expect(key!.startsWith(VIBING_CHAT_PRESENTATION_PREFIX)).toBe(true);
      // The regression guard: MESSAGE_KEY_PATTERN admits no underscore, so a
      // key built naively from the SCREAMING_SNAKE code would be rejected by
      // producerPresentation() and silently fall back to the generic message.
      expect(key!).toMatch(MESSAGE_KEY_PATTERN);
      expect(key!).not.toContain('_');
    });
  }

  it('returns undefined for an unknown code so the UI falls back to generic', () => {
    expect(vibingChatPresentationKey('NOT_A_CODE')).toBeUndefined();
    expect(vibingChatPresentationKey(undefined)).toBeUndefined();
  });

  it('never produces a value usable as an outcome code', () => {
    // The whole reason backend codes travel via `presentation` rather than
    // `code`: `code` is a lowercase-only browser-safety boundary, and remote
    // -origin tokens must not be laundered into it.
    for (const code of CODES) {
      expect(code).not.toMatch(CODE_PATTERN);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Both surfaces resolve every code, in all 12 locales
// ---------------------------------------------------------------------------

describe('cross-surface locale coverage', () => {
  for (const locale of LOCALE_IDS) {
    it(`${locale}: Electron plugin translates all codes`, () => {
      const data = readJson(path.join(PLUGIN_LOCALES, locale, 'strategy-builder.json'));
      const errorCodes = data.errorCodes as Record<string, string>;
      for (const code of CODES) {
        expect(typeof errorCodes?.[code]).toBe('string');
        expect(errorCodes[code].length).toBeGreaterThan(0);
      }
    });

    it(`${locale}: Guide WebUI translates all codes`, () => {
      const data = readJson(path.join(DASHBOARD_LOCALES, locale, 'dashboard.json'));
      const agentOutcome = data.agentOutcome as Record<string, unknown>;
      const vibingChat = agentOutcome?.vibingChat as Record<string, string>;
      for (const code of CODES) {
        // Look the key up exactly as the runtime does, so a locale keyed by a
        // segment the resolver never emits fails here.
        const key = vibingChatPresentationKey(code)!
          .slice(VIBING_CHAT_PRESENTATION_PREFIX.length);
        expect(typeof vibingChat?.[key]).toBe('string');
        expect(vibingChat[key].length).toBeGreaterThan(0);
      }
    });

    it(`${locale}: the same failure reads the same way on both surfaces`, () => {
      // Surface parity is the point of the ticket: a user who sees a failure in
      // Electron and the Guide WebUI must not get two different explanations.
      const plugin = readJson(path.join(PLUGIN_LOCALES, locale, 'strategy-builder.json'));
      const dashboard = readJson(path.join(DASHBOARD_LOCALES, locale, 'dashboard.json'));
      const pluginCodes = plugin.errorCodes as Record<string, string>;
      const dashboardCodes = (dashboard.agentOutcome as Record<string, unknown>)
        .vibingChat as Record<string, string>;
      for (const code of CODES) {
        const key = vibingChatPresentationKey(code)!
          .slice(VIBING_CHAT_PRESENTATION_PREFIX.length);
        expect(dashboardCodes[key]).toBe(pluginCodes[code]);
      }
    });
  }
});
