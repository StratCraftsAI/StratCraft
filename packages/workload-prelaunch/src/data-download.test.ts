import { describe, expect, it } from 'vitest';
import {
  resolveDataDownloadReview,
  DATA_DOWNLOAD_PARAMETER_SPECIFICATION,
} from './data-download';
import {
  applyPrelaunchEdits,
  confirmPrelaunchReview,
  assertConfirmedPlanIntegrity,
  assertCurrentConfirmedPlan,
  WorkloadPrelaunchError,
} from './index';
import type { DataDownloadDerivedContext } from '@StratCraft/types';

const baseContext: DataDownloadDerivedContext = {
  version: 'dukascopy:1m,5m,15m,30m,1h,4h,1d',
  supportedIntervals: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'],
  supportedSymbols: null,
};

const contextWithCoverage: DataDownloadDerivedContext = {
  ...baseContext,
  existingCoverage: {
    startDate: '2024-01-01',
    endDate: '2024-06-30',
    totalBars: 180000,
  },
  providerOnlineRange: {
    startDate: '2003-01-01',
    endDate: '2026-08-01',
  },
};

describe('data-download prelaunch specification', () => {
  it('resolves a complete Dukascopy draft with all provenance', () => {
    const review = resolveDataDownloadReview({
      provider: 'dukascopy',
      symbols: ['EURUSD'],
      interval: '1m',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    }, baseContext);

    expect(review.specificationId).toBe('quantnexus.data-download');
    expect(review.specificationVersion).toBe('1.0.0');
    expect(review.missingRequired).toEqual([]);
    expect(review.validationErrors).toEqual([]);
    expect(review.planFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(review.confirmationRequired).toBe(true);

    const providerParam = review.parameters.find(p => p.id === 'provider');
    expect(providerParam?.value).toBe('dukascopy');
    expect(providerParam?.provenance).toBe('explicit');

    const symbolsParam = review.parameters.find(p => p.id === 'symbols');
    expect(symbolsParam?.value).toEqual(['EURUSD']);
    expect(symbolsParam?.provenance).toBe('explicit');

    const priorityParam = review.parameters.find(p => p.id === 'priority');
    expect(priorityParam?.value).toBe('background');
    expect(priorityParam?.provenance).toBe('default');
  });

  it('reports missing required fields for an underspecified request', () => {
    const review = resolveDataDownloadReview({
      provider: 'dukascopy',
    }, baseContext);

    const missingIds = review.missingRequired.map(m => m.id);
    expect(missingIds).toContain('symbols');
    expect(missingIds).toContain('interval');
    expect(missingIds).toContain('startDate');
    expect(missingIds).toContain('endDate');
    expect(missingIds).not.toContain('provider');
    expect(missingIds).not.toContain('priority');
  });

  it('reports empty symbols as a validation error', () => {
    const review = resolveDataDownloadReview({
      provider: 'dukascopy',
      symbols: [],
      interval: '1m',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    }, baseContext);

    expect(review.validationErrors.some(e => e.code === 'DOWNLOAD_SYMBOLS_EMPTY')).toBe(true);
  });

  it('rejects an unknown provider', () => {
    const review = resolveDataDownloadReview({
      provider: 'unknown_provider' as any,
      symbols: ['EURUSD'],
      interval: '1m',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    }, baseContext);

    expect(review.validationErrors.some(e => e.code === 'DOWNLOAD_PROVIDER_UNKNOWN')).toBe(true);
  });

  it('rejects an unsupported interval', () => {
    const review = resolveDataDownloadReview({
      provider: 'dukascopy',
      symbols: ['EURUSD'],
      interval: '3m' as any,
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    }, baseContext);

    expect(review.validationErrors.some(e => e.code === 'DOWNLOAD_INTERVAL_UNSUPPORTED')).toBe(true);
  });

  it('rejects start date >= end date', () => {
    const review = resolveDataDownloadReview({
      provider: 'dukascopy',
      symbols: ['EURUSD'],
      interval: '1m',
      startDate: '2024-12-31',
      endDate: '2024-01-01',
    }, baseContext);

    expect(review.validationErrors.some(e => e.code === 'DOWNLOAD_WINDOW_INVALID')).toBe(true);
  });

  it('rejects dates outside provider online range', () => {
    const review = resolveDataDownloadReview({
      provider: 'dukascopy',
      symbols: ['EURUSD'],
      interval: '1m',
      startDate: '2001-01-01',
      endDate: '2024-12-31',
    }, contextWithCoverage);

    expect(review.validationErrors.some(e => e.code === 'DOWNLOAD_OUTSIDE_ONLINE_RANGE')).toBe(true);
  });

  it('includes existing coverage as derived parameters', () => {
    const review = resolveDataDownloadReview({
      provider: 'dukascopy',
      symbols: ['EURUSD'],
      interval: '1m',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    }, contextWithCoverage);

    const coverage = review.parameters.find(p => p.id === 'existingCoverageBars');
    expect(coverage?.value).toBe(180000);
    expect(coverage?.provenance).toBe('derived');
  });

  it('produces a deterministic fingerprint for the same inputs', () => {
    const draft = {
      provider: 'dukascopy' as const,
      symbols: ['EURUSD'],
      interval: '1m',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    };
    const fp1 = resolveDataDownloadReview(draft, baseContext).planFingerprint;
    const fp2 = resolveDataDownloadReview(draft, baseContext).planFingerprint;
    expect(fp1).toBe(fp2);
  });

  it('changes the fingerprint when symbols change', () => {
    const base = {
      provider: 'dukascopy' as const,
      interval: '1m',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    };
    const fp1 = resolveDataDownloadReview({ ...base, symbols: ['EURUSD'] }, baseContext).planFingerprint;
    const fp2 = resolveDataDownloadReview({ ...base, symbols: ['USDJPY'] }, baseContext).planFingerprint;
    expect(fp1).not.toBe(fp2);
  });
});

describe('data-download prelaunch edits', () => {
  it('applies edits and changes the fingerprint', () => {
    const review = resolveDataDownloadReview({
      provider: 'dukascopy',
      symbols: ['EURUSD'],
      interval: '1m',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    }, baseContext);

    const edited = applyPrelaunchEdits(
      DATA_DOWNLOAD_PARAMETER_SPECIFICATION,
      review,
      { interval: '5m' },
      { derivedContextVersion: baseContext.version },
    );

    expect(edited.parameters.find(p => p.id === 'interval')?.value).toBe('5m');
    expect(edited.planFingerprint).not.toBe(review.planFingerprint);
  });

  it('rejects edits to non-editable parameters', () => {
    const review = resolveDataDownloadReview({
      provider: 'dukascopy',
      symbols: ['EURUSD'],
      interval: '1m',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    }, baseContext);

    expect(() =>
      applyPrelaunchEdits(
        DATA_DOWNLOAD_PARAMETER_SPECIFICATION,
        review,
        { callerId: 'hacked' },
        { derivedContextVersion: baseContext.version },
      ),
    ).toThrow(WorkloadPrelaunchError);
  });
});

describe('data-download prelaunch confirmation', () => {
  const completeDraft = {
    provider: 'dukascopy' as const,
    symbols: ['EURUSD'],
    interval: '1m',
    startDate: '2024-01-01',
    endDate: '2024-12-31',
  };

  it('confirms a complete valid review', () => {
    const review = resolveDataDownloadReview(completeDraft, baseContext);
    const confirmed = confirmPrelaunchReview(
      DATA_DOWNLOAD_PARAMETER_SPECIFICATION,
      review,
      {
        planFingerprint: review.planFingerprint,
        specificationVersion: review.specificationVersion,
        confirmedAtUtc: '2026-08-05T00:00:00Z',
      },
    );

    expect(confirmed.planFingerprint).toBe(review.planFingerprint);
    expect(confirmed.specificationId).toBe('quantnexus.data-download');
    expect(confirmed.confirmedAtUtc).toBe('2026-08-05T00:00:00Z');
  });

  it('rejects confirmation of an incomplete plan', () => {
    const review = resolveDataDownloadReview({ provider: 'dukascopy' }, baseContext);

    expect(() =>
      confirmPrelaunchReview(
        DATA_DOWNLOAD_PARAMETER_SPECIFICATION,
        review,
        {
          planFingerprint: review.planFingerprint,
          specificationVersion: review.specificationVersion,
          confirmedAtUtc: '2026-08-05T00:00:00Z',
        },
      ),
    ).toThrow('unresolved');
  });

  it('rejects a stale fingerprint', () => {
    const review = resolveDataDownloadReview(completeDraft, baseContext);

    expect(() =>
      confirmPrelaunchReview(
        DATA_DOWNLOAD_PARAMETER_SPECIFICATION,
        review,
        {
          planFingerprint: 'deadbeef'.repeat(8),
          specificationVersion: review.specificationVersion,
          confirmedAtUtc: '2026-08-05T00:00:00Z',
        },
      ),
    ).toThrow('does not identify');
  });

  it('detects stale confirmed plan when context changes', () => {
    const review = resolveDataDownloadReview(completeDraft, baseContext);
    const confirmed = confirmPrelaunchReview(
      DATA_DOWNLOAD_PARAMETER_SPECIFICATION,
      review,
      {
        planFingerprint: review.planFingerprint,
        specificationVersion: review.specificationVersion,
        confirmedAtUtc: '2026-08-05T00:00:00Z',
      },
    );

    const newContext = { ...baseContext, version: 'dukascopy:1m,5m,1h' };
    const newReview = resolveDataDownloadReview(completeDraft, newContext);

    expect(() =>
      assertCurrentConfirmedPlan(
        DATA_DOWNLOAD_PARAMETER_SPECIFICATION,
        confirmed,
        newReview,
      ),
    ).toThrow('stale');
  });

  it('passes integrity check with matching context', () => {
    const review = resolveDataDownloadReview(completeDraft, baseContext);
    const confirmed = confirmPrelaunchReview(
      DATA_DOWNLOAD_PARAMETER_SPECIFICATION,
      review,
      {
        planFingerprint: review.planFingerprint,
        specificationVersion: review.specificationVersion,
        confirmedAtUtc: '2026-08-05T00:00:00Z',
      },
    );

    expect(() =>
      assertConfirmedPlanIntegrity(
        DATA_DOWNLOAD_PARAMETER_SPECIFICATION,
        confirmed,
        baseContext.version,
      ),
    ).not.toThrow();
  });

  it('fails integrity check with changed context version', () => {
    const review = resolveDataDownloadReview(completeDraft, baseContext);
    const confirmed = confirmPrelaunchReview(
      DATA_DOWNLOAD_PARAMETER_SPECIFICATION,
      review,
      {
        planFingerprint: review.planFingerprint,
        specificationVersion: review.specificationVersion,
        confirmedAtUtc: '2026-08-05T00:00:00Z',
      },
    );

    expect(() =>
      assertConfirmedPlanIntegrity(
        DATA_DOWNLOAD_PARAMETER_SPECIFICATION,
        confirmed,
        'changed-context-version',
      ),
    ).toThrow('stale');
  });
});

describe('data-download multi-symbol review', () => {
  it('resolves multiple symbols in a single review', () => {
    const review = resolveDataDownloadReview({
      provider: 'dukascopy',
      symbols: ['EURUSD', 'USDJPY', 'GBPUSD'],
      interval: '5m',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    }, baseContext);

    expect(review.missingRequired).toEqual([]);
    expect(review.validationErrors).toEqual([]);
    const syms = review.parameters.find(p => p.id === 'symbols');
    expect(syms?.value).toEqual(['EURUSD', 'USDJPY', 'GBPUSD']);
  });

  it('includes estimated work symbol count', () => {
    const review = resolveDataDownloadReview({
      provider: 'dukascopy',
      symbols: ['EURUSD', 'USDJPY'],
      interval: '1m',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    }, baseContext);

    expect(review.estimatedWork.symbols).toBe(2);
  });
});
