export function clampNumeric(raw: string, min: number, max: number, fallback: number): number {
  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
