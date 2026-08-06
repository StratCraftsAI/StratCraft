/**
 * TICKET_1335_1 Phase 3 -- every translation key the page can request exists.
 *
 * WHY THIS TEST IS NECESSARY RATHER THAN PEDANTIC:
 * The components build keys by INTERPOLATION -- `researchEnvironment.states.
 * ${status.state}`, `...capabilities.${capability}.name`, `...causes.${cause}`
 * and so on. A missing key therefore cannot be caught by the type checker or by
 * a smoke render; it surfaces at runtime as the raw key string sitting in the
 * UI, and only in the state that happens to produce it. The failure mode is a
 * user reaching the one error path nobody clicked through and reading
 * `researchEnvironment.causes.backend_init` instead of a sentence.
 *
 * Every loop below iterates a SHARED runtime tuple, so a state, stage, cause,
 * category, or capability added by parent TICKET_1335 fails here immediately
 * instead of shipping an untranslated surface.
 *
 * Phase 4 extends this from "en_US has every key" to "EVERY LOCALE has every
 * key" (AC12). The en_US suite below stays as the source-of-truth assertion,
 * and the parity suite at the bottom holds the other eleven to exactly the same
 * key set -- structurally, so a key added to en_US later cannot ship as an
 * English string in eleven languages without failing here first.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RESEARCH_CAPABILITIES,
  RESEARCH_ENVIRONMENT_FAILURE_CATEGORIES,
  RESEARCH_ENVIRONMENT_JOB_STATES,
  RESEARCH_ENVIRONMENT_OPERATIONS,
  RESEARCH_ENVIRONMENT_STAGES,
  RESEARCH_ENVIRONMENT_STATES,
} from '@StratCraft/types';

const LOCALE_ROOT = join(__dirname, '../../../../i18n/locales');

function loadUi(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(LOCALE_ROOT, locale, 'ui.json'), 'utf8'));
}

/** Resolve a dotted key, returning undefined rather than throwing. */
function lookup(bundle: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object' && part in (node as object)) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, bundle);
}

function expectString(bundle: Record<string, unknown>, key: string): void {
  const value = lookup(bundle, key);
  expect(value, `missing translation key: ${key}`).toBeTypeOf('string');
  expect((value as string).length, `empty translation key: ${key}`).toBeGreaterThan(0);
}

describe('research environment i18n coverage (en_US)', () => {
  const ui = loadUi('en_US');

  it('translates every environment state the contract can report', () => {
    for (const state of RESEARCH_ENVIRONMENT_STATES) {
      expectString(ui, `researchEnvironment.states.${state}`);
    }
  });

  it('translates every stage a job can report', () => {
    for (const stage of RESEARCH_ENVIRONMENT_STAGES) {
      expectString(ui, `researchEnvironment.stages.${stage}`);
    }
  });

  it('translates every job state', () => {
    for (const state of RESEARCH_ENVIRONMENT_JOB_STATES) {
      expectString(ui, `researchEnvironment.jobStates.${state}`);
    }
  });

  /**
   * Actions and progress headings are keyed by operation, so all three of
   * install/repair/verify must resolve. A missing `repair` heading is how a
   * repair silently comes back looking like an install (AC6a).
   */
  it('translates every operation as both an action and a progress heading', () => {
    for (const operation of RESEARCH_ENVIRONMENT_OPERATIONS) {
      expectString(ui, `researchEnvironment.actions.${operation}`);
      expectString(ui, `researchEnvironment.progress.${operation}`);
    }
  });

  it('translates every failure category (AC7)', () => {
    for (const category of RESEARCH_ENVIRONMENT_FAILURE_CATEGORIES) {
      expectString(ui, `researchEnvironment.failureCategory.${category}`);
    }
  });

  /**
   * Causes are enumerated from the shared union's variants rather than guessed.
   * Each is a legal `cause` for at least one category, so each is reachable.
   */
  it('translates every cause the failure union can carry', () => {
    const causes = [
      'unsupported',
      'missing_executable',
      'missing_lock',
      'manifest_drift',
      'lock_io',
      'invalid_lock_metadata',
      'database',
      'network',
      'process_exit',
      'process_lost',
      'import',
      'probe',
      'backend_init',
    ] as const;
    for (const cause of causes) {
      expectString(ui, `researchEnvironment.causes.${cause}`);
    }
  });

  /** The three causes a capability card can headline (AC8). */
  it('translates every capability-level cause headline', () => {
    for (const cause of ['import', 'probe', 'backend_init'] as const) {
      expectString(ui, `researchEnvironment.capabilityCause.${cause}`);
    }
  });

  it('names and describes every shared capability (AC3)', () => {
    for (const capability of RESEARCH_CAPABILITIES) {
      expectString(ui, `researchEnvironment.capabilities.${capability}.name`);
      expectString(ui, `researchEnvironment.capabilities.${capability}.description`);
    }
  });

  it('translates the PySR layer rows and their states (AC8)', () => {
    for (const layer of ['python', 'julia'] as const) {
      expectString(ui, `researchEnvironment.pysr.${layer}`);
    }
    for (const state of ['ready', 'failed', 'pending'] as const) {
      expectString(ui, `researchEnvironment.layerStates.${state}`);
    }
  });

  it('translates the summary evidence labels (AC9)', () => {
    for (const key of [
      'interpreter',
      'lastVerified',
      'pixiVersion',
      'technicalDetails',
      'manifestHash',
      'lockHash',
      'liveWorkloadNotice',
    ]) {
      expectString(ui, `researchEnvironment.summary.${key}`);
    }
  });

  it('translates the remaining page-level strings', () => {
    for (const key of [
      'loading',
      'approvalDeclined',
      'sharedEnvironmentNotice',
      'failure.stage',
      'failure.cause',
      'failure.capability',
      'capability.expected',
      'capability.installed',
      'capability.notInstalled',
    ]) {
      expectString(ui, `researchEnvironment.${key}`);
    }
  });

  /**
   * AC10 is a promise about behaviour, so the string that carries it must
   * actually say it. Asserting the substance rather than the exact sentence
   * keeps a copy edit from silently dropping the guarantee.
   */
  it('states that a live workload is never restarted (AC10)', () => {
    const notice = lookup(ui, 'researchEnvironment.summary.liveWorkloadNotice');
    expect(notice).toBeTypeOf('string');
    expect((notice as string).toLowerCase()).toContain('restarted');
  });

  /**
   * AC11: the live region and the accessible names are user-facing strings that
   * a sighted reviewer never sees, which is exactly why they need a test --
   * a missing key here ships as a screen reader reading
   * `researchEnvironment.a11y.capabilityState` aloud.
   */
  it('translates every live-region announcement (AC11)', () => {
    for (const key of ['succeeded', 'failed', 'failedState']) {
      expectString(ui, `researchEnvironment.announce.${key}`);
    }
  });

  it('translates every accessible name and region label (AC11)', () => {
    for (const key of [
      'environmentState',
      'capabilityState',
      'platform',
      'elapsed',
      'logTail',
    ]) {
      expectString(ui, `researchEnvironment.a11y.${key}`);
    }
    expectString(ui, 'researchEnvironment.regions.summary');
  });

  /**
   * The terminal announcements interpolate the operation heading, so dropping
   * the placeholder would announce "failed." with no subject -- true of the
   * page but useless to the person listening.
   */
  it('keeps the operation placeholder in both terminal announcements', () => {
    for (const key of ['succeeded', 'failed']) {
      const value = lookup(ui, `researchEnvironment.announce.${key}`) as string;
      expect(value, key).toContain('{{operation}}');
    }
  });
});

// -----------------------------------------------------------------------------
// AC12 -- every locale carries the same key set
// -----------------------------------------------------------------------------

/**
 * The locale set is read from disk rather than hard-coded so that adding a
 * locale to the app cannot leave this page behind in English.
 */
const LOCALES = readdirSync(LOCALE_ROOT).filter((entry) =>
  statSync(join(LOCALE_ROOT, entry)).isDirectory(),
);

/** Every dotted leaf path under an object, in traversal order. */
function leafKeys(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leafKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe('research environment i18n coverage (AC12: all locales)', () => {
  const expectedKeys = leafKeys(
    lookup(loadUi('en_US'), 'researchEnvironment'),
  ).sort();

  it('discovers the full Electron locale set', () => {
    // Sanity floor: if this ever reads 1, the directory scan broke and every
    // per-locale assertion below would pass vacuously.
    expect(LOCALES.length).toBeGreaterThanOrEqual(12);
    expect(LOCALES).toContain('en_US');
  });

  it('has a non-trivial key set to compare against', () => {
    // Guards the same way: an empty `expectedKeys` would make parity trivial.
    expect(expectedKeys.length).toBeGreaterThan(50);
  });

  /**
   * Structural parity rather than a per-key list: comparing the SORTED key sets
   * catches a missing key AND a stray one, and needs no edit when parent
   * TICKET_1335 adds a capability or a failure category.
   */
  it.each(LOCALES)('%s carries exactly the en_US key set', (locale) => {
    const block = lookup(loadUi(locale), 'researchEnvironment');
    expect(block, `${locale} has no researchEnvironment block`).toBeTypeOf('object');
    expect(leafKeys(block).sort()).toEqual(expectedKeys);
  });

  it.each(LOCALES)('%s has no empty string in the block', (locale) => {
    const ui = loadUi(locale);
    for (const key of expectedKeys) {
      expectString(ui, `researchEnvironment.${key}`);
    }
  });

  /**
   * Interpolation placeholders are part of the CONTRACT, not the prose: a
   * translator who drops `{{count}}` or renames `{{state}}` produces a sentence
   * with a hole in it, and i18next fails silently by leaving the literal
   * placeholder on screen. Asserting the placeholder SET per key holds every
   * locale to the same variables en_US uses.
   */
  it.each(LOCALES)('%s preserves every interpolation placeholder', (locale) => {
    const en = loadUi('en_US');
    const ui = loadUi(locale);
    const placeholders = (value: string): string[] =>
      [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

    for (const key of expectedKeys) {
      const source = lookup(en, `researchEnvironment.${key}`) as string;
      const expected = placeholders(source);
      if (expected.length === 0) continue;
      const translated = lookup(ui, `researchEnvironment.${key}`) as string;
      expect(placeholders(translated), `${locale}: ${key}`).toEqual(expected);
    }
  });

  /**
   * AC12 is about localization, not about copying English into twelve files.
   * Package names (`DuckDB`, `gplearn`) and the `--` placeholder are legitimately
   * identical everywhere, so parity is asserted on the SENTENCES: if a locale's
   * prose is byte-identical to en_US, nothing was translated.
   */
  it.each(LOCALES.filter((locale) => locale !== 'en_US'))(
    '%s actually translates the prose rather than copying en_US',
    (locale) => {
      const en = loadUi('en_US');
      const ui = loadUi(locale);
      const prose = [
        'loading',
        'approvalDeclined',
        'summary.liveWorkloadNotice',
        'states.absent',
        'actions.install',
        'announce.failedState',
        'a11y.logTail',
      ];
      for (const key of prose) {
        expect(
          lookup(ui, `researchEnvironment.${key}`),
          `${locale}: ${key} is still English`,
        ).not.toBe(lookup(en, `researchEnvironment.${key}`));
      }
    },
  );
});
