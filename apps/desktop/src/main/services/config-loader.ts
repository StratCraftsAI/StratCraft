/**
 * ConfigLoader - JSONC file loading and path expansion
 *
 * TICKET_046: System-Level Configuration Implementation
 * Handles loading, parsing, and path variable expansion for config files.
 */

import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import * as jsonc from 'jsonc-parser';
import type {
  SystemConfig,
  ResolvedPaths,
  PathVariable,
} from '../../shared/types/config';
import { DEFAULT_SYSTEM_CONFIG } from '../../shared/types/config';
import { appLog } from '../utils/logger';

// =============================================================================
// Config Parse Error
// =============================================================================

/**
 * Error thrown when config file contains fatal parse errors.
 * Non-fatal errors (e.g., trailing commas, comments) are tolerated with warnings.
 */
export class ConfigParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigParseError';
  }
}

/**
 * JSONC ParseErrorCode values that represent fatal syntax errors.
 * These indicate the parsed result is potentially corrupt/incomplete.
 *
 * Non-fatal codes (tolerated with warning):
 *   10 = InvalidCommentToken
 *   11 = UnexpectedEndOfComment
 *
 * Note: Trailing commas are handled by allowTrailingComma option,
 * so they never appear in the errors array.
 */
const FATAL_PARSE_ERROR_CODES = new Set([
  1,  // InvalidSymbol
  2,  // InvalidNumberFormat
  3,  // PropertyNameExpected
  4,  // ValueExpected
  5,  // ColonExpected
  6,  // CommaExpected
  7,  // CloseBraceExpected
  8,  // CloseBracketExpected
  9,  // EndOfFileExpected
  12, // UnexpectedEndOfString
  13, // UnexpectedEndOfNumber
  14, // InvalidUnicode
  15, // InvalidEscapeCharacter
  16, // InvalidCharacter
]);

/**
 * Check if a JSONC parse error code is fatal (corrupts output).
 */
export function isFatalParseError(code: number): boolean {
  return FATAL_PARSE_ERROR_CODES.has(code);
}

// =============================================================================
// Path Resolution
// =============================================================================

/**
 * Get resolved path variables for current platform
 */
export function getResolvedPaths(): ResolvedPaths {
  return {
    appData: app.getPath('userData'),
    userHome: app.getPath('home'),
    userDocuments: app.getPath('documents'),
    appPath: app.getAppPath(),
  };
}

/**
 * Expand path variables in a string
 */
export function expandPathVariables(
  value: string,
  paths: ResolvedPaths
): string {
  return value
    .replace(/\$\{APP_DATA\}/g, paths.appData)
    .replace(/\$\{USER_HOME\}/g, paths.userHome)
    .replace(/\$\{USER_DOCUMENTS\}/g, paths.userDocuments)
    .replace(/\$\{APP_PATH\}/g, paths.appPath);
}

/**
 * Recursively expand path variables in config object
 */
export function expandAllPathVariables<T>(
  obj: T,
  paths: ResolvedPaths
): T {
  if (typeof obj === 'string') {
    return expandPathVariables(obj, paths) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => expandAllPathVariables(item, paths)) as T;
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandAllPathVariables(value, paths);
    }
    return result as T;
  }

  return obj;
}

// =============================================================================
// Config File Path
// =============================================================================

/**
 * Get the path to the config file
 */
export function getConfigFilePath(): string {
  const configDir = join(app.getPath('userData'), 'config');
  return join(configDir, 'StratCraft.config.jsonc');
}

/**
 * Ensure config directory exists
 */
export function ensureConfigDir(): void {
  const configPath = getConfigFilePath();
  const configDir = dirname(configPath);

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
    appLog.info('Created config directory:', configDir);
  }
}

// =============================================================================
// Config Loading
// =============================================================================

/**
 * Load and parse JSONC config file
 */
export function loadConfigFile(filePath: string): SystemConfig | null {
  if (!existsSync(filePath)) {
    appLog.debug('Config file not found:', filePath);
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const errors: jsonc.ParseError[] = [];
    const parsed = jsonc.parse(content, errors, {
      allowTrailingComma: true,
      disallowComments: false,
    });

    if (errors.length > 0) {
      const fatalErrors = errors.filter(e => isFatalParseError(e.error));
      const warnErrors = errors.filter(e => !isFatalParseError(e.error));

      if (warnErrors.length > 0) {
        appLog.warn(`JSONC parse warnings in config file (${filePath}):`);
        warnErrors.forEach((error) => {
          appLog.warn(`  - Offset ${error.offset}: ${jsonc.printParseErrorCode(error.error)}`);
        });
      }

      if (fatalErrors.length > 0) {
        fatalErrors.forEach((error) => {
          appLog.error(`  - Offset ${error.offset}: ${jsonc.printParseErrorCode(error.error)}`);
        });
        throw new ConfigParseError(
          `Config file has ${fatalErrors.length} fatal parse error(s): ${fatalErrors.map(e => jsonc.printParseErrorCode(e.error)).join(', ')}`
        );
      }
    }

    return parsed as SystemConfig;
  } catch (error) {
    if (error instanceof ConfigParseError) {
      throw error; // Fatal parse errors must propagate
    }
    appLog.error('Failed to load config file:', error);
    return null;
  }
}

/**
 * Deep merge two objects (source into target)
 */
export function deepMerge<T extends Record<string, any>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== undefined &&
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue !== undefined &&
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}

/**
 * Load config with defaults
 * Returns merged config (file config overrides defaults)
 */
export function loadConfigWithDefaults(): SystemConfig {
  const configPath = getConfigFilePath();
  const fileConfig = loadConfigFile(configPath);

  if (!fileConfig) {
    appLog.info('Using default configuration');
    return { ...DEFAULT_SYSTEM_CONFIG };
  }

  // Merge file config over defaults
  const merged = deepMerge(DEFAULT_SYSTEM_CONFIG, fileConfig);
  appLog.info('Loaded configuration from:', configPath);

  return merged;
}

/**
 * Set a value in an object using dot-notation path
 */
export function setValueByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1];
  current[lastKey] = value;
}

/**
 * Get a value from an object using dot-notation path
 */
export function getValueByPath<T>(
  obj: Record<string, unknown>,
  path: string
): T | undefined {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current as T;
}

// =============================================================================
// Config Saving
// =============================================================================

/**
 * Generate JSONC content with comments
 */
export function generateConfigContent(config: SystemConfig): string {
  const lines: string[] = [
    '{',
    '  // StratCraft System Configuration',
    '  // Documentation: https://docs.StratCraft.com/config',
    '  ',
    `  "$schema": "${config.$schema}",`,
    `  "version": ${config.version},`,
    '',
    '  // ==========================================================================',
    '  // Path Configuration',
    '  // ==========================================================================',
    '  "paths": {',
    `    "plugins": ${JSON.stringify(config.paths.plugins)}`,
    '  },',
    '',
    '  // ==========================================================================',
    '  // Performance Configuration',
    '  // ==========================================================================',
    '  "performance": {',
    `    "maxBacktestTasks": ${config.performance.maxBacktestTasks}`,
    '  },',
    '',
    '  // ==========================================================================',
    '  // Hot-Reload Settings',
    '  // ==========================================================================',
    '  "hotReload": {',
    `    "allowedKeys": ${JSON.stringify(config.hotReload.allowedKeys, null, 6).replace(/\n/g, '\n    ')}`,
    '  }',
    '}',
  ];

  return lines.join('\n');
}

/**
 * Save config to file
 */
export function saveConfigFile(config: SystemConfig): void {
  ensureConfigDir();
  const configPath = getConfigFilePath();
  const content = generateConfigContent(config);

  writeFileSync(configPath, content, 'utf-8');
  appLog.info('Saved configuration to:', configPath);
}

/**
 * Create default config file if it doesn't exist
 */
export function createDefaultConfigIfNotExists(): boolean {
  const configPath = getConfigFilePath();

  if (existsSync(configPath)) {
    return false;
  }

  ensureConfigDir();
  saveConfigFile(DEFAULT_SYSTEM_CONFIG);
  appLog.info('Created default configuration file');
  return true;
}

// =============================================================================
// Module Configuration (TICKET_055_1 UMCF)
// =============================================================================

const SYSTEM_CONFIG_PREFIXES = Object.keys(DEFAULT_SYSTEM_CONFIG);

/**
 * Check if a config path is system config
 */
export function isSystemConfigPath(path: string): boolean {
  const prefix = path.split('.')[0];
  return SYSTEM_CONFIG_PREFIXES.includes(prefix);
}

/**
 * Extract module ID from config path
 * Returns null if path is system config
 * @example 'strategy.regime.defaultLLM' -> 'strategy'
 */
export function extractModuleId(path: string): string | null {
  if (isSystemConfigPath(path)) {
    return null;
  }
  return path.split('.')[0];
}

/**
 * Get the directory for module config files
 */
export function getModuleConfigDir(): string {
  return join(app.getPath('userData'), 'config', 'modules');
}

/**
 * Get the path to a module's config file
 */
export function getModuleConfigFilePath(moduleId: string): string {
  return join(getModuleConfigDir(), `${moduleId}.config.json`);
}

/**
 * Load module config from file
 */
export function loadModuleConfig(moduleId: string): Record<string, unknown> {
  const filePath = getModuleConfigFilePath(moduleId);
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    appLog.warn(`Failed to load module config for ${moduleId}:`, error);
    return {};
  }
}

/**
 * Save module config to file
 */
export function saveModuleConfig(
  moduleId: string,
  config: Record<string, unknown>
): void {
  const dir = getModuleConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const filePath = getModuleConfigFilePath(moduleId);
  writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  appLog.debug(`Saved module config: ${filePath}`);
}

/**
 * Load all module configs from the modules directory
 */
export function loadAllModuleConfigs(): Map<string, Record<string, unknown>> {
  const configs = new Map<string, Record<string, unknown>>();
  const dir = getModuleConfigDir();

  if (!existsSync(dir)) {
    return configs;
  }

  try {
    const files = readdirSync(dir);
    for (const file of files) {
      if (file.endsWith('.config.json')) {
        const moduleId = file.replace('.config.json', '');
        configs.set(moduleId, loadModuleConfig(moduleId));
      }
    }
  } catch (error) {
    appLog.warn('Failed to load module configs:', error);
  }

  return configs;
}
