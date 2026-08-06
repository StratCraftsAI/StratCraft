/**
 * Main Process String Resolver
 * TICKET_786_11: Localisation for OS notifications and main-process strings.
 *
 * Generic helper that loads any namespace JSON from the locale directory,
 * resolves a dot-path key, and interpolates {{placeholder}} tokens.
 * Falls back to en_US when a locale file or key is missing.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { appLog } from '../utils/logger';
import { DEFAULT_LOCALE } from '../../i18n/config';

// Cache: Map<`${locale}/${namespace}`, parsedJSON>
const cache = new Map<string, Record<string, unknown>>();

/**
 * Clear cache (for testing)
 */
export function clearMainStringsCache(): void {
  cache.clear();
}

/**
 * Load and cache a namespace JSON file for the given locale.
 */
function loadNamespace(locale: string, namespace: string): Record<string, unknown> {
  const cacheKey = `${locale}/${namespace}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const localesDir = path.join(app.getAppPath(), 'src/i18n/locales');
  const filePath = path.join(localesDir, locale, `${namespace}.json`);

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const bundle = JSON.parse(content) as Record<string, unknown>;
      cache.set(cacheKey, bundle);
      return bundle;
    }
  } catch (err) {
    appLog.error(`[I18N] Failed to load ${namespace}.json for ${locale}: ${err}`);
  }

  // Fallback to en_US
  if (locale !== DEFAULT_LOCALE) {
    return loadNamespace(DEFAULT_LOCALE, namespace);
  }

  return {};
}

/**
 * Resolve a dot-path key from a nested JSON object.
 * e.g. resolveKey(obj, "notifications.sweep.allComplete") traverses obj.notifications.sweep.allComplete
 */
function resolveKey(obj: Record<string, unknown>, dotPath: string): string | undefined {
  const parts = dotPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

/**
 * Interpolate {{placeholder}} tokens in a string.
 */
function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return key in params ? String(params[key]) : `{{${key}}}`;
  });
}

/**
 * Resolve a localised string for the main process.
 *
 * @param locale   Current locale code (e.g. "ja_JP")
 * @param namespace  JSON filename without extension (e.g. "ui", "errors")
 * @param key      Dot-path key inside the namespace (e.g. "notifications.sweep.allCompleteTitle")
 * @param params   Optional interpolation values
 * @returns Resolved string, or the key itself as ultimate fallback
 */
export function mainT(
  locale: string,
  namespace: string,
  key: string,
  params?: Record<string, string | number>,
): string {
  // Try requested locale
  const bundle = loadNamespace(locale, namespace);
  let resolved = resolveKey(bundle, key);

  // Fallback to en_US if not found in requested locale
  if (resolved === undefined && locale !== DEFAULT_LOCALE) {
    const fallbackBundle = loadNamespace(DEFAULT_LOCALE, namespace);
    resolved = resolveKey(fallbackBundle, key);
  }

  // Ultimate fallback: return the key
  if (resolved === undefined) {
    appLog.warn(`[I18N] Missing key ${namespace}:${key} for locale ${locale}`);
    return key;
  }

  return params ? interpolate(resolved, params) : resolved;
}
