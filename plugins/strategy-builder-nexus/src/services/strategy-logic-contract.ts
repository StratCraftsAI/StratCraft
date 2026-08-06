/**
 * TICKET_1224: boundary_comparison strategy-logic contract.
 *
 * Contract: a `boundary_comparison` rule references a `threshold_param`
 * (`upperband` / `lowerband`) that MUST be a param the selected indicator
 * actually defines in the indicator catalog. Unbounded oscillators (MACD,
 * APO, Momentum, ROC, ...) define no bands, so the reference is semantically
 * unreachable and the backend LLM checker rejects it as a fatal error.
 * This module fails fast at config validation time so the invalid
 * combination never leaves the renderer.
 */

import { STRATEGY_INDICATOR_CATALOG as indicatorCatalog } from '@StratCraft/types';

interface CatalogIndicatorEntry {
  slug: string;
  params?: Array<{ name: string }>;
}

/** slug -> set of param names defined in the catalog (source of truth). */
const CATALOG_PARAM_NAMES: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  (indicatorCatalog as CatalogIndicatorEntry[]).map((entry) => [
    entry.slug,
    new Set((entry.params ?? []).map((param) => param.name)),
  ]),
);

/** UI template key for the boundary comparison template. */
export const BOUNDARY_COMPARISON_TEMPLATE_KEY = 'boundary_comparison_oscillator';

/** Backend strategy.type for the boundary comparison template. */
export const BOUNDARY_COMPARISON_TYPE = 'boundary_comparison';

/**
 * Resolve the effective threshold_param for a boundary_comparison rule,
 * applying the shared operator-based default (`>` targets the upper band).
 */
export function resolveBoundaryThresholdParam(
  operator: string | undefined,
  thresholdParam: string | undefined,
): string {
  return thresholdParam || ((operator || '>') === '>' ? 'upperband' : 'lowerband');
}

export interface ThresholdParamViolation {
  /** i18n key in the `errors` namespace. */
  error: string;
  errorParams: { indicator: string; thresholdParam: string };
}

interface BoundaryRuleLike {
  indicator?: { slug?: string; name?: string } | null;
  strategy?: {
    logic?: {
      type?: string;
      operator?: string;
      threshold_param?: string;
    };
  } | null;
}

/**
 * Check the boundary_comparison contract for a single rule.
 * Returns null when the rule is valid (or not a boundary_comparison rule);
 * returns a violation payload for validateConfig otherwise.
 */
export function checkBoundaryThresholdParam(
  rule: BoundaryRuleLike,
): ThresholdParamViolation | null {
  const logic = rule.strategy?.logic;
  const rawType = logic?.type || '';
  if (rawType !== BOUNDARY_COMPARISON_TEMPLATE_KEY && rawType !== BOUNDARY_COMPARISON_TYPE) {
    return null;
  }

  const slug = rule.indicator?.slug;
  if (!slug) {
    // Missing indicator is reported by the dedicated validation rule.
    return null;
  }

  const thresholdParam = resolveBoundaryThresholdParam(logic?.operator, logic?.threshold_param);
  const paramNames = CATALOG_PARAM_NAMES.get(slug);
  if (paramNames?.has(thresholdParam)) {
    return null;
  }

  return {
    error: 'MSG_BUILDER_VALIDATION_THRESHOLD_PARAM_UNSUPPORTED',
    errorParams: {
      indicator: rule.indicator?.name || slug,
      thresholdParam,
    },
  };
}
