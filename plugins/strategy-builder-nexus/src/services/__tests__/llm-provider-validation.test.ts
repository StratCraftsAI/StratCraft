/**
 * LLM Provider Validation Tests
 *
 * TICKET_644: Validates that service-level config validators reject
 * missing LLM provider, closing the silent fallback gap.
 */

import { describe, it, expect } from 'vitest';

import { validateMarketRegimeConfig } from '../market-regime-service';
import { validateRegimeIndicatorEntryConfig } from '../regime-indicator-entry-service';
import { validateMarketObserverConfig } from '../market-observer-service';

// =============================================================================
// Market Regime Service
// =============================================================================

describe('validateMarketRegimeConfig', () => {
  const validConfig = {
    regime: 'trend',
    rules: [{ rule_type: 'template_based' as const, indicator: { slug: 'sma', name: 'SMA' } }],
    llm_provider: 'OPENAI',
    llm_model: 'gpt-4o',
  };

  it('should pass with valid config including llm_provider', () => {
    const result = validateMarketRegimeConfig(validConfig);
    expect(result.valid).toBe(true);
  });

  it('should reject missing llm_provider', () => {
    const result = validateMarketRegimeConfig({ ...validConfig, llm_provider: undefined });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('MSG_BUILDER_VALIDATION_LLM_PROVIDER_REQUIRED');
  });

  it('should reject empty string llm_provider', () => {
    const result = validateMarketRegimeConfig({ ...validConfig, llm_provider: '' });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('MSG_BUILDER_VALIDATION_LLM_PROVIDER_REQUIRED');
  });

  it('should accept PRO_CATALOG provider (validated at workflow level)', () => {
    const result = validateMarketRegimeConfig({ ...validConfig, llm_provider: 'PRO_CATALOG' });
    expect(result.valid).toBe(true);
  });

  it('should still reject missing regime', () => {
    const result = validateMarketRegimeConfig({ ...validConfig, regime: undefined });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('MSG_BUILDER_VALIDATION_REGIME_TYPE_REQUIRED');
  });

  it('should still reject empty rules', () => {
    const result = validateMarketRegimeConfig({ ...validConfig, rules: [] });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('MSG_BUILDER_VALIDATION_AT_LEAST_ONE_RULE');
  });
});

// =============================================================================
// Regime Indicator Entry Service
// =============================================================================

describe('validateRegimeIndicatorEntryConfig', () => {
  const validConfig = {
    rules: [{ rule_type: 'template_based' as const, indicator: { slug: 'rsi', name: 'RSI' } }],
    llm_provider: 'CLAUDE',
    llm_model: 'claude-sonnet-4-20250514',
  };

  it('should pass with valid config including llm_provider', () => {
    const result = validateRegimeIndicatorEntryConfig(validConfig);
    expect(result.valid).toBe(true);
  });

  it('should reject missing llm_provider', () => {
    const result = validateRegimeIndicatorEntryConfig({ ...validConfig, llm_provider: undefined });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('MSG_BUILDER_VALIDATION_LLM_PROVIDER_REQUIRED');
  });

  it('should reject empty string llm_provider', () => {
    const result = validateRegimeIndicatorEntryConfig({ ...validConfig, llm_provider: '' });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('MSG_BUILDER_VALIDATION_LLM_PROVIDER_REQUIRED');
  });

  it('should still reject empty rules', () => {
    const result = validateRegimeIndicatorEntryConfig({ ...validConfig, rules: [] });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('MSG_BUILDER_VALIDATION_AT_LEAST_ONE_INDICATOR_RULE');
  });
});

// =============================================================================
// Market Observer Service
// =============================================================================

describe('validateMarketObserverConfig', () => {
  const validConfig = {
    rules: [{ rule_type: 'template_based' as const, indicator: { slug: 'ATR', name: 'ATR' } }],
    llm_provider: 'OPENAI',
    llm_model: 'gpt-4o',
  };

  it('should pass with valid config including llm_provider', () => {
    const result = validateMarketObserverConfig(validConfig);
    expect(result.valid).toBe(true);
  });

  it('should reject missing llm_provider', () => {
    const result = validateMarketObserverConfig({ ...validConfig, llm_provider: undefined });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('MSG_BUILDER_VALIDATION_LLM_PROVIDER_REQUIRED');
  });

  it('should reject empty string llm_provider', () => {
    const result = validateMarketObserverConfig({ ...validConfig, llm_provider: '' });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('MSG_BUILDER_VALIDATION_LLM_PROVIDER_REQUIRED');
  });

  it('should still reject empty rules', () => {
    const result = validateMarketObserverConfig({ ...validConfig, rules: [] });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('MSG_BUILDER_VALIDATION_AT_LEAST_ONE_RULE');
  });
});
