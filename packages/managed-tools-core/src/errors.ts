import type { ManagedToolErrorCode } from '@StratCraft/types';

export class ManagedToolContractError extends Error {
  public readonly code: ManagedToolErrorCode;
  public readonly details: Readonly<Record<string, unknown>>;

  public constructor(
    code: ManagedToolErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'ManagedToolContractError';
    this.code = code;
    this.details = details;
  }
}

