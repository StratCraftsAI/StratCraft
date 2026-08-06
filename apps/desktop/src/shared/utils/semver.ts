/**
 * Lightweight semver comparison utilities.
 *
 * TICKET_456: Shared between main process and renderer for consistent
 * version comparison across Marketplace, plugin-market-service, etc.
 */

/**
 * Compare two semver strings.
 * @returns  1 if a > b, -1 if a < b, 0 if equal
 */
export function compareSemver(a: string, b: string): number {
  if (!a || !b) return a ? 1 : b ? -1 : 0;
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;
    if (aPart > bPart) return 1;
    if (aPart < bPart) return -1;
  }
  return 0;
}

/**
 * Returns true if version `a` is strictly greater than version `b`.
 */
export function semverGt(a: string, b: string): boolean {
  if (!a || !b) return false;
  return compareSemver(a, b) > 0;
}
