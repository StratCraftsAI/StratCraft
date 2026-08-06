// Unit tests for TICKET_843 Phase 2 fallback-string discipline rules.
//
// Each test exercises the pure rule functions exported from
// fallback-discipline.mjs (no filesystem scan). The PASS / FAIL cases
// listed below mirror the ticket's test-plan section verbatim; if any
// of them stop holding, this file is the canonical failure surface.
//
// Runs via Node's built-in test runner (no devDependency required):
//   node --test scripts/i18n/__tests__/fallback-discipline.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  VIOLATION,
  checkFallbackString,
  checkPlaceholderVarsMismatch,
  extractPlaceholders,
  extractTopLevelObjectKeys,
} from '../fallback-discipline.mjs';

// -- Rule 3: whitespace edges -----------------------------------------

test('PASS: literal noun-phrase fallback "Cancel"', () => {
  assert.deepEqual(checkFallbackString('Cancel'), []);
});

test('PASS: interpolated sentence "{{n}} rows"', () => {
  assert.deepEqual(checkFallbackString('{{n}} rows'), []);
});

test('FAIL: leading whitespace', () => {
  const v = checkFallbackString('   leading whitespace');
  assert.equal(v.length, 1);
  assert.equal(v[0].code, VIOLATION.WHITESPACE_EDGES);
});

test('FAIL: trailing whitespace', () => {
  const v = checkFallbackString('Cancel ');
  assert.equal(v.length, 1);
  assert.equal(v[0].code, VIOLATION.WHITESPACE_EDGES);
});

// -- Rule 2: ` x ` between placeholders (TICKET_841 footgun) ----------

test('FAIL: "{{n}} folds x reps" -- TICKET_841 regression', () => {
  // The original defective fallback string. ` x ` adjacent to the
  // `{{n}}` placeholder reads as if `x` itself were an unsubstituted
  // variable when the locale key is missing.
  const v = checkFallbackString('{{n}} folds x reps');
  assert.equal(v.length, 1);
  assert.equal(v[0].code, VIOLATION.X_BETWEEN_WORDS);
});

test('FAIL: " x {{reps}}" (placeholder on the right)', () => {
  // Symmetric: word + ` x ` + placeholder is the same defect class.
  const v = checkFallbackString('folds x {{reps}}');
  assert.equal(v.length, 1);
  assert.equal(v[0].code, VIOLATION.X_BETWEEN_WORDS);
});

test('PASS: " x " between two plain words is permitted (heuristic narrowed)', () => {
  // Per the ticket "Risks and tradeoffs" refinement, the rule only fires
  // when ` x ` is adjacent to a `{{` or `}}` token. Prose like "5 x 10"
  // or "rows x columns" in a fully literal fallback is left alone so the
  // rule does not false-positive on legitimate uses.
  assert.deepEqual(checkFallbackString('5 x 10 grid'), []);
});

test('PASS: "Folds * Reps" -- recommended replacement', () => {
  // The fix prescribed by the ticket: use `*`, `/`, `&`, or a real word.
  assert.deepEqual(checkFallbackString('{{folds}} * {{reps}}'), []);
});

// -- Rule 1: stray braces ---------------------------------------------

test('FAIL: stray "{{" without matching "}}"', () => {
  const v = checkFallbackString('Total {{ rows');
  assert.equal(v.length, 1);
  assert.equal(v[0].code, VIOLATION.STRAY_BRACES);
});

test('FAIL: stray "}}" without matching "{{"', () => {
  const v = checkFallbackString('Total }} rows');
  assert.equal(v.length, 1);
  assert.equal(v[0].code, VIOLATION.STRAY_BRACES);
});

test('PASS: balanced "{{name}}" placeholders', () => {
  assert.deepEqual(checkFallbackString('Hello {{name}}, {{count}} items'), []);
});

// -- Rule 4: placeholder / vars mismatch ------------------------------

test('FAIL: vars mismatch -- placeholder absent from vars', () => {
  // t('k', '{{n}} rows', { count: 5 })  -- ticket-listed example
  const v = checkPlaceholderVarsMismatch('{{n}} rows', new Set(['count']));
  assert.equal(v.length, 1);
  assert.equal(v[0].code, VIOLATION.VARS_PLACEHOLDER_MISMATCH);
  assert.match(v[0].detail, /\[n\] not provided/);
  assert.match(v[0].detail, /\[count\] not referenced/);
});

test('FAIL: placeholder absent, vars match present', () => {
  const v = checkPlaceholderVarsMismatch('{{a}} {{b}}', new Set(['a']));
  assert.equal(v.length, 1);
  assert.match(v[0].detail, /\[b\] not provided/);
});

test('FAIL: extra unused vars key', () => {
  const v = checkPlaceholderVarsMismatch('{{a}}', new Set(['a', 'b']));
  assert.equal(v.length, 1);
  assert.match(v[0].detail, /\[b\] not referenced/);
});

test('PASS: every placeholder backed by a vars key', () => {
  const v = checkPlaceholderVarsMismatch(
    'Hello {{name}}, {{count}} items',
    new Set(['name', 'count']),
  );
  assert.deepEqual(v, []);
});

test('PASS: i18next formatter syntax "{{count, number}}" extracts ident only', () => {
  const v = checkPlaceholderVarsMismatch('{{count, number}}', new Set(['count']));
  assert.deepEqual(v, []);
});

test('SUPPRESS: null varsKeys (could not parse) suppresses mismatch warning', () => {
  // Conservative: if the vars-object parser bailed, we do not emit a
  // potentially-false warning.
  assert.deepEqual(checkPlaceholderVarsMismatch('{{n}}', null), []);
});

// -- extractPlaceholders direct coverage ------------------------------

test('extractPlaceholders: basic', () => {
  assert.deepEqual([...extractPlaceholders('{{a}} {{b}}')].sort(), ['a', 'b']);
});

test('extractPlaceholders: strips i18next formatter suffix', () => {
  assert.deepEqual([...extractPlaceholders('{{count, number}}')], ['count']);
});

test('extractPlaceholders: ignores invalid identifiers', () => {
  assert.deepEqual([...extractPlaceholders('{{ 123abc }}')], []);
});

// -- extractTopLevelObjectKeys coverage -------------------------------

test('extractTopLevelObjectKeys: identifier-form keys', () => {
  const keys = extractTopLevelObjectKeys('{ a: 1, b: 2 }');
  assert.deepEqual([...keys].sort(), ['a', 'b']);
});

test('extractTopLevelObjectKeys: shorthand properties', () => {
  // The bug that surfaced when scanning AlphaDecayChip the first time:
  // `{ status: label, latest, median }` was reporting `latest, median`
  // as "not provided in vars".
  const keys = extractTopLevelObjectKeys('{ status: label, latest, median }');
  assert.deepEqual([...keys].sort(), ['latest', 'median', 'status']);
});

test('extractTopLevelObjectKeys: quoted-string keys', () => {
  const keys = extractTopLevelObjectKeys("{ 'foo-bar': 1, \"baz\": 2 }");
  assert.deepEqual([...keys].sort(), ['baz', 'foo-bar']);
});

test('extractTopLevelObjectKeys: nested object commas do not split slots', () => {
  const keys = extractTopLevelObjectKeys('{ a: { x: 1, y: 2 }, b: [1, 2, 3] }');
  assert.deepEqual([...keys].sort(), ['a', 'b']);
});

test('extractTopLevelObjectKeys: string-literal commas do not split slots', () => {
  const keys = extractTopLevelObjectKeys("{ a: 'x, y, z', b: 2 }");
  assert.deepEqual([...keys].sort(), ['a', 'b']);
});

test('extractTopLevelObjectKeys: spread bails to null (conservative)', () => {
  assert.equal(extractTopLevelObjectKeys('{ ...rest, a: 1 }'), null);
});

test('extractTopLevelObjectKeys: computed key bails to null', () => {
  assert.equal(extractTopLevelObjectKeys('{ [dynamicKey]: 1 }'), null);
});

test('extractTopLevelObjectKeys: not a brace-delimited object returns null', () => {
  assert.equal(extractTopLevelObjectKeys('some other expression'), null);
});

test('extractTopLevelObjectKeys: trailing comma is tolerated', () => {
  const keys = extractTopLevelObjectKeys('{ a: 1, b: 2, }');
  assert.deepEqual([...keys].sort(), ['a', 'b']);
});
