export {
  DUCKDB_CATALOG_REVISION,
  DUCKDB_DESCRIPTOR_REVISION,
  DUCKDB_IMMUTABLE_REF,
  DUCKDB_RELEASE_COMMIT,
  DUCKDB_RELEASE_PUBLISHED_AT,
  DUCKDB_REPOSITORY,
  DUCKDB_TOOL_ID,
  DUCKDB_VERSION,
  INSTALL_DISK_SAFETY_MULTIPLIER,
  MANAGED_TOOLS_DIRECTORY,
} from './constants';
export { BUNDLED_MANAGED_TOOL_CATALOG } from './duckdb-catalog';
export { ManagedToolContractError } from './errors';
export {
  resolveManagedToolArtifact,
  resolveManagedToolDescriptor,
  validateManagedToolCatalog,
} from './catalog';
export {
  requireAbsoluteUserDataRoot,
  resolveManagedToolStorePaths,
  resolveStandaloneUserDataRoot,
  type ManagedToolStorePathInput,
  type UserDataRootResolutionInput,
} from './path-resolver';
export {
  planManagedToolInstall,
  type PlanManagedToolInstallInput,
} from './planner';

