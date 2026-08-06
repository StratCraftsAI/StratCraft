/**
 * TICKET_1208 P2: useDataManagementStore Tests
 *
 * Validates catalog selection, download form draft, and import form
 * draft preservation across view switches.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useDataManagementStore } from '../useDataManagementStore';

describe('useDataManagementStore', () => {
  beforeEach(() => {
    useDataManagementStore.setState({
      catalog: { selected: new Set(), collapsed: {} },
      download: { symbol: '', interval: '', startDate: '', endDate: '', provider: '' },
      importForm: { pkgSourcePath: null, pkgName: '', pkgAdjustMode: 'hfq', pkgArchivalCadence: 'snapshot' },
    });
  });

  // ── Catalog ─────────────────────────────────────────────────────────────

  it('should start with empty catalog selection', () => {
    const { catalog } = useDataManagementStore.getState();
    expect(catalog.selected.size).toBe(0);
    expect(catalog.collapsed).toEqual({});
  });

  it('should set catalog selected', () => {
    const ids = new Set([1, 5, 12]);
    useDataManagementStore.getState().setCatalogSelected(ids);
    expect(useDataManagementStore.getState().catalog.selected).toEqual(ids);
  });

  it('should set catalog collapsed without losing selected', () => {
    useDataManagementStore.getState().setCatalogSelected(new Set([3]));
    useDataManagementStore.getState().setCatalogCollapsed({ yfinance: true });

    const { catalog } = useDataManagementStore.getState();
    expect(catalog.collapsed).toEqual({ yfinance: true });
    expect(catalog.selected.has(3)).toBe(true);
  });

  // ── Download Draft ──────────────────────────────────────────────────────

  it('should start with empty download draft', () => {
    const { download } = useDataManagementStore.getState();
    expect(download.symbol).toBe('');
    expect(download.provider).toBe('');
  });

  it('should patch download draft fields', () => {
    useDataManagementStore.getState().setDownloadDraft({
      symbol: 'EURUSD',
      provider: 'yfinance',
      interval: '5m',
    });
    const { download } = useDataManagementStore.getState();
    expect(download.symbol).toBe('EURUSD');
    expect(download.provider).toBe('yfinance');
    expect(download.interval).toBe('5m');
    expect(download.startDate).toBe('');
  });

  it('should reset download draft to defaults', () => {
    useDataManagementStore.getState().setDownloadDraft({
      symbol: 'AAPL',
      startDate: '2020-01-01',
      endDate: '2025-01-01',
      provider: 'clickhouse',
      interval: '1d',
    });
    useDataManagementStore.getState().resetDownloadDraft();

    const { download } = useDataManagementStore.getState();
    expect(download.symbol).toBe('');
    expect(download.startDate).toBe('');
    expect(download.provider).toBe('');
  });

  // ── Import Draft ────────────────────────────────────────────────────────

  it('should start with default import draft', () => {
    const { importForm } = useDataManagementStore.getState();
    expect(importForm.pkgSourcePath).toBeNull();
    expect(importForm.pkgName).toBe('');
    expect(importForm.pkgAdjustMode).toBe('hfq');
    expect(importForm.pkgArchivalCadence).toBe('snapshot');
  });

  it('should patch import draft fields', () => {
    useDataManagementStore.getState().setImportDraft({
      pkgSourcePath: '/data/histdata/forex',
      pkgName: 'histdata-forex',
      pkgAdjustMode: 'none',
    });
    const { importForm } = useDataManagementStore.getState();
    expect(importForm.pkgSourcePath).toBe('/data/histdata/forex');
    expect(importForm.pkgName).toBe('histdata-forex');
    expect(importForm.pkgAdjustMode).toBe('none');
    expect(importForm.pkgArchivalCadence).toBe('snapshot');
  });

  it('should reset import draft to defaults', () => {
    useDataManagementStore.getState().setImportDraft({
      pkgSourcePath: '/some/path',
      pkgName: 'test-pkg',
      pkgAdjustMode: 'qfq',
      pkgArchivalCadence: 'monthly_archive',
    });
    useDataManagementStore.getState().resetImportDraft();

    const { importForm } = useDataManagementStore.getState();
    expect(importForm.pkgSourcePath).toBeNull();
    expect(importForm.pkgName).toBe('');
    expect(importForm.pkgAdjustMode).toBe('hfq');
    expect(importForm.pkgArchivalCadence).toBe('snapshot');
  });

  // ── Cross-section isolation ─────────────────────────────────────────────

  it('should not affect other sections when updating one', () => {
    useDataManagementStore.getState().setCatalogSelected(new Set([7, 8]));
    useDataManagementStore.getState().setDownloadDraft({ symbol: 'GBPUSD' });
    useDataManagementStore.getState().setImportDraft({ pkgName: 'my-pkg' });

    useDataManagementStore.getState().resetDownloadDraft();

    const state = useDataManagementStore.getState();
    expect(state.catalog.selected.has(7)).toBe(true);
    expect(state.importForm.pkgName).toBe('my-pkg');
    expect(state.download.symbol).toBe('');
  });

  // ── Simulated unmount/remount ───────────────────────────────────────────

  it('should preserve all state across simulated unmount/remount', () => {
    useDataManagementStore.getState().setCatalogSelected(new Set([2, 4]));
    useDataManagementStore.getState().setCatalogCollapsed({ databento: true });
    useDataManagementStore.getState().setDownloadDraft({
      symbol: 'USDJPY',
      interval: '1h',
      startDate: '2024-01-01',
      endDate: '2026-01-01',
      provider: 'yfinance',
    });
    useDataManagementStore.getState().setImportDraft({
      pkgSourcePath: '/data/import',
      pkgName: 'forex-archive',
      pkgAdjustMode: 'hfq',
      pkgArchivalCadence: 'monthly_archive',
    });

    const afterRemount = useDataManagementStore.getState();
    expect(afterRemount.catalog.selected).toEqual(new Set([2, 4]));
    expect(afterRemount.catalog.collapsed).toEqual({ databento: true });
    expect(afterRemount.download.symbol).toBe('USDJPY');
    expect(afterRemount.download.interval).toBe('1h');
    expect(afterRemount.importForm.pkgSourcePath).toBe('/data/import');
    expect(afterRemount.importForm.pkgArchivalCadence).toBe('monthly_archive');
  });
});
