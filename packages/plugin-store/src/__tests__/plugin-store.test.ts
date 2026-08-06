/**
 * TICKET_1276 P2 Batch C2 -- plugin read core unit tests.
 * Feeds a temp bundled/user directory tree and asserts manifest scan, get,
 * user-config / config reads, and entitlement resolution.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  discoverPlugins,
  scanPluginDir,
  findPluginManifest,
  readPluginConfig,
  readUserConfig,
  resolvePluginEntitlements,
  resolveServiceState,
  type PluginDirs,
} from '../index';

let root: string;
let dirs: PluginDirs;

function writePlugin(
  base: string,
  dirName: string,
  manifest: Record<string, unknown> | null,
): string {
  const pluginDir = path.join(base, dirName);
  fs.mkdirSync(pluginDir, { recursive: true });
  if (manifest !== null) {
    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify(manifest));
  }
  return pluginDir;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-store-test-'));
  dirs = { bundled: path.join(root, 'bundled'), user: path.join(root, 'user') };
  fs.mkdirSync(dirs.bundled, { recursive: true });
  fs.mkdirSync(dirs.user, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('scanPluginDir', () => {
  it('returns plugins with a valid manifest and skips dirs without one', () => {
    writePlugin(dirs.bundled, 'a', { id: 'plugin.a' });
    writePlugin(dirs.bundled, 'nomanifest', null);
    const found = scanPluginDir(dirs.bundled, 'bundled');
    expect(found.map((p) => p.id)).toEqual(['plugin.a']);
    expect(found[0].source).toBe('bundled');
  });

  it('falls back to the directory name when manifest.id is absent', () => {
    writePlugin(dirs.bundled, 'legacy-dir', { name: 'no id here' });
    const found = scanPluginDir(dirs.bundled, 'bundled');
    expect(found[0].id).toBe('legacy-dir');
  });

  it('returns [] for a non-existent directory', () => {
    expect(scanPluginDir(path.join(root, 'nope'), 'user')).toEqual([]);
  });

  it('skips a manifest that is not valid JSON', () => {
    const d = path.join(dirs.bundled, 'broken');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'manifest.json'), '{ not json');
    expect(scanPluginDir(dirs.bundled, 'bundled')).toEqual([]);
  });
});

describe('discoverPlugins', () => {
  it('merges bundled + user, and a user plugin shadows a bundled one of the same id', () => {
    writePlugin(dirs.bundled, 'shared', { id: 'plugin.shared', version: 'bundled' });
    writePlugin(dirs.user, 'shared', { id: 'plugin.shared', version: 'user' });
    writePlugin(dirs.bundled, 'only-bundled', { id: 'plugin.bundled' });
    const plugins = discoverPlugins(dirs);
    const shared = plugins.find((p) => p.id === 'plugin.shared')!;
    expect(shared.source).toBe('user');
    expect(shared.manifest.version).toBe('user');
    expect(plugins.map((p) => p.id).sort()).toEqual(['plugin.bundled', 'plugin.shared']);
  });
});

describe('findPluginManifest', () => {
  it('matches by manifest.id', () => {
    writePlugin(dirs.user, 'somedir', { id: 'plugin.x', foo: 1 });
    expect(findPluginManifest(dirs, 'plugin.x')?.foo).toBe(1);
  });

  it('matches by directory name', () => {
    writePlugin(dirs.user, 'dir-name-id', { name: 'x' });
    expect(findPluginManifest(dirs, 'dir-name-id')).not.toBeNull();
  });

  it('returns null when not found', () => {
    expect(findPluginManifest(dirs, 'missing')).toBeNull();
  });
});

describe('readPluginConfig', () => {
  it('returns {} when config.json is absent', () => {
    expect(readPluginConfig(dirs.user, 'plugin.x')).toEqual({});
  });

  it('reads and parses config.json', () => {
    const d = path.join(dirs.user, 'plugin.x');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ key: 'val' }));
    expect(readPluginConfig(dirs.user, 'plugin.x')).toEqual({ key: 'val' });
  });

  it('throws on a corrupt config.json (TICKET_858, never a silent {})', () => {
    const d = path.join(dirs.user, 'plugin.x');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'config.json'), '{ bad');
    expect(() => readPluginConfig(dirs.user, 'plugin.x')).toThrow();
  });
});

describe('readUserConfig', () => {
  it('returns the default when absent', () => {
    expect(readUserConfig(dirs.user, 'plugin.x')).toEqual({ services: {} });
  });

  it('reads user-config.json', () => {
    const d = path.join(dirs.user, 'plugin.x');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(
      path.join(d, 'user-config.json'),
      JSON.stringify({ services: { svc: { enabled: false } } }),
    );
    expect(readUserConfig(dirs.user, 'plugin.x').services?.svc.enabled).toBe(false);
  });

  it('defaults on corrupt user-config (log-and-default parity)', () => {
    const d = path.join(dirs.user, 'plugin.x');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'user-config.json'), 'bad');
    expect(readUserConfig(dirs.user, 'plugin.x')).toEqual({ services: {} });
  });
});

describe('resolveServiceState / resolvePluginEntitlements', () => {
  const def = { id: 'svc', name: 'Svc', tier: 'pro', defaultEnabled: true };

  it('manifest default when user config is empty', () => {
    const s = resolveServiceState(def, { services: {} }, undefined, 'gold');
    expect(s.enabled).toBe(true);
    expect(s.source).toBe('manifest');
    expect(s.locked).toBe(false);
    expect(s.effectiveEnabled).toBe(true);
  });

  it('user config overrides the manifest default and marks source user-config', () => {
    const s = resolveServiceState(def, { services: { svc: { enabled: false } } }, undefined, 'gold');
    expect(s.enabled).toBe(false);
    expect(s.source).toBe('user-config');
  });

  it('locks and forces effectiveEnabled=false when the user tier is below the required tier', () => {
    const s = resolveServiceState(def, { services: { svc: { enabled: true } } }, undefined, 'free');
    expect(s.locked).toBe(true);
    expect(s.lockReason).toBe('Requires PRO tier');
    expect(s.enabled).toBe(true);
    expect(s.effectiveEnabled).toBe(false);
  });

  it('respects a per-manifest tierMapping override', () => {
    const mapping = { free: 0, custom: 5 };
    const customDef = { ...def, tier: 'custom' };
    const locked = resolveServiceState(customDef, { services: {} }, mapping, 'free');
    expect(locked.locked).toBe(true);
    const unlocked = resolveServiceState(customDef, { services: {} }, mapping, 'custom');
    expect(unlocked.locked).toBe(false);
  });

  it('resolvePluginEntitlements maps all manifest services', () => {
    const manifest = {
      id: 'plugin.x',
      entitlements: {
        services: [
          { id: 's1', name: 'S1', tier: 'free', defaultEnabled: true },
          { id: 's2', name: 'S2', tier: 'gold', defaultEnabled: false },
        ],
      },
    };
    const state = resolvePluginEntitlements(manifest, { services: {} }, 'basic');
    expect(state.pluginId).toBe('plugin.x');
    expect(state.services.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(state.services[1].locked).toBe(true); // gold required, basic user
  });

  it('resolvePluginEntitlements returns empty services when the manifest declares none', () => {
    expect(resolvePluginEntitlements({ id: 'p' }, { services: {} }).services).toEqual([]);
  });
});
