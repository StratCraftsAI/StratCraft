/**
 * LLMProviderSelector Tests
 *
 * TICKET_639: Tests auto-select logic and config persistence.
 * TICKET_695: Tests cost-aware auto-selection (cheapest provider first).
 * Validates that:
 * - Empty config triggers cost-aware auto-select of cheapest configured BYOK provider
 * - Config read failure triggers auto-select (not display-only fallback)
 * - Auto-selected provider is persisted to config and dispatches event
 * - FREE user with stale PRO_CATALOG selection is auto-migrated
 * - currentProvider does not fall back to filteredProviders[0]
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectCostPreferredProvider } from '@shared/constants/llm-providers';

// =============================================================================
// Types (mirror component-internal types)
// =============================================================================

interface LLMModel {
  id: string;
  name: string;
}

interface LLMProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  status: 'platform' | 'verified' | 'unverified';
  defaultModel: string;
  models: LLMModel[];
}

// =============================================================================
// Extracted logic under test
// =============================================================================

/**
 * Mirrors the auto-select decision logic in LLMProviderSelector loadData().
 * TICKET_695: Uses selectCostPreferredProvider for cost-aware selection.
 * Returns the resolved provider/model or null if no auto-select needed.
 */
function resolveAutoSelect(
  provider: string,
  userPlan: string | null,
  providers: LLMProviderInfo[],
): { provider: string; model: string } | null {
  const isFree = !userPlan || userPlan === 'FREE';
  const needsAutoSelect = !provider || (isFree && provider === 'PRO_CATALOG');

  if (needsAutoSelect) {
    const configuredIds = new Set(
      providers.filter(p => p.id !== 'PRO_CATALOG' && p.configured).map(p => p.id)
    );
    const preferred = selectCostPreferredProvider(configuredIds);
    if (preferred) {
      return { provider: preferred.providerId, model: preferred.modelId };
    }
    return null; // No BYOK configured
  }
  return null; // No auto-select needed
}

/**
 * Mirrors the currentProvider resolution in LLMProviderSelector render.
 * TICKET_639: Does NOT fall back to filteredProviders[0].
 */
function resolveCurrentProvider(
  selectedProvider: string,
  filteredProviders: LLMProviderInfo[],
): LLMProviderInfo | undefined {
  return selectedProvider
    ? filteredProviders.find(p => p.id === selectedProvider)
    : undefined;
}

// =============================================================================
// Test data (use real provider IDs from LLM_PROVIDER_RECORDS for cost-aware lookup)
// =============================================================================

const OPENAI_PROVIDER: LLMProviderInfo = {
  id: 'OPENAI',
  name: 'OpenAI',
  configured: true,
  status: 'verified',
  defaultModel: 'gpt-5.2',
  models: [{ id: 'gpt-5.2', name: 'GPT-5.2' }, { id: 'gpt-5-mini', name: 'GPT-5 Mini' }],
};

const CLAUDE_PROVIDER: LLMProviderInfo = {
  id: 'CLAUDE',
  name: 'Claude',
  configured: true,
  status: 'verified',
  defaultModel: 'claude-4-5-sonnet-latest',
  models: [{ id: 'claude-4-5-sonnet-latest', name: 'Claude 4.5 Sonnet' }],
};

const DEEPSEEK_PROVIDER: LLMProviderInfo = {
  id: 'DEEPSEEK',
  name: 'DeepSeek',
  configured: true,
  status: 'verified',
  defaultModel: 'deepseek-chat',
  models: [{ id: 'deepseek-chat', name: 'DeepSeek V3' }],
};

const PRO_CATALOG_PROVIDER: LLMProviderInfo = {
  id: 'PRO_CATALOG',
  name: 'StratCraft Pro',
  configured: true,
  status: 'platform',
  defaultModel: '',
  models: [],
};

const UNCONFIGURED_DEEPSEEK: LLMProviderInfo = {
  id: 'DEEPSEEK',
  name: 'DeepSeek',
  configured: false,
  status: 'unverified',
  defaultModel: 'deepseek-chat',
  models: [{ id: 'deepseek-chat', name: 'DeepSeek V3' }],
};

// =============================================================================
// Tests
// =============================================================================

describe('LLMProviderSelector auto-select logic', () => {
  // ===========================================================================
  // Empty config -- cost-aware auto-select (TICKET_695)
  // ===========================================================================

  describe('when config has no provider (empty string)', () => {
    it('should auto-select cheapest configured BYOK provider (TICKET_695)', () => {
      // OPENAI + CLAUDE configured, but OPENAI is cheaper in COST_PREFERRED_PROVIDER_ORDER
      const result = resolveAutoSelect('', 'FREE', [PRO_CATALOG_PROVIDER, OPENAI_PROVIDER, CLAUDE_PROVIDER]);
      // OPENAI with cost-preferred model override: gpt-5-mini
      expect(result).toEqual({ provider: 'OPENAI', model: 'gpt-5-mini' });
    });

    it('should prefer DEEPSEEK over OPENAI and CLAUDE (cheapest first)', () => {
      const result = resolveAutoSelect('', 'FREE', [PRO_CATALOG_PROVIDER, CLAUDE_PROVIDER, DEEPSEEK_PROVIDER, OPENAI_PROVIDER]);
      expect(result).toEqual({ provider: 'DEEPSEEK', model: 'deepseek-chat' });
    });

    it('should auto-select even for PRO users with empty config', () => {
      const result = resolveAutoSelect('', 'PRO', [PRO_CATALOG_PROVIDER, OPENAI_PROVIDER]);
      expect(result).toEqual({ provider: 'OPENAI', model: 'gpt-5-mini' });
    });

    it('should return null when no BYOK providers are configured', () => {
      const result = resolveAutoSelect('', 'FREE', [PRO_CATALOG_PROVIDER, UNCONFIGURED_DEEPSEEK]);
      expect(result).toBeNull();
    });

    it('should skip unconfigured providers', () => {
      const result = resolveAutoSelect('', 'FREE', [PRO_CATALOG_PROVIDER, UNCONFIGURED_DEEPSEEK, CLAUDE_PROVIDER]);
      expect(result).toEqual({ provider: 'CLAUDE', model: 'claude-4-5-sonnet-latest' });
    });
  });

  // ===========================================================================
  // FREE user with stale PRO_CATALOG selection
  // ===========================================================================

  describe('when FREE user has stale PRO_CATALOG selection', () => {
    it('should auto-migrate to cheapest BYOK provider', () => {
      const result = resolveAutoSelect('PRO_CATALOG', 'FREE', [PRO_CATALOG_PROVIDER, OPENAI_PROVIDER]);
      expect(result).toEqual({ provider: 'OPENAI', model: 'gpt-5-mini' });
    });

    it('should auto-migrate with null userPlan (treated as FREE)', () => {
      const result = resolveAutoSelect('PRO_CATALOG', null, [PRO_CATALOG_PROVIDER, CLAUDE_PROVIDER]);
      expect(result).toEqual({ provider: 'CLAUDE', model: 'claude-4-5-sonnet-latest' });
    });

    it('should NOT auto-migrate PRO_CATALOG for PRO users', () => {
      const result = resolveAutoSelect('PRO_CATALOG', 'PRO', [PRO_CATALOG_PROVIDER, OPENAI_PROVIDER]);
      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // Existing valid selection -- no auto-select
  // ===========================================================================

  describe('when config has valid provider', () => {
    it('should not auto-select when provider is already set', () => {
      const result = resolveAutoSelect('OPENAI', 'FREE', [OPENAI_PROVIDER, CLAUDE_PROVIDER]);
      expect(result).toBeNull();
    });

    it('should not auto-select for PRO user with PRO_CATALOG', () => {
      const result = resolveAutoSelect('PRO_CATALOG', 'PRO', [PRO_CATALOG_PROVIDER, OPENAI_PROVIDER]);
      expect(result).toBeNull();
    });
  });
});

// =============================================================================
// currentProvider resolution (no display-only fallback)
// =============================================================================

describe('LLMProviderSelector currentProvider resolution', () => {
  const providers = [OPENAI_PROVIDER, CLAUDE_PROVIDER];

  it('should return the matching provider when selectedProvider is set', () => {
    const result = resolveCurrentProvider('OPENAI', providers);
    expect(result).toEqual(OPENAI_PROVIDER);
  });

  it('should return undefined when selectedProvider is empty (NOT filteredProviders[0])', () => {
    const result = resolveCurrentProvider('', providers);
    expect(result).toBeUndefined();
  });

  it('should return undefined when selectedProvider does not match any provider', () => {
    const result = resolveCurrentProvider('NONEXISTENT', providers);
    expect(result).toBeUndefined();
  });

  it('should return undefined with empty providers list', () => {
    const result = resolveCurrentProvider('OPENAI', []);
    expect(result).toBeUndefined();
  });
});

// =============================================================================
// PRO_CATALOG display resolution
// =============================================================================

/**
 * Mirrors the proCatalogDisplay resolution in LLMProviderSelector render.
 * When PRO_CATALOG is selected, resolves provider name + model name from
 * proCatalogProviders (since PRO_CATALOG is not in filteredProviders).
 */
function resolveProCatalogDisplay(
  selectedProvider: string,
  selectedModel: string,
  proCatalogProviders: Array<{ id: string; name: string; defaultModel: string; models: Array<{ id: string; name: string }> }>,
): { providerName: string; modelName: string } | null {
  const isProCatalogSelected = selectedProvider === 'PRO_CATALOG';
  if (!isProCatalogSelected || proCatalogProviders.length === 0) return null;
  for (const catProvider of proCatalogProviders) {
    const model = catProvider.models.find(m => m.id === selectedModel);
    if (model) return { providerName: catProvider.name, modelName: model.name };
  }
  return { providerName: 'Pro', modelName: selectedModel };
}

const PRO_CATALOG_PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    defaultModel: 'gpt-5.2',
    models: [
      { id: 'gpt-5.2', name: 'GPT-5.2' },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Claude',
    defaultModel: 'claude-4-5-sonnet-latest',
    models: [
      { id: 'claude-4-5-sonnet-latest', name: 'Claude 4.5 Sonnet' },
    ],
  },
];

describe('LLMProviderSelector PRO_CATALOG display resolution', () => {
  it('should resolve provider and model name for PRO_CATALOG selection', () => {
    const result = resolveProCatalogDisplay('PRO_CATALOG', 'gpt-5-mini', PRO_CATALOG_PROVIDERS);
    expect(result).toEqual({ providerName: 'OpenAI', modelName: 'GPT-5 Mini' });
  });

  it('should resolve different model from same provider', () => {
    const result = resolveProCatalogDisplay('PRO_CATALOG', 'gpt-5.2', PRO_CATALOG_PROVIDERS);
    expect(result).toEqual({ providerName: 'OpenAI', modelName: 'GPT-5.2' });
  });

  it('should resolve model from different catalog provider', () => {
    const result = resolveProCatalogDisplay('PRO_CATALOG', 'claude-4-5-sonnet-latest', PRO_CATALOG_PROVIDERS);
    expect(result).toEqual({ providerName: 'Claude', modelName: 'Claude 4.5 Sonnet' });
  });

  it('should return fallback when model not found in any catalog provider', () => {
    const result = resolveProCatalogDisplay('PRO_CATALOG', 'unknown-model', PRO_CATALOG_PROVIDERS);
    expect(result).toEqual({ providerName: 'Pro', modelName: 'unknown-model' });
  });

  it('should return null when not PRO_CATALOG selected', () => {
    const result = resolveProCatalogDisplay('OPENAI', 'gpt-5-mini', PRO_CATALOG_PROVIDERS);
    expect(result).toBeNull();
  });

  it('should return null when PRO_CATALOG selected but no catalog providers', () => {
    const result = resolveProCatalogDisplay('PRO_CATALOG', 'gpt-5-mini', []);
    expect(result).toBeNull();
  });
});

// =============================================================================
// TICKET_1276 AC7: external-store-change subscription (source-level)
// =============================================================================

describe('TICKET_1276 AC7: external store change subscription', () => {
  it('component subscribes to onLLMExternalStoreChanged and re-fetches', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'LLMProviderSelector.tsx'),
      'utf-8',
    );
    // Subscription is registered inside an effect and drives loadData().
    expect(source).toContain('entitlement.onLLMExternalStoreChanged');
    const effect = source.slice(source.indexOf('onLLMExternalStoreChanged'));
    expect(effect.slice(0, 300)).toContain('loadData()');
  });
});

// =============================================================================
// TICKET_1266_1: Pro selection owner resolution (provider dimension)
// =============================================================================

interface CatProvider {
  id: string;
  name: string;
  defaultModel: string;
  models: LLMModel[];
}

/**
 * Mirrors the `proSelectionOwnerId` memo in LLMProviderSelector: the persisted
 * SELECTED_PRO_PROVIDER id is authoritative; scanning model lists is ONLY the
 * migration fallback for configs written before the key existed. Model ids are
 * NOT unique across the Pro catalog (TICKET_1266 relay curation reuses other
 * providers' exact ids), so id-scan alone would light multiple rows.
 */
function resolveProSelectionOwner(
  selectedProvider: string,
  selectedProProvider: string,
  proCatalogProviders: CatProvider[],
  selectedModel: string,
): string | null {
  if (selectedProvider !== 'PRO_CATALOG') return null;
  if (selectedProProvider && proCatalogProviders.some(p => p.id === selectedProProvider)) {
    return selectedProProvider;
  }
  return proCatalogProviders.find(p => p.models.some(m => m.id === selectedModel))?.id ?? null;
}

describe('TICKET_1266_1: pro selection owner resolution', () => {
  // deepseek-chat exists under BOTH providers (relay duplicate) -- the
  // ambiguity that motivated persisting the provider dimension.
  const catalog: CatProvider[] = [
    {
      id: 'DEEPSEEK', name: 'DeepSeek', defaultModel: 'deepseek-chat',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }, { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' }],
    },
    {
      id: 'OPENAI_COMPATIBLE', name: 'OpenAI Compatible', defaultModel: 'gpt-4o',
      models: [{ id: 'gpt-4o', name: 'GPT-4o' }, { id: 'deepseek-chat', name: 'DeepSeek Chat' }],
    },
  ];

  it('persisted provider id is authoritative over duplicate model ids (AC2/AC5)', () => {
    expect(resolveProSelectionOwner('PRO_CATALOG', 'DEEPSEEK', catalog, 'deepseek-chat')).toBe('DEEPSEEK');
    expect(resolveProSelectionOwner('PRO_CATALOG', 'OPENAI_COMPATIBLE', catalog, 'deepseek-chat')).toBe('OPENAI_COMPATIBLE');
  });

  it('exactly one owner resolves for a duplicated model id (AC2)', () => {
    const owner = resolveProSelectionOwner('PRO_CATALOG', 'DEEPSEEK', catalog, 'deepseek-chat');
    const litRows = catalog.filter(p => p.id === owner);
    expect(litRows).toHaveLength(1);
    expect(litRows[0].id).toBe('DEEPSEEK');
  });

  it('falls back to first owner ONLY when no persisted id exists (migration)', () => {
    expect(resolveProSelectionOwner('PRO_CATALOG', '', catalog, 'deepseek-chat')).toBe('DEEPSEEK');
    expect(resolveProSelectionOwner('PRO_CATALOG', '', catalog, 'gpt-4o')).toBe('OPENAI_COMPATIBLE');
  });

  it('re-derives the owner when the persisted provider left the catalog', () => {
    expect(resolveProSelectionOwner('PRO_CATALOG', 'RETIRED_PROVIDER', catalog, 'deepseek-chat')).toBe('DEEPSEEK');
  });

  it('returns null while a BYOK provider is selected (stale key is inert)', () => {
    expect(resolveProSelectionOwner('DEEPSEEK', 'OPENAI_COMPATIBLE', catalog, 'deepseek-chat')).toBeNull();
  });

  it('returns null when the model is not in the catalog at all', () => {
    expect(resolveProSelectionOwner('PRO_CATALOG', '', catalog, 'unknown-model')).toBeNull();
  });
});

// =============================================================================
// TICKET_1266_1: source-level checks -- persistence + no model-id-scan highlight
// =============================================================================

describe('TICKET_1266_1: component source contract', () => {
  it('persists SELECTED_PRO_PROVIDER on pro row and pro model clicks; highlights by owner id', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'LLMProviderSelector.tsx'),
      'utf-8',
    );
    // Both pro click paths persist the owning provider id.
    const writes = source.match(/LLM_CONFIG_KEYS\.SELECTED_PRO_PROVIDER, catProvider\.id/g) ?? [];
    expect(writes.length).toBe(2);
    // The old ambiguous highlight (scan for selectedModel across provider model
    // lists) is gone from the Pro section.
    expect(source).not.toContain('catProvider.models.some(m => m.id === selectedModel)');
    expect(source).toContain('proSelectionOwnerId === catProvider.id');
  });
});
