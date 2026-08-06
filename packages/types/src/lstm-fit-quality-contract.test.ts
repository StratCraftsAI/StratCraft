import { describe, expect, it } from 'vitest';
import { assessFitQuality, DEFAULT_LSTM_FIT_QUALITY_CONFIG } from './lstm-fit-quality-contract';

describe('shared TICKET_998 fit-quality contract', () => {
  it.each([
    { mean: 0.01, folds: [0.01, 0.01], zone: 'underfit' },
    { mean: 0.1, folds: [0.09, 0.11], zone: 'marginal' },
    { mean: 0.2, folds: [0.19, 0.21], zone: 'well_fitted' },
    { mean: 0.2, folds: [-0.2, 0.6], zone: 'overfit' },
  ])('classifies $zone from the shared decision function', ({ mean, folds, zone }) => {
    expect(assessFitQuality(DEFAULT_LSTM_FIT_QUALITY_CONFIG, folds, mean).zone).toBe(zone);
  });

  it('returns unknown without two complete fold results', () => {
    expect(assessFitQuality(DEFAULT_LSTM_FIT_QUALITY_CONFIG, [0.2], 0.2).zone).toBe('unknown');
  });

  it('applies the shared data-sufficiency prerequisite', () => {
    const result = assessFitQuality(DEFAULT_LSTM_FIT_QUALITY_CONFIG, [0.19, 0.21], 0.2, 100, 100);
    expect(result.zone).toBe('underfit');
    expect(result.detail).toBe('fitQuality.dataStarved');
  });

  it('scopes a well-fitted result to validation folds rather than generalization', () => {
    const result = assessFitQuality(
      DEFAULT_LSTM_FIT_QUALITY_CONFIG,
      [0.19, 0.21],
      0.2,
    );
    expect(result.zone).toBe('well_fitted');
    expect(result.detail).toContain('consistent validation-fold fit');
    expect(result.detail).not.toContain('generalization');
  });
});
