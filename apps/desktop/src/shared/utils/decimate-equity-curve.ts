/**
 * TICKET_1263_1 D3: LTTB decimation for equity curves on the main-process
 * IPC boundary. Full-resolution curves go only to saveRun persistence;
 * the IPC DTO carries ~2k points for chart rendering (the renderer applies
 * its own LTTB too, so this is a transport-size optimisation).
 *
 * Coverage (all full-length series crossing the IPC boundary):
 *   - book curves: equityCurve / gross.equityCurve / net.equityCurve
 *   - book leverageSeries (per-bar leverage multipliers)
 *   - firm DTO: firm.equityCurve + every book in bookSet.books
 */

import type { FirmPortfolioDTO, PortfolioEquityPoint } from '@StratCraft/types';
import { CHART_MAX_RENDER_POINTS } from '../constants/rendering';
import { downsampleLTTB } from './downsample-lttb';

/** LTTB over any point shape carrying `equity` (PortfolioEquityPoint uses
 *  `timestamp`, the firm curve uses `ts`; the x-axis is the array index in
 *  both cases, so the algorithm only needs the y value). */
export function decimateEquityCurve<T extends { equity: number }>(
  curve: readonly T[],
  maxPoints: number = CHART_MAX_RENDER_POINTS,
): T[] {
  return downsampleLTTB(curve, maxPoints, (p) => p.equity);
}

/** Bucket-max downsample for the per-bar leverage series. Max (not mean)
 *  preserves the leverage peaks -- the signal a risk reviewer looks for. */
export function decimateLeverageSeries(
  series: number[],
  maxPoints: number = CHART_MAX_RENDER_POINTS,
): number[] {
  if (series.length <= maxPoints) return series;
  const result: number[] = new Array(maxPoints);
  const bucketSize = series.length / maxPoints;
  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.min(Math.floor((i + 1) * bucketSize), series.length);
    let max = series[start];
    for (let j = start + 1; j < end; j++) {
      if (series[j] > max) max = series[j];
    }
    result[i] = max;
  }
  return result;
}

export function decimateBookCurves(
  book: {
    equityCurve: PortfolioEquityPoint[];
    gross: { equityCurve: PortfolioEquityPoint[]; };
    net: { equityCurve: PortfolioEquityPoint[]; };
    leverageSeries?: number[];
  },
  maxPoints: number = CHART_MAX_RENDER_POINTS,
): void {
  const grossDec = decimateEquityCurve(book.gross.equityCurve, maxPoints);
  const netDec = decimateEquityCurve(book.net.equityCurve, maxPoints);
  book.gross.equityCurve = grossDec;
  book.net.equityCurve = netDec;
  // book.equityCurve is the same reference as book.gross.equityCurve
  // in PortfolioBookResult (from assembleResult), so reassign it too.
  book.equityCurve = grossDec;
  if (book.leverageSeries) {
    book.leverageSeries = decimateLeverageSeries(book.leverageSeries, maxPoints);
  }
}

/**
 * TICKET_1263_1 D3: decimate every full-length series in the firm DTO for
 * IPC transport. The per-market books are mutated in place (saveRun has
 * already persisted the full-resolution curves before the DTO is built);
 * the top-level firm curve is replaced on a shallow copy because the DTO
 * fields are readonly.
 */
export function decimateFirmPortfolioDTO(
  dto: FirmPortfolioDTO,
  maxPoints: number = CHART_MAX_RENDER_POINTS,
): FirmPortfolioDTO {
  for (const book of Object.values(dto.bookSet.books)) {
    decimateBookCurves(book, maxPoints);
  }
  return {
    ...dto,
    equityCurve: decimateEquityCurve(dto.equityCurve, maxPoints),
  };
}
