/**
 * Public host constants for the TICKET_1304_5C commercial worker boundary.
 */

export const RESEARCH_WORKER_PACKAGE_ID = 'com.stratcraft.quant-lab' as const;
export const RESEARCH_WORKER_ACTIVE_POINTER_FILE = 'active.json' as const;
export const RESEARCH_WORKER_DEFAULT_MANIFEST_FILE =
  'research-worker-package.json' as const;
export const RESEARCH_WORKER_TRUST_STORE_FILE = 'research-worker-trust.json' as const;

export const RESEARCH_WORKER_NEGOTIATION_TIMEOUT_MS = 10_000 as const;
export const RESEARCH_WORKER_CANCELLATION_GRACE_MS = 10_000 as const;
export const RESEARCH_WORKER_MAX_STDERR_BYTES = 65_536 as const;
export const RESEARCH_WORKER_STAGING_DIRECTORY = 'staging' as const;
export const RESEARCH_WORKER_PUBLISHED_DIRECTORY = 'published' as const;
export const RESEARCH_WORKER_SYSTEMD_RUN_COMMAND = 'systemd-run' as const;
export const RESEARCH_WORKER_SYSTEMD_UNIT_PREFIX = 'stratcraft-research' as const;
