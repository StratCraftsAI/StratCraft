#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function splitLicenseExpression(expression) {
  return expression
    .replace(/[()]/g, '')
    .split(/\s+(?:OR|AND)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function auditDependencyLicenses(report, policy) {
  const errors = [];
  let checkedDependencies = 0;
  if (report === null || typeof report !== 'object' || Array.isArray(report) || report.error) {
    const detail = report?.error?.message ?? 'report must be an object keyed by license';
    return { errors: [`dependency license report is invalid: ${detail}`], checkedDependencies };
  }
  const allowed = new Set(policy.allowedDependencyLicenses);
  for (const [reportedLicense, packages] of Object.entries(report)) {
    if (!Array.isArray(packages)) {
      errors.push(`dependency license report entry "${reportedLicense}" must be an array`);
      continue;
    }
    for (const dependency of packages) {
      const versions = dependency.versions ?? [dependency.version];
      for (const version of versions.filter(Boolean)) {
        checkedDependencies += 1;
        const packageId = `${dependency.name}@${version}`;
        const effectiveLicense = policy.dependencyLicenseOverrides[packageId] ?? reportedLicense;
        const alternatives = splitLicenseExpression(effectiveLicense ?? '');
        if (alternatives.length === 0 || !alternatives.some((license) => allowed.has(license))) {
          errors.push(`${packageId} has unapproved or unknown license "${effectiveLicense || 'Unknown'}"`);
        }
      }
    }
  }
  return { errors, checkedDependencies };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2) throw new Error('Expected dependency report and policy paths');
  const report = JSON.parse(fs.readFileSync(path.resolve(argv[0]), 'utf8'));
  const policy = JSON.parse(fs.readFileSync(path.resolve(argv[1]), 'utf8'));
  const result = auditDependencyLicenses(report, policy);
  if (result.errors.length > 0) {
    throw new Error(`Dependency license audit failed:\n- ${result.errors.join('\n- ')}`);
  }
  process.stdout.write(`Dependency license audit passed (${result.checkedDependencies} dependencies).\n`);
}

/* v8 ignore next -- entrypoint identity is not observable through an imported module. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
