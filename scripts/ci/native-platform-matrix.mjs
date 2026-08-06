#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_NATIVE_PLATFORMS = Object.freeze([
  Object.freeze({
    platform: 'Linux',
    runner: 'ubuntu-latest',
    target: 'linux',
    triplet: 'x64-linux',
    artifact: 'generated-public-Linux-x64',
    'artifact-path': [
      'public-tree/apps/desktop/release/*.AppImage',
      'public-tree/apps/desktop/release/*.deb',
      'public-tree/apps/desktop/release/*.zip',
      'public-tree/artifacts/evidence/**',
    ].join('\n'),
  }),
  Object.freeze({
    platform: 'Windows',
    runner: 'windows-2022',
    target: 'win',
    triplet: 'x64-windows',
    artifact: 'generated-public-Windows-x64',
    'artifact-path': [
      'public-tree/apps/desktop/release/*.exe',
      'public-tree/artifacts/evidence/**',
    ].join('\n'),
  }),
  Object.freeze({
    platform: 'macOS',
    runner: 'macos-15',
    target: 'mac',
    triplet: 'arm64-osx',
    artifact: 'generated-public-macOS-arm64',
    'artifact-path': [
      'public-tree/apps/desktop/release/*.dmg',
      'public-tree/apps/desktop/release/*.zip',
      'public-tree/artifacts/evidence/**',
    ].join('\n'),
  }),
]);

export function nativePlatformMatrix() {
  return { include: REQUIRED_NATIVE_PLATFORMS };
}

/* node:coverage ignore next 3 */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(nativePlatformMatrix()));
}
