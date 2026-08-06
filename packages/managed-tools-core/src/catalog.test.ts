import { describe, expect, it } from 'vitest';
import type { ManagedToolCatalog } from '@StratCraft/types';
import {
  BUNDLED_MANAGED_TOOL_CATALOG,
  ManagedToolContractError,
  resolveManagedToolArtifact,
  resolveManagedToolDescriptor,
  validateManagedToolCatalog,
} from './index';

type MutableCatalog = {
  schemaVersion: number;
  catalogRevision: string;
  descriptors: Array<Record<string, any>>;
};

function cloneCatalog(): MutableCatalog {
  return structuredClone(BUNDLED_MANAGED_TOOL_CATALOG) as unknown as MutableCatalog;
}

function expectInvalid(mutate: (catalog: MutableCatalog) => void): void {
  const catalog = cloneCatalog();
  mutate(catalog);
  expect(() =>
    validateManagedToolCatalog(catalog as unknown as ManagedToolCatalog),
  ).toThrowError(
    expect.objectContaining<Partial<ManagedToolContractError>>({
      code: 'CATALOG_INVALID',
    }),
  );
}

describe('managed-tool catalog validation', () => {
  it('accepts the reviewed bundled DuckDB catalog', () => {
    expect(() => validateManagedToolCatalog(BUNDLED_MANAGED_TOOL_CATALOG)).not.toThrow();
  });

  it('rejects invalid catalog and descriptor authority fields', () => {
    const mutations: Array<(catalog: MutableCatalog) => void> = [
      (catalog) => {
        catalog.schemaVersion = 2;
      },
      (catalog) => {
        catalog.catalogRevision = '';
      },
      (catalog) => {
        catalog.descriptors = [];
      },
      (catalog) => {
        catalog.descriptors[0].schemaVersion = 2;
      },
      (catalog) => {
        catalog.descriptors[0].descriptorRevision = '';
      },
      (catalog) => {
        catalog.descriptors[0].displayName = '';
      },
      (catalog) => {
        catalog.descriptors[0].version = '';
      },
      (catalog) => {
        catalog.descriptors[0].toolId = 'DuckDB CLI';
      },
      (catalog) => {
        catalog.descriptors.push(structuredClone(catalog.descriptors[0]));
      },
      (catalog) => {
        catalog.descriptors[0].source.type = 'git';
      },
      (catalog) => {
        catalog.descriptors[0].source.repository = 'https://github.com/other/repo';
      },
      (catalog) => {
        catalog.descriptors[0].source.immutableRef = 'main';
      },
      (catalog) => {
        catalog.descriptors[0].source.releaseCommit = 'not-a-commit';
      },
      (catalog) => {
        catalog.descriptors[0].source.publishedAt = 'not-a-date';
      },
      (catalog) => {
        catalog.descriptors[0].license.spdx = '';
      },
      (catalog) => {
        catalog.descriptors[0].capabilities = [];
      },
      (catalog) => {
        catalog.descriptors[0].permissions.networkDuringInstall = [];
      },
      (catalog) => {
        catalog.descriptors[0].permissions.filesystemRead = [];
      },
      (catalog) => {
        catalog.descriptors[0].permissions.filesystemWrite = [];
      },
      (catalog) => {
        catalog.descriptors[0].permissions.networkDuringInstall = ['example.com'];
      },
      (catalog) => {
        catalog.descriptors[0].runtime.maxProcesses = 2;
      },
      (catalog) => {
        catalog.descriptors[0].runtime.timeoutPolicy = 'unbounded';
      },
      (catalog) => {
        catalog.descriptors[0].healthcheck.argv = [];
      },
      (catalog) => {
        catalog.descriptors[0].healthcheck.argv = ['other', '-version'];
      },
      (catalog) => {
        catalog.descriptors[0].healthcheck.argv = ['duckdb', '--arbitrary'];
      },
      (catalog) => {
        catalog.descriptors[0].artifacts = [];
      },
    ];
    for (const mutate of mutations) expectInvalid(mutate);
  });

  it('rejects incomplete, mutable, duplicated, and non-reviewed artifacts', () => {
    const mutations: Array<(catalog: MutableCatalog) => void> = [
      (catalog) => {
        catalog.descriptors[0].artifacts[0].sha256 = '';
      },
      (catalog) => {
        catalog.descriptors[0].artifacts[0].sizeBytes = 0;
      },
      (catalog) => {
        catalog.descriptors[0].artifacts[0].sizeBytes = Number.MAX_VALUE;
      },
      (catalog) => {
        catalog.descriptors[0].artifacts[0].executableRelativePath = '';
      },
      (catalog) => {
        catalog.descriptors[0].artifacts[0].executableRelativePath = '/duckdb';
      },
      (catalog) => {
        catalog.descriptors[0].artifacts[0].executableRelativePath = '\\duckdb.exe';
      },
      (catalog) => {
        catalog.descriptors[0].artifacts[0].executableRelativePath = '../duckdb';
      },
      (catalog) => {
        catalog.descriptors[0].artifacts[0].url = 'not-a-url';
      },
      (catalog) => {
        catalog.descriptors[0].artifacts[0].url =
          'http://github.com/duckdb/duckdb/releases/download/v1.5.2/file.zip';
      },
      (catalog) => {
        catalog.descriptors[0].artifacts[0].url =
          'https://example.com/duckdb/duckdb/releases/download/v1.5.2/file.zip';
      },
      (catalog) => {
        catalog.descriptors[0].artifacts[0].url =
          'https://github.com/duckdb/duckdb/archive/refs/tags/v1.5.2.zip';
      },
      (catalog) => {
        catalog.descriptors[0].artifacts.push(
          structuredClone(catalog.descriptors[0].artifacts[0]),
        );
      },
    ];
    for (const mutate of mutations) expectInvalid(mutate);
  });

  it('resolves only registered versions and exactly one platform artifact', () => {
    expect(resolveManagedToolDescriptor(BUNDLED_MANAGED_TOOL_CATALOG, 'duckdb-cli'))
      .toMatchObject({ version: '1.5.2' });
    expect(
      resolveManagedToolDescriptor(
        BUNDLED_MANAGED_TOOL_CATALOG,
        'duckdb-cli',
        '1.5.2',
      ),
    ).toMatchObject({ descriptorRevision: 'duckdb-cli-v1.5.2-r1' });

    const descriptor = resolveManagedToolDescriptor(
      BUNDLED_MANAGED_TOOL_CATALOG,
      'duckdb-cli',
    );
    const duplicated = structuredClone(descriptor) as any;
    duplicated.artifacts.push(structuredClone(duplicated.artifacts[0]));
    expect(() =>
      resolveManagedToolArtifact(duplicated, 'linux', 'x64'),
    ).toThrowError(
      expect.objectContaining<Partial<ManagedToolContractError>>({
        code: 'PLATFORM_NOT_SUPPORTED',
      }),
    );
  });
});
