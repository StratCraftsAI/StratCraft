#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function findExecutable(releaseRoot) {
  const candidates = process.platform === 'win32'
    ? ['win-unpacked/StratCraft.exe']
    : process.platform === 'darwin'
      ? ['mac-arm64/StratCraft.app/Contents/MacOS/StratCraft', 'mac/StratCraft.app/Contents/MacOS/StratCraft']
      : ['linux-unpacked/stratcraft', 'linux-unpacked/StratCraft'];
  const match = candidates.map((candidate) => resolve(releaseRoot, candidate)).find(existsSync);
  if (!match) {
    throw new Error(`Packaged application executable not found in ${releaseRoot}`);
  }
  return match;
}

async function waitForEvidence(path, child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    if (child.exitCode !== null) {
      throw new Error(`Packaged application exited before smoke evidence (exit ${child.exitCode})`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error('Packaged application did not produce runtime smoke evidence within 120 seconds');
}

async function main() {
  const releaseRoot = resolve(process.argv[2] || 'apps/desktop/release');
  const evidencePath = resolve(process.argv[3] || 'artifacts/evidence/runtime-smoke.json');
  mkdirSync(dirname(evidencePath), { recursive: true });
  const executable = findExecutable(releaseRoot);
  const child = spawn(executable, [], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      STRATCRAFT_GENERATED_PUBLIC_SMOKE_EVIDENCE: evidencePath,
      ELECTRON_DISABLE_SANDBOX: process.platform === 'linux' ? '1' : '',
    },
    stdio: 'inherit',
  });
  await waitForEvidence(evidencePath, child);
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolveExit(code));
  });
  if (exitCode !== 0) throw new Error(`Packaged application smoke exited ${exitCode}`);
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  for (const field of ['main', 'preload', 'renderer', 'database', 'executor', 'cleanShutdown']) {
    if (evidence[field] !== true) throw new Error(`Runtime smoke did not prove ${field}`);
  }
  process.stdout.write(`Packaged runtime smoke passed: ${executable}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
