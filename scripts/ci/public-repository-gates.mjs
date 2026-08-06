#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CANONICAL_LICENSE = 'Apache-2.0';
export const REQUIRED_FILES = ['LICENSE', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md'];

export function trackedFiles(repoRoot) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot })
    .toString('utf8').split('\0').filter(Boolean);
}

export function auditPublicRepository(repoRoot, files = trackedFiles(repoRoot)) {
  const errors = [];
  const fileSet = new Set(files);
  for (const required of REQUIRED_FILES) {
    if (!fileSet.has(required)) errors.push(`missing required file: ${required}`);
  }
  for (const file of files) {
    if (/(?:^|\/)[^/]+\.(?:db|sqlite3?)(?:-(?:shm|wal))?$/i.test(file)) {
      errors.push(`tracked runtime database: ${file}`);
    }
    if (['apps/server/', 'docs/private/', 'docs/back-source/'].some((prefix) => file.startsWith(prefix))) {
      errors.push(`private release content: ${file}`);
    }
  }
  if (fileSet.has('LICENSE')) {
    const license = fs.readFileSync(path.join(repoRoot, 'LICENSE'), 'utf8');
    if (!license.includes('Apache License') || !license.includes('Version 2.0')) {
      errors.push(`LICENSE is not ${CANONICAL_LICENSE}`);
    }
  }
  for (const manifest of files.filter((file) => path.posix.basename(file) === 'package.json')) {
    const parsed = JSON.parse(fs.readFileSync(path.join(repoRoot, manifest), 'utf8'));
    if (parsed.license !== CANONICAL_LICENSE) {
      errors.push(`${manifest} license is ${JSON.stringify(parsed.license)}; expected ${CANONICAL_LICENSE}`);
    }
  }
  return { ok: errors.length === 0, checkedFiles: files.length, errors };
}

export function runCli(repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')) {
  const result = auditPublicRepository(repoRoot);
  if (!result.ok) throw new Error(`Public repository gate failed:\n- ${result.errors.join('\n- ')}`);
  process.stdout.write(`Public repository gate passed: ${result.checkedFiles} tracked files checked.\n`);
  return result;
}

/* node:coverage ignore next 8 */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
