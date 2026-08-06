import { describe, expect, it } from 'vitest';
import type {
  ManagedToolArchitecture,
  ManagedToolPlatform,
} from '@StratCraft/types';
import {
  BUNDLED_MANAGED_TOOL_CATALOG,
  ManagedToolContractError,
  planManagedToolInstall,
} from './index';

const USER_DATA_ROOT = '/users/alice/stratcraft';

function plan(
  platform: ManagedToolPlatform = 'linux',
  architecture: ManagedToolArchitecture = 'x64',
) {
  return planManagedToolInstall({
    catalog: BUNDLED_MANAGED_TOOL_CATALOG,
    toolId: 'duckdb-cli',
    userDataRoot: USER_DATA_ROOT,
    platform,
    architecture,
  });
}

describe('managed-tool immutable planner', () => {
  it('produces a deterministic plan whose identity covers authority and paths', () => {
    const first = plan();
    const second = plan();

    expect(first).toEqual(second);
    expect(first.planId).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toMatchObject({
      catalogRevision: '2026-07-25.1',
      descriptorRevision: 'duckdb-cli-v1.5.2-r1',
      toolId: 'duckdb-cli',
      targetVersion: '1.5.2',
      immutableRef: 'v1.5.2',
      platform: 'linux',
      architecture: 'x64',
      licenseSpdx: 'MIT',
      currentVersion: null,
      rollbackVersion: null,
      networkRequired: true,
      resourceDecision: {
        operationClass: 'install',
        maxProcesses: 1,
        artifactBytes: 21_189_997,
        requiredFreeBytes: 63_569_991,
      },
    });
    expect(first.pathIdentity).toEqual({
      userDataRoot: USER_DATA_ROOT,
      storeRoot: `${USER_DATA_ROOT}/managed-tools`,
      artifactPath:
        `${USER_DATA_ROOT}/managed-tools/artifacts/` +
        'fc9145affabca627431e73ddaf6b8117e5c192692480c13886f227be202d5d15',
      installPath:
        `${USER_DATA_ROOT}/managed-tools/installs/duckdb-cli/1.5.2/linux-x64`,
      activationPath: `${USER_DATA_ROOT}/managed-tools/active/duckdb-cli.json`,
      stagingRoot: `${USER_DATA_ROOT}/managed-tools/staging`,
      dataPath: `${USER_DATA_ROOT}/managed-tools/data/duckdb-cli`,
    });

    const changedRoot = planManagedToolInstall({
      catalog: BUNDLED_MANAGED_TOOL_CATALOG,
      toolId: 'duckdb-cli',
      userDataRoot: '/users/bob/stratcraft',
      platform: 'linux',
      architecture: 'x64',
    });
    expect(changedRoot.planId).not.toBe(first.planId);
  });

  it('selects every reviewed platform artifact uniquely', () => {
    const expected = new Map<string, string>([
      ['linux-x64', 'fc9145affabca627431e73ddaf6b8117e5c192692480c13886f227be202d5d15'],
      ['linux-arm64', '28b15a8d78e6df62f6ec43da6b0e6397dcd28e25ab93d847df3c5c97f59375f5'],
      ['darwin-x64', '67c79301e25bf2289aec81a33131b4d3bfecef0fb4074cf38771e63de6da9c38'],
      ['darwin-arm64', 'd5289966c3284b432afc7bf064b8a134ba38db0597e1f3559f0aba4ce23c5ea8'],
      ['win32-x64', 'd7b4f5774419c2e9eb14cb7361d3488821ef0244f8af461fd2c6fcb6f43bc3e0'],
      ['win32-arm64', '7908e22d25e6991f45e895b1613277e2a600eec6721253f45ce10cde6a3ffdaf'],
    ]);

    for (const [key, digest] of expected) {
      const [platform, architecture] = key.split('-') as [
        ManagedToolPlatform,
        ManagedToolArchitecture,
      ];
      expect(plan(platform, architecture).artifact.sha256).toBe(digest);
    }
  });

  it('records the prior version only when it is a rollback candidate', () => {
    const upgrade = planManagedToolInstall({
      catalog: BUNDLED_MANAGED_TOOL_CATALOG,
      toolId: 'duckdb-cli',
      requestedVersion: '1.5.2',
      currentVersion: '1.5.1',
      userDataRoot: USER_DATA_ROOT,
      platform: 'linux',
      architecture: 'x64',
    });
    const reinstall = planManagedToolInstall({
      catalog: BUNDLED_MANAGED_TOOL_CATALOG,
      toolId: 'duckdb-cli',
      currentVersion: '1.5.2',
      userDataRoot: USER_DATA_ROOT,
      platform: 'linux',
      architecture: 'x64',
    });
    expect(upgrade.rollbackVersion).toBe('1.5.1');
    expect(reinstall.rollbackVersion).toBeNull();
  });

  it('rejects unregistered tools, versions, platforms, and relative roots', () => {
    const cases = [
      {
        expected: 'TOOL_NOT_REGISTERED',
        input: { toolId: 'arbitrary-github-url' },
      },
      {
        expected: 'VERSION_NOT_REGISTERED',
        input: { requestedVersion: 'main' },
      },
      {
        expected: 'PLATFORM_NOT_SUPPORTED',
        input: { architecture: 'ppc64' as ManagedToolArchitecture },
      },
      {
        expected: 'USER_DATA_ROOT_INVALID',
        input: { userDataRoot: 'relative/path' },
      },
    ];
    for (const testCase of cases) {
      expect(() =>
        planManagedToolInstall({
          catalog: BUNDLED_MANAGED_TOOL_CATALOG,
          toolId: 'duckdb-cli',
          userDataRoot: USER_DATA_ROOT,
          platform: 'linux',
          architecture: 'x64',
          ...testCase.input,
        }),
      ).toThrowError(
        expect.objectContaining<Partial<ManagedToolContractError>>({
          code: testCase.expected as ManagedToolContractError['code'],
        }),
      );
    }
  });
});

