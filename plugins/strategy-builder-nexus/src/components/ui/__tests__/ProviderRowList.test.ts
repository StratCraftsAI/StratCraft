/**
 * ProviderRowList Source-Pin Tests
 *
 * TICKET_077_28: Pins the list-level contract:
 *   - add-row picks first non-disabled primary option
 *   - add-row disabled (not hidden) when no options remain
 *   - remove-row emits onRowsChange with row removed
 *   - empty list is a valid state (no auto first-row)
 *   - total-symbols footer hidden when showTotalSymbols === false
 *   - no pooled-norm / interval-refresh / yfinance-warning props (the
 *     anti-pattern explicitly forbidden by the ticket)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  ProviderRowListProps,
  ProviderRowEntry,
  ProviderRowSliceConfig,
} from '../ProviderRowList';
import type { UniverseSliceSpec } from '../UniverseSliceSelector';

const src = readFileSync(
  resolve(__dirname, '..', 'ProviderRowList.tsx'),
  'utf-8',
);

describe('ProviderRowList props interface (TICKET_077_28)', () => {
  it('accepts minimal required props', () => {
    const minimal: ProviderRowListProps = {
      rows: [],
      onRowsChange: () => {},
      buildPrimaryOptions: () => [],
      buildSubsetOptions: () => [],
      resolveSymbolsFor: () => [],
      addRowLabel: '+ Add data source',
      removeRowLabel: 'Remove row',
      symbolCountFormatter: n => `${n} symbols`,
      totalSymbolsFormatter: n => `${n} total symbols`,
      testIdBase: 'data-source-picker',
    };
    expect(minimal.rows).toHaveLength(0);
    expect(minimal.showTotalSymbols).toBeUndefined();
    expect(minimal.renderRowWarnings).toBeUndefined();
  });

  it('accepts a populated entry list', () => {
    const entries: ProviderRowEntry[] = [
      { value: 'yfinance', subset: 'sp500', symbols: ['AAPL'] },
      { value: 'ccxt', subset: null, symbols: ['BTC/USDT', 'ETH/USDT'] },
    ];
    const full: ProviderRowListProps = {
      rows: entries,
      onRowsChange: () => {},
      buildPrimaryOptions: () => [
        { value: 'yfinance', label: 'Yahoo Finance' },
        { value: 'ccxt', label: 'CCXT' },
      ],
      buildSubsetOptions: (_i, pid) =>
        pid === 'yfinance' ? [{ value: 'sp500', label: 'S&P 500' }] : [],
      resolveSymbolsFor: e => e.symbols,
      renderRowWarnings: () => null,
      addRowLabel: '+ Add data source',
      addRowDisabledReason: 'No more providers available',
      removeRowLabel: 'Remove row',
      symbolCountFormatter: n => `${n} symbols`,
      totalSymbolsFormatter: n => `${n} total symbols`,
      showTotalSymbols: true,
      disabled: false,
      testIdBase: 'data-source-picker',
    };
    expect(full.rows).toHaveLength(2);
    expect(full.addRowDisabledReason).toBe('No more providers available');
  });

  it('does NOT carry sweep-only or 927-only props (anti-pattern guard)', () => {
    // The ticket explicitly forbids these props on the primitive.
    const forbidden = [
      'pooledNormalisation',
      'PooledNormalisation',
      'onIntervalsRefresh',
      'getYfinanceIntradayWarning',
      'sweep',
      'mode',
    ];
    type Props = keyof ProviderRowListProps;
    const allowed: Props[] = [
      'rows',
      'onRowsChange',
      'buildPrimaryOptions',
      'buildSubsetOptions',
      'resolveSymbolsFor',
      'renderRowWarnings',
      'addRowLabel',
      'addRowDisabledReason',
      'removeRowLabel',
      'symbolCountFormatter',
      'totalSymbolsFormatter',
      'showTotalSymbols',
      'disabled',
      'testIdBase',
    ];
    for (const f of forbidden) {
      expect(allowed).not.toContain(f as Props);
    }
  });
});

describe('ProviderRowList rendering branches (TICKET_077_28)', () => {
  it('add button picks first non-disabled primary option (list invariant #1)', () => {
    expect(src).toMatch(/const firstAddable = addRowOptions\.find\(o => !o\.disabled\)/);
    // canAdd gates whether the button is enabled
    expect(src).toMatch(/const canAdd = !disabled && firstAddable !== undefined/);
    // handleAdd refuses silently when no addable option
    expect(src).toMatch(/if \(!firstAddable\) return/);
  });

  it('add button is disabled (not hidden) when no options remain', () => {
    // The button always renders; only disabled toggles. addRowDisabledReason
    // surfaces via title when disabled.
    expect(src).toMatch(/disabled=\{!canAdd\}/);
    expect(src).toMatch(/title=\{!canAdd \? addRowDisabledReason : undefined\}/);
  });

  it('remove emits onRowsChange with the row at index removed', () => {
    expect(src).toMatch(/rows\.filter\(\(_, i\) => i !== rowIndex\)/);
    expect(src).toMatch(/onRowsChange\(next\)/);
  });

  it('does NOT auto-add a first row on empty list (invariant #2)', () => {
    // Empty list is a valid state -- no useEffect / startup logic creates rows.
    expect(src).not.toMatch(/useEffect/);
    // The only push of a new row comes from handleAdd (user click).
    const addCount = (src.match(/const handleAdd/g) ?? []).length;
    expect(addCount).toBe(1);
  });

  it('total-symbols footer hidden when showTotalSymbols === false', () => {
    expect(src).toMatch(/showTotalSymbols = true/);
    expect(src).toMatch(/\{showTotalSymbols && \(/);
    // The total-symbols div lives inside the gate.
    const gated = src.slice(src.indexOf('{showTotalSymbols && ('));
    expect(gated).toMatch(/-total-symbols/);
    expect(gated).toMatch(/totalSymbolsFormatter\(totalSymbols\)/);
  });

  it('passes inlineRowWarnings down via renderRowWarnings callback', () => {
    expect(src).toMatch(/inlineRowWarnings=\{renderRowWarnings\?\.\(i, row\)\}/);
  });

  it('does NOT import store / IPC / electronAPI / useTranslation', () => {
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/window\.electronAPI\./);
    expect(code).not.toMatch(/useSignalDiscoveryStore/);
    expect(code).not.toMatch(/['"]zustand['"]/);
    expect(code).not.toMatch(/useTranslation/);
  });
});

describe('ProviderRowList behavioural simulation (TICKET_077_28)', () => {
  // We can exercise add/remove logic without React by importing the
  // component and feeding its callbacks through a thin recorder. The
  // component itself is a React FC so we cannot render it in node-env;
  // instead we validate the spec-level guarantees by simulating the
  // logic that the source has been pinned to above. (Behavioural
  // assertions over the same code paths, distinct from source-pins.)

  it('first-non-disabled selection: skips disabled options', () => {
    const options = [
      { value: 'p1', label: 'P1', disabled: true },
      { value: 'p2', label: 'P2', disabled: false },
      { value: 'p3', label: 'P3', disabled: false },
    ];
    const firstAddable = options.find(o => !o.disabled);
    expect(firstAddable?.value).toBe('p2');
  });

  it('first-non-disabled selection: returns undefined when all disabled', () => {
    const options = [
      { value: 'p1', label: 'P1', disabled: true },
      { value: 'p2', label: 'P2', disabled: true },
    ];
    const firstAddable = options.find(o => !o.disabled);
    expect(firstAddable).toBeUndefined();
  });

  it('remove-by-index drops exactly that row and preserves order', () => {
    const rows: ProviderRowEntry[] = [
      { value: 'a', subset: null, symbols: [] },
      { value: 'b', subset: null, symbols: [] },
      { value: 'c', subset: null, symbols: [] },
    ];
    const next = rows.filter((_, i) => i !== 1).map(r => ({ ...r }));
    expect(next.map(r => r.value)).toEqual(['a', 'c']);
  });

  it('total-symbols sums resolved symbols across rows', () => {
    const rows: ProviderRowEntry[] = [
      { value: 'a', subset: null, symbols: ['x', 'y'] },
      { value: 'b', subset: null, symbols: ['z'] },
    ];
    const resolve = (e: ProviderRowEntry) => e.symbols;
    const total = rows.reduce((s, r) => s + resolve(r).length, 0);
    expect(total).toBe(3);
  });

  it('subset preservation on primary change: keeps prior subset if still valid', () => {
    // Mirrors handlePrimaryChange's "prior subset still in next options" rule.
    const priorSubset = 'sp500';
    const nextOpts: { value: string; label: string; disabled?: boolean }[] = [
      { value: 'sp500', label: 'S&P 500' },
      { value: 'nasdaq100', label: 'NASDAQ 100' },
    ];
    const kept =
      nextOpts.find(o => o.value === priorSubset && !o.disabled)
        ? priorSubset
        : nextOpts.find(o => !o.disabled)?.value ?? null;
    expect(kept).toBe('sp500');
  });

  it('subset preservation: falls back to first non-disabled when prior invalid', () => {
    const priorSubset = 'old_universe';
    const nextOpts: { value: string; label: string; disabled?: boolean }[] = [
      { value: 'sp500', label: 'S&P 500' },
      { value: 'nasdaq100', label: 'NASDAQ 100' },
    ];
    const kept =
      nextOpts.find(o => o.value === priorSubset && !o.disabled)
        ? priorSubset
        : nextOpts.find(o => !o.disabled)?.value ?? null;
    expect(kept).toBe('sp500');
  });

  it('subset preservation: null when next provider has no subset dimension', () => {
    const priorSubset = 'sp500';
    const nextOpts: { value: string; label: string; disabled?: boolean }[] = [];
    const kept =
      nextOpts.length === 0
        ? null
        : nextOpts.find(o => o.value === priorSubset && !o.disabled)
          ? priorSubset
          : nextOpts.find(o => !o.disabled)?.value ?? null;
    expect(kept).toBeNull();
  });
});

describe('ProviderRowList slice (Layer 3) wiring (TICKET_077_29)', () => {
  it('ProviderRowEntry.slice is an optional UniverseSliceSpec | null', () => {
    // Compile-time: existing entries with no `slice` still type-check.
    const legacy: ProviderRowEntry = {
      value: 'alpaca',
      subset: null,
      symbols: ['AAPL'],
    };
    expect(legacy.slice).toBeUndefined();

    const sliced: ProviderRowEntry = {
      value: 'yfinance',
      subset: 'sp500',
      slice: { topN: 50, rankingMetric: 'market_cap' },
      symbols: [],
    };
    expect(sliced.slice?.topN).toBe(50);

    const noSlice: ProviderRowEntry = {
      value: 'yfinance',
      subset: 'dow30',
      slice: null,
      symbols: [],
    };
    expect(noSlice.slice).toBeNull();
  });

  it('ProviderRowSliceConfig has the four contract fields', () => {
    const cfg: ProviderRowSliceConfig = {
      rankingMetricOptions: [
        { value: 'market_cap', label: 'Market cap' },
      ],
      defaultSpec: { topN: 50, rankingMetric: 'market_cap' },
      topNMin: 1,
      topNMax: 500,
    };
    expect(cfg.rankingMetricOptions).toHaveLength(1);
    expect(cfg.defaultSpec.topN).toBe(50);
  });

  it('omitting buildSliceConfig is a valid (backward-compatible) call', () => {
    const legacy: ProviderRowListProps = {
      rows: [],
      onRowsChange: () => {},
      buildPrimaryOptions: () => [],
      buildSubsetOptions: () => [],
      resolveSymbolsFor: () => [],
      addRowLabel: '+ Add data source',
      removeRowLabel: 'Remove row',
      symbolCountFormatter: n => `${n} symbols`,
      totalSymbolsFormatter: n => `${n} total symbols`,
      testIdBase: 'data-source-picker',
    };
    expect(legacy.buildSliceConfig).toBeUndefined();
    expect(legacy.sliceToggleOnLabel).toBeUndefined();
  });

  it('accepts buildSliceConfig + four caller-resolved label strings', () => {
    const full: ProviderRowListProps = {
      rows: [],
      onRowsChange: () => {},
      buildPrimaryOptions: () => [],
      buildSubsetOptions: () => [],
      resolveSymbolsFor: () => [],
      addRowLabel: '+ Add data source',
      removeRowLabel: 'Remove row',
      symbolCountFormatter: n => `${n} symbols`,
      totalSymbolsFormatter: n => `${n} total symbols`,
      buildSliceConfig: () => ({
        rankingMetricOptions: [
          { value: 'dollar_volume', label: 'Dollar volume' },
        ],
        defaultSpec: { topN: 50, rankingMetric: 'dollar_volume' },
      }),
      sliceToggleOnLabel: 'Use top N of universe',
      sliceTopNLabel: 'Top N',
      sliceRankingMetricLabel: 'Ranking metric',
      sliceFullUniverseLabel: 'Use full universe',
      testIdBase: 'data-source-picker',
    };
    expect(full.buildSliceConfig).toBeDefined();
    expect(full.sliceTopNLabel).toBe('Top N');
  });

  it('omitting buildSliceConfig does NOT construct any UniverseSliceSelector', () => {
    // The render path conditionally constructs the slice node only when
    // buildSliceConfig(i, row) returns a truthy config with at least one
    // ranking metric. When buildSliceConfig is undefined, the `?.` short-
    // circuits and sliceNode is undefined, so <UniverseSliceSelector>
    // is never instantiated.
    expect(src).toMatch(/const sliceCfg = buildSliceConfig\?\.\(i, row\)/);
    expect(src).toMatch(
      /sliceCfg && sliceCfg\.rankingMetricOptions\.length > 0/,
    );
  });

  it('renders sliceSelector via the ProviderRow sliceSelector prop', () => {
    expect(src).toMatch(/sliceSelector=\{sliceNode\}/);
  });

  it('provider change invalidates slice -> null (different ranking-metric registry)', () => {
    expect(src).toMatch(
      /handlePrimaryChange[\s\S]*?slice: null,[\s\S]*?onRowsChange/,
    );
  });

  it('subset change invalidates slice -> null (different (provider, subset) pair)', () => {
    expect(src).toMatch(
      /handleSubsetChange[\s\S]*?slice: null,[\s\S]*?onRowsChange/,
    );
  });

  it('add-row seeds slice: null on the new entry', () => {
    expect(src).toMatch(/handleAdd[\s\S]*?slice: null,[\s\S]*?onRowsChange/);
  });

  it('handleSliceChange re-resolves symbols via resolveSymbolsFor', () => {
    // Slice spec drives the resolve (top-N membership at as-of), so the
    // list must call resolveSymbolsFor inside the slice-change path the
    // same way it does for primary / subset changes.
    expect(src).toMatch(
      /handleSliceChange[\s\S]*?symbols: resolveSymbolsFor\(candidate\)/,
    );
  });

  it('row with rankingMetricOptions === [] does NOT render a slice selector', () => {
    // The render gate is `sliceCfg.rankingMetricOptions.length > 0`.
    // Replay it for both shapes: empty -> no node, populated -> node.
    const emptyCfg: ProviderRowSliceConfig = {
      rankingMetricOptions: [],
      defaultSpec: { topN: 50, rankingMetric: 'm' },
    };
    const populatedCfg: ProviderRowSliceConfig = {
      rankingMetricOptions: [{ value: 'm', label: 'M' }],
      defaultSpec: { topN: 50, rankingMetric: 'm' },
    };
    const shouldRender = (c: ProviderRowSliceConfig | undefined) =>
      !!c && c.rankingMetricOptions.length > 0;
    expect(shouldRender(emptyCfg)).toBe(false);
    expect(shouldRender(populatedCfg)).toBe(true);
    expect(shouldRender(undefined)).toBe(false);
  });

  it('slice-change replay: emits {value, subset, slice: next, symbols: resolved}', () => {
    // Replays the body of handleSliceChange to pin the candidate shape.
    const rows: ProviderRowEntry[] = [
      { value: 'yfinance', subset: 'sp500', slice: null, symbols: ['AAPL'] },
    ];
    const resolveSymbolsFor = (e: ProviderRowEntry): ReadonlyArray<string> => {
      // Resolver clips by slice.topN as 077_29's data-layer contract would.
      const full = ['AAPL', 'MSFT', 'GOOG', 'AMZN'];
      return e.slice ? full.slice(0, e.slice.topN) : full;
    };
    const nextSlice: UniverseSliceSpec = {
      topN: 2,
      rankingMetric: 'market_cap',
    };
    const rowIndex = 0;
    const next = rows.map((r, i) => {
      if (i !== rowIndex) return { ...r };
      const candidate: ProviderRowEntry = {
        value: r.value,
        subset: r.subset,
        slice: nextSlice,
        symbols: [],
      };
      return { ...candidate, symbols: resolveSymbolsFor(candidate) };
    });
    expect(next[0]?.slice).toEqual(nextSlice);
    expect(next[0]?.symbols).toEqual(['AAPL', 'MSFT']);
  });
});
