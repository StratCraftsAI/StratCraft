/**
 * TICKET_286/287 + TICKET_887_3 Section G: Factor Engine Constants
 *
 * Centralized engine identifiers for the multi-engine factor evaluation
 * architecture. All 5 engines (TA-Lib, Alpha158, Alpha101, Alpha191, JKP)
 * are builtin and seed into nona_factors on startup via
 * seedBuiltinCatalog().
 *
 * TICKET_1335 D2: this file does NOT map engines to Python packages. The
 * locked `pixi.toml` + `pixi.lock` manifest is the sole owner of Python
 * package identity. The former `ENGINE_PYTHON_PACKAGES` map (talib ->
 * 'pandas-ta') was deleted here: it had zero non-test consumers yet read as
 * authoritative, which is exactly the "package identity lives partly in a
 * constants file" drift named in the TICKET_1335 root cause. Do not
 * reintroduce a package mapping in this layer.
 */

import { isFactorCatalogId } from '@StratCraft/types';

export const FACTOR_ENGINE_IDS = {
  ALPHA158: 'alpha158',
  ALPHA101: 'alpha101',
  TALIB: 'talib',
  ALPHA191: 'alpha191',
  JKP: 'jkp',
} as const;

export type FactorEngineId = (typeof FACTOR_ENGINE_IDS)[keyof typeof FACTOR_ENGINE_IDS];

/**
 * TICKET_1335 D2: the single validator for engine/catalog identity crossing a
 * trust boundary. Replaces the unconstrained `z.string()` MCP parameter and the
 * bare string that used to reach a SQL lookup and, through `python_package`, a
 * shell command. Every adapter (IPC, Service API, MCP) narrows with this guard
 * before touching the database.
 *
 * Delegates to `isFactorCatalogId` in the shared contracts package so the
 * Electron main process and the standalone MCP process validate against one
 * list. Re-implementing the membership test here would let the two drift, which
 * is the same failure mode the deleted `ENGINE_PYTHON_PACKAGES` map created.
 */
export function isFactorEngineId(value: unknown): value is FactorEngineId {
  return isFactorCatalogId(value);
}

export const BUILTIN_ENGINE_IDS: readonly FactorEngineId[] = [
  FACTOR_ENGINE_IDS.ALPHA158,
  FACTOR_ENGINE_IDS.ALPHA101,
  FACTOR_ENGINE_IDS.TALIB,
  FACTOR_ENGINE_IDS.ALPHA191,
  FACTOR_ENGINE_IDS.JKP,
] as const;
