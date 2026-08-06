/**
 * Host-side data provider contributions
 *
 * TICKET_809_1 Phase 5 (TICKET_808). Builds one
 * ProviderCredentialContribution per data provider that has stored
 * credentials today (currently: Alpaca) and registers them with the
 * shared `credentialRegistry`.
 *
 * Per TICKET_809_2 section 2: data-provider credentials remain
 * plugin-owned (Alpaca lives under
 * `pluginId = 'com.stratcraft.back-test-nexus'`), unlike global LLM
 * credentials which moved to `pluginId = 'host'`. The contribution
 * `pluginId` field reflects that ownership directly per parent ticket
 * section 12.2.
 *
 * TICKET_810 adds Alpha Vantage and Polygon as first-class
 * single-key BYOK contributions (provider classes still pending --
 * see TICKET_807 Phase 5). ClickHouse remains out: it uses
 * on-demand tunnel credentials (TICKET_140), not BYOK, and joining
 * it to this panel requires a separate design conversation.
 */

import { Briefcase, ChartLine, Database, TrendingUp } from 'lucide-react';

import {
  DATA_CREDENTIAL_KEYS,
  PROVIDER_ALPACA, PROVIDER_ALPHA_VANTAGE, PROVIDER_POLYGON, PROVIDER_TUSHARE,
  DATA_SIGNUP_URL_ALPACA,
  DATA_SIGNUP_URL_ALPHA_VANTAGE,
  DATA_SIGNUP_URL_POLYGON,
  DATA_SIGNUP_URL_TUSHARE,
} from '@StratCraft/types';
import type {
  ProviderCredentialContribution,
  ProviderIconComponent,
} from '../../shared/types/credential-contribution';
import { credentialRegistry } from './credential-registry';
import i18n from 'i18next';

// =============================================================================
// Constants
// =============================================================================

/**
 * Owning pluginId for back-test-plugin-scoped data-provider credentials.
 * Matches the value used at the credential.set call sites in the
 * back-test plugin's SecretsTab today.
 */
const BACK_TEST_PLUGIN_ID = 'com.stratcraft.back-test-nexus';

// =============================================================================
// Provider definitions
// =============================================================================

interface DataProviderMetadata {
  providerId: string;
  validateId: string;
  nameKey: string;
  icon: ProviderIconComponent;
  pluginId: string;
  fields: Array<{
    key: string;
    labelKey: string;
    placeholderKey?: string;
    inputType: 'password' | 'text' | 'url';
    required: boolean;
    pattern?: string;
  }>;
  signupUrl?: string;
  /**
   * Whether the contribution declares a verifier. Verifier wiring
   * mirrors the api-key-validator.ts Alpaca path which requires the
   * "keyId:secretKey" composite string.
   *
   * TICKET_810: mutually exclusive with `verifySingleKey`. The two
   * discriminators cover the two shapes the validator main-process
   * service supports: composite for Alpaca (keyId + secret) and
   * single for Alpha Vantage / Polygon (one api key).
   */
  verifyCompositeKey?: { keyIdField: string; secretField: string };
  /**
   * TICKET_810: single-key verifier shape. Passes the raw value of
   * `keyField` to `validateApiKey(validateId, value)` and reports the
   * usual ok/error result. Used by providers whose validation
   * endpoint accepts the key as a single string (Alpha Vantage,
   * Polygon).
   */
  verifySingleKey?: { keyField: string };
  byokDefaultDomain?: 'us_equity';
}

const DATA_PROVIDERS: DataProviderMetadata[] = [
  {
    providerId: PROVIDER_ALPACA,
    validateId: 'ALPACA',
    nameKey: 'secretsPanel.providers.alpaca.name',
    icon: Briefcase,
    pluginId: BACK_TEST_PLUGIN_ID,
    fields: [
      {
        key: DATA_CREDENTIAL_KEYS.ALPACA_API_KEY_ID,
        labelKey: 'secretsPanel.providers.alpaca.apiKeyId',
        placeholderKey: 'secretsPanel.providers.alpaca.apiKeyIdPlaceholder',
        inputType: 'text',
        required: true,
      },
      {
        key: DATA_CREDENTIAL_KEYS.ALPACA_API_SECRET_KEY,
        labelKey: 'secretsPanel.providers.alpaca.apiSecretKey',
        placeholderKey: 'secretsPanel.providers.alpaca.apiSecretKeyPlaceholder',
        inputType: 'password',
        required: true,
      },
    ],
    signupUrl: DATA_SIGNUP_URL_ALPACA,
    verifyCompositeKey: {
      keyIdField: DATA_CREDENTIAL_KEYS.ALPACA_API_KEY_ID,
      secretField: DATA_CREDENTIAL_KEYS.ALPACA_API_SECRET_KEY,
    },
    byokDefaultDomain: 'us_equity',
  },
  // TICKET_810: BYOK credential entry for Alpha Vantage. Single-key
  // shape (one `apiKey` field). Provider class is intentionally not
  // wired yet -- this entry only enables credential storage + Test
  // button so TICKET_807 resolver work can be tested end-to-end
  // against real user keys when it lands.
  {
    providerId: PROVIDER_ALPHA_VANTAGE,
    validateId: 'ALPHA_VANTAGE',
    nameKey: 'secretsPanel.providers.alphaVantage.name',
    icon: ChartLine,
    pluginId: BACK_TEST_PLUGIN_ID,
    fields: [
      {
        key: DATA_CREDENTIAL_KEYS.ALPHA_VANTAGE_API_KEY,
        labelKey: 'secretsPanel.providers.alphaVantage.apiKey',
        placeholderKey: 'secretsPanel.providers.alphaVantage.apiKeyPlaceholder',
        inputType: 'password',
        required: true,
      },
    ],
    signupUrl: DATA_SIGNUP_URL_ALPHA_VANTAGE,
    verifySingleKey: { keyField: DATA_CREDENTIAL_KEYS.ALPHA_VANTAGE_API_KEY },
    byokDefaultDomain: 'us_equity',
  },
  // TICKET_810: BYOK credential entry for Polygon.io. Same single-key
  // shape as Alpha Vantage. Provider class wiring deferred to
  // TICKET_807 Phase 5.
  {
    providerId: PROVIDER_POLYGON,
    validateId: 'POLYGON',
    nameKey: 'secretsPanel.providers.polygon.name',
    icon: TrendingUp,
    pluginId: BACK_TEST_PLUGIN_ID,
    fields: [
      {
        key: DATA_CREDENTIAL_KEYS.POLYGON_API_KEY,
        labelKey: 'secretsPanel.providers.polygon.apiKey',
        placeholderKey: 'secretsPanel.providers.polygon.apiKeyPlaceholder',
        inputType: 'password',
        required: true,
      },
    ],
    signupUrl: DATA_SIGNUP_URL_POLYGON,
    verifySingleKey: { keyField: DATA_CREDENTIAL_KEYS.POLYGON_API_KEY },
    byokDefaultDomain: 'us_equity',
  },
  // TICKET_904_2: BYOK credential entry for Tushare Pro (China A-share).
  // Single-key shape (API token). china_a_share domain -- separate from
  // US equity BYOK default.
  {
    providerId: PROVIDER_TUSHARE,
    validateId: 'TUSHARE',
    nameKey: 'secretsPanel.providers.tushare.name',
    icon: Database,
    pluginId: BACK_TEST_PLUGIN_ID,
    fields: [
      {
        key: DATA_CREDENTIAL_KEYS.TUSHARE_API_TOKEN,
        labelKey: 'secretsPanel.providers.tushare.apiToken',
        placeholderKey: 'secretsPanel.providers.tushare.apiTokenPlaceholder',
        inputType: 'password',
        required: true,
      },
    ],
    signupUrl: DATA_SIGNUP_URL_TUSHARE,
    verifySingleKey: { keyField: DATA_CREDENTIAL_KEYS.TUSHARE_API_TOKEN },
  },
];

// =============================================================================
// Builders
// =============================================================================

function buildContribution(meta: DataProviderMetadata): ProviderCredentialContribution {
  const contribution: ProviderCredentialContribution = {
    providerId: meta.providerId,
    domain: 'data',
    nameKey: meta.nameKey,
    icon: meta.icon,
    pluginId: meta.pluginId,
    fields: meta.fields,
    signupUrl: meta.signupUrl,
    byokDefaultDomain: meta.byokDefaultDomain,
  };

  if (meta.verifyCompositeKey) {
    const { keyIdField, secretField } = meta.verifyCompositeKey;
    contribution.verify = async values => {
      const keyId = values[keyIdField];
      const secret = values[secretField];
      if (!keyId || !secret) {
        return { ok: false, error: 'secretsPanel.verifyMissingCompositeKey' };
      }
      return runValidator(meta.validateId, `${keyId}:${secret}`);
    };
  } else if (meta.verifySingleKey) {
    const { keyField } = meta.verifySingleKey;
    contribution.verify = async values => {
      const key = values[keyField];
      if (!key) {
        return { ok: false, error: 'secretsPanel.verifyMissingApiKey' };
      }
      return runValidator(meta.validateId, key);
    };
  }

  return contribution;
}

/**
 * TICKET_810: shared validator IPC wrapper. Extracted so the
 * composite-key and single-key verifier branches share a single
 * source of truth for error normalisation.
 */
async function runValidator(
  validateId: string,
  payload: string,
): Promise<{ ok: true; details: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const result = await window.electronAPI.credential.validateApiKey(
      validateId,
      payload,
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
      error: result.data.error ?? i18n.t('renderer.validation.validationFailed', { ns: 'errors', errorCode: result.data.errorCode ?? 'UNKNOWN' }),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// =============================================================================
// Public API
// =============================================================================

/** Pure inspection helper -- returns built contributions without registering them. */
export function getDataProviderContributions(): ProviderCredentialContribution[] {
  return DATA_PROVIDERS.map(buildContribution);
}

/**
 * Register every data-provider contribution with the shared
 * `credentialRegistry`. Idempotent.
 */
export function registerDataProviderContributions(): void {
  for (const contribution of getDataProviderContributions()) {
    if (credentialRegistry.has(contribution.providerId)) continue;
    credentialRegistry.register(contribution);
  }
}
