/**
 * WordPress MySQL DATETIME parser.
 *
 * TICKET_805 C2: WP `wp_plugin_entitlements.expires_at` is serialized as a
 * MySQL DATETIME string in `Y-m-d H:i:s` format and is UTC by convention
 * (written via `gmdate()` in promo-quota.php:307). A naive `new Date(s)`
 * call interprets the string as local time on most JS engines, which would
 * shift banner-trigger boundaries by the host's UTC offset.
 *
 * This helper is the single source of truth for parsing these strings on
 * Desktop. Use it everywhere a WP DATETIME crosses the IPC boundary, never
 * `new Date()` directly.
 */

/**
 * Parse a WordPress MySQL DATETIME string ("Y-m-d H:i:s", UTC) into a Date.
 *
 * Accepts both MySQL DATETIME (`"2026-08-01 00:00:00"`, no `T`, no zone)
 * and ISO 8601 with explicit zone (`"2026-08-01T00:00:00Z"`, `+00:00`,
 * etc.) -- WP REST currently returns the first form, but some callsites
 * mock the second; treating both correctly avoids surprise null returns.
 *
 * @param s  Raw value from WP REST API. `null`, `undefined`, empty
 *           string, and malformed strings all return `null` rather than
 *           throwing -- callers gate on `null` the same way they gate on
 *           the upstream `expiresAt` being null (which signals a
 *           permanent buyout).
 * @returns  Date in UTC, or `null` if input is unparseable.
 */
export function parseWpDateTimeUtc(s: string | null | undefined): Date | null {
  if (typeof s !== 'string' || s.length === 0) return null;

  // Build an ISO 8601 string with an explicit UTC zone so the engine's
  // local timezone cannot shift the result.
  //
  // - MySQL DATETIME "2026-08-01 00:00:00" -> "2026-08-01T00:00:00Z"
  // - ISO 8601 with Z / offset is kept as-is (the regex below confirms a
  //   zone designator is present, so we don't append a second one).
  let iso = s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s;
  if (!/Z|[+-]\d{2}:?\d{2}$/.test(iso)) {
    iso += 'Z';
  }

  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
