/**
 * Host-side LLM provider contributions
 *
 * TICKET_809_1 Phase 4 (TICKET_809). Builds one
 * ProviderCredentialContribution per BYOK LLM provider (Claude, OpenAI,
 * Gemini, DeepSeek, Grok, Qwen, Ollama) and registers them all with the
 * shared `credentialRegistry` (Phase 2) at app startup.
 *
 * Every provider's `verify` hits `window.electronAPI.credential.validateApiKey`
 * (the existing main-process validator from TICKET_192). Every provider's
 * `postConfigureHook` invalidates the LLM catalog so model dropdowns
 * refresh after a key is added/removed.
 *
 * This file is the single source of truth for LLM credential metadata.
 * `plugins/strategy-builder-nexus/src/config/llm-provider-ui.ts` is left
 * in place for non-credential metadata (provider list ordering for the
 * Builder model picker), but its `secretKey` field now points at the
 * same `llm.*.apiKey` keys this module declares.
 */

import {
  Brain,
  Bot,
  Cpu,
  Flame,
  Globe,
  Sparkles,
  Zap,
} from 'lucide-react';

import {
  LLM_CONTRIB_CLAUDE, LLM_CONTRIB_OPENAI, LLM_CONTRIB_GEMINI,
  LLM_CONTRIB_DEEPSEEK, LLM_CONTRIB_GROK, LLM_CONTRIB_QWEN,
  LLM_CONTRIB_OLLAMA, LLM_CONTRIB_LINO, LLM_CONTRIB_OPENAI_COMPATIBLE,
  LLM_PROVIDER_CLAUDE, LLM_PROVIDER_OPENAI, LLM_PROVIDER_GEMINI,
  LLM_PROVIDER_DEEPSEEK, LLM_PROVIDER_GROK, LLM_PROVIDER_QWEN,
  LLM_PROVIDER_OLLAMA, LLM_PROVIDER_LINO, LLM_PROVIDER_OPENAI_COMPATIBLE,
  LLM_CREDENTIAL_KEYS,
} from '@StratCraft/types';
import { getProviderRecord } from '../../shared/constants/llm-providers';
import { HOST_PLUGIN_ID } from '../../shared/types/credential-contribution';
import type {
  CredentialKeyField,
  ProviderCredentialContribution,
  ProviderIconComponent,
} from '../../shared/types/credential-contribution';
import { credentialRegistry } from './credential-registry';
import i18n from 'i18next';

// =============================================================================
// Provider metadata
// =============================================================================

/**
 * UI-only metadata (icon + i18n keys + contrib slug). The credential fields
 * (fieldKey/inputType/pattern/signupUrl/skipVerify/required) are NOT duplicated
 * here -- they are derived from the shared `LLM_PROVIDER_RECORDS` credential
 * metadata (TICKET_1265_7 D2 / TICKET_854) via `resolveProviderMeta()`.
 */
/**
 * TICKET_1266: i18n label/placeholder keys for a secondary credential field
 * (only OPENAI_COMPATIBLE's base URL today). The field's key/inputType/pattern
 * come from the shared credential meta `extraFields`; only the display strings
 * are UI-layer.
 */
interface LlmExtraFieldUi {
  /** Storage key -- must match a shared-meta extraFields[].key. */
  key: string;
  labelKey: string;
  placeholderKey: string;
}

interface LlmProviderUiMeta {
  /** Credential-registry slug (lowercase, e.g. 'claude') */
  providerId: string;
  /** Uppercase provider id used for the verifier + shared-record lookup */
  validateId: string;
  nameKey: string;
  icon: ProviderIconComponent;
  fieldLabelKey: string;
  fieldPlaceholderKey: string;
  /**
   * TICKET_1266: display strings for extra credential fields, matched to the
   * shared meta `extraFields` by `key`. Rendered before the primary field.
   */
  extraFieldsUi?: LlmExtraFieldUi[];
}

interface LlmProviderMetadata extends LlmProviderUiMeta {
  fieldKey: string;
  inputType: 'password' | 'url';
  pattern?: string;
  signupUrl?: string;
  /** Ollama is a local base URL, not an API key. Skip the verifier. */
  skipVerify?: boolean;
  /** TICKET_1266: fully-resolved extra credential fields (URL-first render). */
  extraFields: CredentialKeyField[];
}

const LLM_PROVIDER_UI: LlmProviderUiMeta[] = [
  {
    providerId: LLM_CONTRIB_CLAUDE, validateId: LLM_PROVIDER_CLAUDE,
    nameKey: 'secretsPanel.providers.claude.name', icon: Brain,
    fieldLabelKey: 'secretsPanel.providers.claude.apiKey',
    fieldPlaceholderKey: 'secretsPanel.providers.claude.apiKeyPlaceholder',
  },
  {
    providerId: LLM_CONTRIB_OPENAI, validateId: LLM_PROVIDER_OPENAI,
    nameKey: 'secretsPanel.providers.openai.name', icon: Sparkles,
    fieldLabelKey: 'secretsPanel.providers.openai.apiKey',
    fieldPlaceholderKey: 'secretsPanel.providers.openai.apiKeyPlaceholder',
  },
  {
    providerId: LLM_CONTRIB_GEMINI, validateId: LLM_PROVIDER_GEMINI,
    nameKey: 'secretsPanel.providers.gemini.name', icon: Globe,
    fieldLabelKey: 'secretsPanel.providers.gemini.apiKey',
    fieldPlaceholderKey: 'secretsPanel.providers.gemini.apiKeyPlaceholder',
  },
  {
    providerId: LLM_CONTRIB_DEEPSEEK, validateId: LLM_PROVIDER_DEEPSEEK,
    nameKey: 'secretsPanel.providers.deepseek.name', icon: Bot,
    fieldLabelKey: 'secretsPanel.providers.deepseek.apiKey',
    fieldPlaceholderKey: 'secretsPanel.providers.deepseek.apiKeyPlaceholder',
  },
  {
    providerId: LLM_CONTRIB_GROK, validateId: LLM_PROVIDER_GROK,
    nameKey: 'secretsPanel.providers.grok.name', icon: Zap,
    fieldLabelKey: 'secretsPanel.providers.grok.apiKey',
    fieldPlaceholderKey: 'secretsPanel.providers.grok.apiKeyPlaceholder',
  },
  {
    providerId: LLM_CONTRIB_QWEN, validateId: LLM_PROVIDER_QWEN,
    nameKey: 'secretsPanel.providers.qwen.name', icon: Flame,
    fieldLabelKey: 'secretsPanel.providers.qwen.apiKey',
    fieldPlaceholderKey: 'secretsPanel.providers.qwen.apiKeyPlaceholder',
  },
  {
    providerId: LLM_CONTRIB_LINO, validateId: LLM_PROVIDER_LINO,
    nameKey: 'secretsPanel.providers.lino.name', icon: Globe,
    fieldLabelKey: 'secretsPanel.providers.lino.apiKey',
    fieldPlaceholderKey: 'secretsPanel.providers.lino.apiKeyPlaceholder',
  },
  {
    providerId: LLM_CONTRIB_OLLAMA, validateId: LLM_PROVIDER_OLLAMA,
    nameKey: 'secretsPanel.providers.ollama.name', icon: Cpu,
    fieldLabelKey: 'secretsPanel.providers.ollama.baseUrl',
    fieldPlaceholderKey: 'secretsPanel.providers.ollama.baseUrlPlaceholder',
  },
  {
    // TICKET_1266: two-field provider -- the base URL (extra) renders first,
    // the API key (primary) second, matching the ticket's credential UI order.
    providerId: LLM_CONTRIB_OPENAI_COMPATIBLE, validateId: LLM_PROVIDER_OPENAI_COMPATIBLE,
    nameKey: 'secretsPanel.providers.openaiCompatible.name', icon: Globe,
    fieldLabelKey: 'secretsPanel.providers.openaiCompatible.apiKey',
    fieldPlaceholderKey: 'secretsPanel.providers.openaiCompatible.apiKeyPlaceholder',
    extraFieldsUi: [
      {
        key: LLM_CREDENTIAL_KEYS.OPENAI_COMPATIBLE_BASE_URL,
        labelKey: 'secretsPanel.providers.openaiCompatible.baseUrl',
        placeholderKey: 'secretsPanel.providers.openaiCompatible.baseUrlPlaceholder',
      },
    ],
  },
];

/**
 * TICKET_1265_7 D2: merge UI-only metadata with the shared credential record.
 * `fieldKey`, `inputType`, `pattern`, `signupUrl`, `skipVerify` come from the
 * single shared source (`LLM_PROVIDER_RECORDS[].credential` + `.secretKey`);
 * nothing about how a provider authenticates is duplicated in this file.
 */
function resolveProviderMeta(ui: LlmProviderUiMeta): LlmProviderMetadata {
  const record = getProviderRecord(ui.validateId);
  if (!record) {
    throw new Error(`[TICKET_1265_7] No shared provider record for '${ui.validateId}'`);
  }
  const { credential } = record;

  // TICKET_1266: resolve extra credential fields (base URL) from the shared
  // meta's `extraFields`, joined to the UI label/placeholder keys by storage
  // key. The field's kind/inputType/pattern/required stay owned by the shared
  // meta -- the UI layer only supplies display strings.
  const extraFields: CredentialKeyField[] = (ui.extraFieldsUi ?? []).map(uiExtra => {
    const metaExtra = (credential.extraFields ?? []).find(f => f.key === uiExtra.key);
    if (!metaExtra) {
      throw new Error(
        `[TICKET_1266] No shared credential meta extraField '${uiExtra.key}' for '${ui.validateId}'`,
      );
    }
    return {
      key: metaExtra.key,
      labelKey: uiExtra.labelKey,
      placeholderKey: uiExtra.placeholderKey,
      inputType: metaExtra.inputType,
      required: metaExtra.required,
      pattern: metaExtra.pattern,
    };
  });

  return {
    ...ui,
    fieldKey: record.secretKey,
    inputType: credential.inputType,
    pattern: credential.pattern,
    signupUrl: credential.signupUrl,
    skipVerify: credential.skipVerify,
    extraFields,
  };
}

const LLM_PROVIDERS: LlmProviderMetadata[] = LLM_PROVIDER_UI.map(resolveProviderMeta);

// =============================================================================
// Builders
// =============================================================================

async function refreshCatalog(): Promise<void> {
  try {
    await window.electronAPI.llmCatalog.refresh();
  } catch (err) {
    // Catalog refresh is best-effort. A user who just saved their key
    // should not see a save error because the dropdown couldn't refresh.
    console.warn('[W:LLM:CATALOG_REFRESH_FAILED] catalog refresh failed:', err);
  }
}

function buildContribution(meta: LlmProviderMetadata): ProviderCredentialContribution {
  const primaryField: CredentialKeyField = {
    key: meta.fieldKey,
    labelKey: meta.fieldLabelKey,
    placeholderKey: meta.fieldPlaceholderKey,
    inputType: meta.inputType,
    required: true,
    pattern: meta.pattern,
  };

  const contribution: ProviderCredentialContribution = {
    providerId: meta.providerId,
    domain: 'llm',
    nameKey: meta.nameKey,
    icon: meta.icon,
    pluginId: HOST_PLUGIN_ID,
    // TICKET_1266: extra fields (base URL) render before the primary API-key
    // field, matching the ticket's credential UI order.
    fields: [...meta.extraFields, primaryField],
    postConfigureHook: refreshCatalog,
    signupUrl: meta.signupUrl,
  };

  if (!meta.skipVerify) {
    contribution.verify = async values => {
      const apiKey = values[meta.fieldKey];
      if (!apiKey) {
        return { ok: false, error: 'secretsPanel.verifyMissingApiKey' };
      }
      // TICKET_1266: OPENAI_COMPATIBLE carries its user-supplied endpoint as an
      // extra field; forward it to the validator (undefined for others).
      const baseUrlField = meta.extraFields.find(
        f => f.key === LLM_CREDENTIAL_KEYS.OPENAI_COMPATIBLE_BASE_URL,
      );
      const baseUrl = baseUrlField ? values[baseUrlField.key] : undefined;
      try {
        const result = await window.electronAPI.credential.validateApiKey(
          meta.validateId,
          apiKey,
          baseUrl,
        );
        if (!result.success || !result.data) {
          return {
            ok: false,
            error: result.errorMessage ?? 'secretsPanel.verifyRequestFailed',
          };
        }
        if (result.data.valid) {
          return { ok: true, details: result.data as unknown as Record<string, unknown> };
        }
        return {
          ok: false,
          error: result.data.error
            ?? i18n.t('renderer.validation.validationFailed', {
              ns: 'errors',
              errorCode: result.data.errorCode ?? 'UNKNOWN',
              defaultValue: `Validation failed (${result.data.errorCode ?? 'UNKNOWN'})`,
            })
            ?? `Validation failed (${result.data.errorCode ?? 'UNKNOWN'})`,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    };
  }

  return contribution;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Return every LLM provider contribution. Pure -- no registry mutation.
 * Exposed for tests and for callers that need to inspect what would be
 * registered without actually mutating the singleton.
 */
export function getLlmContributions(): ProviderCredentialContribution[] {
  return LLM_PROVIDERS.map(buildContribution);
}

/**
 * Register every LLM provider contribution with the shared
 * `credentialRegistry`. Idempotent: calling twice is a no-op the second
 * time (each providerId is checked via `registry.has` first).
 *
 * Called once at renderer bootstrap (e.g. `apps/desktop/src/renderer/index.tsx`
 * or the host shell's plugin loader). Safe to call from React component
 * useEffect as a fallback if bootstrap wiring is not yet in place.
 */
export function registerLlmContributions(): void {
  for (const contribution of getLlmContributions()) {
    if (credentialRegistry.has(contribution.providerId)) continue;
    credentialRegistry.register(contribution);
  }
}
