import {
  COMMERCIAL_OPERATION_CONTRACT_VERSION,
  commercialOperationIdSchema,
  commercialOperationRequestSchema,
  type CommercialJsonObject,
  type CommercialOperationId,
  type CommercialOperationResult,
} from '@StratCraft/types';
import { randomUUID } from 'node:crypto';
import { getCommercialOperationRuntime } from '../commercial-operation-runtime';

export interface CommercialRouteResult {
  readonly success: boolean;
  readonly data?: CommercialJsonObject;
  readonly error?: string;
  readonly errorCode?: string;
  readonly remediation?: string;
  readonly retryable?: boolean;
  readonly requestId?: string;
}

export async function getCommercialCapability(body: unknown): Promise<unknown> {
  const operationId = commercialOperationIdSchema.parse(
    (body as { operationId?: unknown } | null)?.operationId,
  );
  return getCommercialOperationRuntime().getCapability(operationId);
}

export async function executeCommercialOperation(body: unknown): Promise<unknown> {
  const request = commercialOperationRequestSchema.parse(body);
  return getCommercialOperationRuntime().execute(request, 'service-api');
}

/**
 * Compatibility adapter for the established Service API routes. HTTP remains
 * a transport surface: it selects one contract operation, supplies the legacy
 * request body as input, and projects the typed package result into the common
 * `{ success, data | error }` Service API envelope. It owns no Quant Lab
 * validation, policy, persistence, or execution decision.
 */
export async function executeCommercialRoute(
  operationId: CommercialOperationId,
  input: CommercialJsonObject = {},
): Promise<CommercialRouteResult> {
  const result = await getCommercialOperationRuntime().execute({
    contractVersion: COMMERCIAL_OPERATION_CONTRACT_VERSION,
    requestId: randomUUID(),
    operationId,
    input,
  }, 'service-api');
  return projectCommercialRouteResult(result);
}

export function projectCommercialRouteResult(
  result: CommercialOperationResult,
): CommercialRouteResult {
  if (result.status === 'succeeded') {
    return {
      success: true,
      data: result.output,
      requestId: result.requestId,
    };
  }
  return {
    success: false,
    error: result.message,
    errorCode: result.code,
    remediation: result.remediation,
    retryable: result.retryable,
    requestId: result.requestId,
  };
}
