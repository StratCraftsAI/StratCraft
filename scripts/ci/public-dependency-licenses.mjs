#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function licenseExpression(manifest) {
  if (typeof manifest.license === 'string' && manifest.license.trim() !== '') {
    return manifest.license.trim();
  }
  if (manifest.license && typeof manifest.license.type === 'string') {
    return manifest.license.type.trim() || 'Unknown';
  }
  if (Array.isArray(manifest.licenses)) {
    const expressions = manifest.licenses
      .map((license) => typeof license === 'string' ? license : license?.type)
      .filter((license) => typeof license === 'string' && license.trim() !== '')
      .map((license) => license.trim());
    if (expressions.length > 0) return expressions.join(' OR ');
  }
  return 'Unknown';
}

function packageManifestPaths(virtualStoreRoot) {
  const manifests = [];
  for (const locator of fs.readdirSync(virtualStoreRoot, { withFileTypes: true })) {
    if (!locator.isDirectory() || locator.name === 'node_modules') continue;
    const modulesRoot = path.join(virtualStoreRoot, locator.name, 'node_modules');
    if (!fs.existsSync(modulesRoot)) continue;
    for (const entry of fs.readdirSync(modulesRoot, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && entry.name.startsWith('@')) {
        const scopeRoot = path.join(modulesRoot, entry.name);
        for (const scoped of fs.readdirSync(scopeRoot, { withFileTypes: true })) {
          if (!scoped.isDirectory() || scoped.isSymbolicLink()) continue;
          manifests.push(path.join(scopeRoot, scoped.name, 'package.json'));
        }
      } else if (entry.isDirectory()) {
        manifests.push(path.join(modulesRoot, entry.name, 'package.json'));
      }
    }
  }
  return manifests.filter((manifestPath) => fs.existsSync(manifestPath));
}

export function collectInstalledDependencyLicenses(projectRoot) {
  const virtualStoreRoot = path.join(projectRoot, 'node_modules', '.pnpm');
  if (!fs.existsSync(virtualStoreRoot)) {
    throw new Error(`Installed pnpm virtual store is missing: ${virtualStoreRoot}`);
  }
  const byLicense = new Map();
  for (const manifestPath of packageManifestPaths(virtualStoreRoot)) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      throw new Error(`Installed dependency manifest is invalid: ${manifestPath}`, { cause: error });
    }
    if (
      typeof manifest.name !== 'string'
      || manifest.name === ''
      || typeof manifest.version !== 'string'
      || manifest.version === ''
    ) {
      throw new Error(`Installed dependency manifest lacks name or version: ${manifestPath}`);
    }
    const expression = licenseExpression(manifest);
    const packages = byLicense.get(expression) ?? new Map();
    const versions = packages.get(manifest.name) ?? new Set();
    versions.add(manifest.version);
    packages.set(manifest.name, versions);
    byLicense.set(expression, packages);
  }
  if (byLicense.size === 0) {
    throw new Error(`Installed pnpm virtual store contains no dependency manifests: ${virtualStoreRoot}`);
  }
  return Object.fromEntries([...byLicense.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([license, packages]) => [
      license,
      [...packages.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, versions]) => ({ name, versions: [...versions].sort() })),
    ]));
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length > 1) throw new Error('Expected at most one project root argument');
  const projectRoot = path.resolve(argv[0] ?? process.cwd());
  process.stdout.write(`${JSON.stringify(collectInstalledDependencyLicenses(projectRoot), null, 2)}\n`);
}

/* v8 ignore next -- entrypoint identity is not observable through an imported module. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
