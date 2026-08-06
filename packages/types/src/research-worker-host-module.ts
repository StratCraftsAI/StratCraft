import type { ResearchWorkerHostDiscovery } from './research-worker-protocol';

export const RESEARCH_WORKER_HOST_MODULE_REGISTER_EXPORT =
  'registerCommercialHostCapabilities' as const;

export interface ResearchWorkerExecutionPolicy {
  readonly entitlementId: string;
  readonly entitlementError: {
    readonly code: string;
    readonly message: string;
    readonly remediation: string;
  };
}

export interface ResearchWorkerExecutionSurface {
  readonly discover: () => Promise<ResearchWorkerHostDiscovery>;
  readonly execute: (
    request: unknown,
    onProgress?: (payload: unknown) => void,
  ) => Promise<unknown>;
  readonly cancel: (requestId: string) => Promise<boolean>;
  readonly cancelAll: () => Promise<void>;
  readonly getActiveRequestIds: () => readonly string[];
}

export interface ResearchWorkerHostModuleRegistrationContext {
  readonly contractVersion: '1.0.0';
  readonly createExecutionSurface: (
    policy: ResearchWorkerExecutionPolicy,
  ) => ResearchWorkerExecutionSurface;
  readonly registerIpcHandler: (
    channel: string,
    handler: (...args: readonly unknown[]) => Promise<unknown>,
  ) => void;
  readonly publishProgress: (channel: string, payload: unknown) => void;
}

export type ResearchWorkerHostModuleRegistrar = (
  context: ResearchWorkerHostModuleRegistrationContext,
) => void | Promise<void>;
