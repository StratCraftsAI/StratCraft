import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ManagedToolContractError,
  requireAbsoluteUserDataRoot,
  resolveStandaloneUserDataRoot,
} from './index';

describe('shared standalone user-data resolver', () => {
  it('uses process defaults when no dependency inputs are supplied', () => {
    const previous = process.env.STRATCRAFT_MCP_USERDATA_DIR;
    process.env.STRATCRAFT_MCP_USERDATA_DIR = '/tmp/stratcraft-default-input-test';
    try {
      expect(resolveStandaloneUserDataRoot()).toBe(
        '/tmp/stratcraft-default-input-test',
      );
    } finally {
      if (previous === undefined) {
        delete process.env.STRATCRAFT_MCP_USERDATA_DIR;
      } else {
        process.env.STRATCRAFT_MCP_USERDATA_DIR = previous;
      }
    }
  });

  it('uses the explicit standalone override and normalizes it', () => {
    expect(
      resolveStandaloneUserDataRoot({
        platform: 'linux',
        homeDirectory: '/home/alice',
        environment: {
          STRATCRAFT_MCP_USERDATA_DIR: '/mnt/state/../state/stratcraft',
          STRATCRAFT_DATA_ROOT: '/research-data',
        },
      }),
    ).toBe(path.normalize('/mnt/state/stratcraft'));
  });

  it('matches Electron application paths on Linux, macOS, and Windows', () => {
    expect(
      resolveStandaloneUserDataRoot({
        platform: 'linux',
        homeDirectory: '/home/alice',
        environment: {},
      }),
    ).toBe('/home/alice/.config/@StratCraft/desktop');
    expect(
      resolveStandaloneUserDataRoot({
        platform: 'linux',
        homeDirectory: '/home/alice',
        environment: { XDG_CONFIG_HOME: '/configuration' },
      }),
    ).toBe('/configuration/@StratCraft/desktop');
    expect(
      resolveStandaloneUserDataRoot({
        platform: 'darwin',
        homeDirectory: '/Users/alice',
        environment: {},
      }),
    ).toBe('/Users/alice/Library/Application Support/@StratCraft/desktop');
    expect(
      resolveStandaloneUserDataRoot({
        platform: 'win32',
        homeDirectory: 'C:\\Users\\alice',
        environment: { APPDATA: 'C:\\Users\\alice\\AppData\\Roaming' },
      }),
    ).toBe('C:\\Users\\alice\\AppData\\Roaming\\@StratCraft\\desktop');
    expect(
      resolveStandaloneUserDataRoot({
        platform: 'win32',
        homeDirectory: 'C:\\Users\\alice',
        environment: {},
      }),
    ).toBe('C:\\Users\\alice\\AppData\\Roaming\\@StratCraft\\desktop');
  });

  it('rejects empty and relative roots with an actionable identity', () => {
    for (const userDataRoot of ['', 'relative']) {
      expect(() => requireAbsoluteUserDataRoot(userDataRoot)).toThrowError(
        expect.objectContaining<Partial<ManagedToolContractError>>({
          name: 'ManagedToolContractError',
          code: 'USER_DATA_ROOT_INVALID',
          details: { userDataRoot },
        }),
      );
    }
  });
});
