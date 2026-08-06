export {
  getAuditByAlgorithm,
  listAuditEntries,
  listDeletedStrategies,
  purgeDeletedStrategy,
  restoreDeletedStrategy,
} from './strategy-persistence-store';

export type {
  AuditEntry,
  AuditListFilters,
  DeletedStrategyRecord,
  ListDeletedStrategiesOptions,
  SqliteDatabase,
  SqliteRunResult,
  SqliteStatement,
} from './strategy-persistence-store';

// TICKET_1306_4 (D4/D5): list / get / soft-delete owners.
export {
  getStrategy,
  listStrategies,
  resolveLocalStrategyName,
  softDeleteStrategy,
  SoftDeleteStrategyError,
} from './strategy-crud';

export type {
  ListStrategiesParams,
  SoftDeleteStrategyRequest,
  SoftDeleteStrategyResult,
  StrategyDetailRow,
  StrategyListRow,
} from './strategy-crud';

// TICKET_1306_4 (D6): shared classification_metadata + strategy_rules assembly.
export {
  buildStrategyClassification,
  generateSignalSource,
} from './strategy-classification';

export type {
  StrategyClassification,
  StrategyClassificationInput,
} from './strategy-classification';

// TICKET_1306_4 (D6): neutral generation-persist orchestration.
export {
  MissingPipelineDependencyError,
  persistStrategy,
} from './persist-strategy';

export type {
  PersistStrategyDeps,
  PersistStrategyInput,
  PersistStrategyInsertData,
  PersistStrategyResult,
  PostInsertInput,
} from './persist-strategy';
