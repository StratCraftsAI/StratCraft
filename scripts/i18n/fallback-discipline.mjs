#!/usr/bin/env node
// i18n fallback-string discipline check (TICKET_843 Phase 2).
//
// Background: TICKET_841 was caused by a `t(key, fallback)` call where the
// fallback string itself encoded design wording -- `'{{n}} folds x reps'`.
// When the locale entry was missing, the literal substring ` x reps`
// rendered as if it were an unsubstituted i18next placeholder. The
// fallback string is **emergency text for a missing locale key**, not a
// place to encode design intent.
//
// This script enforces the discipline:
//   1. No literal `{{` / `}}` tokens that are not part of a real
//      `{{varName}}` placeholder reference.
//   2. No ` x ` substring between two word characters (reads as a stranded
//      placeholder; use `*`, `/`, `&`, or a real word like "by").
//   3. No leading or trailing whitespace.
//   4. Every `{{var}}` placeholder in the fallback must appear as a key
//      in the third-argument `vars` object (when one is provided).
//      Conversely, every `vars` key should be referenced by a placeholder
//      in the fallback. Mismatches are runtime bugs.
//
// Usage:
//   node scripts/i18n/fallback-discipline.mjs                # report, exit 0
//   node scripts/i18n/fallback-discipline.mjs --strict       # exit 1 on findings
//   node scripts/i18n/fallback-discipline.mjs --json         # machine-readable
//   node scripts/i18n/fallback-discipline.mjs --files <p>... # check only listed files
//
// Pre-commit and CI invoke this with `--strict`. When called from
// lint-staged or husky with a list of staged files, pass them via
// `--files` so only the touched call sites are scanned.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Default scan roots when --files is not provided. Matches keycheck.mjs
// SOURCE_GLOBS so the discipline check covers the same surface.
export const DEFAULT_SCAN_ROOTS = [
  'apps/desktop/src',
  'plugins/strategy-builder-nexus/src',
  'plugins/quant-lab-nexus/ui/quant-lab-nexus/src',
  'plugins/back-test-nexus/ui/src',
  'plugins/broker-bridge-nexus/src',
  'plugins/data-plugin/ui/data-nexus/src',
  'plugins/optional/chart/src',
];

const EXCLUDE_FRAGMENTS = [
  '/node_modules/',
  '/dist/',
  '/build/',
  '/.turbo/',
  '/__tests__/',
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
];

// Violation codes -- kept short and stable so the eventual ignore-baseline
// (if needed) can reference them precisely.
export const VIOLATION = {
  STRAY_BRACES: 'STRAY_BRACES',
  X_BETWEEN_WORDS: 'X_BETWEEN_WORDS',
  WHITESPACE_EDGES: 'WHITESPACE_EDGES',
  VARS_PLACEHOLDER_MISMATCH: 'VARS_PLACEHOLDER_MISMATCH',
};

const argv = process.argv.slice(2);
const FLAGS = {
  strict: argv.includes('--strict'),
  json: argv.includes('--json'),
  files: (() => {
    const idx = argv.indexOf('--files');
    if (idx < 0) return null;
    return argv.slice(idx + 1).filter((a) => !a.startsWith('--'));
  })(),
};

function walkSourceFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    const ents = fs.readdirSync(cur, { withFileTypes: true });
    for (const ent of ents) {
      const full = path.join(cur, ent.name);
      if (EXCLUDE_FRAGMENTS.some((frag) => full.includes(frag))) continue;
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (/\.(ts|tsx)$/.test(ent.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

// Locate every `t(KEY, FALLBACK[, OPTIONS])` call. Conservative pragma:
//   - Match callee identifier: `t`, any `t<Suffix>` (`tErr`, `tCommon`),
//     `i18n.t`, `<obj>.t` -- the same set keycheck.mjs treats as i18n call
//     sites.
//   - Require a string literal FALLBACK in the second slot (other forms
//     -- variable, template literal -- are out of scope for the discipline
//     check; they cannot be statically reasoned about and the
//     unit-of-concern is the inline default).
//   - Capture the optional third argument up to the matching close-paren
//     so the vars/placeholder mismatch rule can introspect its keys.
//
// Robust paren-matching is done by hand below; the regex only seeds the
// callee + KEY + FALLBACK fragments.
const CALL_SEED_RE =
  /(?:^|[^a-zA-Z0-9_$])((?:[a-zA-Z_$][\w$]*\.)?(?:t|t[A-Z][\w$]*))\(\s*(['"])([^'"\n]+)\2\s*,\s*(['"])((?:\\.|[^\\])*?)\4/g;

// Identify the matching close-paren for a call starting at openIdx (which
// points at the `(` after the callee). Returns the index of the matching
// `)`, or -1 if not found. String literal tracking is intentionally
// minimal -- we only need to skip single/double-quoted strings and
// template literals on the surface level so commas / parens inside them
// do not throw off the bracket counter.
function findMatchingClose(src, openIdx) {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < src.length) {
        const cc = src[i];
        if (cc === '\\') { i += 2; continue; }
        if (cc === quote) { i += 1; break; }
        // Inside template literals, also skip `${...}` spans so a `)`
        // inside an interpolation does not close our call.
        if (quote === '`' && cc === '$' && src[i + 1] === '{') {
          let braceDepth = 1;
          i += 2;
          while (i < src.length && braceDepth > 0) {
            if (src[i] === '{') braceDepth += 1;
            else if (src[i] === '}') braceDepth -= 1;
            i += 1;
          }
          continue;
        }
        i += 1;
      }
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

// Extract identifier keys from a `{ k1: ..., k2: ..., 'k3': ... }`
// object-literal source fragment. Supports identifier-form keys
// (`status: ...`), quoted-string keys (`'foo': ...`), and shorthand
// properties (`latest` standing for `latest: latest`). Tolerates nested
// objects, function calls, and string values; returns the set of
// *top-level* keys only. Computed keys (`[expr]: ...`) and spread
// (`...rest`) cause a conservative null return so the caller suppresses
// the mismatch warning rather than emitting a false positive.
export function extractTopLevelObjectKeys(src) {
  const trimmed = src.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  const body = trimmed.slice(1, -1);
  const keys = new Set();

  // Tokenize the body into top-level slot strings (split on `,` at
  // depth 0, respecting string literals). Each slot is then classified
  // as identifier-key, quoted-key, shorthand, or "give up".
  const slots = [];
  let slotStart = 0;
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < body.length) {
        const cc = body[i];
        if (cc === '\\') { i += 2; continue; }
        if (cc === quote) { i += 1; break; }
        if (quote === '`' && cc === '$' && body[i + 1] === '{') {
          let bd = 1;
          i += 2;
          while (i < body.length && bd > 0) {
            if (body[i] === '{') bd += 1;
            else if (body[i] === '}') bd -= 1;
            i += 1;
          }
          continue;
        }
        i += 1;
      }
      continue;
    }
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    else if (c === ',' && depth === 0) {
      slots.push(body.slice(slotStart, i));
      slotStart = i + 1;
    }
    i += 1;
  }
  // Trailing slot (no terminating comma).
  if (slotStart < body.length) slots.push(body.slice(slotStart));

  for (const rawSlot of slots) {
    const slot = rawSlot.trim();
    if (slot === '') continue; // trailing comma
    if (slot.startsWith('...')) return null;
    if (slot.startsWith('[')) return null;

    // Quoted-key form: `'foo': ...` or `"foo": ...`
    const quoted = slot.match(/^(['"])((?:\\.|[^\\])*?)\1\s*:/);
    if (quoted) {
      keys.add(quoted[2]);
      continue;
    }

    // Identifier-key form: `foo: ...`
    const idColon = slot.match(/^([A-Za-z_$][\w$]*)\s*:/);
    if (idColon) {
      keys.add(idColon[1]);
      continue;
    }

    // Shorthand-property form: `foo` (slot is just a bare identifier).
    if (/^[A-Za-z_$][\w$]*$/.test(slot)) {
      keys.add(slot);
      continue;
    }

    // Anything else (method shorthand `foo() {}`, computed expressions
    // sneaking past the `[` check, etc.) -- bail conservatively.
    return null;
  }
  return keys;
}

// Extract `{{name}}` placeholder identifiers from a string. Tolerates
// i18next-style modifiers like `{{count, number}}` -- we only care about
// the identifier before the comma.
export function extractPlaceholders(fallback) {
  const out = new Set();
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
  let m;
  while ((m = re.exec(fallback)) !== null) {
    const raw = m[1].trim();
    // Strip i18next formatter suffix: `name, number` -> `name`.
    const ident = raw.split(',')[0].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(ident)) out.add(ident);
  }
  return out;
}

// Check a single fallback string against rules 1-3. Returns an array of
// { code, detail } objects.
export function checkFallbackString(fallback) {
  const violations = [];

  // Rule 3: leading/trailing whitespace.
  if (fallback !== fallback.trim()) {
    violations.push({
      code: VIOLATION.WHITESPACE_EDGES,
      detail: `fallback has leading or trailing whitespace: ${JSON.stringify(fallback)}`,
    });
  }

  // Rule 1: stray `{{` or `}}` that is not part of a `{{ident}}` token.
  // Strategy: remove every valid `{{...}}` token (lazy-match, no nested
  // braces inside) and check the residue for any remaining `{{` / `}}`.
  const residue = fallback.replace(/\{\{[^{}]*\}\}/g, '');
  if (residue.includes('{{') || residue.includes('}}')) {
    violations.push({
      code: VIOLATION.STRAY_BRACES,
      detail: `fallback contains stray '{{' or '}}' outside a placeholder: ${JSON.stringify(fallback)}`,
    });
  }

  // Rule 2: ` x ` between two word characters (the TICKET_841 footgun).
  // The danger -- "x" mistaken for an unsubstituted i18next variable --
  // only matters in fallbacks that already host `{{placeholder}}` tokens
  // (a pure-prose fallback like "5 x 10 grid" cannot confuse the reader
  // because there are no real placeholders for it to look like). So the
  // rule fires only when the fallback contains at least one `{{...}}`
  // and also contains a ` x ` sandwiched between two word characters.
  // This is the broad form recommended by the ticket's "Rule (to be
  // enforced)" section, with the false-positive guard from the
  // "Risks and tradeoffs" section folded in.
  const hasPlaceholder = /\{\{[^{}]*\}\}/.test(fallback);
  // A "word" on either side may be a literal word character (\w) or the
  // start/end of a `{{placeholder}}` token. Both cases substitute into a
  // value at runtime and produce the same visual hazard.
  const hasXBetweenWords = /(\w|\}\})\s+x\s+(\w|\{\{)/.test(fallback);
  if (hasPlaceholder && hasXBetweenWords) {
    violations.push({
      code: VIOLATION.X_BETWEEN_WORDS,
      detail: `fallback contains ' x ' between word characters within a placeholder-bearing string. When the locale key is missing, 'x' renders ambiguously next to substituted placeholder values. Use '*', '/', '&', or a real word like 'by' instead. Fallback: ${JSON.stringify(fallback)}`,
    });
  }

  return violations;
}

// Cross-check placeholders in the fallback against keys in the vars
// object literal. Symmetric: a placeholder without a vars key is a bug,
// and a vars key without a placeholder is dead weight.
export function checkPlaceholderVarsMismatch(fallback, varsObjectKeys) {
  if (varsObjectKeys === null) return []; // could not parse, skip
  const placeholders = extractPlaceholders(fallback);
  const missingInVars = [...placeholders].filter((p) => !varsObjectKeys.has(p));
  const unusedVars = [...varsObjectKeys].filter((k) => !placeholders.has(k));
  if (missingInVars.length === 0 && unusedVars.length === 0) return [];
  const parts = [];
  if (missingInVars.length) parts.push(`placeholder(s) [${missingInVars.join(', ')}] not provided in vars object`);
  if (unusedVars.length) parts.push(`vars key(s) [${unusedVars.join(', ')}] not referenced by any {{placeholder}}`);
  return [{
    code: VIOLATION.VARS_PLACEHOLDER_MISMATCH,
    detail: parts.join('; '),
  }];
}

function scanFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf-8');
  const findings = [];
  CALL_SEED_RE.lastIndex = 0;
  let m;
  while ((m = CALL_SEED_RE.exec(src)) !== null) {
    const fallbackRaw = m[5];
    // Unescape the captured fallback to match the runtime value the user
    // would see. Handle the common escapes; passing through any tail.
    const fallback = fallbackRaw.replace(/\\(['"\\nrt])/g, (_, ch) =>
      ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch === 't' ? '\t' : ch,
    );

    // Locate the open-paren so we can find the matching close and slice
    // out the optional third argument.
    const calleeStart = m.index + m[0].length - m[3].length - 2 - m[5].length - 1;
    // The above arithmetic is fragile; recompute by scanning forward from
    // the regex match for the `(` that opens this call.
    let openParenIdx = src.lastIndexOf('(', m.index + m[0].length);
    // Walk back to the `(` that immediately follows the callee identifier
    // captured by m[1]. Simpler: find `(` after the callee in the source
    // span we matched.
    const calleeMatchStart = src.indexOf(m[1], m.index);
    openParenIdx = src.indexOf('(', calleeMatchStart + m[1].length);
    const closeParenIdx = findMatchingClose(src, openParenIdx);
    const tail = closeParenIdx >= 0
      ? src.slice(m.index + m[0].length, closeParenIdx)
      : '';

    // Locate the optional third argument: skip the closing quote of the
    // fallback (already past it via m[0].length), then look for `, {`.
    let varsKeys = null;
    const commaIdx = tail.indexOf(',');
    if (commaIdx >= 0) {
      const afterComma = tail.slice(commaIdx + 1);
      const trimmedAfter = afterComma.trimStart();
      if (trimmedAfter.startsWith('{')) {
        // Slice out the full object literal up to its matching close.
        const objStart = afterComma.indexOf('{');
        const objAbsStart = m.index + m[0].length + commaIdx + 1 + objStart;
        // Reuse the matching-brace logic by calling findMatchingClose
        // with a temporary view that maps `{`/`}` onto `(`/`)`.
        const objSlice = sliceBalancedBraces(src, objAbsStart);
        if (objSlice !== null) {
          varsKeys = extractTopLevelObjectKeys(objSlice);
        }
      }
    }

    const lineNumber = src.slice(0, m.index).split('\n').length;
    const baseLoc = {
      file: path.relative(REPO_ROOT, filePath),
      line: lineNumber,
      callee: m[1],
      key: m[3],
      fallback,
    };
    const stringViolations = checkFallbackString(fallback);
    const mismatchViolations = checkPlaceholderVarsMismatch(fallback, varsKeys);
    for (const v of [...stringViolations, ...mismatchViolations]) {
      findings.push({ ...baseLoc, ...v });
    }
  }
  return findings;
}

// Slice out a `{...}` block starting at startIdx (which points at the
// `{`). Returns the substring including both braces, or null if no match.
function sliceBalancedBraces(src, startIdx) {
  if (src[startIdx] !== '{') return null;
  let depth = 0;
  let i = startIdx;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < src.length) {
        const cc = src[i];
        if (cc === '\\') { i += 2; continue; }
        if (cc === quote) { i += 1; break; }
        if (quote === '`' && cc === '$' && src[i + 1] === '{') {
          let bd = 1;
          i += 2;
          while (i < src.length && bd > 0) {
            if (src[i] === '{') bd += 1;
            else if (src[i] === '}') bd -= 1;
            i += 1;
          }
          continue;
        }
        i += 1;
      }
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(startIdx, i + 1);
    }
    i += 1;
  }
  return null;
}

function collectFiles() {
  if (FLAGS.files && FLAGS.files.length > 0) {
    return FLAGS.files
      .map((f) => path.isAbsolute(f) ? f : path.join(REPO_ROOT, f))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => fs.existsSync(f))
      .filter((f) => !EXCLUDE_FRAGMENTS.some((frag) => f.includes(frag)));
  }
  const all = [];
  for (const root of DEFAULT_SCAN_ROOTS) {
    all.push(...walkSourceFiles(path.join(REPO_ROOT, root)));
  }
  return all;
}

function main() {
  const files = collectFiles();
  const findings = [];
  for (const f of files) {
    findings.push(...scanFile(f));
  }

  if (FLAGS.json) {
    process.stdout.write(JSON.stringify({ findings }, null, 2) + '\n');
  } else {
    report(findings);
  }

  if (FLAGS.strict && findings.length > 0) process.exit(1);
}

function report(findings) {
  console.log('=== i18n fallback-string discipline ===\n');
  if (findings.length === 0) {
    console.log('No violations found.');
    return;
  }
  console.log(`Violations: ${findings.length}\n`);
  for (const f of findings) {
    console.log(`  [${f.code}] ${f.file}:${f.line}`);
    console.log(`    t('${f.key}', ${JSON.stringify(f.fallback)})`);
    console.log(`    -> ${f.detail}`);
    console.log('');
  }
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) main();
