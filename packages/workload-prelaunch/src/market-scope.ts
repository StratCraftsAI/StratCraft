/**
 * TICKET_1370 R9/AC22: the single owner of factor-mining market-scope
 * resolution.
 *
 * Before R9 the market scope existed as two peer fields (`symbols`, `preset`)
 * that every layer re-interpreted: the pre-launch validator refused when both
 * were set, while the Python CLI silently gave `--preset` precedence. That
 * disagreement violates the reviewed-versus-executed contract of TICKET_1363.
 * This module resolves either input mode to one canonical `resolvedSymbols`
 * list; estimated work, fingerprinting, confirmation, admission, process
 * construction, persistence, and status all consume that list and never
 * re-expand a preset or choose between the two inputs.
 */

import type {
  FactorMiningMarketScope,
  FactorMiningMarketScopeSource,
  FactorMiningPreset,
  StructuredWorkloadValidationError,
  WorkloadJsonValue,
} from '@StratCraft/types';
import { FACTOR_MINING_PRESET_SYMBOLS, FACTOR_MINING_PRESETS } from '@StratCraft/types';

export const MARKET_SCOPE_ERROR_CODE = 'MINING_MARKET_SCOPE_INVALID';

function isPreset(value: WorkloadJsonValue | undefined): value is FactorMiningPreset {
  return typeof value === 'string' && (FACTOR_MINING_PRESETS as readonly string[]).includes(value);
}

/**
 * Canonicalize a user-supplied symbol list: upper-case, trimmed, de-duplicated,
 * and sorted. Canonical ordering is what lets AC23 compare the reviewed,
 * admitted, and executed universes byte-for-byte.
 */
export function canonicalizeSymbols(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const symbol = value.trim().toUpperCase();
    if (symbol.length > 0) seen.add(symbol);
  }
  return [...seen].sort((left, right) => left.localeCompare(right));
}

export interface MarketScopeResolution {
  readonly scope?: FactorMiningMarketScope;
  readonly errors: readonly StructuredWorkloadValidationError[];
}

/**
 * Resolve the selected source to a non-empty canonical symbol universe.
 *
 * Returns structured errors rather than throwing: an unresolved market scope is
 * an ordinary pre-launch review state that the card must be able to display and
 * repair, not an exceptional condition.
 */
export function resolveMarketScope(
  values: Readonly<Record<string, WorkloadJsonValue>>,
): MarketScopeResolution {
  const source = values.marketScopeSource as FactorMiningMarketScopeSource | undefined;
  if (source !== 'preset' && source !== 'custom') {
    return {
      errors: [{
        code: MARKET_SCOPE_ERROR_CODE,
        parameterIds: ['marketScopeSource'],
        message: 'Choose how the mining market scope is specified.',
        remediation: 'Select a repository preset or supply a custom symbol list.',
      }],
    };
  }
  if (source === 'preset') {
    const preset = values.preset;
    if (!isPreset(preset)) {
      return {
        errors: [{
          code: MARKET_SCOPE_ERROR_CODE,
          parameterIds: ['preset'],
          message: preset === undefined
            ? 'Select a repository symbol preset.'
            : `Unknown symbol preset '${String(preset)}'.`,
          remediation: `Choose one of: ${FACTOR_MINING_PRESETS.join(', ')}.`,
        }],
      };
    }
    return {
      scope: {
        source,
        preset,
        resolvedSymbols: canonicalizeSymbols(FACTOR_MINING_PRESET_SYMBOLS[preset]),
      },
      errors: [],
    };
  }
  const symbols = values.symbols;
  if (!Array.isArray(symbols) || symbols.some(symbol => typeof symbol !== 'string')) {
    return {
      errors: [{
        code: MARKET_SCOPE_ERROR_CODE,
        parameterIds: ['symbols'],
        message: 'Supply the custom symbol list to mine.',
        remediation: 'Add at least one symbol, or switch the market scope to a preset.',
      }],
    };
  }
  const resolvedSymbols = canonicalizeSymbols(symbols as readonly string[]);
  if (resolvedSymbols.length === 0) {
    return {
      errors: [{
        code: MARKET_SCOPE_ERROR_CODE,
        parameterIds: ['symbols'],
        message: 'The custom symbol list resolves to no symbols.',
        remediation: 'Add at least one symbol, or switch the market scope to a preset.',
      }],
    };
  }
  return { scope: { source, symbols: resolvedSymbols, resolvedSymbols }, errors: [] };
}
