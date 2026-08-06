import indicatorCatalogJson from './data/strategy-indicators.json';
import strategyTemplateCatalogJson from './data/strategy-templates.json';
import { toApiProvider } from './llm-provider-records';
import {
  API_START_MARKET_REGIME,
  API_CHECK_MARKET_REGIME,
  API_START_ENTRY_SIGNAL,
  API_CHECK_ENTRY_SIGNAL,
  API_START_EXIT_STRATEGY,
  API_CHECK_EXIT_STRATEGY,
  API_START_KRONOS_INDICATOR_ENTRY,
  API_CHECK_KRONOS_INDICATOR_ENTRY,
  API_KRONOS_LLM_ENTRY,
  API_CHECK_KRONOS_LLM_ENTRY,
  API_START_LLM_LIBERO,
  API_CHECK_LLM_LIBERO,
  API_VIBING_CHAT,
  API_CHECK_VIBING_CHAT,
  API_LLM_TRADER,
  API_CHECK_LLM_TRADER,
  API_START_WATCHLIST,
  API_CHECK_WATCHLIST,
  API_GENERATE_CATALOG_STRATEGY,
  API_CHECK_CATALOG_STRATEGY,
} from './api-routes';

export const REGIME_OPTIONS = [
  { id: 'trend', displayName: 'Trend', compatibleCategories: ['trend', 'moving_average'] },
  { id: 'range', displayName: 'Range', compatibleCategories: ['oscillator', 'volatility'] },
  { id: 'consolidation', displayName: 'Consolidation', compatibleCategories: ['volatility', 'moving_average'] },
  { id: 'oscillation', displayName: 'Oscillation', compatibleCategories: ['oscillator'] },
  { id: 'bespoke', displayName: 'Bespoke', compatibleCategories: ['trend', 'moving_average', 'oscillator', 'volatility', 'other'] },
] as const;

export type RegimeId = (typeof REGIME_OPTIONS)[number]['id'];

export const DEFAULT_REGIME_ID: RegimeId = 'trend';
export const DEFAULT_REGIME_STRATEGY_NAME = 'New Strategy';
export const MAX_STRATEGY_NAME_LENGTH = 200;
export const DEFAULT_STRATEGY_INDICATOR_LIMIT = 8;
export const MAX_STRATEGY_INDICATOR_LIMIT = 50;
export const BATCH_GENERATION_QUANTITY_MIN = 1;
export const BATCH_GENERATION_QUANTITY_MAX = 50;
export const BATCH_GENERATION_MAX_INDICATORS = 20;

export const STRATEGY_GENERATION_ENDPOINT_PAIRS = [
  { start: API_START_MARKET_REGIME, poll: API_CHECK_MARKET_REGIME },
  { start: API_START_ENTRY_SIGNAL, poll: API_CHECK_ENTRY_SIGNAL },
  { start: API_START_EXIT_STRATEGY, poll: API_CHECK_EXIT_STRATEGY },
  { start: API_START_KRONOS_INDICATOR_ENTRY, poll: API_CHECK_KRONOS_INDICATOR_ENTRY },
  { start: API_KRONOS_LLM_ENTRY, poll: API_CHECK_KRONOS_LLM_ENTRY },
  { start: API_START_LLM_LIBERO, poll: API_CHECK_LLM_LIBERO },
  { start: API_VIBING_CHAT, poll: API_CHECK_VIBING_CHAT },
  { start: API_LLM_TRADER, poll: API_CHECK_LLM_TRADER },
  { start: API_START_WATCHLIST, poll: API_CHECK_WATCHLIST },
  { start: API_GENERATE_CATALOG_STRATEGY, poll: API_CHECK_CATALOG_STRATEGY },
] as const;

export const STRATEGY_GENERATION_ENDPOINTS: ReadonlySet<string> = new Set(
  STRATEGY_GENERATION_ENDPOINT_PAIRS.flatMap(({ start, poll }) => [start, poll]),
);

export function isStrategyGenerationEndpoint(endpoint: string): boolean {
  return STRATEGY_GENERATION_ENDPOINTS.has(endpoint);
}

export function isStrategyGenerationEndpointPair(
  startEndpoint: string,
  pollEndpoint: string,
): boolean {
  return STRATEGY_GENERATION_ENDPOINT_PAIRS.some(
    ({ start, poll }) => start === startEndpoint && poll === pollEndpoint,
  );
}

export interface StrategyIndicatorParameter {
  name: string;
  label: string;
  type: string;
  default: unknown;
}

export interface StrategyIndicatorDefinition {
  name: string;
  slug: string;
  aliases: string[];
  params: StrategyIndicatorParameter[];
  template_keys: string[];
  usage_modes: {
    standalone: boolean;
    strategy_template: boolean;
  };
  category: string;
  output_lines: string[];
  display_name: string;
}

export interface StrategyIndicatorProjection {
  slug: string;
  display_name: string;
  category: string;
  parameter_defaults: Record<string, unknown>;
  supported_templates: string[];
  output_lines: string[];
}

export interface StrategyIndicatorSelection {
  slug: string;
  params?: Record<string, unknown>;
  template_key?: string;
  rule_logic?: string;
  category?: 'trend' | 'range';
}

export interface StrategyIndicatorGenerationConfig {
  slug: string;
  display_name: string;
  category: string;
  parameters: Record<string, unknown>;
  template_key: string;
  supported_templates: string[];
  rule_logic: string;
  output_lines: string[];
  regime_category?: 'trend' | 'range';
}

export interface StrategyTemplateOperator {
  value: string;
  label: string;
}

export interface StrategyTemplateDefinition {
  type: string;
  label: string;
  strategy_type: string | string[];
  description: string;
  default_rule: {
    operator?: string;
    description: string;
    [key: string]: unknown;
  };
  rule_options: {
    operators?: StrategyTemplateOperator[];
    [key: string]: unknown;
  };
}

export interface ListStrategyIndicatorsInput {
  regime?: RegimeId;
  category?: string;
  search?: string;
  recommended_only?: boolean;
  limit?: number;
}

export interface RegimeStrategyGenerationRequestInput {
  regime: RegimeId;
  indicators: ReadonlyArray<StrategyIndicatorGenerationConfig>;
  strategyName: string;
  llmProvider: string;
  llmModel: string;
  locale: string;
  autoReverse?: boolean;
  apiKey?: string;
  preference?: string;
  persona?: string;
}

export interface VibingChatPayloadInput {
  taskId?: string;
  sessionId: string;
  message: string;
  strategyName?: string;
  llmProvider: string;
  llmModel: string;
  locale: string;
  apiKey?: string;
  currentStrategyRules?: Record<string, unknown>;
}

export function buildVibingChatGenerationRequest(
  input: VibingChatPayloadInput,
): Record<string, unknown> {
  return {
    task_id: input.taskId
      ?? `vibing_chat_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    session_id: input.sessionId,
    message: input.message,
    locale: input.locale,
    model: toApiProvider(input.llmProvider),
    llm_model: input.llmModel,
    output_format: 'v3',
    storage_mode: 'local',
    strategy_name: input.strategyName ?? '',
    metadata: { mode: 'generator' },
    ...(input.apiKey ? { llm_api_key: input.apiKey } : {}),
    ...(input.currentStrategyRules
      ? { current_strategy_rules: input.currentStrategyRules }
      : {}),
  };
}

export const STRATEGY_INDICATOR_CATALOG =
  indicatorCatalogJson as StrategyIndicatorDefinition[];
export const STRATEGY_TEMPLATE_CATALOG =
  strategyTemplateCatalogJson as Record<string, StrategyTemplateDefinition>;

const REGIME_IDS = new Set<string>(REGIME_OPTIONS.map((option) => option.id));

export function isRegimeId(value: string): value is RegimeId {
  return REGIME_IDS.has(value);
}

export function getRegimeOption(regime: string): (typeof REGIME_OPTIONS)[number] | undefined {
  return REGIME_OPTIONS.find((option) => option.id === regime);
}

export function findStrategyIndicator(value: string): StrategyIndicatorDefinition | undefined {
  const normalized = value.trim().toLocaleLowerCase('en-US');
  if (!normalized) return undefined;
  return STRATEGY_INDICATOR_CATALOG.find((indicator) =>
    indicator.slug.toLocaleLowerCase('en-US') === normalized
    || indicator.name.toLocaleLowerCase('en-US') === normalized
    || indicator.display_name.toLocaleLowerCase('en-US') === normalized
    || indicator.aliases.some((alias) => alias.toLocaleLowerCase('en-US') === normalized));
}

export function getStrategyTemplate(templateKey: string): StrategyTemplateDefinition | undefined {
  return STRATEGY_TEMPLATE_CATALOG[templateKey];
}

export function listStrategyIndicators(
  input: ListStrategyIndicatorsInput = {},
): StrategyIndicatorProjection[] {
  const regimeOption = input.regime ? getRegimeOption(input.regime) : undefined;
  const category = input.category?.trim().toLocaleLowerCase('en-US');
  const search = input.search?.trim().toLocaleLowerCase('en-US');
  const recommendedOnly = input.recommended_only === true;
  const requestedLimit = Number.isFinite(input.limit) ? Math.trunc(input.limit!) : DEFAULT_STRATEGY_INDICATOR_LIMIT;
  const limit = Math.min(MAX_STRATEGY_INDICATOR_LIMIT, Math.max(1, requestedLimit));

  return STRATEGY_INDICATOR_CATALOG
    .filter((indicator) => indicator.usage_modes.strategy_template)
    .filter((indicator) => !category || indicator.category.toLocaleLowerCase('en-US') === category)
    .filter((indicator) =>
      !search
      || indicator.slug.toLocaleLowerCase('en-US').includes(search)
      || indicator.name.toLocaleLowerCase('en-US').includes(search)
      || indicator.display_name.toLocaleLowerCase('en-US').includes(search)
      || indicator.aliases.some((alias) => alias.toLocaleLowerCase('en-US').includes(search)))
    .filter((indicator) =>
      !recommendedOnly
      || !regimeOption
      || (regimeOption.compatibleCategories as readonly string[]).includes(indicator.category))
    .slice(0, limit)
    .map((indicator) => ({
      slug: indicator.slug,
      display_name: indicator.display_name,
      category: indicator.category,
      parameter_defaults: Object.fromEntries(
        indicator.params.map((parameter) => [parameter.name, parameter.default]),
      ),
      supported_templates: [...indicator.template_keys],
      output_lines: [...indicator.output_lines],
    }));
}

export function resolveStrategyIndicatorConfigurations(
  selections: ReadonlyArray<string | StrategyIndicatorSelection>,
): StrategyIndicatorGenerationConfig[] {
  return selections.map((selection) => {
    const rawSlug = typeof selection === 'string' ? selection : selection.slug;
    const indicator = findStrategyIndicator(rawSlug);
    if (!indicator) {
      throw new Error(`Unknown strategy indicator '${rawSlug}'. Call list_strategy_indicators to choose a catalog indicator.`);
    }

    const providedParams = typeof selection === 'string' ? {} : selection.params ?? {};
    const parameters: Record<string, unknown> = {};
    for (const parameter of indicator.params) {
      const value = Object.prototype.hasOwnProperty.call(providedParams, parameter.name)
        ? providedParams[parameter.name]
        : parameter.default;
      if (value === undefined || value === null || value === '') {
        throw new Error(`Strategy indicator '${indicator.slug}' is missing required parameter '${parameter.name}'.`);
      }
      parameters[parameter.name] = value;
    }

    const templateKey = typeof selection === 'string'
      ? indicator.template_keys[0]
      : selection.template_key ?? indicator.template_keys[0];
    if (!templateKey || !indicator.template_keys.includes(templateKey)) {
      throw new Error(`Strategy indicator '${indicator.slug}' does not support template '${templateKey}'.`);
    }

    return {
      slug: indicator.slug,
      display_name: indicator.display_name,
      category: indicator.category,
      parameters,
      template_key: templateKey,
      supported_templates: [...indicator.template_keys],
      rule_logic: typeof selection === 'string'
        ? templateKey
        : selection.rule_logic ?? templateKey,
      output_lines: [...indicator.output_lines],
      regime_category: typeof selection === 'string' ? undefined : selection.category,
    };
  });
}

export function resolveRegimeStrategyName(
  explicitName?: string,
  localizedDefault: string = DEFAULT_REGIME_STRATEGY_NAME,
): string {
  const candidate = explicitName?.trim() || localizedDefault.trim() || DEFAULT_REGIME_STRATEGY_NAME;
  return candidate.slice(0, MAX_STRATEGY_NAME_LENGTH);
}

export function mapRegimeToCaseType(regime: string): string {
  if (regime.startsWith('bespoke_')) return regime;
  const mapped = {
    trend: 'TREND_DETECTION',
    range: 'RANGE_DETECTION',
    consolidation: 'CONSOLIDATION_DETECTION',
    oscillation: 'OSCILLATION_DETECTION',
  }[regime];
  return mapped ?? regime.toUpperCase();
}

export function buildRegimeStrategyGenerationRequest(
  input: RegimeStrategyGenerationRequestInput,
): Record<string, unknown> {
  const autoReverse = input.autoReverse !== false;
  if (!autoReverse) {
    const categories = new Set(input.indicators.map((indicator) => indicator.regime_category));
    const missing = (['trend', 'range'] as const).filter((category) => !categories.has(category));
    if (missing.length > 0) {
      throw new Error(
        `Manual signal mode requires at least one indicator in each regime category. Missing: ${missing.join(', ')}.`,
      );
    }
  }
  const serverIndicators = input.indicators.map((indicator) => ({
    type: indicator.slug.toLocaleLowerCase('en-US'),
    name: indicator.slug,
    params: { ...indicator.parameters },
    template_key: indicator.template_key,
    rule_logic: indicator.rule_logic,
    output_lines: [...indicator.output_lines],
    ...(!autoReverse ? { category: indicator.regime_category } : {}),
  }));
  const indicatorSummary = input.indicators
    .map((indicator) => {
      const params = Object.entries(indicator.parameters)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(', ');
      return params ? `${indicator.slug}(${params})` : indicator.slug;
    })
    .join(' AND ');
  const regimeLabel = input.regime.replace(/_/g, ' ');
  const prompt = input.preference
    ? `${input.preference}\n\nRules: ${indicatorSummary}`
    : `Generate a ${regimeLabel} strategy using: ${indicatorSummary}`;

  return {
    strategy_name: input.strategyName,
    locale: input.locale,
    output_format: 'v3',
    storage_mode: 'local',
    language: 'cpp',
    auto_reverse: autoReverse,
    analysis_config: {
      regime: [{
        case_type: mapRegimeToCaseType(input.regime),
        params: {
          indicators: serverIndicators,
          factors: [],
        },
      }],
      llm_config: {
        prompt,
        provider: toApiProvider(input.llmProvider),
        model: input.llmModel,
      },
      auto_reverse: autoReverse,
    },
    ...(input.apiKey ? { llm_api_key: input.apiKey } : {}),
    ...(input.persona ? { persona: input.persona } : {}),
    ...(input.preference ? { preference: input.preference } : {}),
  };
}
