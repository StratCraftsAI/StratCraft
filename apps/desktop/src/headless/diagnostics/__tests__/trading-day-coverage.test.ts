import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import mod from '../trading-day-coverage';

describe('trading-day-coverage diagnostic', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-tdc-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('requires symbol arg', async () => {
    const result = await mod.run({});
    expect(result.pass).toBe(false);
    expect(result.summary).toContain('Missing required arg: symbol');
  });

  it('rejects unknown provider', async () => {
    const result = await mod.run({ symbol: 'EURUSD', provider: 'unknown' });
    expect(result.pass).toBe(false);
    expect(result.summary).toContain('Unknown provider');
  });

  it('reports missing parquet file', async () => {
    const result = await mod.run({ symbol: 'EURUSD', parquetDir: tmpDir });
    expect(result.pass).toBe(false);
    expect(result.summary).toContain('Parquet not found');
  });

  it('reports existing file with metadata', async () => {
    const providerDir = path.join(tmpDir, 'dukascopy');
    fs.mkdirSync(providerDir, { recursive: true });
    fs.writeFileSync(path.join(providerDir, 'EURUSD_1h.parquet'), 'fake-parquet-data');

    const result = await mod.run({ symbol: 'EURUSD', parquetDir: tmpDir });
    expect(result.pass).toBe(true);
    expect(result.details.fileSizeBytes).toBeGreaterThan(0);
    expect(result.details.calendar).toBe('FX_5_24');
  });

  it('maps providers to correct calendars', async () => {
    const cases: [string, string][] = [
      ['dukascopy', 'FX_5_24'],
      ['yfinance', 'NYSE'],
      ['databento', 'NYSE'],
      ['ccxt', 'CRYPTO_24_7'],
    ];
    for (const [provider, calendar] of cases) {
      const providerDir = path.join(tmpDir, provider);
      fs.mkdirSync(providerDir, { recursive: true });
      fs.writeFileSync(path.join(providerDir, 'TEST_1h.parquet'), 'data');

      const result = await mod.run({ symbol: 'TEST', parquetDir: tmpDir, provider });
      expect(result.details.calendar).toBe(calendar);
    }
  });
});
