export interface LinoModelLike {
  id: string;
  name: string;
}

export interface LinoProviderLike<M extends LinoModelLike = LinoModelLike> {
  id: string;
  models: M[];
}

export function filterLinoModels<M extends LinoModelLike>(models: M[], query: string): M[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return models;
  return models.filter(model =>
    model.id.toLocaleLowerCase().includes(normalized) ||
    model.name.toLocaleLowerCase().includes(normalized),
  );
}

export function applyLinoUserModelSelection<P extends LinoProviderLike>(
  providers: P[],
  enabledModelIds: unknown,
): P[] {
  // No persisted preference means all discovered LinoAPI models are enabled.
  // An explicit empty array remains a deliberate "disable all" choice.
  if (!Array.isArray(enabledModelIds)) return providers;
  const enabled = new Set(
    enabledModelIds.filter((id): id is string => typeof id === 'string'),
  );
  return providers.flatMap(provider => {
    if (provider.id !== 'LINO') return [provider];
    const models = provider.models.filter(model => enabled.has(model.id));
    return models.length > 0 ? [{ ...provider, models }] : [];
  });
}

export function shouldExposeProviderModels(provider: LinoProviderLike): boolean {
  return provider.models.length > 1 || (provider.id === 'LINO' && provider.models.length > 0);
}
