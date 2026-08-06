/**
 * TICKET_1265_7 D2: Per-provider LLM credential metadata -- the cross-package
 * single source of truth for how each provider is authenticated.
 *
 * Lifted out of the desktop plugin config (TICKET_483 left placeholder/pattern/
 * inputType in the plugin layer) and the renderer `llm-contributions.ts`
 * literals so BOTH the desktop shared constants (`shared/constants/llm-providers.ts`)
 * AND the standalone MCP package (which can only import from `@StratCraft/types`,
 * not from `apps/desktop/src/shared`) render credential fields from ONE source.
 *
 * `kind` distinguishes an API key from a base URL. `required:false` (Ollama)
 * means the provider is usable with NO stored secret: pickers list it
 * unconditionally and the access gate never refuses it for a missing key.
 * `pattern` guards the entry surface at BOTH webui and desktop so an `sk-...`
 * value can never land in the `llm.ollama.baseUrl` keychain slot.
 */

import {
  LLM_SIGNUP_URL_CLAUDE, LLM_SIGNUP_URL_OPENAI, LLM_SIGNUP_URL_GEMINI,
  LLM_SIGNUP_URL_DEEPSEEK, LLM_SIGNUP_URL_GROK, LLM_SIGNUP_URL_QWEN,
  LLM_SIGNUP_URL_OLLAMA, LLM_SIGNUP_URL_LINO,
} from './provider-urls';
import {
  LLM_PROVIDER_CLAUDE, LLM_PROVIDER_OPENAI, LLM_PROVIDER_GEMINI,
  LLM_PROVIDER_DEEPSEEK, LLM_PROVIDER_GROK, LLM_PROVIDER_QWEN,
  LLM_PROVIDER_OLLAMA, LLM_PROVIDER_LINO, LLM_PROVIDER_OPENAI_COMPATIBLE,
} from './llm-provider-id';
import { LLM_CREDENTIAL_KEYS } from './credential-keys';

/**
 * TICKET_1266: a secondary credential field a provider needs beyond its
 * primary `secretKey`. Today only OPENAI_COMPATIBLE uses this -- its API key
 * is the primary `secretKey` (the "configured" gate), and the base URL is a
 * second required field, resolved separately by the fetcher/validator/agent
 * loop. Rendered by both the desktop and webui credential surfaces.
 */
export interface LLMExtraCredentialField {
  /** Storage key under the host pluginId (a value in LLM_CREDENTIAL_KEYS). */
  key: string;
  kind: 'apiKey' | 'baseUrl';
  required: boolean;
  inputType: 'password' | 'url';
  /** Client + server validation regex. */
  pattern?: string;
  placeholder: string;
}

export interface LLMCredentialMeta {
  kind: 'apiKey' | 'baseUrl';
  /** false for Ollama (local base URL, always usable without a stored secret) */
  required: boolean;
  inputType: 'password' | 'url';
  /** Client + server validation regex (e.g. '^sk-ant-', '^https?://.+') */
  pattern?: string;
  /** Placeholder shown in the credential entry field */
  placeholder: string;
  /** true for Ollama: no key-verifier call on save (it is a URL, not a key) */
  skipVerify?: boolean;
  /** Provider signup / docs URL surfaced next to the credential field */
  signupUrl?: string;
  /**
   * TICKET_1266: additional required credential fields beyond the primary
   * `secretKey` (e.g. OPENAI_COMPATIBLE's base URL). Rendered in declaration
   * order after the primary field. Absent for single-credential providers.
   */
  extraFields?: LLMExtraCredentialField[];
}

/** Credential metadata keyed by uppercase LLM provider id. */
export const LLM_CREDENTIAL_META: Record<string, LLMCredentialMeta> = {
  [LLM_PROVIDER_CLAUDE]: {
    kind: 'apiKey', required: true, inputType: 'password',
    pattern: '^sk-ant-', placeholder: 'sk-ant-...', signupUrl: LLM_SIGNUP_URL_CLAUDE,
  },
  [LLM_PROVIDER_OPENAI]: {
    kind: 'apiKey', required: true, inputType: 'password',
    pattern: '^sk-', placeholder: 'sk-...', signupUrl: LLM_SIGNUP_URL_OPENAI,
  },
  [LLM_PROVIDER_GEMINI]: {
    kind: 'apiKey', required: true, inputType: 'password',
    pattern: '^AIza', placeholder: 'AIza...', signupUrl: LLM_SIGNUP_URL_GEMINI,
  },
  [LLM_PROVIDER_DEEPSEEK]: {
    kind: 'apiKey', required: true, inputType: 'password',
    pattern: '^sk-', placeholder: 'sk-...', signupUrl: LLM_SIGNUP_URL_DEEPSEEK,
  },
  [LLM_PROVIDER_GROK]: {
    kind: 'apiKey', required: true, inputType: 'password',
    pattern: '^xai-', placeholder: 'xai-...', signupUrl: LLM_SIGNUP_URL_GROK,
  },
  [LLM_PROVIDER_QWEN]: {
    kind: 'apiKey', required: true, inputType: 'password',
    pattern: '^sk-', placeholder: 'sk-...', signupUrl: LLM_SIGNUP_URL_QWEN,
  },
  [LLM_PROVIDER_OLLAMA]: {
    kind: 'baseUrl', required: false, inputType: 'url',
    pattern: '^https?://.+', placeholder: 'http://localhost:11434',
    skipVerify: true, signupUrl: LLM_SIGNUP_URL_OLLAMA,
  },
  [LLM_PROVIDER_LINO]: {
    kind: 'apiKey', required: true, inputType: 'password',
    placeholder: 'your-lino-api-key', signupUrl: LLM_SIGNUP_URL_LINO,
  },
  // TICKET_1266: primary credential is the API key (`secretKey`); the base URL
  // is a required extra field. HTTPS is enforced by the validator (localhost
  // http exception), so the entry-surface pattern only requires an http(s) URL.
  [LLM_PROVIDER_OPENAI_COMPATIBLE]: {
    kind: 'apiKey', required: true, inputType: 'password',
    placeholder: 'sk-...',
    extraFields: [
      {
        key: LLM_CREDENTIAL_KEYS.OPENAI_COMPATIBLE_BASE_URL,
        kind: 'baseUrl', required: true, inputType: 'url',
        pattern: '^https?://.+', placeholder: 'https://api.example.com/v1',
      },
    ],
  },
};

/** Lookup credential metadata by provider id (case-insensitive). */
export function getLlmCredentialMeta(providerId: string): LLMCredentialMeta | undefined {
  return LLM_CREDENTIAL_META[providerId.toUpperCase()];
}

/**
 * Validate a credential value against the provider's shared `pattern`.
 * Single implementation consumed by the webui Settings entry (client-side) and
 * `setLlmCredential` (server-side) so the `sk-... -> llm.ollama.baseUrl`
 * corruption door is closed at both surfaces from ONE regex source.
 * Returns null when valid, else an i18n-agnostic reason key the caller localizes.
 */
export function validateLlmCredentialValue(
  providerId: string,
  value: string,
): 'unknownProvider' | 'empty' | 'patternMismatch' | null {
  const meta = getLlmCredentialMeta(providerId);
  if (!meta) return 'unknownProvider';
  const trimmed = value.trim();
  if (!trimmed) return meta.required ? 'empty' : null;
  if (meta.pattern && !new RegExp(meta.pattern).test(trimmed)) return 'patternMismatch';
  return null;
}
