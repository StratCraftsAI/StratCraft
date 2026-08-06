/**
 * TICKET_1253: Shared elapsed-time formatters.
 *
 * Two standard formats covering all consumers:
 * - compact: "45s", "14m 39s", "1h 14m 39s"
 * - fixed:   "00:14:39"
 */

export function formatElapsedCompact(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60) % 60;
  const h = Math.floor(s / 3600);
  const rem = s % 60;
  if (h > 0) return rem > 0 ? `${h}h ${m}m ${rem}s` : `${h}h ${m}m`;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

export function formatElapsedFixed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
