#!/usr/bin/env node
// i18n key audit: detect MISSING (referenced in source, absent from en_US JSON)
// and ORPHAN (present in en_US JSON, unreferenced in source) keys.
//
// Drift detection (en_US vs other locales) is handled by keydiff.sh -- this
// script delegates with --drift.
//
// Background: TICKET_786_6 Phase 7. Existing tooling (i18n-audit.js,
// keydiff.sh) handles drift; orphan + missing remained manual.
//
// Usage:
//   node scripts/i18n/keycheck.mjs                 # report, exit 0
//   node scripts/i18n/keycheck.mjs --strict        # exit 1 on findings
//   node scripts/i18n/keycheck.mjs --json          # machine-readable
//   node scripts/i18n/keycheck.mjs --drift         # also run keydiff.sh
//   node scripts/i18n/keycheck.mjs --ns ui         # restrict to namespace

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Namespace root inventory. Keep aligned with keydiff.sh ROOTS array.
export const NAMESPACE_ROOTS = [
  { ns: 'ui', dir: 'apps/desktop/src/i18n/locales' },
  { ns: 'trading', dir: 'apps/desktop/src/i18n/locales' },
  { ns: 'settings', dir: 'apps/desktop/src/i18n/locales' },
  { ns: 'marketplace', dir: 'apps/desktop/src/i18n/locales' },
  { ns: 'errors', dir: 'apps/desktop/src/i18n/locales' },
  { ns: 'strategy-builder', dir: 'plugins/strategy-builder-nexus/locales' },
  { ns: 'quant-lab', dir: 'plugins/quant-lab-nexus/locales' },
  { ns: 'backtest', dir: 'plugins/back-test-nexus/locales' },
  { ns: 'broker', dir: 'plugins/broker-bridge-nexus/locales' },
  { ns: 'chart', dir: 'plugins/optional/chart/locales' },
];

// Source roots that the scanner walks for `t()` references. Plugin layouts
// differ -- some plugins live at `<plugin>/src`, others at
// `<plugin>/ui/<inner>/src`. Each entry is verified at startup by the
// path-existence drift guard in `main()`; a regression here surfaces
// immediately instead of producing the silent false-zero behavior that
// TICKET_841 surfaced (see TICKET_843 Phase 1).
//
// To add a new plugin: add the entry below, then add a `DEFAULT_NS_BY_DIR`
// mapping so files that don't call `useTranslation()` explicitly still
// resolve to the correct namespace. The
// `scripts/i18n/__tests__/source-globs-drift.test.mjs` unit test makes
// "the path exists" a build-time fact.
export const SOURCE_GLOBS = [
  'apps/desktop/src',
  'plugins/strategy-builder-nexus/src',
  'plugins/quant-lab-nexus/ui/quant-lab-nexus/src',
  'plugins/back-test-nexus/ui/src',
  'plugins/broker-bridge-nexus/src',
  'plugins/data-plugin/ui/data-nexus/src',
  'plugins/optional/chart/src',
];

// Files / paths to skip during source scan.
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

// Plugin directory -> default namespace mapping (used when useTranslation
// hook is not invoked explicitly in the file, e.g. service / util modules).
// The regexes match anywhere in the absolute file path, so they tolerate
// the `<plugin>/ui/<inner>/src` layout used by quant-lab / back-test /
// data-plugin as well as the flatter `<plugin>/src` layout.
const DEFAULT_NS_BY_DIR = [
  { match: /\/plugins\/strategy-builder-nexus\//, ns: 'strategy-builder' },
  { match: /\/plugins\/quant-lab-nexus\//, ns: 'quant-lab' },
  { match: /\/plugins\/back-test-nexus\//, ns: 'backtest' },
  { match: /\/plugins\/broker-bridge-nexus\//, ns: 'broker' },
  { match: /\/plugins\/data-plugin\//, ns: 'ui' },
  { match: /\/plugins\/optional\/chart\//, ns: 'chart' },
  { match: /\/apps\/desktop\//, ns: 'ui' },
];

const IGNORE_FILE = path.join(__dirname, 'keycheck-ignore.json');

const argv = process.argv.slice(2);
const FLAGS = {
  strict: argv.includes('--strict'),
  json: argv.includes('--json'),
  drift: argv.includes('--drift'),
  nsFilter: (() => {
    const idx = argv.indexOf('--ns');
    return idx >= 0 ? argv[idx + 1] : null;
  })(),
};

function loadIgnore() {
  const empty = {
    dynamicKeyPatterns: [],
    allowedOrphans: new Set(),
    allowedMissing: new Set(),
  };
  if (!fs.existsSync(IGNORE_FILE)) return empty;
  try {
    const raw = JSON.parse(fs.readFileSync(IGNORE_FILE, 'utf-8'));
    return {
      dynamicKeyPatterns: (raw.dynamicKeyPatterns || []).map((p) => new RegExp(p)),
      allowedOrphans: new Set(raw.allowedOrphans || []),
      allowedMissing: new Set(raw.allowedMissing || []),
    };
  } catch (e) {
    console.error(`Failed to parse ${IGNORE_FILE}: ${e.message}`);
    process.exit(2);
  }
}

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

// Read the file once, then run three extraction passes:
//   (1) discover bindings: `const { t[: alias] } = useTranslation(<ns>)` and
//       associate the alias (default `t`) with its namespace(s).
//   (2) extract every call of the form `<binding>('key', ...)` so each call
//       is attributed only to the namespace(s) bound to that binding, not
//       to every namespace declared anywhere in the file (which is what the
//       prior implementation did, producing false positives in files that
//       declared multiple useTranslation hooks such as
//       `const { t } = useTranslation('marketplace'); const { t: tErr } =
//       useTranslation('errors')`).
//   (3) honour explicit overrides: `{ ns: 'foo' }` option argument and the
//       `ns:key` colon form take precedence over binding lookup.
const USE_TRANSLATION_BINDING_RE =
  /\bconst\s*\{\s*t(?:\s*:\s*([A-Za-z_$][\w$]*))?\s*[},][^=]*=\s*useTranslation\(\s*(['"][^'"]+['"]|\[[^\]]+\])\s*[,)]/g;
const USE_TRANSLATION_BARE_RE = /\buseTranslation\(\s*(['"][^'"]+['"]|\[[^\]]+\])/g;
const NS_OPTION_RE = /\bns\s*:\s*['"]([^'"]+)['"]/;

function inferDefaultNs(filePath) {
  for (const { match, ns } of DEFAULT_NS_BY_DIR) {
    if (match.test(filePath)) return ns;
  }
  return null;
}

function parseNsArg(rawArg) {
  // rawArg is either a quoted string or a bracketed list of quoted strings.
  if (rawArg.startsWith('[')) {
    return rawArg
      .slice(1, -1)
      .split(',')
      .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  return [rawArg.replace(/^['"]|['"]$/g, '')];
}

function extractReferences(filePath) {
  const src = fs.readFileSync(filePath, 'utf-8');

  // (1) Discover bindings. Map binding name (e.g. `t`, `tErr`) -> namespaces.
  const bindings = new Map();
  const allDeclaredNs = new Set();
  let m;
  USE_TRANSLATION_BINDING_RE.lastIndex = 0;
  while ((m = USE_TRANSLATION_BINDING_RE.exec(src)) !== null) {
    const alias = m[1] || 't';
    const nss = parseNsArg(m[2]);
    if (!bindings.has(alias)) bindings.set(alias, new Set());
    for (const ns of nss) {
      bindings.get(alias).add(ns);
      allDeclaredNs.add(ns);
    }
  }
  // Also pick up bare useTranslation(...) calls that weren't matched by the
  // binding-aware regex (e.g. non-destructured forms, advanced patterns) so
  // the file-level NS set still tracks them for fallback attribution.
  USE_TRANSLATION_BARE_RE.lastIndex = 0;
  while ((m = USE_TRANSLATION_BARE_RE.exec(src)) !== null) {
    for (const ns of parseNsArg(m[1])) allDeclaredNs.add(ns);
  }

  const defaultNs = inferDefaultNs(filePath);

  // (2) Build a call regex constrained to the binding names we discovered,
  // falling back to a generic `t(...)` matcher when no binding survived.
  const aliasNames = bindings.size > 0 ? [...bindings.keys()] : ['t'];
  // Sort longest-first so `tErr` matches before `t`.
  aliasNames.sort((a, b) => b.length - a.length);
  const aliasGroup = aliasNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const callRe = new RegExp(
    `(?:^|[^a-zA-Z0-9_$])(?:i18n\\.)?(${aliasGroup})\\(\\s*['"]([^'"$\\\\]+)['"]([^)]*)\\)`,
    'g',
  );

  // Each ref now carries a *candidate set* of namespaces. The key is MISSING
  // only if it is absent from every candidate (because i18next resolves a
  // key by trying each namespace in order and returning the first hit). For
  // ORPHAN tallying, the key is treated as referenced in every candidate
  // namespace so a multi-NS binding does not falsely orphan one side.
  const refs = [];
  while ((m = callRe.exec(src)) !== null) {
    const alias = m[1];
    const rawKey = m[2];
    const tail = m[3] || '';

    // Highest precedence: explicit ns option in t() call.
    const nsOpt = tail.match(NS_OPTION_RE);
    if (nsOpt) {
      refs.push({ candidates: [nsOpt[1]], key: rawKey, file: filePath });
      continue;
    }

    // Next: explicit "ns:key" form overrides binding-resolved namespace.
    const colonIdx = rawKey.indexOf(':');
    if (colonIdx >= 0) {
      const ns = rawKey.slice(0, colonIdx);
      const key = rawKey.slice(colonIdx + 1);
      refs.push({ candidates: [ns], key, file: filePath });
      continue;
    }

    let nss = bindings.get(alias);
    if (!nss || nss.size === 0) {
      // Bare call with no discovered binding (e.g. `i18n.t(...)` in a util
      // or a module-level helper); fall back to file-declared NS set or the
      // directory default.
      nss = allDeclaredNs.size > 0 ? allDeclaredNs : (defaultNs ? new Set([defaultNs]) : new Set());
    }
    refs.push({ candidates: [...nss], key: rawKey, file: filePath });
  }
  return refs;
}

function flattenJson(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenJson(v, fullKey));
    } else {
      out.push(fullKey);
    }
  }
  return out;
}

function loadBaselineKeys() {
  // Map: namespace -> Set<key>
  const byNs = new Map();
  for (const { ns, dir } of NAMESPACE_ROOTS) {
    const file = path.join(REPO_ROOT, dir, 'en_US', `${ns}.json`);
    if (!fs.existsSync(file)) {
      console.warn(`[warn] baseline missing: ${path.relative(REPO_ROOT, file)}`);
      byNs.set(ns, new Set());
      continue;
    }
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    byNs.set(ns, new Set(flattenJson(data)));
  }
  return byNs;
}

function isDynamicWhitelisted(key, patterns) {
  return patterns.some((re) => re.test(key));
}

// Verify every configured source / namespace path exists on disk before
// scanning. If a plugin directory layout changes (e.g. quant-lab's extra
// `ui/quant-lab-nexus/` indirection) and SOURCE_GLOBS is not updated, the
// scanner silently walks an empty tree and reports MISSING=0 / ORPHAN=all
// (the TICKET_841 failure mode). Fail-fast surfaces drift immediately.
export function assertSourcePathsExist() {
  const drift = [];
  for (const root of SOURCE_GLOBS) {
    const abs = path.join(REPO_ROOT, root);
    if (!fs.existsSync(abs)) drift.push({ kind: 'SOURCE_GLOBS', path: root });
  }
  for (const { ns, dir } of NAMESPACE_ROOTS) {
    const abs = path.join(REPO_ROOT, dir, 'en_US', `${ns}.json`);
    if (!fs.existsSync(abs)) {
      drift.push({ kind: 'NAMESPACE_ROOTS', path: path.relative(REPO_ROOT, abs), ns });
    }
  }
  if (drift.length > 0) {
    const lines = drift.map((d) =>
      d.kind === 'SOURCE_GLOBS'
        ? `  - SOURCE_GLOBS entry does not exist: ${d.path}`
        : `  - NAMESPACE_ROOTS baseline does not exist: ${d.path} (ns=${d.ns})`,
    );
    const msg =
      'keycheck.mjs path drift detected. The following configured paths do not exist on disk:\n' +
      lines.join('\n') +
      '\n\nThis usually means a plugin directory layout changed without updating\n' +
      'scripts/i18n/keycheck.mjs. Update SOURCE_GLOBS / NAMESPACE_ROOTS to match\n' +
      'the real layout, or remove the stale entry. The drift unit test under\n' +
      'scripts/i18n/__tests__/source-globs-drift.test.mjs is the canonical guard.\n';
    throw new Error(msg);
  }
}

function main() {
  try {
    assertSourcePathsExist();
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }

  const ignore = loadIgnore();
  const baseline = loadBaselineKeys();

  // Collect every t() reference across the source tree.
  const refs = [];
  for (const root of SOURCE_GLOBS) {
    const abs = path.join(REPO_ROOT, root);
    for (const file of walkSourceFiles(abs)) {
      refs.push(...extractReferences(file));
    }
  }

  // Track which (ns, key) pairs are referenced anywhere so the ORPHAN check
  // can credit a key against every candidate namespace it might satisfy.
  const referencedByNs = new Map();
  for (const r of refs) {
    for (const ns of r.candidates) {
      if (!referencedByNs.has(ns)) referencedByNs.set(ns, new Set());
      referencedByNs.get(ns).add(r.key);
    }
  }

  // Compute MISSING: a ref is MISSING only when the key is absent from
  // *every* candidate namespace -- i18next resolves multi-NS bindings by
  // walking the list and returning the first hit, so a key in any one
  // bound namespace is enough.
  const missing = [];
  const seenMissing = new Set(); // dedup by `ns|key`
  const knownNamespaces = new Set(NAMESPACE_ROOTS.map((r) => r.ns));

  for (const r of refs) {
    if (FLAGS.nsFilter && !r.candidates.includes(FLAGS.nsFilter)) continue;
    if (isDynamicWhitelisted(r.key, ignore.dynamicKeyPatterns)) continue;
    // Resolved if any known candidate ns has the key in its baseline.
    const resolved = r.candidates.some((ns) => {
      const base = baseline.get(ns);
      return base && base.has(r.key);
    });
    if (resolved) continue;
    // Pick the most likely missing target: the first known candidate ns,
    // else fall back to the raw first candidate.
    const reportNs =
      r.candidates.find((ns) => knownNamespaces.has(ns)) ?? r.candidates[0] ?? '?';
    if (ignore.allowedMissing.has(`${reportNs}.${r.key}`)) continue;
    const dedupKey = `${reportNs}|${r.key}`;
    if (seenMissing.has(dedupKey)) continue;
    seenMissing.add(dedupKey);
    missing.push({ ns: reportNs, key: r.key, file: path.relative(REPO_ROOT, r.file) });
  }

  // Compute ORPHAN: a baseline key is orphaned if no source ref lists its
  // namespace among its candidates with that key.
  const orphan = [];
  for (const [ns, baseKeys] of baseline.entries()) {
    if (FLAGS.nsFilter && FLAGS.nsFilter !== ns) continue;
    const refKeys = referencedByNs.get(ns) ?? new Set();
    for (const key of baseKeys) {
      if (refKeys.has(key)) continue;
      if (isDynamicWhitelisted(key, ignore.dynamicKeyPatterns)) continue;
      if (ignore.allowedOrphans.has(`${ns}.${key}`)) continue;
      orphan.push({ ns, key });
    }
  }

  // Refs to namespaces we have no JSON for (typo in useTranslation arg).
  const unknownNs = [];
  const seenUnknown = new Set();
  for (const r of refs) {
    for (const ns of r.candidates) {
      if (knownNamespaces.has(ns) || seenUnknown.has(ns)) continue;
      seenUnknown.add(ns);
      unknownNs.push({ ns, file: path.relative(REPO_ROOT, r.file) });
    }
  }

  if (FLAGS.json) {
    process.stdout.write(JSON.stringify({ missing, orphan, unknownNs }, null, 2) + '\n');
  } else {
    report({ missing, orphan, unknownNs });
  }

  if (FLAGS.drift) {
    try {
      execFileSync(path.join(__dirname, 'keydiff.sh'), ['--strict'], {
        stdio: 'inherit',
        cwd: REPO_ROOT,
      });
    } catch (e) {
      if (FLAGS.strict) process.exit(1);
    }
  }

  // TICKET_843 Phase 1: strict mode fails only on findings that indicate a
  // bug -- MISSING keys (the user-visible defect class) and UNKNOWN namespaces
  // (almost always a typo in useTranslation). ORPHAN keys are reported as
  // informational; they represent locale-side cleanup debt and should not
  // block CI or pre-commit. See ticket "Risks and tradeoffs" for rationale.
  const hasBlockingFindings = missing.length > 0 || unknownNs.length > 0;
  if (FLAGS.strict && hasBlockingFindings) process.exit(1);
}

function report({ missing, orphan, unknownNs }) {
  console.log('=== i18n keycheck ===\n');

  console.log(`MISSING keys (referenced in source, absent from en_US JSON): ${missing.length}`);
  const byNsM = groupBy(missing, 'ns');
  for (const [ns, items] of byNsM.entries()) {
    console.log(`  [${ns}] ${items.length}`);
    for (const it of items.slice(0, 20)) {
      console.log(`    - ${it.key}  (${it.file ?? '?'})`);
    }
    if (items.length > 20) console.log(`    (+${items.length - 20} more)`);
  }

  console.log(`\nORPHAN keys (in en_US JSON, no source reference): ${orphan.length}`);
  const byNsO = groupBy(orphan, 'ns');
  for (const [ns, items] of byNsO.entries()) {
    console.log(`  [${ns}] ${items.length}`);
    for (const it of items.slice(0, 20)) console.log(`    - ${it.key}`);
    if (items.length > 20) console.log(`    (+${items.length - 20} more)`);
  }

  if (unknownNs.length > 0) {
    console.log(`\nUNKNOWN namespaces (referenced in source, no JSON root): ${unknownNs.length}`);
    for (const it of unknownNs) console.log(`  - ${it.ns}  (${it.file ?? '?'})`);
  }
  console.log('');
}

function groupBy(arr, key) {
  const out = new Map();
  for (const item of arr) {
    if (!out.has(item[key])) out.set(item[key], []);
    out.get(item[key]).push(item);
  }
  return out;
}

// Only execute when invoked directly (e.g. `node scripts/i18n/keycheck.mjs`).
// When imported by a test file the exports above are consumed without
// firing the full scan + report.
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) main();
