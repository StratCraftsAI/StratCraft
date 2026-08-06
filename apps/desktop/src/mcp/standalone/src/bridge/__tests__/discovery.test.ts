/**
 * Unit tests for MCP Service API Discovery
 *
 * Tests discoverServiceApi() from discovery.ts:
 * - Both discovery files exist with valid content
 * - Port file missing
 * - Token file missing
 * - Empty port value
 * - resolveDiscoveryDir throws
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

vi.mock('../../db', () => ({
  resolveDiscoveryDir: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

import {
  discoverServiceApi,
  discoverServiceApiResult,
  removeStaleDiscoveryFiles,
} from '../discovery';
import { resolveDiscoveryDir } from '../../db';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_DATA_DIR = path.dirname('/mock/data/StratCraft.db'); // '/mock/data'
const PORT_FILE = path.join(MOCK_DATA_DIR, 'api-port');
const TOKEN_FILE = path.join(MOCK_DATA_DIR, 'api-token');

beforeEach(() => {
  vi.resetAllMocks();
  (resolveDiscoveryDir as ReturnType<typeof vi.fn>).mockReturnValue(MOCK_DATA_DIR);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('discoverServiceApi', () => {
  it('returns baseUrl and token when both discovery files exist with valid content', () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      return p === PORT_FILE || p === TOKEN_FILE;
    });
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      if (p === PORT_FILE) return '  12345\n';
      if (p === TOKEN_FILE) return '  secret-token\n';
      return '';
    });

    const result = discoverServiceApi();

    expect(result).toEqual({
      baseUrl: 'http://127.0.0.1:12345',
      token: 'secret-token',
    });
  });

  it('returns null when port file does not exist', () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      if (p === PORT_FILE) return false;
      if (p === TOKEN_FILE) return true;
      return false;
    });

    const result = discoverServiceApi();

    expect(result).toBeNull();
  });

  it('returns null when token file does not exist', () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      if (p === PORT_FILE) return true;
      if (p === TOKEN_FILE) return false;
      return false;
    });

    const result = discoverServiceApi();

    expect(result).toBeNull();
  });

  it('returns null when port value is empty after trim', () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      return p === PORT_FILE || p === TOKEN_FILE;
    });
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      if (p === PORT_FILE) return '   \n';
      if (p === TOKEN_FILE) return 'valid-token';
      return '';
    });

    const result = discoverServiceApi();

    expect(result).toBeNull();
  });

  it('returns null when token value is empty after trim', () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      return p === PORT_FILE || p === TOKEN_FILE;
    });
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      if (p === PORT_FILE) return '9999';
      if (p === TOKEN_FILE) return '  \n';
      return '';
    });

    const result = discoverServiceApi();

    expect(result).toBeNull();
  });

  it('returns null when resolveDiscoveryDir throws', () => {
    (resolveDiscoveryDir as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('DB path resolution failed');
    });

    const result = discoverServiceApi();

    expect(result).toBeNull();
  });

  it('returns null when readFileSync throws', () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    const result = discoverServiceApi();

    expect(result).toBeNull();
  });

  it('derives discovery files from resolveDiscoveryDir', () => {
    const customDataDir = '/custom/path/to/data';
    (resolveDiscoveryDir as ReturnType<typeof vi.fn>).mockReturnValue(customDataDir);

    const customPortFile = path.join(customDataDir, 'api-port');
    const customTokenFile = path.join(customDataDir, 'api-token');

    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      return p === customPortFile || p === customTokenFile;
    });
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      if (p === customPortFile) return '8080';
      if (p === customTokenFile) return 'my-token';
      return '';
    });

    const result = discoverServiceApi();

    expect(result).toEqual({
      baseUrl: 'http://127.0.0.1:8080',
      token: 'my-token',
    });
  });
});

describe('discoverServiceApiResult (TICKET_1335 AC20)', () => {
  it('returns an owner-neutral available result for valid evidence', () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => (
      p === PORT_FILE ? '12345\n' : 'runtime-token\n'
    ));

    expect(discoverServiceApiResult()).toEqual({
      status: 'available',
      config: { baseUrl: 'http://127.0.0.1:12345', token: 'runtime-token' },
    });
  });

  it('distinguishes wholly missing evidence from incomplete evidence', () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
    expect(discoverServiceApiResult()).toMatchObject({
      status: 'missing_evidence',
      code: 'service_api_discovery_missing',
    });

    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => p === PORT_FILE);
    expect(discoverServiceApiResult()).toMatchObject({
      status: 'invalid_evidence',
      code: 'service_api_discovery_invalid',
      reason: 'incomplete_files',
    });
  });

  it.each(['', 'abc', '0', '65536'])('classifies invalid port evidence %j', (port) => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => (
      p === PORT_FILE ? port : 'runtime-token'
    ));

    expect(discoverServiceApiResult()).toMatchObject({
      status: 'invalid_evidence',
      reason: 'invalid_port',
    });
  });

  it('classifies an empty token independently from an invalid port', () => {
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => (
      p === PORT_FILE ? '12345' : '  \n'
    ));

    expect(discoverServiceApiResult()).toMatchObject({
      status: 'invalid_evidence',
      reason: 'empty_token',
    });
  });

  it('reports directory, inspection, and read failures as invalid evidence', () => {
    (resolveDiscoveryDir as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('directory unavailable');
    });
    expect(discoverServiceApiResult()).toMatchObject({
      status: 'invalid_evidence',
      reason: 'read_failed',
      message: expect.stringContaining('directory unavailable'),
    });

    (resolveDiscoveryDir as ReturnType<typeof vi.fn>).mockReturnValue(MOCK_DATA_DIR);
    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('cannot inspect');
    });
    expect(discoverServiceApiResult()).toMatchObject({
      status: 'invalid_evidence',
      reason: 'read_failed',
      message: expect.stringContaining('cannot inspect'),
    });

    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('cannot read');
    });
    expect(discoverServiceApiResult()).toMatchObject({
      status: 'invalid_evidence',
      reason: 'read_failed',
      message: expect.stringContaining('cannot read'),
    });
  });

  it('stringifies non-Error failures at every filesystem boundary', () => {
    (resolveDiscoveryDir as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw 'directory-string-failure';
    });
    expect(discoverServiceApiResult()).toMatchObject({
      message: expect.stringContaining('directory-string-failure'),
    });

    (resolveDiscoveryDir as ReturnType<typeof vi.fn>).mockReturnValue(MOCK_DATA_DIR);
    (fs.existsSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw 'inspection-string-failure';
    });
    expect(discoverServiceApiResult()).toMatchObject({
      message: expect.stringContaining('inspection-string-failure'),
    });

    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw 'read-string-failure';
    });
    expect(discoverServiceApiResult()).toMatchObject({
      message: expect.stringContaining('read-string-failure'),
    });
  });
});

// ---------------------------------------------------------------------------
// TICKET_1265_4: removeStaleDiscoveryFiles (self-heal)
// ---------------------------------------------------------------------------

describe('removeStaleDiscoveryFiles', () => {
  const STALE_CONFIG = { baseUrl: 'http://127.0.0.1:39359', token: 'stale-token' };

  it('deletes both discovery files when they still point at the dead port', () => {
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      if (p === PORT_FILE) return '39359\n';
      return '';
    });

    removeStaleDiscoveryFiles(STALE_CONFIG);

    expect(fs.unlinkSync).toHaveBeenCalledWith(PORT_FILE);
    expect(fs.unlinkSync).toHaveBeenCalledWith(TOKEN_FILE);
  });

  it('keeps the files when a restarted Electron rewrote them with a new port', () => {
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      if (p === PORT_FILE) return '41000\n';
      return '';
    });

    removeStaleDiscoveryFiles(STALE_CONFIG);

    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it('tolerates already-removed files (readFileSync throws)', () => {
    (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    expect(() => removeStaleDiscoveryFiles(STALE_CONFIG)).not.toThrow();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  it('tolerates resolveDiscoveryDir failure', () => {
    (resolveDiscoveryDir as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('DB path resolution failed');
    });

    expect(() => removeStaleDiscoveryFiles(STALE_CONFIG)).not.toThrow();
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });
});
