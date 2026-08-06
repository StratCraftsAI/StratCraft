import type { DiagModule, DiagResult } from '../types';
import { enumerateTradingDays } from '../../shared/calendars/trading-calendars';

interface HolidayCheck {
  date: string;
  dayOfWeek: string;
  isWeekday: boolean;
  excluded: boolean;
}

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MS_PER_DAY = 86_400_000;

function checkYear(year: number): HolidayCheck[] {
  const holidays = [
    { month: 0, day: 1, label: 'Jan 1' },
    { month: 11, day: 25, label: 'Dec 25' },
    { month: 11, day: 26, label: 'Dec 26' },
  ];
  const results: HolidayCheck[] = [];

  for (const h of holidays) {
    const ms = Date.UTC(year, h.month, h.day);
    const dt = new Date(ms);
    const dow = dt.getUTCDay();
    const isWeekday = dow !== 0 && dow !== 6;

    if (!isWeekday) {
      results.push({
        date: `${year}-${String(h.month + 1).padStart(2, '0')}-${String(h.day).padStart(2, '0')}`,
        dayOfWeek: DOW_NAMES[dow],
        isWeekday: false,
        excluded: true,
      });
      continue;
    }

    const startMs = ms;
    const endMs = ms;
    const days = enumerateTradingDays('FX_5_24', startMs, endMs);
    const excluded = days.length === 0;

    results.push({
      date: `${year}-${String(h.month + 1).padStart(2, '0')}-${String(h.day).padStart(2, '0')}`,
      dayOfWeek: DOW_NAMES[dow],
      isWeekday: true,
      excluded,
    });
  }

  return results;
}

const mod: DiagModule = {
  name: 'fx-calendar-holidays',
  description: 'Verify FX_5_24 calendar excludes Jan 1, Dec 25, Dec 26 on weekday years',

  async run(args): Promise<DiagResult> {
    const t0 = performance.now();
    const startYear = typeof args.startYear === 'number' ? args.startYear : 2020;
    const endYear = typeof args.endYear === 'number' ? args.endYear : 2030;

    const allChecks: Record<number, HolidayCheck[]> = {};
    const failures: string[] = [];

    for (let y = startYear; y <= endYear; y++) {
      const checks = checkYear(y);
      allChecks[y] = checks;

      for (const c of checks) {
        if (c.isWeekday && !c.excluded) {
          failures.push(`${c.date} (${c.dayOfWeek}) is a weekday but NOT excluded from FX_5_24`);
        }
      }
    }

    const pass = failures.length === 0;
    return {
      name: 'fx-calendar-holidays',
      pass,
      summary: pass
        ? `FX_5_24 correctly excludes all 3 holidays on weekday years (${startYear}-${endYear})`
        : `${failures.length} holiday(s) not excluded: ${failures.join('; ')}`,
      details: { startYear, endYear, checks: allChecks, failures },
      durationMs: Math.round(performance.now() - t0),
    };
  },
};

export default mod;
