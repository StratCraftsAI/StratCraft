import { describe, expect, it } from 'vitest';

import {
  applyLinoUserModelSelection,
  filterLinoModels,
  shouldExposeProviderModels,
} from '../lino-model-selection';

const models = [
  { id: 'gpt-4o', name: 'GPT 4o' },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
  { id: 'text-embedding-3', name: 'Text Embedding 3' },
];

describe('filterLinoModels', () => {
  it('returns all models for an empty search', () => {
    expect(filterLinoModels(models, '  ')).toEqual(models);
  });

  it('searches model ids and names case-insensitively', () => {
    expect(filterLinoModels(models, 'SONNET')).toEqual([models[1]]);
    expect(filterLinoModels(models, 'embedding-3')).toEqual([models[2]]);
  });
});

describe('applyLinoUserModelSelection', () => {
  const providers = [
    { id: 'LINO', models },
    { id: 'OPENAI', models: [models[0]] },
  ];

  it('exposes only enabled Lino models and leaves other providers unchanged', () => {
    const result = applyLinoUserModelSelection(providers, ['claude-sonnet-4']);
    expect(result[0].models).toEqual([models[1]]);
    expect(result[1]).toBe(providers[1]);
  });

  it('defaults an absent preference to all models and preserves explicit disable-all', () => {
    expect(applyLinoUserModelSelection(providers, undefined)).toEqual(providers);
    expect(applyLinoUserModelSelection(providers, [])).toEqual([providers[1]]);
    expect(applyLinoUserModelSelection(providers, 'gpt-4o')).toEqual(providers);
  });

  it('ignores non-string entries in persisted arrays', () => {
    expect(applyLinoUserModelSelection(providers, ['gpt-4o', 42])[0].models).toEqual([models[0]]);
  });
});

describe('shouldExposeProviderModels', () => {
  it('shows a single curated Lino model as a selectable child row', () => {
    expect(shouldExposeProviderModels({ id: 'LINO', models: [models[0]] })).toBe(true);
  });

  it('uses the normal multi-model rule for other providers', () => {
    expect(shouldExposeProviderModels({ id: 'OPENAI', models: [models[0]] })).toBe(false);
    expect(shouldExposeProviderModels({ id: 'OPENAI', models: models.slice(0, 2) })).toBe(true);
  });
});
