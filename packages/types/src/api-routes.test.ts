import { describe, expect, it } from 'vitest';
import { API_FACTOR_MINING_EDIT } from './index';

describe('factor-mining API route exports', () => {
  it('exports the edit route through the runtime package entry point', () => {
    expect(API_FACTOR_MINING_EDIT).toBe('/api/v1/factor-mining/edit');
  });
});
