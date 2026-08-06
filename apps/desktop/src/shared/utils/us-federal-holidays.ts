/**
 * US Federal Holiday calendar (UTC date arithmetic).
 *
 * TICKET_568_5_1_b Step 2: Required by CftcCotProvider to compute the
 * `knowledge_time = release_friday T 15:30 ET` PIT contract with
 * roll-forward when that Friday is a US federal holiday. Without this
 * helper, every Friday-holiday year silently understates `knowledge_time`
 * by 24 h on every observance year -- a real PIT contract violation.
 *
 * Scope: only the ~11 federal holidays that move CFTC publication. No
 * external library dependency (date-fns / luxon / etc.) -- the rule set
 * is small, stable, and library-grade for these holidays.
 *
 * All dates are interpreted as UTC midnight; callers compose in/out via
 * `Date.UTC(...)` or ISO-Z strings to avoid host-tz drift.
 *
 * Federal holidays observed (5 USC 6103):
 *   - New Year's Day            (Jan 1)
 *   - Martin Luther King Jr Day (3rd Monday of January)
 *   - Presidents' Day           (3rd Monday of February)
 *   - Memorial Day              (last Monday of May)
 *   - Juneteenth                (Jun 19, observed since 2021)
 *   - Independence Day          (Jul 4)
 *   - Labor Day                 (1st Monday of September)
 *   - Columbus Day              (2nd Monday of October)
 *   - Veterans Day              (Nov 11)
 *   - Thanksgiving Day          (4th Thursday of November)
 *   - Christmas Day             (Dec 25)
 *
 * When a fixed-date holiday falls on Saturday, it is observed on the
 * preceding Friday; when it falls on Sunday, on the following Monday.
 * This matches OPM's federal-observance rule and is what CFTC follows.
 */

/**
 * Returns true if the given UTC date is a US federal holiday (including
 * weekend-observance shifts of fixed-date holidays).
 */
export function isUsFederalHoliday(date: Date): boolean {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed
  const day = date.getUTCDate();
  const dow = date.getUTCDay(); // 0=Sun ... 6=Sat
  const ymd = ymdKey(year, month, day);

  return holidaySetForYear(year).has(ymd);
}

/**
 * Return the next US business day on or after `date` (when
 * `includeStart` is true) or strictly after `date` (default).
 *
 * "Business day" = not a Saturday, not a Sunday, not a US federal
 * holiday observance.
 */
export function nextUsBusinessDay(
  date: Date,
  opts: { includeStart?: boolean } = {},
): Date {
  const includeStart = opts.includeStart ?? false;
  const cursor = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  if (!includeStart) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  // Bounded loop: at most ~10 forward steps even across a long weekend
  // + holiday-week (e.g. Christmas Eve Fri + Christmas Mon observance).
  for (let i = 0; i < 14; i++) {
    const dow = cursor.getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    if (!isWeekend && !isUsFederalHoliday(cursor)) {
      return cursor;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  // 14-day fallback is unreachable for any real calendar; fail loud if
  // it ever fires so a bad input doesn't silently return garbage.
  throw new Error(
    `[us-federal-holidays] nextUsBusinessDay: no business day found within 14 days of ${date.toISOString()}`,
  );
}

// =============================================================================
// Internals
// =============================================================================

const holidayCache = new Map<number, Set<string>>();

function holidaySetForYear(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const set = computeHolidaySet(year);
  holidayCache.set(year, set);
  return set;
}

function computeHolidaySet(year: number): Set<string> {
  const out = new Set<string>();

  // Fixed-date holidays with weekend-observance shift.
  addFixedDateObservance(out, year, 0, 1); // New Year's Day
  addFixedDateObservance(out, year, 6, 4); // Independence Day
  addFixedDateObservance(out, year, 10, 11); // Veterans Day
  addFixedDateObservance(out, year, 11, 25); // Christmas Day
  // Juneteenth observed since 2021 (Public Law 117-17).
  if (year >= 2021) {
    addFixedDateObservance(out, year, 5, 19);
  }

  // Floating Monday/Thursday holidays -- no weekend shift needed by rule.
  out.add(ymdKey(year, 0, nthWeekdayOfMonth(year, 0, 1, 3))); // MLK Day: 3rd Mon Jan
  out.add(ymdKey(year, 1, nthWeekdayOfMonth(year, 1, 1, 3))); // Presidents' Day: 3rd Mon Feb
  out.add(ymdKey(year, 4, lastWeekdayOfMonth(year, 4, 1))); // Memorial Day: last Mon May
  out.add(ymdKey(year, 8, nthWeekdayOfMonth(year, 8, 1, 1))); // Labor Day: 1st Mon Sep
  out.add(ymdKey(year, 9, nthWeekdayOfMonth(year, 9, 1, 2))); // Columbus Day: 2nd Mon Oct
  out.add(ymdKey(year, 10, nthWeekdayOfMonth(year, 10, 4, 4))); // Thanksgiving: 4th Thu Nov

  return out;
}

/**
 * Add a fixed-date holiday plus its weekend-observance shift.
 *   - Sat -> observed previous Friday
 *   - Sun -> observed following Monday
 * The actual calendar date is NOT added when it falls on a weekend;
 * CFTC closure (and federal observance) tracks the observed date.
 */
function addFixedDateObservance(
  out: Set<string>,
  year: number,
  month: number,
  day: number,
): void {
  const actual = new Date(Date.UTC(year, month, day));
  const dow = actual.getUTCDay();
  if (dow === 6) {
    // Saturday -> Friday before
    const obs = new Date(actual.getTime());
    obs.setUTCDate(obs.getUTCDate() - 1);
    out.add(ymdKey(obs.getUTCFullYear(), obs.getUTCMonth(), obs.getUTCDate()));
  } else if (dow === 0) {
    // Sunday -> Monday after
    const obs = new Date(actual.getTime());
    obs.setUTCDate(obs.getUTCDate() + 1);
    out.add(ymdKey(obs.getUTCFullYear(), obs.getUTCMonth(), obs.getUTCDate()));
  } else {
    out.add(ymdKey(year, month, day));
  }
}

/**
 * Return the day-of-month for the Nth occurrence of `targetDow` in
 * `month` of `year` (1-indexed: n=1 is first occurrence).
 */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  targetDow: number,
  n: number,
): number {
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const firstDow = firstOfMonth.getUTCDay();
  const offset = (targetDow - firstDow + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

/**
 * Return the day-of-month for the last occurrence of `targetDow` in
 * `month` of `year`.
 */
function lastWeekdayOfMonth(
  year: number,
  month: number,
  targetDow: number,
): number {
  // Day 0 of next month = last day of current month.
  const lastOfMonth = new Date(Date.UTC(year, month + 1, 0));
  const lastDay = lastOfMonth.getUTCDate();
  const lastDow = lastOfMonth.getUTCDay();
  const offset = (lastDow - targetDow + 7) % 7;
  return lastDay - offset;
}

function ymdKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
