import { describe, it, expect } from 'vitest';
import mod from '../fx-calendar-holidays';

describe('fx-calendar-holidays diagnostic', () => {
  it('has correct name and description', () => {
    expect(mod.name).toBe('fx-calendar-holidays');
    expect(mod.description).toContain('FX_5_24');
  });

  it('returns DiagResult with all required fields', async () => {
    const result = await mod.run({ startYear: 2024, endYear: 2024 });
    expect(result).toHaveProperty('name', 'fx-calendar-holidays');
    expect(result).toHaveProperty('pass');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('details');
    expect(result).toHaveProperty('durationMs');
    expect(typeof result.pass).toBe('boolean');
    expect(typeof result.summary).toBe('string');
    expect(typeof result.durationMs).toBe('number');
  });

  it('passes for known correct range 2020-2030', async () => {
    const result = await mod.run({ startYear: 2020, endYear: 2030 });
    expect(result.pass).toBe(true);
    expect(result.summary).toContain('correctly excludes');
  });

  it('checks all three holidays per year', async () => {
    const result = await mod.run({ startYear: 2025, endYear: 2025 });
    const checks = (result.details.checks as Record<number, unknown[]>)[2025];
    expect(checks).toHaveLength(3);
  });

  it('reports weekday holidays as excluded', async () => {
    // 2025: Jan 1 = Wed, Dec 25 = Thu, Dec 26 = Fri -- all weekdays
    const result = await mod.run({ startYear: 2025, endYear: 2025 });
    const checks = (result.details.checks as Record<number, { isWeekday: boolean; excluded: boolean }[]>)[2025];
    for (const c of checks) {
      if (c.isWeekday) {
        expect(c.excluded).toBe(true);
      }
    }
  });

  it('marks weekend holidays correctly', async () => {
    // 2022: Jan 1 = Sat -- weekend, should still be marked excluded
    const result = await mod.run({ startYear: 2022, endYear: 2022 });
    const checks = (result.details.checks as Record<number, { date: string; isWeekday: boolean }[]>)[2022];
    const jan1 = checks.find(c => c.date === '2022-01-01');
    expect(jan1).toBeDefined();
    expect(jan1!.isWeekday).toBe(false);
  });

  it('uses default range when no args provided', async () => {
    const result = await mod.run({});
    expect(result.details.startYear).toBe(2020);
    expect(result.details.endYear).toBe(2030);
  });

  it('runs in under 100ms', async () => {
    const result = await mod.run({ startYear: 2024, endYear: 2024 });
    expect(result.durationMs).toBeLessThan(100);
  });
});
