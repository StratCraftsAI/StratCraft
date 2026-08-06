/**
 * TICKET_849 Phase D3 -- pull-window arithmetic tests.
 *
 * `pullBarsToCalendarMs` reads each provider's self-declared
 * `capabilities.calendarPaddingRatio`. These tests pin the contract:
 *   - equity 1h timeframe -> 5.35x inflation (intraday * daily:
 *     (24/6.5) * (365/252) = 8760/1638 ~= 5.35)
 *   - daily timeframe -> 1.45x inflation (365/252 ~= 1.45)
 *   - crypto / FX (omitted ratio) -> 1.0x
 *   - unknown timeframe / negative bars -> throw
 *   - unregistered provider (imported package) -> ratio 1.0
 *
 * The provider manager singleton is reset per test so each spec
 * registers exactly the providers it cares about.
 */

import path from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// `provider-manager` -> `yfinance-provider` -> `../../utils/logger`
// reads `app.isPackaged` at module load. Mock electron before the
// imports so the test runs under vitest without an Electron runtime.
vi.mock('electron', () => ({
  app: {
    getAppPath: () => path.join(__dirname, '..', '..', '..', '..'),
    getLocale: () => 'en-US',
    isPackaged: false,
  },
}));

import {
  pullBarsToCalendarMs,
  pullBarsToCalendarMsDefault,
  pullBarsToCalendarMsRequest,
  pullBarsToCalendarMsRequestDefault,
  checkProviderMaxLookback,
} from '../pull-window';
import { PULL_WINDOW_SAFETY_MARGIN } from '../../../../shared/constants/data-cache-integrity';
import { DataProviderManager } from '../provider-manager';
import type { IDataProvider } from '../types';
import { asTrainingBars } from '@StratCraft/types';

// Each test installs a fresh DataProviderManager by re-mocking
// `getDataProviderManager()`. The mock factory below reads from
// `currentManager`, which `withManager` swaps in per spec. Mocking the
// accessor (instead of the module-scope `instance` let, which is not
// reassignable from outside) is the only seam vitest gives us.
let currentManager: DataProviderManager = new DataProviderManager();
vi.mock('../provider-manager', async (importOriginal) => {
  const original = await importOriginal<typeof import('../provider-manager')>();
  return {
    ...original,
    getDataProviderManager: () => currentManager,
  };
});

// TICKET_919_9: pull-window now lazy-requires data-cache-manager so it
// can fork the imported-package branch. The test stub below lets each
// spec install or omit a package; `setImportedPackage(null)` is the
// "no BYOD package present" default (matching the registered-provider
// path).
let currentImportedPackage: {
  packageName: string;
  adjustMode: 'none';
  sourceDialect: 'duckdb';
  createdAt: number;
  calendarPaddingRatio: Readonly<Record<string, number>>;
} | null = null;
vi.mock('../../data-cache-manager', () => ({
  getDataCacheManager: () => ({
    getImportedPackage: (id: string) =>
      currentImportedPackage && currentImportedPackage.packageName === id
        ? currentImportedPackage
        : null,
  }),
}));

function setImportedPackage(pkg: {
  packageName: string;
  calendarPaddingRatio: Readonly<Record<string, number>>;
} | null): void {
  currentImportedPackage = pkg
    ? {
        packageName: pkg.packageName,
        adjustMode: 'none',
        sourceDialect: 'duckdb',
        createdAt: 0,
        calendarPaddingRatio: pkg.calendarPaddingRatio,
      }
    : null;
}

function withManager(register: (m: DataProviderManager) => void): DataProviderManager {
  const m = new DataProviderManager();
  register(m);
  currentManager = m;
  return m;
}

function stubProvider(
  id: string,
  ratio?: Readonly<Record<string, number>>,
  maxLookback?: Record<string, string>,
): IDataProvider {
  return {
    id,
    name: `Stub ${id}`,
    capabilities: {
      assetTypes: ['stock'],
      // TICKET_196_12 Step 1: stub serves all its intervals natively
      nativeIntervals: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'],
      intervals: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'],
      requiresAuth: false,
      supportsSearch: false,
      // TICKET_958_4: test stub; tradingCalendar is a required capability
      // field, but the day-set invariant is not under test here. NONE
      // short-circuits the invariant exactly like an imported-package
      // provider.
      tradingCalendar: 'NONE',
      cacheSchema: 'OHLCV_V1_CANONICAL',
      ...(ratio ? { calendarPaddingRatio: ratio } : {}),
      ...(maxLookback ? { maxLookback } : {}),
    },
    // TICKET_927_2_2: any IDataProvider implementor declares >=1 MarketId.
    supportedMarkets: ['yfinance_us_equity'],
    queryOHLCV: async () => [],
    searchSymbols: async () => ({ results: [], totalCount: 0, truncated: false }),
    checkConnection: async () => ({ connected: true }),
  };
}

beforeEach(() => {
  // Reset between specs by re-registering inside each test.
  setImportedPackage(null);
});

describe('TICKET_849 Phase D3 -- pullBarsToCalendarMs', () => {
  it('equity 1h with ratio 5.35 -> 5.35x raw bar-time', () => {
    withManager((m) =>
      m.register(stubProvider('yfinance', { '1h': 5.35, '1d': 1.45 })),
    );
    const ms = pullBarsToCalendarMs(asTrainingBars(100), '1h', 'yfinance');
    // 100 bars * 3600s * 1000ms * 5.35 = 1,926,000,000
    expect(ms).toBe(Math.ceil(100 * 3600 * 1000 * 5.35));
  });

  it('equity 1d with ratio 1.45 -> 1.45x raw bar-time', () => {
    withManager((m) =>
      m.register(stubProvider('yfinance', { '1h': 5.35, '1d': 1.45 })),
    );
    const ms = pullBarsToCalendarMs(asTrainingBars(252), '1d', 'yfinance');
    // 252 * 86400 * 1000 * 1.45 = 31,449,600,000
    expect(ms).toBe(Math.ceil(252 * 86400 * 1000 * 1.45));
  });

  it('crypto provider with omitted ratio -> 1.0x default', () => {
    withManager((m) => m.register(stubProvider('ccxt')));
    const ms = pullBarsToCalendarMs(asTrainingBars(100), '1h', 'ccxt');
    // 100 * 3600 * 1000 * 1.0 = 360,000,000
    expect(ms).toBe(360_000_000);
  });

  it('FX provider with empty ratio table -> 1.0x default per missing key', () => {
    withManager((m) => m.register(stubProvider('dukascopy', {})));
    const ms = pullBarsToCalendarMs(asTrainingBars(50), '1h', 'dukascopy');
    expect(ms).toBe(50 * 3600 * 1000); // ratio 1.0
  });

  it('Run #51 fixture: HMM-sized 907 bars at 1h equity -> 907 * 3600s * 1000ms * 5.35 ~= 202 calendar days', () => {
    // 907 required bars * ratio=5.35 -> ~202 calendar days -> startDate ~= 2025-11-xx,
    // giving ~907 US equity 1h bars in the window (enough to clear the HMM floor).
    withManager((m) =>
      m.register(stubProvider('alpaca', { '1h': 5.35, '1d': 1.45 })),
    );
    const ms = pullBarsToCalendarMs(asTrainingBars(907), '1h', 'alpaca');
    expect(ms).toBe(Math.ceil(907 * 3600 * 1000 * 5.35));
    // Sanity: ~202 calendar days
    expect(ms / (86_400 * 1000)).toBeCloseTo(202, 0);
  });

  it('throws on unknown timeframe', () => {
    withManager((m) => m.register(stubProvider('yfinance')));
    expect(() =>
      pullBarsToCalendarMs(asTrainingBars(10), '2h', 'yfinance'),
    ).toThrow(/unknown timeframe '2h'/);
  });

  it('throws on negative bars', () => {
    withManager((m) => m.register(stubProvider('yfinance')));
    expect(() =>
      pullBarsToCalendarMs(-5 as unknown as ReturnType<typeof asTrainingBars>, '1h', 'yfinance'),
    ).toThrow(/bars must be a non-negative finite number/);
  });

  it('throws on non-finite bars', () => {
    withManager((m) => m.register(stubProvider('yfinance')));
    expect(() =>
      pullBarsToCalendarMs(NaN as unknown as ReturnType<typeof asTrainingBars>, '1h', 'yfinance'),
    ).toThrow(/bars must be a non-negative finite number/);
  });

  it('truly-unknown providerId (not registered, not an imported package) falls back to ratio 1.0', () => {
    // Pre-TICKET_919_9 this case was "imported packages too"; now imported
    // packages take the dedicated branch. This spec pins the residual
    // unknown-id behaviour (test harness, fake providers).
    withManager((m) => m.register(stubProvider('yfinance')));
    const ms = pullBarsToCalendarMs(asTrainingBars(10), '1h', 'unknown-fake');
    expect(ms).toBe(10 * 3600 * 1000);
  });
});

// =============================================================================
// TICKET_919_9 -- imported-package branch.
// =============================================================================
describe('TICKET_919_9 -- pullBarsToCalendarMs imported-package branch', () => {
  it('reads self-declared ratio from the package catalog row (forex 24/5 ~ 1.4 on 30m)', () => {
    withManager((m) => m.register(stubProvider('yfinance', { '1h': 5.35 })));
    setImportedPackage({
      packageName: 'forex',
      calendarPaddingRatio: { '30m': 1.4 },
    });
    const ms = pullBarsToCalendarMs(asTrainingBars(1402), '30m', 'forex');
    // 1402 * 1800s * 1000ms * 1.4 = 3,533,040,000 ~= 40.9 calendar days
    expect(ms).toBe(Math.ceil(1402 * 1800 * 1000 * 1.4));
    expect(ms / (86_400 * 1000)).toBeCloseTo(40.9, 1);
  });

  it('throws with a re-import message when the package has no ratio for the requested timeframe', () => {
    setImportedPackage({
      packageName: 'forex',
      calendarPaddingRatio: { '1d': 1.4 }, // only daily ratio known
    });
    expect(() =>
      pullBarsToCalendarMs(asTrainingBars(1402), '30m', 'forex'),
    ).toThrow(/imported package 'forex' has no calendar_padding_ratio for timeframe '30m'/);
  });

  it('throws with a re-import message when the package ratio map is empty (backfill found no usable rows)', () => {
    setImportedPackage({
      packageName: 'forex',
      calendarPaddingRatio: {},
    });
    expect(() =>
      pullBarsToCalendarMs(asTrainingBars(100), '1h', 'forex'),
    ).toThrow(/Re-import the package/);
  });

  it('imported-package branch takes precedence over a same-id registered provider (defensive)', () => {
    // If a registered provider id ever collided with an imported package
    // name, the imported-package row (the data-stream-owning fact)
    // wins. This pins the order of the checks in pull-window.ts.
    withManager((m) => m.register(stubProvider('forex', { '30m': 99.0 })));
    setImportedPackage({
      packageName: 'forex',
      calendarPaddingRatio: { '30m': 1.4 },
    });
    const ms = pullBarsToCalendarMs(asTrainingBars(100), '30m', 'forex');
    expect(ms).toBe(Math.ceil(100 * 1800 * 1000 * 1.4));
  });
});

describe('TICKET_849 Phase D3 -- pullBarsToCalendarMsDefault', () => {
  it('uses the first registered provider as the default', () => {
    withManager((m) => {
      m.register(stubProvider('yfinance', { '1h': 5.35 }));
      m.register(stubProvider('ccxt'));
    });
    const ms = pullBarsToCalendarMsDefault(asTrainingBars(100), '1h');
    // Default = yfinance (first registered) -> 5.35x
    expect(ms).toBe(Math.ceil(100 * 3600 * 1000 * 5.35));
  });

  it('throws when no providers are registered', () => {
    withManager(() => {
      // Intentionally register nothing
    });
    expect(() =>
      pullBarsToCalendarMsDefault(asTrainingBars(10), '1h'),
    ).toThrow('providers.noneRegistered');
  });
});

describe('TICKET_955 -- checkProviderMaxLookback', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('returns null when window is within provider limit', () => {
    withManager((m) =>
      m.register(stubProvider('yfinance', undefined, {
        '1m': '7d', '5m': '60d', '15m': '60d', '1h': '730d',
      })),
    );
    expect(checkProviderMaxLookback('yfinance', '5m', 50 * DAY_MS)).toBeNull();
  });

  it('returns violation when window exceeds provider limit', () => {
    withManager((m) =>
      m.register(stubProvider('yfinance', undefined, {
        '1m': '7d', '5m': '60d', '15m': '60d', '1h': '730d',
      })),
    );
    const result = checkProviderMaxLookback('yfinance', '15m', 78 * DAY_MS);
    expect(result).not.toBeNull();
    expect(result!.maxLookbackSpec).toBe('60d');
    expect(result!.maxDays).toBe(60);
    expect(result!.requestedDays).toBe(78);
  });

  it('returns null for timeframes with no maxLookback entry (1d)', () => {
    withManager((m) =>
      m.register(stubProvider('yfinance', undefined, {
        '1m': '7d', '5m': '60d',
      })),
    );
    expect(checkProviderMaxLookback('yfinance', '1d', 365 * DAY_MS)).toBeNull();
  });

  it('returns null for providers without maxLookback declared', () => {
    withManager((m) => m.register(stubProvider('ccxt')));
    expect(checkProviderMaxLookback('ccxt', '1m', 90 * DAY_MS)).toBeNull();
  });

  it('returns null for unregistered providers', () => {
    withManager(() => {});
    expect(checkProviderMaxLookback('unknown', '1m', 90 * DAY_MS)).toBeNull();
  });

  it('returns null at exact boundary (60d window vs 60d limit)', () => {
    withManager((m) =>
      m.register(stubProvider('yfinance', undefined, { '5m': '60d' })),
    );
    expect(checkProviderMaxLookback('yfinance', '5m', 60 * DAY_MS)).toBeNull();
  });

  it('returns violation at 1 ms over boundary', () => {
    withManager((m) =>
      m.register(stubProvider('yfinance', undefined, { '5m': '60d' })),
    );
    const result = checkProviderMaxLookback('yfinance', '5m', 60 * DAY_MS + 1);
    expect(result).not.toBeNull();
    expect(result!.maxDays).toBe(60);
    expect(result!.requestedDays).toBe(61);
  });

  it('handles 1m with 7d limit correctly', () => {
    withManager((m) =>
      m.register(stubProvider('yfinance', undefined, { '1m': '7d' })),
    );
    expect(checkProviderMaxLookback('yfinance', '1m', 6 * DAY_MS)).toBeNull();
    const violation = checkProviderMaxLookback('yfinance', '1m', 10 * DAY_MS);
    expect(violation).not.toBeNull();
    expect(violation!.maxDays).toBe(7);
    expect(violation!.requestedDays).toBe(10);
  });
});

// =============================================================================
// TICKET_958_3 AC #A -- request-side safety margin.
// =============================================================================
describe('TICKET_958_3 AC #A -- pullBarsToCalendarMsRequest', () => {
  it('inflates the base window by PULL_WINDOW_SAFETY_MARGIN', () => {
    withManager((m) =>
      m.register(stubProvider('databento', { '5m': 5.35 })),
    );
    const base = pullBarsToCalendarMs(asTrainingBars(3017), '5m', 'databento');
    const withMargin = pullBarsToCalendarMsRequest(asTrainingBars(3017), '5m', 'databento');
    expect(withMargin).toBe(Math.ceil(base * (1 + PULL_WINDOW_SAFETY_MARGIN)));
    expect(withMargin).toBeGreaterThan(base);
  });

  it('live-evidence fixture: 3017 RTH bars at 5m equity, ratio 5.35, base ~56 days -> margin ~70 days', () => {
    // Pins the exact gap that triggered the 2026-06-14 09:58 UTC live
    // refusal in TICKET_958_3: base produced 2652 actual bars when the
    // gate demanded 3017; the request variant widens the window so the
    // gate's actual COUNT clears requiredPullBars.
    withManager((m) =>
      m.register(stubProvider('databento', { '5m': 5.35 })),
    );
    const baseMs = pullBarsToCalendarMs(asTrainingBars(3017), '5m', 'databento');
    const requestMs = pullBarsToCalendarMsRequest(asTrainingBars(3017), '5m', 'databento');
    const DAY = 86_400 * 1000;
    expect(baseMs / DAY).toBeCloseTo(56.04, 1);
    expect(requestMs / DAY).toBeCloseTo(56.04 * (1 + PULL_WINDOW_SAFETY_MARGIN), 1);
  });

  it('imported-package branch is also inflated by the request margin', () => {
    withManager((m) => m.register(stubProvider('yfinance', { '1h': 5.35 })));
    setImportedPackage({
      packageName: 'forex',
      calendarPaddingRatio: { '30m': 1.4 },
    });
    const base = pullBarsToCalendarMs(asTrainingBars(1402), '30m', 'forex');
    const requestMs = pullBarsToCalendarMsRequest(asTrainingBars(1402), '30m', 'forex');
    expect(requestMs).toBe(Math.ceil(base * (1 + PULL_WINDOW_SAFETY_MARGIN)));
  });

  it('propagates throw on unknown timeframe (defers to base)', () => {
    withManager((m) => m.register(stubProvider('yfinance')));
    expect(() =>
      pullBarsToCalendarMsRequest(asTrainingBars(10), '2h', 'yfinance'),
    ).toThrow(/unknown timeframe '2h'/);
  });

  it('propagates throw on negative bars (defers to base)', () => {
    withManager((m) => m.register(stubProvider('yfinance')));
    expect(() =>
      pullBarsToCalendarMsRequest(
        -5 as unknown as ReturnType<typeof asTrainingBars>,
        '1h',
        'yfinance',
      ),
    ).toThrow(/bars must be a non-negative finite number/);
  });
});

describe('TICKET_958_3 AC #A -- pullBarsToCalendarMsRequestDefault', () => {
  it('uses the first registered provider, with the safety margin applied', () => {
    withManager((m) => {
      m.register(stubProvider('yfinance', { '1h': 5.35 }));
      m.register(stubProvider('ccxt'));
    });
    const requestMs = pullBarsToCalendarMsRequestDefault(asTrainingBars(100), '1h');
    const baseMs = pullBarsToCalendarMsDefault(asTrainingBars(100), '1h');
    expect(requestMs).toBe(Math.ceil(baseMs * (1 + PULL_WINDOW_SAFETY_MARGIN)));
  });
});
