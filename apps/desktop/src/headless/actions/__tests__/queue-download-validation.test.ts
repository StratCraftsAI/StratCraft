import { describe, it, expect } from 'vitest';

describe('data-manager/queue-download input validation', () => {
  it('rejects missing symbol', async () => {
    const mod = await import('../data-manager/queue-download');
    const result = await mod.default.run({ interval: '1h' });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('Missing required args');
  });

  it('rejects missing interval', async () => {
    const mod = await import('../data-manager/queue-download');
    const result = await mod.default.run({ symbol: 'EURUSD' });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('Missing required args');
  });

  it('has correct name and description', async () => {
    const mod = await import('../data-manager/queue-download');
    expect(mod.default.name).toBe('data-manager/queue-download');
    expect(mod.default.description).toBeTruthy();
  });
});

describe('data-manager/delete-segment input validation', () => {
  it('rejects missing symbol', async () => {
    const mod = await import('../data-manager/delete-segment');
    const result = await mod.default.run({ interval: '1h' });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('Missing required args');
  });
});
