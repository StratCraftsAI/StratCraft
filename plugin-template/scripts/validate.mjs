#!/usr/bin/env node

/**
 * Post-build validator for StratCraft plugins.
 *
 * Checks:
 *   1. dist/index.js exists
 *   2. Output is IIFE format (contains __nexus_plugin_export__)
 *   3. Output does NOT bundle React (would cause duplicate React)
 *   4. manifest.json has required V3 fields
 *
 * Usage: node scripts/validate.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

let errors = 0;

function pass(msg) { console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function fail(msg) { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); errors++; }

console.log('\nValidating plugin build...\n');

// --- 1. Check dist/index.js exists ---
const distPath = resolve(root, 'ui/my-plugin-nexus/dist/index.js');
if (!existsSync(distPath)) {
  fail('dist/index.js not found. Run "pnpm build" first.');
} else {
  pass('dist/index.js exists');

  const code = readFileSync(distPath, 'utf-8');

  // --- 2. IIFE format check ---
  if (code.includes('__nexus_plugin_export__')) {
    pass('IIFE format detected (__nexus_plugin_export__)');
  } else {
    fail('Missing __nexus_plugin_export__. Ensure vite.config.ts lib.name is "__nexus_plugin_export__"');
  }

  // --- 3. No bundled React ---
  if (code.includes('createElement') && code.includes('useState') && code.length > 50000) {
    fail('React appears to be bundled. Add "react" to rollupOptions.external');
  } else {
    pass('React is not bundled (externalized correctly)');
  }

  // --- 4. No ESM syntax ---
  if (/^(import |export )/m.test(code)) {
    fail('ESM syntax detected. Output must be IIFE, not ESM. Set formats: ["iife"]');
  } else {
    pass('No ESM syntax in output');
  }
}

// --- 5. Manifest validation ---
const manifestPath = resolve(root, 'manifest.json');
if (!existsSync(manifestPath)) {
  fail('manifest.json not found at plugin root');
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  const required = ['id', 'name', 'version', 'tier', 'distribution', 'main'];
  for (const field of required) {
    if (manifest[field] === undefined) {
      fail(`manifest.json missing required field: "${field}"`);
    }
  }

  if (manifest.tier !== undefined && ![0, 1].includes(manifest.tier)) {
    fail(`manifest.json "tier" must be 0 or 1, got: ${manifest.tier}`);
  }

  if (manifest.distribution && manifest.distribution !== 'marketplace') {
    fail(`Third-party plugins must use "distribution": "marketplace", got: "${manifest.distribution}"`);
  }

  if (manifest.main && !manifest.main.endsWith('.js')) {
    fail(`manifest.json "main" must point to a .js file, got: "${manifest.main}"`);
  }

  if (errors === 0) {
    pass('manifest.json has all required V3 fields');
  }
}

// --- Summary ---
console.log('');
if (errors > 0) {
  console.log(`\x1b[31m  ${errors} error(s) found. Fix before publishing.\x1b[0m\n`);
  process.exit(1);
} else {
  console.log('  \x1b[32mAll checks passed.\x1b[0m\n');
}
