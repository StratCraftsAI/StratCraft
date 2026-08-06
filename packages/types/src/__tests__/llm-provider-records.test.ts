/**
 * TICKET_1266_1: serving-kind decision for backend catalog entries.
 *
 * `isPlatformServedProvider` decides whether a `/api/llm/providers/models`
 * entry belongs to the Pro-facing projections (platform-served) or exists only
 * as BYOK curation metadata (user-endpoint providers, e.g. openai_compatible).
 */

import { describe, it, expect } from 'vitest';
import { isPlatformServedProvider, type BackendProvider } from '../llm-provider-records';

function entry(provider: string, platform_served?: boolean): BackendProvider {
  return { provider, display_name: provider, models: [], platform_served };
}

describe('isPlatformServedProvider (TICKET_1266_1)', () => {
  it('treats API-key platform providers as platform-served (derived)', () => {
    for (const id of ['claude', 'openai', 'gemini', 'deepseek', 'grok', 'qwen']) {
      expect(isPlatformServedProvider(entry(id))).toBe(true);
    }
  });

  it('derives BYOK-only for OPENAI_COMPATIBLE (required base-URL extra field)', () => {
    expect(isPlatformServedProvider(entry('openai_compatible'))).toBe(false);
    // case-insensitive on the provider id (backend sends lowercase)
    expect(isPlatformServedProvider(entry('OPENAI_COMPATIBLE'))).toBe(false);
  });

  it('derives BYOK-only for OLLAMA (primary credential is a base URL)', () => {
    expect(isPlatformServedProvider(entry('ollama'))).toBe(false);
  });

  it('keeps LinoAPI out of Pro when an older backend omits platform_served', () => {
    expect(isPlatformServedProvider(entry('lino'))).toBe(false);
  });

  it('explicit platform_served=false wins over the derivation (AC4)', () => {
    expect(isPlatformServedProvider(entry('claude', false))).toBe(false);
    expect(isPlatformServedProvider(entry('lino', false))).toBe(false);
  });

  it('explicit platform_served=true wins over the derivation (AC4)', () => {
    expect(isPlatformServedProvider(entry('openai_compatible', true))).toBe(true);
  });

  it('trusts the catalog for unknown provider ids (no credential meta)', () => {
    expect(isPlatformServedProvider(entry('some_future_provider'))).toBe(true);
  });
});
