/**
 * Shared catalog snapshot IO (TICKET_1265_3_1 F2 / AC9).
 *
 * Path-injected write/read round-trip + validation, proving the degradation
 * chain's middle link works with no Electron dependency (usable by MCP).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { BackendProviderResponse } from '@StratCraft/types';
import {
  writeCatalogSnapshot,
  readCatalogSnapshot,
  isValidSnapshotEnvelope,
} from '../snapshot';

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

const PAYLOAD: BackendProviderResponse = {
  providers: [
    {
      provider: 'openai',
      display_name: 'OpenAI',
      models: [{ model_id: 'gpt-5.2', display_name: 'GPT 5.2', tier: 'pro', is_default: true }],
    },
  ],
};

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-test-'));
  file = path.join(dir, 'llm-catalog-snapshot.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('writeCatalogSnapshot / readCatalogSnapshot', () => {
  it('round-trips the payload and stamps a timestamp', async () => {
    const written = await writeCatalogSnapshot(file, PAYLOAD, silentLog);
    expect(written).not.toBeNull();
    expect(written!.payload).toEqual(PAYLOAD);
    expect(typeof written!.timestamp).toBe('number');

    const read = await readCatalogSnapshot(file, silentLog);
    expect(read).not.toBeNull();
    expect(read!.payload).toEqual(PAYLOAD);
    expect(read!.timestamp).toBe(written!.timestamp);
  });

  it('leaves no .tmp file after a successful write', async () => {
    await writeCatalogSnapshot(file, PAYLOAD, silentLog);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('read returns null when the file is absent', async () => {
    const read = await readCatalogSnapshot(path.join(dir, 'missing.json'), silentLog);
    expect(read).toBeNull();
  });

  it('read rejects a structurally-wrong file (garbage guard)', async () => {
    fs.writeFileSync(file, JSON.stringify({ timestamp: 'nope', payload: 42 }), 'utf-8');
    const read = await readCatalogSnapshot(file, silentLog);
    expect(read).toBeNull();
  });

  it('read rejects an unparseable file', async () => {
    fs.writeFileSync(file, '{ not json', 'utf-8');
    const read = await readCatalogSnapshot(file, silentLog);
    expect(read).toBeNull();
  });
});

describe('isValidSnapshotEnvelope', () => {
  it('accepts a well-formed envelope', () => {
    expect(isValidSnapshotEnvelope({ timestamp: 1, payload: PAYLOAD })).toBe(true);
  });
  it('rejects missing/invalid fields', () => {
    expect(isValidSnapshotEnvelope(null)).toBe(false);
    expect(isValidSnapshotEnvelope({ timestamp: 1 })).toBe(false);
    expect(isValidSnapshotEnvelope({ timestamp: 1, payload: {} })).toBe(false);
    expect(isValidSnapshotEnvelope({ timestamp: '1', payload: PAYLOAD })).toBe(false);
  });
});
