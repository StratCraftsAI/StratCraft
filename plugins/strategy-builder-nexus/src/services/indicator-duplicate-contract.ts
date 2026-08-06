/**
 * TICKET_1227: duplicate indicator selection contract.
 *
 * Contract: within one strategy configuration, two indicator selections that
 * are semantically identical (same indicator, same effective parameters, same
 * rule settings) carry no intent — the only defensible reading, "double
 * weight", must be expressed through an explicit weight field, never through
 * row duplication. Duplicates are therefore marked live in the selector UI
 * and refused at config validation time, so an identical pair never reaches
 * the generation API.
 *
 * A duplicate is born at UPDATE time, not add time: blocks are created blank
 * and configured afterwards, so detection always runs over the whole block
 * list, never inside the add handler.
 *
 * Fingerprint semantics mirror `canonicalJsonStringify` in
 * `apps/desktop/src/main/services/signal-discovery/discovery-persistence.ts`
 * (TICKET_568_3). That module is Electron-main code and must not be imported
 * by a renderer plugin, so the pure function is re-homed here.
 */

/** i18n key (errors namespace) reported when a duplicate refuses validation. */
export const DUPLICATE_INDICATOR_ERROR_KEY = 'MSG_BUILDER_VALIDATION_DUPLICATE_INDICATOR';

const FINGERPRINT_SEPARATOR = '|';

/**
 * Deterministic JSON: recursively sorts object keys so semantically identical
 * objects produce identical strings regardless of key insertion order.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

/** Join canonicalized parts into a single comparable fingerprint. */
export function computeSelectionFingerprint(parts: readonly unknown[]): string {
  return parts.map((part) => canonicalJsonStringify(part)).join(FINGERPRINT_SEPARATOR);
}

export interface DuplicateIndicatorViolation {
  /** i18n key in the `errors` namespace. */
  error: string;
  errorParams: { indicator: string };
}

// -----------------------------------------------------------------------------
// UI layer: selector block fingerprints (IndicatorSelector /
// RawIndicatorSelector / DirectionalIndicatorSelector)
// -----------------------------------------------------------------------------

/**
 * Union of the semantic fields across the three selector block shapes.
 * Fields a shape does not define stay undefined and hash as null, so blocks
 * of different shapes never collide with each other by accident.
 */
export interface FingerprintableIndicatorBlock {
  id: string;
  indicatorSlug: string | null;
  paramValues: Record<string, number | string>;
  /** RawIndicatorBlock: OHLCV source field. */
  field?: string;
  /** DirectionalIndicatorBlock: long/short direction. */
  direction?: string | null;
  templateKey?: string | null;
  ruleOperator?: string;
  ruleThresholdValue?: number;
  /** IndicatorBlock (TICKET_260): trend/range category. */
  category?: string;
}

interface ParamDefaultsSource {
  slug: string;
  params?: ReadonlyArray<{ name: string; default: number | string }>;
}

/** slug -> catalog default params, built from the selector's indicator prop. */
export function buildParamDefaultsIndex(
  indicators: ReadonlyArray<ParamDefaultsSource>,
): Map<string, Record<string, number | string>> {
  return new Map(
    indicators.map((indicator) => [
      indicator.slug,
      Object.fromEntries((indicator.params ?? []).map((param) => [param.name, param.default])),
    ]),
  );
}

/**
 * Fingerprint one selector block. Returns null for blocks without an
 * indicator selected (still being configured — never flagged).
 *
 * Effective params overlay catalog defaults with user values, so an
 * untouched-defaults block and an explicitly-set-to-defaults block compare
 * equal: both produce identical generation payloads.
 */
export function computeIndicatorBlockFingerprint(
  block: FingerprintableIndicatorBlock,
  paramDefaults?: ReadonlyMap<string, Record<string, number | string>>,
): string | null {
  if (!block.indicatorSlug) {
    return null;
  }
  const defaults = paramDefaults?.get(block.indicatorSlug) ?? {};
  const effectiveParams = { ...defaults, ...block.paramValues };
  return computeSelectionFingerprint([
    block.indicatorSlug,
    effectiveParams,
    block.field ?? null,
    block.direction ?? null,
    block.templateKey ?? null,
    block.ruleOperator ?? null,
    block.ruleThresholdValue ?? null,
    block.category ?? null,
  ]);
}

/**
 * Ids of every block involved in a fingerprint collision (all members of a
 * colliding group, not only the later ones — the user decides which to keep).
 */
export function findDuplicateBlockIds(
  blocks: ReadonlyArray<FingerprintableIndicatorBlock>,
  indicators: ReadonlyArray<ParamDefaultsSource>,
): Set<string> {
  const paramDefaults = buildParamDefaultsIndex(indicators);
  const idsByFingerprint = new Map<string, string[]>();
  for (const block of blocks) {
    const fingerprint = computeIndicatorBlockFingerprint(block, paramDefaults);
    if (fingerprint === null) {
      continue;
    }
    const ids = idsByFingerprint.get(fingerprint);
    if (ids) {
      ids.push(block.id);
    } else {
      idsByFingerprint.set(fingerprint, [block.id]);
    }
  }
  const duplicateIds = new Set<string>();
  for (const ids of idsByFingerprint.values()) {
    if (ids.length > 1) {
      for (const id of ids) {
        duplicateIds.add(id);
      }
    }
  }
  return duplicateIds;
}

// -----------------------------------------------------------------------------
// Validation layer: rule/config shapes checked by validate*Config functions.
// Params are fingerprinted as sent (no defaults overlay): the UI populates
// full defaults on selection, and identical wire payloads are the invariant
// the API boundary owns.
// -----------------------------------------------------------------------------

interface TemplateRuleLike {
  rule_type?: string;
  indicator?: {
    slug?: string;
    name?: string;
    params?: Record<string, unknown>;
  } | null;
  strategy?: { logic?: Record<string, unknown> } | null;
}

/**
 * Duplicate check for template_based indicator rules (RegimeDetector,
 * EntrySignal, KronosIndicatorEntry, MarketObserver). The whole
 * `strategy.logic` object participates, so rules differing in any logic field
 * (operator, threshold, lines, band, ...) are never flagged.
 */
export function checkDuplicateTemplateRules(
  rules: ReadonlyArray<TemplateRuleLike>,
): DuplicateIndicatorViolation | null {
  const seen = new Set<string>();
  for (const rule of rules) {
    const slug = rule.indicator?.slug;
    if ((rule.rule_type ?? 'template_based') !== 'template_based' || !slug) {
      continue;
    }
    const fingerprint = computeSelectionFingerprint([
      slug,
      rule.indicator?.params ?? {},
      rule.strategy?.logic ?? {},
    ]);
    if (seen.has(fingerprint)) {
      return { error: DUPLICATE_INDICATOR_ERROR_KEY, errorParams: { indicator: slug } };
    }
    seen.add(fingerprint);
  }
  return null;
}

interface RawIndicatorBlockLike {
  indicatorSlug: string | null;
  field?: string;
  paramValues?: Record<string, unknown>;
}

/**
 * Duplicate check for raw indicator blocks (KronosAIEntry, TraderAIEntry,
 * AILibero). Field participates: same indicator on close vs volume is
 * legitimate.
 */
export function checkDuplicateRawIndicatorBlocks(
  blocks: ReadonlyArray<RawIndicatorBlockLike>,
): DuplicateIndicatorViolation | null {
  const seen = new Set<string>();
  for (const block of blocks) {
    if (!block.indicatorSlug) {
      continue;
    }
    const fingerprint = computeSelectionFingerprint([
      block.indicatorSlug,
      block.field ?? null,
      block.paramValues ?? {},
    ]);
    if (seen.has(fingerprint)) {
      return {
        error: DUPLICATE_INDICATOR_ERROR_KEY,
        errorParams: { indicator: block.indicatorSlug },
      };
    }
    seen.add(fingerprint);
  }
  return null;
}

interface RiskRuleLike {
  id: string;
  enabled: boolean;
  priority: number;
  type: string;
  indicator?: { name?: string } | null;
}

/**
 * Duplicate check for risk override rules (IndicatorExit page). Two enabled
 * rules are duplicates when everything except identity fields (id, enabled,
 * priority) matches: same trigger with the same action fires twice for no
 * reason. Applies to every rule type — an indicator-only carve-out would be
 * an arbitrary hole in the same contract.
 */
export function checkDuplicateRiskRules(
  rules: ReadonlyArray<RiskRuleLike>,
): DuplicateIndicatorViolation | null {
  const seen = new Set<string>();
  for (const rule of rules) {
    const { id, enabled, priority, ...semantic } = rule as RiskRuleLike & Record<string, unknown>;
    void id;
    void enabled;
    void priority;
    const fingerprint = canonicalJsonStringify(semantic);
    if (seen.has(fingerprint)) {
      return {
        error: DUPLICATE_INDICATOR_ERROR_KEY,
        errorParams: { indicator: rule.indicator?.name || rule.type },
      };
    }
    seen.add(fingerprint);
  }
  return null;
}
