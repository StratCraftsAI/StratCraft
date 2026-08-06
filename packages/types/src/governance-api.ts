/**
 * TICKET_1303_100 Phase 4: the QuantNexus-side projection of the nona_server
 * governance API contract.
 *
 * nona_server owns the authoritative API schema and publishes a pinned
 * OpenAPI 3.1 artifact plus its RFC 8785 content digest. Both are vendored
 * into `contracts/` and verified by `codegen:governance-api:check`, which
 * recomputes the digest here rather than trusting the copied value.
 *
 * This is the anti-corruption boundary described in the umbrella ticket's
 * cross-repo contract ownership table: QuantNexus consumes the projection, it
 * does not extend or re-declare the server's schemas.
 */
import {
  GOVERNANCE_API_VERSION,
  GOVERNANCE_API_HASH,
  GOVERNANCE_API_ENDPOINTS,
  GOVERNANCE_API_ENDPOINT_COUNT,
  GOVERNANCE_API_SCHEMA_NAMES,
} from './governance-api.generated';

export {
  GOVERNANCE_API_VERSION,
  GOVERNANCE_API_HASH,
  GOVERNANCE_API_ENDPOINTS,
  GOVERNANCE_API_ENDPOINT_COUNT,
  GOVERNANCE_API_SCHEMA_NAMES,
};

/** Relative path of the vendored artifact, for tooling and contract tests. */
export const GOVERNANCE_API_ARTIFACT_PATH =
  'contracts/governance-api-v1.openapi.json' as const;

export type GovernanceApiOperationId =
  (typeof GOVERNANCE_API_ENDPOINTS)[number]['operationId'];

export type GovernanceApiSchemaName = (typeof GOVERNANCE_API_SCHEMA_NAMES)[number];

export interface GovernanceApiEndpoint {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
}

const ENDPOINTS_BY_OPERATION_ID = new Map<string, GovernanceApiEndpoint>(
  GOVERNANCE_API_ENDPOINTS.map((endpoint) => [endpoint.operationId, endpoint]),
);

/**
 * Resolve a governance endpoint by its server-assigned operation id.
 *
 * Fails fast (TICKET_857): an unknown operation id means the caller is coded
 * against an endpoint this projection does not carry, which is exactly the
 * drift this contract exists to surface.
 */
export function getGovernanceApiEndpoint(
  operationId: GovernanceApiOperationId,
): GovernanceApiEndpoint {
  const endpoint = ENDPOINTS_BY_OPERATION_ID.get(operationId);
  if (!endpoint) {
    throw new Error(
      `Unknown governance API operation id '${operationId}'. `
        + `The vendored projection (${GOVERNANCE_API_VERSION}, ${GOVERNANCE_API_HASH}) `
        + 'does not declare it; re-vendor from nona_server if the endpoint is new.',
    );
  }
  return endpoint;
}
