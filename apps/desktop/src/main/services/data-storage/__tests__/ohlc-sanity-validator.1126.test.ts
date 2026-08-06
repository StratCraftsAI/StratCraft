/**
 * TICKET_1126 F2 (AC2) -- OHLC sanity validator unit tests.
 *
 * Synthetic corruption signatures MUST reject; legitimate market events
 * MUST pass:
 *   - negative-price bar          -> reject (nonpositive_price)
 *   - 2000x single-bar jump      -> reject (scale_shift)
 *   - scale-block boundary       -> reject (scale_shift)
 *   - round-trip revert spike    -> reject (revert_spike)
 *   - intra-bar incoherence      -> reject (intrabar_incoherent)
 *   - one-sided ~18% flash move  -> PASS (below forex threshold, one-sided)
 *   - one-sided 25% persistent   -> PASS as suspect (kept + flagged)
 *   - weekend-gap reopen jump    -> PASS (gap-aware exemption)
 *
 * The DuckDB SQL form is asserted against the TS form on the same rows so
 * the import-choke-point predicate and the download-path predicate can
 * never drift (TICKET_854 single source of truth).
 */

import { describe, it, expect } from 'vitest';
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  validateOhlcvRows,
  buildOhlcvViolationScanSql,
} from '../ohlc-sanity-validator';
import type { OHLCVRow } from '../../data-providers/types';
import type { EpochSeconds } from '../../../../shared/types/epoch';

const FIVE_MIN = 300;
const BASE_TS = 1_000_000_000;

function bar(
  i: number,
  close: number,
  opts?: Partial<Omit<OHLCVRow, 'timestamp'>> & { tsOffset?: number },
): OHLCVRow {
  const open = opts?.open ?? close;
  const high = opts?.high ?? Math.max(open, close);
  const low = opts?.low ?? Math.min(open, close);
  return {
    timestamp: (BASE_TS + i * FIVE_MIN + (opts?.tsOffset ?? 0)) as EpochSeconds,
    open,
    high,
    low,
    close,
    volume: opts?.volume ?? 100,
  };
}

const FOREX_CTX = {
  symbol: 'EURUSD',
  interval: '5m',
  intervalSeconds: FIVE_MIN,
  providerOrAssetClass: 'forex',
};

describe('TICKET_1126 F2 validateOhlcvRows -- corruption signatures reject', () => {
  it('rejects a negative-price bar (nonpositive_price)', () => {
    const rows = [
      bar(0, 0.8485),
      { ...bar(1, -0.0001), open: -0.0001, high: -0.0001, low: -0.0001 },
      bar(2, 0.8486),
    ];
    const r = validateOhlcvRows(rows, FOREX_CTX);
    expect(r.rejects).toHaveLength(1);
    expect(r.rejects[0].rule).toBe('nonpositive_price');
    expect(r.acceptedRows.map((x) => x.close)).toEqual([0.8485, 0.8486]);
  });

  it('rejects a 2000x jump bar (scale_shift) -- the EURUSD 1965.0001 signature', () => {
    const rows = [bar(0, 0.8485), bar(1, 1965.0001), bar(2, 0.8486)];
    const r = validateOhlcvRows(rows, FOREX_CTX);
    expect(r.rejects).toHaveLength(1);
    expect(r.rejects[0].rule).toBe('scale_shift');
    expect(r.rejects[0].barTs).toBe(BASE_TS + FIVE_MIN);
    expect(r.acceptedRows).toHaveLength(2);
  });

  it('rejects a scale-block boundary (UDXUSD ~89 -> ~10,353 signature)', () => {
    const rows = [bar(0, 88.9), bar(1, 89.1), bar(2, 10_353), bar(3, 10_360)];
    const r = validateOhlcvRows(rows, FOREX_CTX);
    expect(r.rejects.map((v) => v.rule)).toContain('scale_shift');
    // The boundary bar is rejected; the block interior relative to the
    // last VALID bar (89.1) also crosses the scale boundary and rejects.
    expect(r.acceptedRows.map((x) => x.close)).toEqual([88.9, 89.1]);
  });

  it('rejects a round-trip revert spike below the scale boundary (revert_spike)', () => {
    // 30% up, immediately back: data error signature (deviates from BOTH
    // agreeing neighbours). 1.3x is below the 5x scale-shift boundary, so
    // this exercises the revert predicate specifically.
    const rows = [bar(0, 1.0), bar(1, 1.3), bar(2, 1.001)];
    const r = validateOhlcvRows(rows, FOREX_CTX);
    expect(r.rejects).toHaveLength(1);
    expect(r.rejects[0].rule).toBe('revert_spike');
  });

  it('rejects intra-bar incoherence (high < close)', () => {
    const rows = [
      bar(0, 1.0),
      { ...bar(1, 1.001), high: 0.999, open: 1.0, low: 0.998 },
      bar(2, 1.0),
    ];
    const r = validateOhlcvRows(rows, FOREX_CTX);
    expect(r.rejects).toHaveLength(1);
    expect(r.rejects[0].rule).toBe('intrabar_incoherent');
  });

  it('rejects a 5x+ intra-bar range even after a weekend gap (AUDJPY reopen-bar signature)', () => {
    // Incident-verified residue: the AUDJPY contamination block's Sunday
    // reopen bar (2005-05-01 17:00, O=135.18 H=135.21 L=0.6747 C=105.1)
    // is intra-bar COHERENT, gap-exempt from the inter-bar gates, and its
    // close ratio vs the Friday close (~81.9) stays under 5x. Only the
    // intra-bar range rule can catch it.
    const rows = [
      bar(0, 81.9),
      { ...bar(1, 105.1, { tsOffset: 2 * 86_400 }), open: 135.18, high: 135.21, low: 0.6747 },
      bar(2, 81.93, { tsOffset: 2 * 86_400 }),
    ];
    const r = validateOhlcvRows(rows, { ...FOREX_CTX, symbol: 'AUDJPY' });
    expect(r.rejects).toHaveLength(1);
    expect(r.rejects[0].rule).toBe('intrabar_range');
    expect(r.acceptedRows).toHaveLength(2);
  });

  it('crypto: a 5x+ intra-bar wick is a SUSPECT, not a reject (2025-10-10 altcoin flash crash)', () => {
    const rows = [
      bar(0, 0.50),
      { ...bar(1, 0.45), open: 0.50, high: 0.50, low: 0.08 },
      bar(2, 0.44),
    ];
    const r = validateOhlcvRows(rows, { ...FOREX_CTX, symbol: 'JUP_USDT', providerOrAssetClass: 'crypto' });
    expect(r.rejects).toHaveLength(0);
    expect(r.suspects.some((s) => s.rule === 'intrabar_range')).toBe(true);
    expect(r.acceptedRows).toHaveLength(3);
  });

  it('rejected bars never become the jump baseline for their successor', () => {
    // A negative bar then a normal bar: the normal bar must be compared
    // to the last VALID close (1.0), not to the corrupt -0.0001.
    const rows = [
      bar(0, 1.0),
      { ...bar(1, -0.5), open: -0.5, high: -0.5, low: -0.5 },
      bar(2, 1.0005),
    ];
    const r = validateOhlcvRows(rows, FOREX_CTX);
    expect(r.rejects).toHaveLength(1);
    expect(r.suspects).toHaveLength(0);
    expect(r.acceptedRows).toHaveLength(2);
  });
});

describe('TICKET_1126 F2 validateOhlcvRows -- legitimate events pass', () => {
  it('passes a one-sided ~18% flash move with no revert (EURCHF depeg shape)', () => {
    const rows = [bar(0, 1.2010), bar(1, 0.985), bar(2, 0.988), bar(3, 0.990)];
    const r = validateOhlcvRows(rows, FOREX_CTX);
    expect(r.rejects).toHaveLength(0);
    expect(r.suspects).toHaveLength(0); // 18% < forex 20% threshold
    expect(r.acceptedRows).toHaveLength(4);
  });

  it('keeps a one-sided 25% persistent move as a SUSPECT (flag, never drop)', () => {
    const rows = [bar(0, 1.0), bar(1, 1.25), bar(2, 1.26), bar(3, 1.24)];
    const r = validateOhlcvRows(rows, FOREX_CTX);
    expect(r.rejects).toHaveLength(0);
    expect(r.suspects).toHaveLength(1);
    expect(r.suspects[0].rule).toBe('interbar_jump_suspect');
    expect(r.acceptedRows).toHaveLength(4); // suspect KEPT
  });

  it('passes a weekend-gap reopen bar (gap-aware jump exemption)', () => {
    const weekend = 2 * 24 * 3600;
    const rows = [
      bar(0, 1.0),
      bar(1, 1.001),
      // Reopen after a weekend gap with a 30% reprice: legitimate.
      bar(2, 1.30, { tsOffset: weekend }),
      bar(3, 1.301, { tsOffset: weekend }),
    ];
    const r = validateOhlcvRows(rows, FOREX_CTX);
    expect(r.rejects).toHaveLength(0);
    expect(r.suspects).toHaveLength(0);
    expect(r.acceptedRows).toHaveLength(4);
  });
});

describe('TICKET_1126 F2 validateOhlcvRows -- asset-class scale semantics', () => {
  it('forex: a 5x reprice across a sparse-series gap is STILL rejected (wide scale window)', () => {
    // 2h gap on a 5m series (>> 3x interval): the jump gate is exempt but
    // the scale-shift baseline must survive -- this exact blind spot let
    // the UDXUSD foreign-instrument block enter unflagged.
    const rows = [
      bar(0, 89.1),
      bar(1, 10_353, { tsOffset: 2 * 3600 }),
      bar(2, 10_360, { tsOffset: 2 * 3600 }),
    ];
    const r = validateOhlcvRows(rows, FOREX_CTX);
    expect(r.rejects.map((v) => v.rule)).toEqual(['scale_shift', 'scale_shift']);
    expect(r.acceptedRows.map((x) => x.close)).toEqual([89.1]);
  });

  it('equity: an unadjusted split boundary (7x drop) is a SUSPECT, kept as the new baseline', () => {
    const rows = [
      bar(0, 700),
      bar(1, 100), // 7:1 split, unadjusted data -- legitimate
      bar(2, 101),
    ];
    const r = validateOhlcvRows(rows, { ...FOREX_CTX, providerOrAssetClass: 'equity' });
    expect(r.rejects).toHaveLength(0);
    expect(r.suspects).toHaveLength(1);
    expect(r.suspects[0].rule).toBe('scale_shift');
    // Post-split bars are measured against the NEW baseline -- no cascade.
    expect(r.acceptedRows.map((x) => x.close)).toEqual([700, 100, 101]);
  });
});

describe('TICKET_1126 F2 validateOhlcvRows -- contamination blocks (last-valid baseline)', () => {
  it('rejects a whole cross-symbol contamination block and keeps the first real bar after it (AUDJPY shape)', () => {
    const rows = [
      bar(0, 0.674),
      bar(1, 0.6741),
      bar(2, 105.2), // foreign value (USDJPY leaked)
      bar(3, 106.1), // block interior agrees with its corrupt predecessor
      bar(4, 135.3), // another foreign value
      bar(5, 0.6742), // first real bar after the block
      bar(6, 0.6743),
    ];
    const r = validateOhlcvRows(rows, { ...FOREX_CTX, symbol: 'AUDJPY' });
    expect(r.rejects.map((v) => v.barTs)).toEqual([
      BASE_TS + 2 * FIVE_MIN,
      BASE_TS + 3 * FIVE_MIN,
      BASE_TS + 4 * FIVE_MIN,
    ]);
    // The post-block real bar is measured against the last VALID close
    // (0.6741), agrees, and is KEPT.
    expect(r.acceptedRows.map((x) => x.close)).toEqual([0.674, 0.6741, 0.6742, 0.6743]);
  });
});

describe('TICKET_1126 F2 SQL detector form (F4 audit sweep)', () => {
  async function scanWithDuckDb(rows: OHLCVRow[]): Promise<Array<{ ts: number; rule: string; severity: string }>> {
    const dir = mkdtempSync(join(tmpdir(), 'ohlc-1126-'));
    const parquetPath = join(dir, 'probe.parquet');
    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();
    try {
      const values = rows
        .map((r) => `(${r.timestamp}, ${r.open}, ${r.high}, ${r.low}, ${r.close}, ${r.volume})`)
        .join(', ');
      await conn.run(
        `COPY (SELECT * FROM (VALUES ${values}) ` +
          `AS t(timestamp, open, high, low, close, volume)) ` +
          `TO '${parquetPath}' (FORMAT parquet)`,
      );
      const scanSql = buildOhlcvViolationScanSql(`read_parquet('${parquetPath}')`, {
        intervalSeconds: FIVE_MIN,
        providerOrAssetClass: 'forex',
      });
      const reader = await conn.runAndReadAll(scanSql);
      return reader.getRowObjectsJS().map((r) => ({
        ts: Number(r.timestamp),
        rule: String(r.rule),
        severity: String(r.severity),
      }));
    } finally {
      conn.closeSync();
      instance.closeSync();
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('flags a SUPERSET of the TS rejects (detector may over-flag spike successors, never under-flag)', async () => {
    const rows = [
      bar(0, 0.8485),
      bar(1, 1965.0001), // scale shift
      bar(2, 0.8486),
      bar(3, 0.8487),
      { ...bar(4, -0.0001), open: -0.0001, high: -0.0001, low: -0.0001 }, // negative
      bar(5, 0.8488),
    ];
    const tsResult = validateOhlcvRows(rows, FOREX_CTX);
    const sqlResult = await scanWithDuckDb(rows);

    const sqlFlaggedTs = new Set(sqlResult.map((v) => v.ts));
    for (const v of tsResult.rejects) {
      expect(sqlFlaggedTs.has(v.barTs)).toBe(true);
    }
    expect(tsResult.rejects.length).toBeGreaterThan(0);
  });

  it('returns ZERO rows on a clean store (AC1 certification predicate)', async () => {
    const weekend = 2 * 24 * 3600;
    const rows = [
      bar(0, 1.0),
      bar(1, 1.0005),
      bar(2, 0.999),
      bar(3, 1.15, { tsOffset: weekend }), // gap reopen: exempt
      bar(4, 1.151, { tsOffset: weekend }),
    ];
    const tsResult = validateOhlcvRows(rows, FOREX_CTX);
    const sqlResult = await scanWithDuckDb(rows);
    expect(tsResult.rejects).toHaveLength(0);
    expect(tsResult.suspects).toHaveLength(0);
    expect(sqlResult).toHaveLength(0);
  });
});
