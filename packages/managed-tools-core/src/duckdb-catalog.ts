import type { ManagedToolCatalog } from '@StratCraft/types';
import {
  DUCKDB_CATALOG_REVISION,
  DUCKDB_DESCRIPTOR_REVISION,
  DUCKDB_IMMUTABLE_REF,
  DUCKDB_RELEASE_COMMIT,
  DUCKDB_RELEASE_PUBLISHED_AT,
  DUCKDB_REPOSITORY,
  DUCKDB_TOOL_ID,
  DUCKDB_VERSION,
} from './constants';

/**
 * Reviewed upstream evidence:
 * https://api.github.com/repos/duckdb/duckdb/releases/tags/v1.5.2
 *
 * GitHub's release API supplies each exact asset URL, byte count, and
 * sha256 digest. Zip is the sole pilot archive format on every platform.
 */
export const BUNDLED_MANAGED_TOOL_CATALOG = {
  schemaVersion: 1,
  catalogRevision: DUCKDB_CATALOG_REVISION,
  descriptors: [
    {
      schemaVersion: 1,
      descriptorRevision: DUCKDB_DESCRIPTOR_REVISION,
      toolId: DUCKDB_TOOL_ID,
      displayName: 'DuckDB CLI',
      version: DUCKDB_VERSION,
      source: {
        type: 'github-release',
        repository: DUCKDB_REPOSITORY,
        immutableRef: DUCKDB_IMMUTABLE_REF,
        releaseCommit: DUCKDB_RELEASE_COMMIT,
        publishedAt: DUCKDB_RELEASE_PUBLISHED_AT,
      },
      license: { spdx: 'MIT' },
      artifacts: [
        {
          platform: 'linux',
          architecture: 'x64',
          url: 'https://github.com/duckdb/duckdb/releases/download/v1.5.2/duckdb_cli-linux-amd64.zip',
          sha256: 'fc9145affabca627431e73ddaf6b8117e5c192692480c13886f227be202d5d15',
          sizeBytes: 21_189_997,
          archiveFormat: 'zip',
          executableRelativePath: 'duckdb',
        },
        {
          platform: 'linux',
          architecture: 'arm64',
          url: 'https://github.com/duckdb/duckdb/releases/download/v1.5.2/duckdb_cli-linux-arm64.zip',
          sha256: '28b15a8d78e6df62f6ec43da6b0e6397dcd28e25ab93d847df3c5c97f59375f5',
          sizeBytes: 19_203_553,
          archiveFormat: 'zip',
          executableRelativePath: 'duckdb',
        },
        {
          platform: 'darwin',
          architecture: 'x64',
          url: 'https://github.com/duckdb/duckdb/releases/download/v1.5.2/duckdb_cli-osx-amd64.zip',
          sha256: '67c79301e25bf2289aec81a33131b4d3bfecef0fb4074cf38771e63de6da9c38',
          sizeBytes: 18_498_986,
          archiveFormat: 'zip',
          executableRelativePath: 'duckdb',
        },
        {
          platform: 'darwin',
          architecture: 'arm64',
          url: 'https://github.com/duckdb/duckdb/releases/download/v1.5.2/duckdb_cli-osx-arm64.zip',
          sha256: 'd5289966c3284b432afc7bf064b8a134ba38db0597e1f3559f0aba4ce23c5ea8',
          sizeBytes: 16_271_245,
          archiveFormat: 'zip',
          executableRelativePath: 'duckdb',
        },
        {
          platform: 'win32',
          architecture: 'x64',
          url: 'https://github.com/duckdb/duckdb/releases/download/v1.5.2/duckdb_cli-windows-amd64.zip',
          sha256: 'd7b4f5774419c2e9eb14cb7361d3488821ef0244f8af461fd2c6fcb6f43bc3e0',
          sizeBytes: 13_079_721,
          archiveFormat: 'zip',
          executableRelativePath: 'duckdb.exe',
        },
        {
          platform: 'win32',
          architecture: 'arm64',
          url: 'https://github.com/duckdb/duckdb/releases/download/v1.5.2/duckdb_cli-windows-arm64.zip',
          sha256: '7908e22d25e6991f45e895b1613277e2a600eec6721253f45ce10cde6a3ffdaf',
          sizeBytes: 13_762_510,
          archiveFormat: 'zip',
          executableRelativePath: 'duckdb.exe',
        },
      ],
      capabilities: ['parquet-read', 'csv-read', 'bounded-sql'],
      permissions: {
        networkDuringInstall: ['github.com', 'objects.githubusercontent.com'],
        networkDuringRun: [],
        filesystemRead: ['selected-dataset'],
        filesystemWrite: ['operation-output'],
      },
      runtime: {
        maxProcesses: 1,
        timeoutPolicy: 'operation-class',
      },
      healthcheck: {
        argv: ['duckdb', '-version'],
      },
    },
  ],
} as const satisfies ManagedToolCatalog;

