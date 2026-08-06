/**
 * @host/secrets type shim
 *
 * TICKET_809_4a. Public type surface exposed to plugin bundles via the
 * `@host/secrets` alias. Plugins do NOT compile against the SecretsPanel
 * source -- they compile against this declaration file so:
 *   1. Host-only ambient types (electronAPI shape, credential types) do
 *      not need to be visible inside plugin tsconfig.
 *   2. The plugin's contract is explicit -- changes here are deliberate
 *      API additions, not accidental source-file drift.
 *   3. At runtime the import resolves against the host vite alias
 *      (bundled plugins) or globalThis.__nexus_host__ (IIFE plugins) --
 *      the same components either way.
 *
 * Surface area is intentionally narrow. Add only what a plugin shell
 * legitimately needs to render.
 */

import type { ComponentType } from 'react';

export type ProviderCredentialContributionId = string;

export interface SecretsPanelFilter {
  domains?: Array<'llm' | 'data' | 'oauth'>;
  providerIds?: ProviderCredentialContributionId[];
}

export interface SecretsPanelModalProps {
  visible: boolean;
  onClose: () => void;
  filter: SecretsPanelFilter;
  headingKey?: string;
  autoCloseOnConfigured?: boolean;
}

export const SecretsPanelModal: ComponentType<SecretsPanelModalProps>;

export interface ProviderCardProps {
  contribution: unknown;
  onConfigured?: (providerId: ProviderCredentialContributionId) => void;
}

export const ProviderCard: ComponentType<ProviderCardProps>;

export interface SecurityStatusBannerProps {
  className?: string;
}

export const SecurityStatusBanner: ComponentType<SecurityStatusBannerProps>;
