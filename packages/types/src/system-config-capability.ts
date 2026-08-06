/**
 * Typed, user-facing system configuration contract.
 *
 * This is the single allowlist consumed by Electron Main and standalone MCP.
 * It intentionally excludes schema metadata, arbitrary profiles, hot-reload
 * policy, and module paths: those are internal configuration plumbing.
 */

export const SYSTEM_CONFIG_CAPABILITY_KEYS = [
  'paths.plugins',
  'performance.maxBacktestTasks',
  'sync.targetDir',
  'scoreboard.windowBars',
  'lstm.autoTrainEnabled',
  'resourceGovernance.sweep.capPercent',
  'resourceGovernance.mining.capPercent',
  'resourceGovernance.lstm.capPercent',
  'resourceGovernance.enabled',
  'resourceGovernance.admissionCeilingPercent',
] as const;

export type SystemConfigCapabilityKey = typeof SYSTEM_CONFIG_CAPABILITY_KEYS[number];

export const SYSTEM_CONFIG_CAPABILITY_LIMITS = {
  maxBacktestTasksMin: 1,
  scoreboardWindowBarsMin: 20,
  scoreboardWindowBarsMax: 500,
  resourceCapMin: 10,
  resourceCapMax: 90,
  resourceCapAggregateMax: 90,
  admissionCeilingMin: 50,
  admissionCeilingMax: 95,
} as const;

export const SYSTEM_CONFIG_RESTART_KEYS: readonly SystemConfigCapabilityKey[] = [
  'paths.plugins',
];

export const SYSTEM_CONFIG_CAPABILITY_DEFAULTS: Readonly<
  Record<SystemConfigCapabilityKey, unknown>
> = {
  'paths.plugins': ['${APP_DATA}/plugins'],
  'performance.maxBacktestTasks': 3,
  'sync.targetDir': '',
  'scoreboard.windowBars': 60,
  'lstm.autoTrainEnabled': true,
  'resourceGovernance.sweep.capPercent': 30,
  'resourceGovernance.mining.capPercent': 30,
  'resourceGovernance.lstm.capPercent': 30,
  'resourceGovernance.enabled': true,
  'resourceGovernance.admissionCeilingPercent': 85,
};

export function isSystemConfigCapabilityKey(value: string): value is SystemConfigCapabilityKey {
  return (SYSTEM_CONFIG_CAPABILITY_KEYS as readonly string[]).includes(value);
}

export function systemConfigChangeRequiresRestart(key: SystemConfigCapabilityKey): boolean {
  return SYSTEM_CONFIG_RESTART_KEYS.includes(key);
}

function requireIntegerInRange(
  key: string,
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

export function validateSystemConfigCapabilityValue(
  key: SystemConfigCapabilityKey,
  value: unknown,
): unknown {
  const limits = SYSTEM_CONFIG_CAPABILITY_LIMITS;
  switch (key) {
    case 'paths.plugins':
      if (!Array.isArray(value) || value.length === 0 || value.some(
        item => typeof item !== 'string' || item.trim().length === 0,
      )) {
        throw new Error(`${key} must be a non-empty array of non-empty paths`);
      }
      return [...value];
    case 'performance.maxBacktestTasks':
      return requireIntegerInRange(key, value, limits.maxBacktestTasksMin);
    case 'lstm.autoTrainEnabled':
    case 'resourceGovernance.enabled':
      if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
      return value;
    case 'sync.targetDir':
      if (typeof value !== 'string') {
        throw new Error(`${key} must be a string`);
      }
      return value;
    case 'scoreboard.windowBars':
      return requireIntegerInRange(
        key, value, limits.scoreboardWindowBarsMin, limits.scoreboardWindowBarsMax,
      );
    case 'resourceGovernance.sweep.capPercent':
    case 'resourceGovernance.mining.capPercent':
    case 'resourceGovernance.lstm.capPercent':
      return requireIntegerInRange(key, value, limits.resourceCapMin, limits.resourceCapMax);
    case 'resourceGovernance.admissionCeilingPercent':
      return requireIntegerInRange(
        key, value, limits.admissionCeilingMin, limits.admissionCeilingMax,
      );
  }
}

export function getSystemConfigCapabilityValue(
  config: Record<string, unknown>,
  key: SystemConfigCapabilityKey,
): unknown {
  let current: unknown = config;
  for (const segment of key.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function validateSystemConfigCapabilitySnapshot(
  config: Record<string, unknown>,
): { valid: boolean; errors: Array<{ key: SystemConfigCapabilityKey; message: string }> } {
  const errors: Array<{ key: SystemConfigCapabilityKey; message: string }> = [];
  for (const key of SYSTEM_CONFIG_CAPABILITY_KEYS) {
    try {
      validateSystemConfigCapabilityValue(key, getSystemConfigCapabilityValue(config, key));
    } catch (error) {
      errors.push({ key, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const limits = SYSTEM_CONFIG_CAPABILITY_LIMITS;
  const capKeys = [
    'resourceGovernance.sweep.capPercent',
    'resourceGovernance.mining.capPercent',
    'resourceGovernance.lstm.capPercent',
  ] as const;
  const caps = capKeys.map(key => getSystemConfigCapabilityValue(config, key));
  if (caps.every(value => typeof value === 'number')) {
    const sum = (caps as number[]).reduce((total, value) => total + value, 0);
    if (sum > limits.resourceCapAggregateMax) {
      errors.push({
        key: 'resourceGovernance.sweep.capPercent',
        message: `resourceGovernance combined caps ${sum} exceed the aggregate maximum of ${limits.resourceCapAggregateMax}`,
      });
    }
  }
  return { valid: errors.length === 0, errors };
}
