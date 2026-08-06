#!/usr/bin/env ts-node
/**
 * TICKET_774: Migration slot-collision guardrail.
 *
 * Parses EMBEDDED_MIGRATIONS from migration-manager.ts via the TypeScript
 * compiler API, computes a normalized SHA-256 hash per entry, and compares
 * against manifest.lock.json. Any in-place edit of a shipped migration's
 * version/name/up/down body trips the check.
 *
 * Modes:
 *   (default)   check mode -- exits non-zero on any drift
 *   --write     bootstrap or append: rewrites manifest.lock.json from current source
 *
 * The script never executes migration code; it only reads source text. This
 * is by design (see TICKET_774 root-cause analysis): an `import` of the
 * migration module would pull better-sqlite3 native bindings into CI and
 * would also let any future top-level side-effect pollute the hash.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as ts from 'typescript';

// TICKET_1289_1 F1: EMBEDDED_MIGRATIONS moved out of the Electron
// migration-manager.ts into the shared @StratCraft/db-migrations package (single
// source of truth). This manifest guard parses the array literal via the TS AST,
// so it must point at the array's new home.
const MIGRATIONS_SRC = path.resolve(
  __dirname,
  '../../../packages/db-migrations/src/migrations.ts'
);
const MANIFEST_PATH = path.resolve(
  __dirname,
  '../src/main/database/migrations/manifest.lock.json'
);
const MANIFEST_SCHEMA_VERSION = 1;

interface ParsedMigration {
  version: number;
  name: string;
  upText: string;
  upKind: 'string' | 'function';
  downText: string;
}

interface ManifestEntry {
  name: string;
  hash: string;
}

interface ManifestFile {
  version: number;
  migrations: Record<string, ManifestEntry>;
}

/** Strip SQL line comments (`-- ...`), block comments, and trim/drop empty lines. */
function normalizeSql(raw: string): string {
  // Remove /* ... */ block comments first (non-greedy, multi-line).
  const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock
    .split('\n')
    .map(line => {
      // Strip line content after `--` if it's an SQL comment (handles inline too).
      // Simple form: anything after `--` to end-of-line is a comment in SQLite.
      const dashIdx = line.indexOf('--');
      const stripped = dashIdx >= 0 ? line.slice(0, dashIdx) : line;
      return stripped.trim();
    })
    .filter(line => line.length > 0)
    .join('\n');
}

/**
 * Normalize a TypeScript function literal's body text. Strips JS `//` line
 * comments and `/* *\/` block comments, trims each line, drops blank lines.
 * We feed in the *entire* arrow-function/function-expression text (params,
 * arrow, braces and all) so renaming the parameter `db` -> `database` would
 * still flip the hash -- that is a code edit, not a comment edit.
 */
function normalizeTsFunction(raw: string): string {
  const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock
    .split('\n')
    .map(line => {
      const slashIdx = line.indexOf('//');
      const stripped = slashIdx >= 0 ? line.slice(0, slashIdx) : line;
      return stripped.trim();
    })
    .filter(line => line.length > 0)
    .join('\n');
}

function hashMigration(m: ParsedMigration): string {
  const normUp =
    m.upKind === 'string' ? normalizeSql(m.upText) : normalizeTsFunction(m.upText);
  const normDown = normalizeSql(m.downText);
  const payload = [
    `version:${m.version}`,
    `name:${m.name.trim()}`,
    `up-kind:${m.upKind}`,
    '---up---',
    normUp,
    '---down---',
    normDown,
  ].join('\n');
  return 'sha256:' + crypto.createHash('sha256').update(payload).digest('hex');
}

/** Read a string-literal or template-literal expression, returning its raw text content. */
function readStringLike(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  // Reject template literals with ${...} interpolations -- migrations must be
  // static text. If anyone introduces one, fail loudly rather than silently
  // hashing a partial value.
  if (ts.isTemplateExpression(node)) {
    throw new Error(
      `Migration string contains a template interpolation (\${...}). ` +
        `Migration bodies must be static text. Offending node at offset ${node.pos}.`
    );
  }
  // Support the common pattern `[lit1, lit2, ...].join(sepLit)` used by
  // multi-statement SQL migrations (e.g. v17, v18). Anything more dynamic
  // is rejected -- migration bodies must be statically resolvable.
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.name) &&
    node.expression.name.text === 'join' &&
    ts.isArrayLiteralExpression(node.expression.expression) &&
    node.arguments.length === 1
  ) {
    const sep = readStringLike(node.arguments[0]);
    if (sep === null) {
      throw new Error(
        `Migration array .join() separator must be a string literal at offset ${node.pos}`
      );
    }
    const parts: string[] = [];
    for (const el of node.expression.expression.elements) {
      const s = readStringLike(el);
      if (s === null) {
        throw new Error(
          `Migration array element must be a string literal at offset ${el.pos}`
        );
      }
      parts.push(s);
    }
    return parts.join(sep);
  }
  return null;
}

/**
 * Walk migration-manager.ts and return every `{ version: N, name: ..., up: ..., down: ... }`
 * object literal inside the EMBEDDED_MIGRATIONS array.
 */
function parseMigrations(): ParsedMigration[] {
  const src = fs.readFileSync(MIGRATIONS_SRC, 'utf8');
  const sourceFile = ts.createSourceFile(
    MIGRATIONS_SRC,
    src,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TS
  );

  let migrationsArray: ts.ArrayLiteralExpression | undefined;

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'EMBEDDED_MIGRATIONS' &&
      node.initializer
    ) {
      // The initializer may be `as Migration[]` etc; unwrap assertions.
      let init: ts.Node = node.initializer;
      while (ts.isAsExpression(init) || ts.isTypeAssertionExpression(init)) {
        init = init.expression;
      }
      if (ts.isArrayLiteralExpression(init)) {
        migrationsArray = init;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (!migrationsArray) {
    throw new Error(
      `Could not locate EMBEDDED_MIGRATIONS array literal in ${MIGRATIONS_SRC}`
    );
  }

  const out: ParsedMigration[] = [];
  for (const element of migrationsArray.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      throw new Error(
        `EMBEDDED_MIGRATIONS contains a non-object element at offset ${element.pos}`
      );
    }
    let version: number | undefined;
    let name: string | undefined;
    let upText: string | undefined;
    let upKind: 'string' | 'function' | undefined;
    let downText: string | undefined;

    for (const prop of element.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) continue;
      const key = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.text;

      if (key === 'version') {
        if (!ts.isNumericLiteral(prop.initializer)) {
          throw new Error(
            `Migration .version must be a numeric literal, got ${ts.SyntaxKind[prop.initializer.kind]}`
          );
        }
        version = Number(prop.initializer.text);
      } else if (key === 'name') {
        const s = readStringLike(prop.initializer);
        if (s === null) {
          throw new Error(`Migration .name must be a string literal`);
        }
        name = s;
      } else if (key === 'up') {
        const s = readStringLike(prop.initializer);
        if (s !== null) {
          upText = s;
          upKind = 'string';
        } else if (
          ts.isArrowFunction(prop.initializer) ||
          ts.isFunctionExpression(prop.initializer)
        ) {
          // Use the function's full source text (incl. params + body).
          upText = prop.initializer.getText(sourceFile);
          upKind = 'function';
        } else {
          throw new Error(
            `Migration .up must be a string literal or function expression, got ${ts.SyntaxKind[prop.initializer.kind]}`
          );
        }
      } else if (key === 'down') {
        const s = readStringLike(prop.initializer);
        if (s === null) {
          throw new Error(
            `Migration .down must be a string literal (no function form supported)`
          );
        }
        downText = s;
      }
      // `preflight` is intentionally NOT hashed: it is a dry-run inspection
      // helper that throws-to-abort; it does not mutate schema. Hashing it
      // would force a manifest bump for purely advisory log message tweaks.
    }

    if (version === undefined || name === undefined || upText === undefined || upKind === undefined || downText === undefined) {
      throw new Error(
        `Migration entry near offset ${element.pos} is missing one of {version,name,up,down}`
      );
    }
    out.push({ version, name, upText, upKind, downText });
  }

  out.sort((a, b) => a.version - b.version);
  return out;
}

function loadManifest(): ManifestFile {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { version: MANIFEST_SCHEMA_VERSION, migrations: {} };
  }
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw) as ManifestFile;
  if (parsed.version !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `manifest.lock.json schema version mismatch: expected ${MANIFEST_SCHEMA_VERSION}, got ${parsed.version}`
    );
  }
  return parsed;
}

function writeManifest(manifest: ManifestFile): void {
  const ordered: ManifestFile = {
    version: manifest.version,
    migrations: {},
  };
  const sortedKeys = Object.keys(manifest.migrations)
    .map(k => Number(k))
    .sort((a, b) => a - b);
  for (const k of sortedKeys) {
    ordered.migrations[String(k)] = manifest.migrations[String(k)];
  }
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(ordered, null, 2) + '\n', 'utf8');
}

function cmdCheck(): number {
  const parsed = parseMigrations();
  const manifest = loadManifest();
  const errors: string[] = [];

  const codeVersions = new Set(parsed.map(p => p.version));
  const manifestVersions = new Set(Object.keys(manifest.migrations).map(k => Number(k)));

  // 1. Hash mismatch on pinned slot.
  for (const m of parsed) {
    const pinned = manifest.migrations[String(m.version)];
    if (!pinned) continue;
    const actual = hashMigration(m);
    if (actual !== pinned.hash) {
      errors.push(
        `v${m.version} (${m.name}): hash mismatch.\n` +
          `  expected: ${pinned.hash}\n` +
          `  actual:   ${actual}\n` +
          `  This migration has shipped. Editing its version/name/up/down is forbidden.\n` +
          `  Add a NEW migration to fix forward, or -- only for whitespace/comment-only\n` +
          `  edits -- bump the manifest with --write and explain in your PR.`
      );
    }
    if (pinned.name !== m.name) {
      errors.push(
        `v${m.version}: name in code (${JSON.stringify(m.name)}) differs from manifest (${JSON.stringify(pinned.name)}).`
      );
    }
  }

  // 2. Manifest has a version that no longer exists in code.
  for (const v of manifestVersions) {
    if (!codeVersions.has(v)) {
      errors.push(
        `v${v} is pinned in manifest.lock.json but missing from EMBEDDED_MIGRATIONS. ` +
          `Deleting a shipped migration is forbidden.`
      );
    }
  }

  // 3. New migration in code with no manifest entry.
  for (const m of parsed) {
    if (!manifestVersions.has(m.version)) {
      errors.push(
        `v${m.version} (${m.name}) is in EMBEDDED_MIGRATIONS but has no manifest entry. ` +
          `Run \`pnpm --filter @StratCraft/desktop run check:migrations:write\` to pin it, then commit.`
      );
    }
  }

  if (errors.length === 0) {
    const pinnedCount = Object.keys(manifest.migrations).length;
    console.log(
      `[check-migration-manifest] OK: ${parsed.length} migrations in source, ${pinnedCount} pinned.`
    );
    return 0;
  }
  console.error('[check-migration-manifest] FAIL:');
  for (const e of errors) console.error('  - ' + e);
  return 1;
}

function cmdWrite(): number {
  const parsed = parseMigrations();
  const manifest: ManifestFile = {
    version: MANIFEST_SCHEMA_VERSION,
    migrations: {},
  };
  for (const m of parsed) {
    manifest.migrations[String(m.version)] = {
      name: m.name,
      hash: hashMigration(m),
    };
  }
  writeManifest(manifest);
  console.log(
    `[check-migration-manifest] Wrote ${parsed.length} entries to ${path.relative(process.cwd(), MANIFEST_PATH)}`
  );
  return 0;
}

function main(): number {
  const arg = process.argv[2];
  if (arg === '--write') return cmdWrite();
  if (arg && arg !== '--check') {
    console.error(`Unknown argument: ${arg}. Usage: check-migration-manifest [--check|--write]`);
    return 2;
  }
  return cmdCheck();
}

process.exit(main());
