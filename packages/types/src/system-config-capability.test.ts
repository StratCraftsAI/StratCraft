import { describe, expect, it } from 'vitest';
import {
  SYSTEM_CONFIG_CAPABILITY_DEFAULTS,
  SYSTEM_CONFIG_CAPABILITY_KEYS,
  getSystemConfigCapabilityValue,
  isSystemConfigCapabilityKey,
  systemConfigChangeRequiresRestart,
  validateSystemConfigCapabilitySnapshot,
  validateSystemConfigCapabilityValue,
} from './system-config-capability';

function defaultDocument(): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(SYSTEM_CONFIG_CAPABILITY_DEFAULTS)) {
    let target = result;
    const segments = key.split('.');
    for (const segment of segments.slice(0, -1)) {
      target[segment] ??= {};
      target = target[segment] as Record<string, unknown>;
    }
    target[segments.at(-1)!] = value;
  }
  return result;
}

describe('system config capability contract', () => {
  it('accepts every authoritative default and reads every nested value', () => {
    const document = defaultDocument();
    for (const key of SYSTEM_CONFIG_CAPABILITY_KEYS) {
      expect(validateSystemConfigCapabilityValue(
        key,
        getSystemConfigCapabilityValue(document, key),
      )).toEqual(SYSTEM_CONFIG_CAPABILITY_DEFAULTS[key]);
    }
    expect(validateSystemConfigCapabilitySnapshot(document)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('rejects wrong types, invalid enums, empty paths, and numeric boundaries', () => {
    expect(() => validateSystemConfigCapabilityValue('paths.plugins', [])).toThrow();
    expect(() => validateSystemConfigCapabilityValue('sync.targetDir', false)).toThrow();
    expect(() => validateSystemConfigCapabilityValue('performance.maxBacktestTasks', 0)).toThrow();
    expect(() => validateSystemConfigCapabilityValue('scoreboard.windowBars', 501)).toThrow();
    expect(() => validateSystemConfigCapabilityValue('resourceGovernance.admissionCeilingPercent', 49)).toThrow();
  });

  it('reports the aggregate resource-cap constraint', () => {
    const document = defaultDocument();
    (document.resourceGovernance as Record<string, unknown>).sweep = { capPercent: 40 };
    (document.resourceGovernance as Record<string, unknown>).mining = { capPercent: 40 };
    (document.resourceGovernance as Record<string, unknown>).lstm = { capPercent: 40 };
    const result = validateSystemConfigCapabilitySnapshot(document);
    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.message.includes('combined caps 120'))).toBe(true);
  });

  it('classifies keys and restart semantics', () => {
    expect(isSystemConfigCapabilityKey('paths.plugins')).toBe(true);
    expect(isSystemConfigCapabilityKey('internal.secret')).toBe(false);
    expect(systemConfigChangeRequiresRestart('paths.plugins')).toBe(true);
    expect(systemConfigChangeRequiresRestart('performance.maxBacktestTasks')).toBe(false);
  });
});
