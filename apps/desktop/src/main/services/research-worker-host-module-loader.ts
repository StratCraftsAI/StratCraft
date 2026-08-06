/**
 * Verified commercial host-module loader.
 *
 * This public host boundary loads only the exact CommonJS entrypoint returned
 * by ResearchWorkerPackageVerifier. Commercial policy enters through the
 * package-owned registrar and receives only the versioned, policy-free
 * registration context.
 */

import { createRequire } from 'node:module';
import {
  RESEARCH_WORKER_HOST_MODULE_CONTRACT_VERSION,
  RESEARCH_WORKER_HOST_MODULE_REGISTER_EXPORT,
  type ResearchWorkerHostModuleRegistrar,
  type ResearchWorkerHostModuleRegistrationContext,
} from '@StratCraft/types';
import {
  getResearchWorkerPackageVerifier,
  type ResearchWorkerPackageVerifier,
} from './research-worker-package';

interface HostModuleExports {
  readonly registerCommercialHostCapabilities: ResearchWorkerHostModuleRegistrar;
}

export interface ResearchWorkerHostModuleLoaderDependencies {
  readonly verifier: ResearchWorkerPackageVerifier;
  readonly loadModule: (modulePath: string) => unknown;
}

export class ResearchWorkerHostModuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResearchWorkerHostModuleError';
  }
}

function parseHostModuleExports(input: unknown): HostModuleExports {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ResearchWorkerHostModuleError(
      'The verified commercial host module must export a CommonJS object.',
    );
  }
  const exportsObject = input as Record<string, unknown>;
  const keys = Object.keys(exportsObject);
  if (
    keys.length !== 1
    || keys[0] !== RESEARCH_WORKER_HOST_MODULE_REGISTER_EXPORT
    || typeof exportsObject[RESEARCH_WORKER_HOST_MODULE_REGISTER_EXPORT] !== 'function'
  ) {
    throw new ResearchWorkerHostModuleError(
      `The verified commercial host module must export only `
      + `${RESEARCH_WORKER_HOST_MODULE_REGISTER_EXPORT}().`,
    );
  }
  return exportsObject as unknown as HostModuleExports;
}

export class ResearchWorkerHostModuleLoader {
  private readonly dependencies: ResearchWorkerHostModuleLoaderDependencies;
  private registeredManifestSha256: string | null = null;
  private registration: Promise<boolean> | null = null;

  constructor(dependencies?: Partial<ResearchWorkerHostModuleLoaderDependencies>) {
    const requireFromHere = createRequire(__filename);
    this.dependencies = {
      verifier: dependencies?.verifier ?? getResearchWorkerPackageVerifier(),
      loadModule: dependencies?.loadModule ?? ((modulePath) => requireFromHere(modulePath)),
    };
  }

  async registerActive(
    context: ResearchWorkerHostModuleRegistrationContext,
  ): Promise<boolean> {
    if (context.contractVersion !== RESEARCH_WORKER_HOST_MODULE_CONTRACT_VERSION) {
      throw new ResearchWorkerHostModuleError(
        `Host registration context version ${context.contractVersion} is incompatible with `
        + `${RESEARCH_WORKER_HOST_MODULE_CONTRACT_VERSION}.`,
      );
    }
    if (this.registration !== null) return this.registration;
    this.registration = this.registerVerified(context);
    try {
      return await this.registration;
    } finally {
      this.registration = null;
    }
  }

  private async registerVerified(
    context: ResearchWorkerHostModuleRegistrationContext,
  ): Promise<boolean> {
    const verified = await this.dependencies.verifier.verifyActivePackage();
    if (verified === null) return false;
    if (this.registeredManifestSha256 === verified.manifestSha256) return true;
    if (
      verified.manifest.hostModule.contractVersion
      !== RESEARCH_WORKER_HOST_MODULE_CONTRACT_VERSION
    ) {
      throw new ResearchWorkerHostModuleError(
        'The verified commercial host module contract is incompatible with this host.',
      );
    }
    const exportsObject = parseHostModuleExports(
      this.dependencies.loadModule(verified.hostModulePath),
    );
    await exportsObject.registerCommercialHostCapabilities(context);
    this.registeredManifestSha256 = verified.manifestSha256;
    return true;
  }
}
