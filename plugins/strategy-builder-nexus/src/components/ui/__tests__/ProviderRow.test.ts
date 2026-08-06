/**
 * ProviderRow Source-Pin Tests
 *
 * TICKET_077_28: Pins the ProviderRow primitive contract:
 *   - subset select hidden when subsetOptions === []
 *   - symbol-count chip hidden when symbols === []
 *   - inline warnings render under the row, not inside it
 *   - stable testid suffixes (-primary-select, -subset-select,
 *     -symbol-count, -remove)
 *   - no IPC / store / window.electronAPI imports
 *
 * Project vitest runs in node env (no DOM), so we validate the prop
 * interface and pin the rendering branches in source -- same pattern as
 * ToggleSwitch / FloatingMonitor tests.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProviderRowProps } from '../ProviderRow';

const src = readFileSync(
  resolve(__dirname, '..', 'ProviderRow.tsx'),
  'utf-8',
);

describe('ProviderRow props interface (TICKET_077_28)', () => {
  it('accepts minimal required props (single-market shape)', () => {
    const minimal: ProviderRowProps = {
      value: 'alpaca',
      subset: null,
      primaryOptions: [{ value: 'alpaca', label: 'Alpaca' }],
      subsetOptions: [],
      symbols: [],
      onPrimaryChange: () => {},
      onSubsetChange: () => {},
      onRemove: () => {},
      removeRowLabel: 'Remove row',
      symbolCountFormatter: n => `${n} symbols`,
      testIdBase: 'data-source-picker-row-0',
    };
    expect(minimal.subset).toBeNull();
    expect(minimal.subsetOptions).toHaveLength(0);
    expect(minimal.inlineRowWarnings).toBeUndefined();
  });

  it('accepts multi-subset shape (yfinance / ibkr)', () => {
    const full: ProviderRowProps = {
      value: 'yfinance',
      subset: 'sp500',
      primaryOptions: [{ value: 'yfinance', label: 'Yahoo Finance' }],
      subsetOptions: [
        { value: 'sp500', label: 'S&P 500' },
        { value: 'nasdaq100', label: 'NASDAQ 100' },
      ],
      symbols: ['AAPL', 'MSFT', 'GOOG'],
      onPrimaryChange: () => {},
      onSubsetChange: () => {},
      onRemove: () => {},
      primaryPlaceholder: 'Select provider...',
      subsetPlaceholder: 'Select universe...',
      removeRowLabel: 'Remove row',
      symbolCountFormatter: n => `${n} symbols`,
      inlineRowWarnings: null,
      disabled: false,
      testIdBase: 'data-source-picker-row-0',
    };
    expect(full.subset).toBe('sp500');
    expect(full.subsetOptions).toHaveLength(2);
    expect(full.symbols).toHaveLength(3);
  });
});

describe('ProviderRow rendering branches (TICKET_077_28)', () => {
  it('hides the subset select when subsetOptions === [] (invariant #4)', () => {
    // hasSubset = subsetOptions.length > 0, gates the subset SelectDropdown
    expect(src).toMatch(/const hasSubset = subsetOptions\.length > 0/);
    expect(src).toMatch(/\{hasSubset && \(/);
    // The subset SelectDropdown lives inside the hasSubset branch
    const hasSubsetBlock = src.slice(src.indexOf('{hasSubset && ('));
    const subsetSelectIdx = hasSubsetBlock.indexOf('-subset-select');
    expect(subsetSelectIdx).toBeGreaterThan(0);
  });

  it('hides the symbol-count chip when symbols === [] (invariant #3)', () => {
    // symbolCount > 0 gate prevents flashing "0 symbols" during async resolve
    expect(src).toMatch(/const symbolCount = symbols\.length/);
    expect(src).toMatch(/\{symbolCount > 0 && \(/);
    // symbolCountFormatter is called only inside the gate
    const gated = src.slice(src.indexOf('{symbolCount > 0 && ('));
    expect(gated).toMatch(/symbolCountFormatter\(symbolCount\)/);
  });

  it('exposes the four stable testid suffixes', () => {
    expect(src).toMatch(/`\$\{testIdBase\}-primary-select`/);
    expect(src).toMatch(/`\$\{testIdBase\}-subset-select`/);
    expect(src).toMatch(/`\$\{testIdBase\}-symbol-count`/);
    expect(src).toMatch(/`\$\{testIdBase\}-remove`/);
  });

  it('renders inlineRowWarnings under the row, not inside it', () => {
    // The warnings block lives AFTER the main flex row (the row's
    // affordances close before the warnings open).
    const rowOpenIdx = src.indexOf('<div className="flex items-center gap-2">');
    const warningsIdx = src.indexOf('{inlineRowWarnings && (');
    expect(rowOpenIdx).toBeGreaterThan(0);
    expect(warningsIdx).toBeGreaterThan(rowOpenIdx);
  });

  it('does NOT import store / IPC / electronAPI (invariant #2)', () => {
    // Strip docstrings/comments so the prose phrase "no window.electronAPI"
    // doesn't trip these guards -- we care about real usage, not the prose.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/from\s+['"].*electronAPI/);
    expect(code).not.toMatch(/window\.electronAPI\./);
    expect(code).not.toMatch(/useSignalDiscoveryStore/);
    expect(code).not.toMatch(/['"]zustand['"]/);
    expect(code).not.toMatch(/useTranslation/);
  });

  it('does NOT render an Add row affordance (invariant #5)', () => {
    expect(src).not.toMatch(/add[-_]?row|addRow/i);
  });
});

describe('ProviderRow sliceSelector slot (TICKET_077_29)', () => {
  it('accepts an optional sliceSelector ReactNode prop', () => {
    const withSlice: ProviderRowProps = {
      value: 'yfinance',
      subset: 'sp500',
      primaryOptions: [{ value: 'yfinance', label: 'Yahoo Finance' }],
      subsetOptions: [{ value: 'sp500', label: 'S&P 500' }],
      symbols: ['AAPL'],
      onPrimaryChange: () => {},
      onSubsetChange: () => {},
      onRemove: () => {},
      removeRowLabel: 'Remove row',
      symbolCountFormatter: n => `${n} symbols`,
      sliceSelector: null,
      testIdBase: 'row-0',
    };
    expect(withSlice.sliceSelector).toBeNull();
  });

  it('renders sliceSelector inline between subset select and symbol-count chip', () => {
    const subsetIdx = src.indexOf('{hasSubset && (');
    const sliceIdx = src.indexOf('{sliceSelector}');
    const symbolCountIdx = src.indexOf('{symbolCount > 0 && (');
    expect(subsetIdx).toBeGreaterThan(0);
    expect(sliceIdx).toBeGreaterThan(subsetIdx);
    expect(symbolCountIdx).toBeGreaterThan(sliceIdx);
  });

  it('renders sliceSelector inside the main row flex, NOT in inlineRowWarnings', () => {
    // 077_28 keeps inlineRowWarnings text-only; the slice control is an
    // affordance and must live in the main row flex.
    const rowOpenIdx = src.indexOf('<div className="flex items-center gap-2">');
    const sliceIdx = src.indexOf('{sliceSelector}');
    const warningsIdx = src.indexOf('{inlineRowWarnings && (');
    expect(rowOpenIdx).toBeLessThan(sliceIdx);
    expect(sliceIdx).toBeLessThan(warningsIdx);
  });

  it('omitting sliceSelector preserves legacy 077_28 DOM (no extra wrapper)', () => {
    // The slot is rendered directly via {sliceSelector}; when undefined,
    // React renders nothing -- no <div>, no Fragment wrapping. The source
    // therefore contains exactly one bare `{sliceSelector}` reference and
    // no `{sliceSelector ?` / `{sliceSelector &&` gates.
    expect(src).toMatch(/\{sliceSelector\}/);
    expect(src).not.toMatch(/\{sliceSelector \?/);
    expect(src).not.toMatch(/\{sliceSelector &&/);
  });
});
