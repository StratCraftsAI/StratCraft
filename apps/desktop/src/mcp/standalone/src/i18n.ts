/**
 * TICKET_786_6 Phase 4: localisation for MCP tool descriptions.
 *
 * The standalone MCP server runs as a separate Node process spawned by the
 * user's MCP client (Claude Desktop, Cursor, etc.). It cannot share the
 * Electron renderer's i18next runtime, so this module is a tiny self-contained
 * resolver that:
 *
 *   1. Picks a locale from --locale=<tag> argv, then STRATCRAFT_LOCALE env,
 *      then POSIX LANG / LC_ALL (stripping the ".UTF-8" suffix), defaulting to
 *      en_US.
 *   2. Loads `<package>/locales/<locale>/mcp.json` synchronously at startup.
 *      Falls back to en_US for any missing locale file.
 *   3. Exposes `describeT(key, fallback)` for zod `.describe(...)` and
 *      registerTool `description:` payloads. Returns the resolved string, or
 *      the English fallback if the key is absent.
 *
 * Locale changes between MCP sessions take effect on process restart. This is
 * documented in TICKET_786_6 Phase 4 as an accepted limitation -- the MCP
 * client owns the spawn lifecycle.
 */
import fs from 'node:fs';
import path from 'node:path';

const SHIPPED_LOCALES = [
  'en_US',
  'zh_CN',
  'zh_TW',
  'ja_JP',
  'ko_KR',
  'de_DE',
  'es_ES',
  'fr_FR',
  'it_IT',
  'pt_PT',
  'ru_RU',
  'tr_TR',
] as const;

type ShippedLocale = (typeof SHIPPED_LOCALES)[number];
type LocaleBundle = Record<string, unknown>;

const FALLBACK_LOCALE: ShippedLocale = 'en_US';

function normaliseLocaleTag(raw: string | undefined): ShippedLocale | null {
  if (!raw) return null;
  const stripped = raw.split('.')[0].replace('-', '_');
  if ((SHIPPED_LOCALES as readonly string[]).includes(stripped)) {
    return stripped as ShippedLocale;
  }
  // Match by language prefix (e.g. "zh" -> first shipped locale starting with "zh_").
  const prefix = stripped.split('_')[0];
  const match = SHIPPED_LOCALES.find((loc) => loc.startsWith(`${prefix}_`));
  return match ?? null;
}

export function resolveLocale(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): ShippedLocale {
  const argLocale = argv
    .map((a) => /^--locale=(.+)$/.exec(a)?.[1])
    .find((v): v is string => Boolean(v));
  return (
    normaliseLocaleTag(argLocale) ??
    normaliseLocaleTag(env.STRATCRAFT_LOCALE) ??
    normaliseLocaleTag(env.LC_ALL) ??
    normaliseLocaleTag(env.LANG) ??
    FALLBACK_LOCALE
  );
}

function readBundle(locale: ShippedLocale): LocaleBundle {
  // __dirname at runtime is dist/src; locales live at <package>/locales/<locale>/mcp.json.
  // Try a few candidate roots so the resolver works both from source (ts-node) and dist.
  const candidates = [
    path.resolve(__dirname, '../../locales', locale, 'mcp.json'),
    path.resolve(__dirname, '../locales', locale, 'mcp.json'),
    path.resolve(__dirname, '..', 'locales', locale, 'mcp.json'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf-8')) as LocaleBundle;
      } catch (err) {
        console.error(`[StratCraft MCP] Failed to parse ${file}: ${(err as Error).message}`);
        return {};
      }
    }
  }
  return {};
}

function lookup(bundle: LocaleBundle, key: string): string | undefined {
  const parts = key.split('.');
  let cur: unknown = bundle;
  for (const part of parts) {
    if (cur !== null && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

export interface I18n {
  locale: ShippedLocale;
  describeT: (key: string, fallback: string) => string;
}

export function createI18n(opts?: {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
}): I18n {
  const locale = resolveLocale(opts?.argv ?? process.argv, opts?.env ?? process.env);
  const bundle = readBundle(locale);
  const fallbackBundle = locale === FALLBACK_LOCALE ? bundle : readBundle(FALLBACK_LOCALE);
  return {
    locale,
    describeT(key, fallback) {
      return lookup(bundle, key) ?? lookup(fallbackBundle, key) ?? fallback;
    },
  };
}

// Default singleton for convenient call-site use. Tests can construct their
// own via `createI18n({ argv, env })`.
let _default: I18n | null = null;
export function defaultI18n(): I18n {
  if (!_default) _default = createI18n();
  return _default;
}

export function describeT(key: string, fallback: string): string {
  return defaultI18n().describeT(key, fallback);
}

export const __testing = { normaliseLocaleTag, lookup, SHIPPED_LOCALES, FALLBACK_LOCALE };
