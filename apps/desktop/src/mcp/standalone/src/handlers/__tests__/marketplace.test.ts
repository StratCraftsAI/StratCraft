/**
 * TICKET_1276 P2 Batch C2 -- marketplace handler tests.
 *
 * The five Class-S plugin/entitlement reads are now DIRECT filesystem reads
 * (single path, no bridge). They take resolved plugin dirs and never call
 * discoverServiceApi. Feeds a temp bundled/user plugin tree.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const {
  mockDiscoverServiceApi,
  mockMarketplaceGetRegistry,
  mockMarketplaceGetPluginDetails,
  mockMarketplaceCheckUpdates,
  mockMarketplaceActivateLicense,
  mockMarketplaceGetLicenseStatus,
  mockMarketplaceRemoveLicense,
  mockMarketplaceCheckEntitlement,
  mockMarketplaceCheckEntitlementsBatch,
  mockEntitlementGetAuditLog,
} = vi.hoisted(() => ({
  mockDiscoverServiceApi: vi.fn(),
  mockMarketplaceGetRegistry: vi.fn(),
  mockMarketplaceGetPluginDetails: vi.fn(),
  mockMarketplaceCheckUpdates: vi.fn(),
  mockMarketplaceActivateLicense: vi.fn(),
  mockMarketplaceGetLicenseStatus: vi.fn(),
  mockMarketplaceRemoveLicense: vi.fn(),
  mockMarketplaceCheckEntitlement: vi.fn(),
  mockMarketplaceCheckEntitlementsBatch: vi.fn(),
  mockEntitlementGetAuditLog: vi.fn(),
}));

vi.mock('../../bridge/discovery', () => ({ discoverServiceApi: mockDiscoverServiceApi }));
vi.mock('../../bridge/api-client', () => ({
  marketplaceGetRegistry: mockMarketplaceGetRegistry,
  marketplaceGetPluginDetails: mockMarketplaceGetPluginDetails,
  marketplaceCheckUpdates: mockMarketplaceCheckUpdates,
  marketplaceActivateLicense: mockMarketplaceActivateLicense,
  marketplaceGetLicenseStatus: mockMarketplaceGetLicenseStatus,
  marketplaceRemoveLicense: mockMarketplaceRemoveLicense,
  marketplaceCheckEntitlement: mockMarketplaceCheckEntitlement,
  marketplaceCheckEntitlementsBatch: mockMarketplaceCheckEntitlementsBatch,
  entitlementGetAuditLog: mockEntitlementGetAuditLog,
}));

import {
  handleListPlugins,
  handleGetPlugin,
  handleGetPluginConfig,
  handleListEntitlements,
  handleGetPluginEntitlement,
  handleGetMarketplaceRegistry,
  handleGetMarketplacePluginDetails,
  handleCheckPluginUpdates,
  handleActivateLicense,
  handleGetLicenseStatus,
  handleRemoveLicense,
  handleCheckMarketplaceEntitlement,
  handleCheckMarketplaceEntitlementsBatch,
  handleGetEntitlementAuditLog,
} from '../marketplace';

let root: string;
let dirs: { bundled: string; user: string };

function writeFile(dir: string, name: string, obj: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(obj));
}

beforeEach(() => {
  vi.resetAllMocks();
  // Even with a bridge available, the de-bridged reads must never consult it.
  mockDiscoverServiceApi.mockReturnValue({ baseUrl: 'http://x', token: 't' });
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-test-'));
  dirs = { bundled: path.join(root, 'bundled'), user: path.join(root, 'user') };
  fs.mkdirSync(dirs.bundled, { recursive: true });
  fs.mkdirSync(dirs.user, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('handleListPlugins (Class-S direct)', () => {
  it('lists plugins from on-disk manifests, never the bridge', async () => {
    writeFile(path.join(dirs.bundled, 'a'), 'manifest.json', { id: 'plugin.a' });
    const result = await handleListPlugins(dirs);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.map((p: { id: string }) => p.id)).toEqual(['plugin.a']);
    expect(mockDiscoverServiceApi).not.toHaveBeenCalled();
  });
});

describe('handleGetPlugin (Class-S direct)', () => {
  it('returns the manifest for an installed plugin', async () => {
    writeFile(path.join(dirs.user, 'a'), 'manifest.json', { id: 'plugin.a', version: '1.0' });
    const result = await handleGetPlugin(dirs, { plugin_id: 'plugin.a' });
    expect(JSON.parse(result.content[0].text).manifest.version).toBe('1.0');
  });

  it('returns an explicit error for a missing plugin (TICKET_858)', async () => {
    const result = await handleGetPlugin(dirs, { plugin_id: 'missing' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Plugin not found');
    expect(mockDiscoverServiceApi).not.toHaveBeenCalled();
  });
});

describe('handleGetPluginConfig (Class-S direct)', () => {
  it('reads config.json and returns {} when absent', async () => {
    const empty = await handleGetPluginConfig(dirs, { plugin_id: 'plugin.a' });
    expect(JSON.parse(empty.content[0].text).config).toEqual({});

    writeFile(path.join(dirs.user, 'plugin.a'), 'config.json', { k: 'v' });
    const set = await handleGetPluginConfig(dirs, { plugin_id: 'plugin.a' });
    expect(JSON.parse(set.content[0].text).config).toEqual({ k: 'v' });
    expect(mockDiscoverServiceApi).not.toHaveBeenCalled();
  });
});

describe('handleListEntitlements (Class-S direct)', () => {
  it('resolves entitlement state across all installed plugins from manifest + user-config', async () => {
    writeFile(path.join(dirs.user, 'a'), 'manifest.json', {
      id: 'plugin.a',
      entitlements: {
        services: [
          { id: 's1', name: 'S1', tier: 'free', defaultEnabled: true },
          { id: 's2', name: 'S2', tier: 'gold', defaultEnabled: false },
        ],
      },
    });
    const result = await handleListEntitlements(dirs);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.entitlements).toHaveLength(1);
    expect(payload.entitlements[0].pluginId).toBe('plugin.a');
    // 'free' baseline: gold-tier service is locked
    expect(payload.entitlements[0].services[1].locked).toBe(true);
    expect(mockDiscoverServiceApi).not.toHaveBeenCalled();
  });
});

describe('handleGetPluginEntitlement (Class-S direct)', () => {
  it('resolves one plugin, honouring saved user-config override', async () => {
    writeFile(path.join(dirs.user, 'a'), 'manifest.json', {
      id: 'plugin.a',
      entitlements: { services: [{ id: 's1', name: 'S1', tier: 'free', defaultEnabled: true }] },
    });
    writeFile(path.join(dirs.user, 'plugin.a'), 'user-config.json', {
      services: { s1: { enabled: false } },
    });
    const result = await handleGetPluginEntitlement(dirs, { plugin_id: 'plugin.a' });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.entitlements.services[0].enabled).toBe(false);
    expect(payload.entitlements.services[0].source).toBe('user-config');
  });

  it('returns { entitlements: null } for a missing plugin', async () => {
    const result = await handleGetPluginEntitlement(dirs, { plugin_id: 'missing' });
    expect(JSON.parse(result.content[0].text).entitlements).toBeNull();
    expect(mockDiscoverServiceApi).not.toHaveBeenCalled();
  });
});

describe('TICKET_1305 tier-aware entitlement resolution', () => {
  function writeProPlugin(): void {
    writeFile(path.join(dirs.user, 'a'), 'manifest.json', {
      id: 'plugin.a',
      entitlements: {
        services: [
          { id: 's-free', name: 'Free', tier: 'free', defaultEnabled: true },
          { id: 's-pro', name: 'Pro', tier: 'pro', defaultEnabled: true },
        ],
      },
    });
  }

  it('AC3: without a tier context the PRO service is locked (free baseline, TICKET_638)', async () => {
    writeProPlugin();
    const result = await handleListEntitlements(dirs);
    const svc = JSON.parse(result.content[0].text).entitlements[0].services;
    expect(svc.find((s: { id: string }) => s.id === 's-pro').locked).toBe(true);
  });

  it('AC2: a PRO account plan unlocks the PRO service', async () => {
    writeProPlugin();
    const result = await handleListEntitlements(dirs, { plan: 'PRO' });
    const svc = JSON.parse(result.content[0].text).entitlements[0].services;
    expect(svc.find((s: { id: string }) => s.id === 's-pro').locked).toBe(false);
  });

  it('a per-plugin override unlocks the PRO service even for a free plan', async () => {
    writeProPlugin();
    const result = await handleListEntitlements(dirs, {
      pluginTierOverrides: { 'plugin.a': 'pro' },
    });
    const svc = JSON.parse(result.content[0].text).entitlements[0].services;
    expect(svc.find((s: { id: string }) => s.id === 's-pro').locked).toBe(false);
  });

  it('get_plugin_entitlement honours the tier context per plugin', async () => {
    writeProPlugin();
    const locked = JSON.parse(
      (await handleGetPluginEntitlement(dirs, { plugin_id: 'plugin.a' })).content[0].text,
    ).entitlements.services.find((s: { id: string }) => s.id === 's-pro');
    expect(locked.locked).toBe(true);

    const unlocked = JSON.parse(
      (await handleGetPluginEntitlement(dirs, { plugin_id: 'plugin.a' }, { plan: 'PRO' })).content[0].text,
    ).entitlements.services.find((s: { id: string }) => s.id === 's-pro');
    expect(unlocked.locked).toBe(false);
  });
});

describe('TICKET_1302 U1 Class-R marketplace commands', () => {
  const config = { baseUrl: 'http://127.0.0.1:1', token: 'token' };

  beforeEach(() => {
    mockDiscoverServiceApi.mockReturnValue(config);
    for (const command of [
      mockMarketplaceGetRegistry,
      mockMarketplaceGetPluginDetails,
      mockMarketplaceCheckUpdates,
      mockMarketplaceActivateLicense,
      mockMarketplaceGetLicenseStatus,
      mockMarketplaceRemoveLicense,
      mockMarketplaceCheckEntitlement,
      mockMarketplaceCheckEntitlementsBatch,
      mockEntitlementGetAuditLog,
    ]) {
      command.mockResolvedValue({ success: true, data: { ok: true } });
    }
  });

  it('routes all nine typed contracts to the live owning runtime with exact arguments', async () => {
    const cases = [
      {
        run: () => handleGetMarketplaceRegistry({ force_refresh: true }),
        mock: mockMarketplaceGetRegistry,
        args: [config, { force_refresh: true }],
      },
      {
        run: () => handleGetMarketplacePluginDetails({ plugin_id: 'plugin.a' }),
        mock: mockMarketplaceGetPluginDetails,
        args: [config, { plugin_id: 'plugin.a' }],
      },
      {
        run: () => handleCheckPluginUpdates(),
        mock: mockMarketplaceCheckUpdates,
        args: [config],
      },
      {
        run: () => handleActivateLicense({
          plugin_id: 'plugin.a',
          license_key: 'secret-key',
          confirm: true,
        }),
        mock: mockMarketplaceActivateLicense,
        args: [config, { plugin_id: 'plugin.a', license_key: 'secret-key', confirm: true }],
      },
      {
        run: () => handleGetLicenseStatus({ plugin_ids: ['plugin.a'] }),
        mock: mockMarketplaceGetLicenseStatus,
        args: [config, { plugin_ids: ['plugin.a'] }],
      },
      {
        run: () => handleRemoveLicense({ plugin_id: 'plugin.a', confirm: true }),
        mock: mockMarketplaceRemoveLicense,
        args: [config, { plugin_id: 'plugin.a', confirm: true }],
      },
      {
        run: () => handleCheckMarketplaceEntitlement({ plugin_id: 'plugin.a' }),
        mock: mockMarketplaceCheckEntitlement,
        args: [config, { plugin_id: 'plugin.a' }],
      },
      {
        run: () => handleCheckMarketplaceEntitlementsBatch({ plugin_ids: ['plugin.a'] }),
        mock: mockMarketplaceCheckEntitlementsBatch,
        args: [config, { plugin_ids: ['plugin.a'] }],
      },
      {
        run: () => handleGetEntitlementAuditLog({ limit: 25 }),
        mock: mockEntitlementGetAuditLog,
        args: [config, { limit: 25 }],
      },
    ];

    for (const testCase of cases) {
      const result = await testCase.run();
      expect(result.isError).not.toBe(true);
      expect(testCase.mock).toHaveBeenCalledWith(...testCase.args);
    }
  });

  it('requires T2 confirmation before a license key can enter the runtime command', async () => {
    const activation = await handleActivateLicense({
      plugin_id: 'plugin.a',
      license_key: 'secret-key',
      confirm: false,
    });
    const removal = await handleRemoveLicense({ plugin_id: 'plugin.a', confirm: false });

    expect(activation.isError).toBe(true);
    expect(activation.content[0].text).toContain('confirmation_required');
    expect(removal.isError).toBe(true);
    expect(removal.content[0].text).toContain('confirmation_required');
    expect(mockMarketplaceActivateLicense).not.toHaveBeenCalled();
    expect(mockMarketplaceRemoveLicense).not.toHaveBeenCalled();
  });

  it('returns the canonical Electron-down error for absent and stale runtimes', async () => {
    mockDiscoverServiceApi.mockReturnValueOnce(null);
    const absent = await handleCheckPluginUpdates();
    expect(absent.isError).toBe(true);
    expect(absent.content[0].text).toContain('"electronRequired":true');

    mockMarketplaceCheckUpdates.mockResolvedValueOnce({
      success: false,
      unreachable: true,
      error: 'fetch failed',
    });
    const stale = await handleCheckPluginUpdates();
    expect(stale.isError).toBe(true);
    expect(stale.content[0].text).toContain('"electronRequired":true');
  });

  it('propagates service failures and thrown errors without fake success', async () => {
    mockMarketplaceCheckUpdates.mockResolvedValueOnce({
      success: false,
      error: 'registry unavailable',
    });
    const responseFailure = await handleCheckPluginUpdates();
    expect(responseFailure.isError).toBe(true);
    expect(responseFailure.content[0].text).toContain('registry unavailable');

    mockMarketplaceCheckUpdates.mockRejectedValueOnce(new Error('command failed'));
    const errorFailure = await handleCheckPluginUpdates();
    expect(errorFailure.isError).toBe(true);
    expect(errorFailure.content[0].text).toContain('command failed');

    mockMarketplaceCheckUpdates.mockRejectedValueOnce('non-error failure');
    const nonErrorFailure = await handleCheckPluginUpdates();
    expect(nonErrorFailure.isError).toBe(true);
    expect(nonErrorFailure.content[0].text).toContain('non-error failure');
  });
});
