import { createRequire } from 'node:module';
import {
  COMMERCIAL_OPERATION_CONTRACT_VERSION,
  COMMERCIAL_OPERATION_IDS,
  commercialOperationIdSchema,
  commercialOperationRequestSchema,
  type CommercialCapabilityProjection,
  type CommercialHostRole,
  type CommercialOperationExecutionContext,
  type CommercialOperationId,
  type CommercialOperationProgress,
  type CommercialOperationRequest,
  type CommercialOperationResult,
} from '@StratCraft/types';
import {
  CommercialOperationRegistry,
  type CommercialOperationPackageIdentity,
} from './commercial-operation-registry';
import {
  getResearchWorkerPackageVerifier,
  type ResearchWorkerPackageVerifier,
  type VerifiedResearchWorkerPackage,
} from './research-worker-package';
import { getExtensionBridgeRegistry } from './extension-bridge-registry';

const QUANT_LAB_EXTENSION_ID = 'com.stratcraft.quant-lab';

export interface CommercialOperationRuntimeDependencies {
  readonly verifier: Pick<ResearchWorkerPackageVerifier, 'verifyActivePackage'>;
  readonly loadModule: (modulePath: string) => unknown;
  readonly createExecutionContext: (
    hostRole: CommercialHostRole,
    packageIdentity: CommercialOperationPackageIdentity,
    publishProgress: (progress: CommercialOperationProgress) => void,
  ) => CommercialOperationExecutionContext;
  readonly cancelOwnedRequests: () => Promise<void>;
}

export type CommercialOperationProgressListener = (
  progress: CommercialOperationProgress,
) => void;

function absentResult(request: CommercialOperationRequest): CommercialOperationResult {
  return {
    contractVersion: COMMERCIAL_OPERATION_CONTRACT_VERSION,
    requestId: request.requestId,
    operationId: request.operationId,
    status: 'failed',
    code: 'COMMERCIAL_PACKAGE_ABSENT',
    message: 'The Quant Lab commercial operation package is not active.',
    remediation: 'Install or reactivate the signed Quant Lab package.',
    retryable: false,
    entitlementDecisionId: null,
    resourceDecisionId: null,
  };
}

/**
 * Process-local owner of signed commercial module activation and dispatch.
 * Both transport adapters call this exact object. The registry publishes only
 * complete immutable registrations, while this owner adds request leases so a
 * deactivation can refuse, cancel and drain before package files are removed.
 */
export class CommercialOperationRuntime {
  private readonly registry = new CommercialOperationRegistry();
  private readonly dependencies: CommercialOperationRuntimeDependencies;
  private hostRole: CommercialHostRole | null = null;
  private activeIdentity: CommercialOperationPackageIdentity | null = null;
  private accepting = false;
  private activation: Promise<boolean> | null = null;
  private deactivation: Promise<boolean> | null = null;
  private readonly activeRequests = new Set<Promise<CommercialOperationResult>>();
  private readonly progressListeners = new Set<CommercialOperationProgressListener>();

  constructor(dependencies: CommercialOperationRuntimeDependencies) {
    this.dependencies = dependencies;
  }

  activate(hostRole: CommercialHostRole): Promise<boolean> {
    if (this.deactivation !== null) {
      return this.deactivation.then(() => false);
    }
    if (this.activation !== null) return this.activation;
    const pending = this.activateVerified(hostRole);
    this.activation = pending;
    return pending.finally(() => {
      if (this.activation === pending) this.activation = null;
    });
  }

  refreshActivePackage(): Promise<boolean> {
    if (this.hostRole === null) {
      throw new Error('Commercial operation runtime has no initialized host role.');
    }
    return this.activate(this.hostRole);
  }

  deactivate(manifestSha256?: string): Promise<boolean> {
    if (this.deactivation !== null) return this.deactivation;
    if (
      this.activeIdentity !== null
      && (manifestSha256 === undefined
        || this.activeIdentity.manifestSha256 === manifestSha256)
    ) {
      this.accepting = false;
    }
    const pending = this.deactivateAfterActivation(manifestSha256);
    this.deactivation = pending;
    return pending.finally(() => {
      if (this.deactivation === pending) this.deactivation = null;
    });
  }

  private async deactivateAfterActivation(manifestSha256?: string): Promise<boolean> {
    await this.activation?.catch(() => undefined);
    return this.deactivateCurrent(manifestSha256);
  }

  private async deactivateCurrent(manifestSha256?: string): Promise<boolean> {
    if (
      this.activeIdentity === null
      || (manifestSha256 !== undefined
        && this.activeIdentity.manifestSha256 !== manifestSha256)
    ) {
      return false;
    }
    this.accepting = false;
    await this.dependencies.cancelOwnedRequests();
    await Promise.allSettled([...this.activeRequests]);
    const removed = await this.registry.deactivate(manifestSha256);
    if (removed) {
      this.activeIdentity = null;
      this.hostRole = null;
    }
    return removed;
  }

  getCapability(operationId: CommercialOperationId): CommercialCapabilityProjection {
    if (this.activation !== null && !this.accepting) {
      return {
        state: 'activating',
        operationId,
        message: 'The Quant Lab package is activating. Please wait.',
      };
    }
    return this.registry.getCapability(operationId);
  }

  execute(
    requestInput: unknown,
    adapterRole: CommercialHostRole,
  ): Promise<CommercialOperationResult> {
    const request = commercialOperationRequestSchema.parse(requestInput);
    const registration = this.accepting
      ? this.registry.getOperation(request.operationId)
      : null;
    if (registration === null || this.activeIdentity === null) {
      return Promise.resolve(absentResult(request));
    }
    const context = this.dependencies.createExecutionContext(
      adapterRole,
      this.activeIdentity,
      (progress) => this.publishProgress(progress),
    );
    const execution = registration.execute(request, context);
    this.activeRequests.add(execution);
    return execution.finally(() => {
      this.activeRequests.delete(execution);
    });
  }

  subscribeProgress(listener: CommercialOperationProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  private publishProgress(progress: CommercialOperationProgress): void {
    for (const listener of this.progressListeners) listener(progress);
  }

  private async activateVerified(hostRole: CommercialHostRole): Promise<boolean> {
    const verified = await this.dependencies.verifier.verifyActivePackage();
    if (verified === null) {
      await this.deactivateCurrent();
      this.hostRole = hostRole;
      return false;
    }
    const identity = this.identityOf(verified);
    if (
      this.accepting
      && this.hostRole === hostRole
      && this.activeIdentity?.manifestSha256 === identity.manifestSha256
    ) {
      return true;
    }
    const moduleExports = this.dependencies.loadModule(verified.hostModulePath);
    await this.registry.activate({
      hostRole,
      packageIdentity: identity,
      registrationContractVersion: verified.manifest.hostModule.contractVersion,
      operationContractVersion: verified.manifest.hostModule.operationContractVersion,
      registerExport: verified.manifest.hostModule.registerExport,
      supportedHostRoles: verified.manifest.hostModule.supportedHostRoles,
      moduleExports,
      expectedOperationIds: COMMERCIAL_OPERATION_IDS,
    });
    this.hostRole = hostRole;
    this.activeIdentity = identity;
    this.accepting = true;
    return true;
  }

  private identityOf(verified: VerifiedResearchWorkerPackage): CommercialOperationPackageIdentity {
    return {
      packageId: verified.manifest.packageId,
      packageVersion: verified.manifest.packageVersion,
      manifestSha256: verified.manifestSha256,
    };
  }
}

let runtime: CommercialOperationRuntime | null = null;
let unregisterExtensionBridge: (() => void) | null = null;

export function initializeCommercialOperationRuntime(
  createExecutionContext: CommercialOperationRuntimeDependencies['createExecutionContext'],
  cancelOwnedRequests: CommercialOperationRuntimeDependencies['cancelOwnedRequests'],
): CommercialOperationRuntime {
  if (runtime !== null) return runtime;
  const requireFromHere = createRequire(__filename);
  runtime = new CommercialOperationRuntime({
    verifier: getResearchWorkerPackageVerifier(),
    loadModule: (modulePath) => requireFromHere(modulePath),
    createExecutionContext,
    cancelOwnedRequests,
  });
  unregisterExtensionBridge = getExtensionBridgeRegistry().register(
    QUANT_LAB_EXTENSION_ID,
    {
      getCapability: (command) => runtime!.getCapability(
        commercialOperationIdSchema.parse(command),
      ),
      invoke: (invocation) => runtime!.execute({
        contractVersion: COMMERCIAL_OPERATION_CONTRACT_VERSION,
        requestId: invocation.requestId,
        operationId: commercialOperationIdSchema.parse(invocation.command),
        input: invocation.input,
      }, 'electron'),
      subscribe: (listener) => runtime!.subscribeProgress((progress) =>
        listener('progress', progress as unknown as import('@StratCraft/types').ExtensionJsonValue)),
    },
  );
  return runtime;
}

export function getCommercialOperationRuntime(): CommercialOperationRuntime {
  if (runtime === null) {
    throw new Error('CommercialOperationRuntime is not initialized.');
  }
  return runtime;
}

export function getCommercialOperationRuntimeIfInitialized(): CommercialOperationRuntime | null {
  return runtime;
}

export function __resetCommercialOperationRuntimeForTest(): void {
  unregisterExtensionBridge?.();
  unregisterExtensionBridge = null;
  runtime = null;
}
