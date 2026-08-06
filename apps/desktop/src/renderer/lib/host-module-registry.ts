/**
 * Host Module Registry
 *
 * TICKET_809_4a. Runtime registry exposing curated host renderer
 * components to plugin bundles via `globalThis.__nexus_host__`. Parallel
 * to TICKET_454_2's `__nexus_modules__` (which exposes third-party
 * libraries like React); this registry exposes first-party host UI that
 * plugins reuse to keep credential / auth UX consistent.
 *
 * Plugins import these via the `@host/<slice>` alias declared in their
 * tsconfig + vite externals. At build time the import is externalised;
 * at runtime plugin-loader rewrites the bare import to a lookup against
 * this object.
 *
 * The registry is intentionally narrow. New slices are added only when
 * a host UI element needs to be reused inside a plugin shell -- it is
 * NOT a general "host kitchen sink" escape hatch.
 */

import {
  SecretsPanelModal,
  ProviderCard,
  SecurityStatusBanner,
} from '../components/settings/SecretsPanel';
import { pluginPortManager } from './plugin-port-manager';

export interface HostSecretsSlice {
  SecretsPanelModal: typeof SecretsPanelModal;
  ProviderCard: typeof ProviderCard;
  SecurityStatusBanner: typeof SecurityStatusBanner;
}

export interface HostModuleRegistry {
  '@host/secrets': HostSecretsSlice;
  pluginPortManager: typeof pluginPortManager;
}

export const HOST_MODULES: HostModuleRegistry = {
  '@host/secrets': {
    SecretsPanelModal,
    ProviderCard,
    SecurityStatusBanner,
  },
  pluginPortManager,
};

declare global {
  // eslint-disable-next-line no-var
  var __nexus_host__: HostModuleRegistry | undefined;
}
