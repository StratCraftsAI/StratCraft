/**
 * Copy Bundled Plugins Script
 *
 * This script copies official plugins from the submodule to the
 * Electron app's resources directory for bundling.
 *
 * Usage: npx ts-node scripts/copy-bundled-plugins.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGINS_SOURCE = path.resolve(SCRIPT_DIR, '../../../plugins');
const PLUGINS_DEST = path.resolve(SCRIPT_DIR, '../resources/bundled_plugins');

const BUNDLED_PLUGINS = [
  'data-source-nexus',
  'strategy-builder-nexus',
  'back-test-nexus'
];

const EXCLUDE_PATTERNS = [
  'node_modules',
  'dist',
  '.turbo',
  '__pycache__',
  '.pytest_cache',
  '*.pyc',
  '.git'
];

function shouldExclude(name: string): boolean {
  return EXCLUDE_PATTERNS.some(pattern => {
    if (pattern.startsWith('*')) {
      return name.endsWith(pattern.slice(1));
    }
    return name === pattern;
  });
}

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(src)) {
    console.warn(`Source not found: ${src}`);
    return;
  }

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (shouldExclude(entry.name)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function main(): void {
  console.log('Copying bundled plugins...');
  console.log(`Source: ${PLUGINS_SOURCE}`);
  console.log(`Destination: ${PLUGINS_DEST}`);

  if (fs.existsSync(PLUGINS_DEST)) {
    fs.rmSync(PLUGINS_DEST, { recursive: true });
  }
  fs.mkdirSync(PLUGINS_DEST, { recursive: true });

  let copied = 0;
  for (const plugin of BUNDLED_PLUGINS) {
    const src = path.join(PLUGINS_SOURCE, plugin);
    const dest = path.join(PLUGINS_DEST, plugin);

    if (fs.existsSync(src)) {
      console.log(`  Copying: ${plugin}`);
      copyDirRecursive(src, dest);
      copied++;
    } else {
      console.warn(`  Skipping (not found): ${plugin}`);
    }
  }

  console.log(`Done. Copied ${copied} plugins.`);
}

main();
