import {
  COMMERCIAL_HOST_REGISTRATION_CONTRACT_VERSION,
  COMMERCIAL_OPERATION_CONTRACT_VERSION,
  COMMERCIAL_OPERATION_IDS,
  type CommercialCapabilityProjection,
  type CommercialHostModuleRegistrar,
  type CommercialHostRole,
  type CommercialOperationId,
  type CommercialOperationRegistration,
} from '@StratCraft/types';

export const COMMERCIAL_HOST_MODULE_REGISTER_EXPORT =
  'registerCommercialHostCapabilities' as const;

export type CommercialOperationRegistrationErrorCode =
  | 'COMMERCIAL_REGISTRATION_INCOMPATIBLE'
  | 'COMMERCIAL_REGISTRATION_EXPORT_MISSING'
  | 'COMMERCIAL_REGISTRATION_EXPORT_INVALID'
  | 'COMMERCIAL_REGISTRATION_DUPLICATE'
  | 'COMMERCIAL_REGISTRATION_INCOMPLETE';

export class CommercialOperationRegistrationError extends Error {
  constructor(
    readonly code: CommercialOperationRegistrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CommercialOperationRegistrationError';
  }
}

export interface CommercialOperationPackageIdentity {
  readonly packageId: 'com.stratcraft.quant-lab';
  readonly packageVersion: string;
  readonly manifestSha256: string;
}

export interface CommercialOperationActivation {
  readonly hostRole: CommercialHostRole;
  readonly packageIdentity: CommercialOperationPackageIdentity;
  readonly registrationContractVersion: string;
  readonly operationContractVersion: string;
  readonly registerExport: string;
  readonly supportedHostRoles: readonly CommercialHostRole[];
  readonly moduleExports: unknown;
  readonly expectedOperationIds: readonly CommercialOperationId[];
}

interface ActiveCommercialModule {
  readonly packageIdentity: CommercialOperationPackageIdentity;
  readonly operations: ReadonlyMap<CommercialOperationId, CommercialOperationRegistration>;
}

function parseRegistrar(activation: CommercialOperationActivation): CommercialHostModuleRegistrar {
  if (
    activation.registrationContractVersion !== COMMERCIAL_HOST_REGISTRATION_CONTRACT_VERSION
    || activation.operationContractVersion !== COMMERCIAL_OPERATION_CONTRACT_VERSION
    || activation.registerExport !== COMMERCIAL_HOST_MODULE_REGISTER_EXPORT
    || !activation.supportedHostRoles.includes(activation.hostRole)
  ) {
    throw new CommercialOperationRegistrationError(
      'COMMERCIAL_REGISTRATION_INCOMPATIBLE',
      `Commercial module registration is incompatible with host role ${activation.hostRole}.`,
    );
  }
  if (
    typeof activation.moduleExports !== 'object'
    || activation.moduleExports === null
    || Array.isArray(activation.moduleExports)
  ) {
    throw new CommercialOperationRegistrationError(
      'COMMERCIAL_REGISTRATION_EXPORT_MISSING',
      `Commercial module must export ${COMMERCIAL_HOST_MODULE_REGISTER_EXPORT}().`,
    );
  }
  const exportsObject = activation.moduleExports as Record<string, unknown>;
  const keys = Object.keys(exportsObject);
  if (!Object.hasOwn(exportsObject, COMMERCIAL_HOST_MODULE_REGISTER_EXPORT)) {
    throw new CommercialOperationRegistrationError(
      'COMMERCIAL_REGISTRATION_EXPORT_MISSING',
      `Commercial module must export ${COMMERCIAL_HOST_MODULE_REGISTER_EXPORT}().`,
    );
  }
  if (
    keys.length !== 1
    || typeof exportsObject[COMMERCIAL_HOST_MODULE_REGISTER_EXPORT] !== 'function'
  ) {
    throw new CommercialOperationRegistrationError(
      'COMMERCIAL_REGISTRATION_EXPORT_INVALID',
      `Commercial module must export only ${COMMERCIAL_HOST_MODULE_REGISTER_EXPORT}().`,
    );
  }
  return exportsObject[COMMERCIAL_HOST_MODULE_REGISTER_EXPORT] as CommercialHostModuleRegistrar;
}

export class CommercialOperationRegistry {
  private active: ActiveCommercialModule | null = null;
  private transition: Promise<void> = Promise.resolve();

  activate(activation: CommercialOperationActivation): Promise<void> {
    const pending = this.transition.then(() => this.activateTransaction(activation));
    this.transition = pending.catch(() => undefined);
    return pending;
  }

  deactivate(manifestSha256?: string): Promise<boolean> {
    let removed = false;
    const pending = this.transition.then(() => {
      if (
        this.active === null
        || (manifestSha256 !== undefined
          && this.active.packageIdentity.manifestSha256 !== manifestSha256)
      ) {
        return;
      }
      this.active = null;
      removed = true;
    });
    this.transition = pending.catch(() => undefined);
    return pending.then(() => removed);
  }

  getOperation(operationId: CommercialOperationId): CommercialOperationRegistration | null {
    return this.active?.operations.get(operationId) ?? null;
  }

  getCapability(operationId: CommercialOperationId): CommercialCapabilityProjection {
    const active = this.active;
    if (active === null) {
      return {
        state: 'absent',
        operationId,
        code: 'COMMERCIAL_PACKAGE_ABSENT',
        message: 'The Quant Lab commercial operation package is not active.',
        remediation: 'Install or reactivate the signed Quant Lab package.',
      };
    }
    if (!active.operations.has(operationId)) {
      return {
        state: 'absent',
        operationId,
        code: 'COMMERCIAL_OPERATION_UNAVAILABLE',
        message: `The active Quant Lab package does not provide ${operationId}.`,
        remediation: 'Install a compatible Quant Lab package that provides this operation.',
      };
    }
    return {
      state: 'available',
      operationId,
      contractVersion: COMMERCIAL_OPERATION_CONTRACT_VERSION,
      ...active.packageIdentity,
    };
  }

  private async activateTransaction(activation: CommercialOperationActivation): Promise<void> {
    if (this.active?.packageIdentity.manifestSha256 === activation.packageIdentity.manifestSha256) {
      return;
    }
    const registrar = parseRegistrar(activation);
    const expected = new Set(activation.expectedOperationIds);
    if (expected.size !== activation.expectedOperationIds.length) {
      throw new CommercialOperationRegistrationError(
        'COMMERCIAL_REGISTRATION_DUPLICATE',
        'The commercial module manifest declares duplicate operations.',
      );
    }
    const knownOperations = new Set<CommercialOperationId>(COMMERCIAL_OPERATION_IDS);
    const staged = new Map<CommercialOperationId, CommercialOperationRegistration>();

    await registrar({
      contractVersion: COMMERCIAL_HOST_REGISTRATION_CONTRACT_VERSION,
      hostRole: activation.hostRole,
      stageOperation: (registration) => {
        if (
          registration.contractVersion !== COMMERCIAL_OPERATION_CONTRACT_VERSION
          || !knownOperations.has(registration.operationId)
          || !expected.has(registration.operationId)
        ) {
          throw new CommercialOperationRegistrationError(
            'COMMERCIAL_REGISTRATION_INCOMPATIBLE',
            `Operation ${registration.operationId} is not compatible with this activation.`,
          );
        }
        if (staged.has(registration.operationId)) {
          throw new CommercialOperationRegistrationError(
            'COMMERCIAL_REGISTRATION_DUPLICATE',
            `Operation ${registration.operationId} was registered more than once.`,
          );
        }
        staged.set(registration.operationId, Object.freeze(registration));
      },
    });

    const missing = activation.expectedOperationIds.filter((operationId) => !staged.has(operationId));
    if (missing.length > 0) {
      throw new CommercialOperationRegistrationError(
        'COMMERCIAL_REGISTRATION_INCOMPLETE',
        `Commercial module did not register required operations: ${missing.join(', ')}.`,
      );
    }

    this.active = Object.freeze({
      packageIdentity: Object.freeze({ ...activation.packageIdentity }),
      operations: new Map(staged),
    });
  }
}
