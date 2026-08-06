/**
 * Data Foundation Plugin (Tier 0)
 *
 * PLUGIN_TICKET_018: Shared data source components and types
 * for consumption by Tier 1 business plugins.
 */

// Types
export type {
  DataSourceOption,
  DataSourceRegion,
  SymbolSearchResult,
  SymbolSearchResponse,
  TimeframeOption,
} from './types/data-source';

// Config
export {
  DATA_PROVIDERS,
  getProviderBySecretKey,
  isPrimarySecretKey,
} from './config/data-providers';
export type { DataProvider } from './config/data-providers';

// Constants
export {
  DEFAULT_DATA_SOURCE,
  PROVIDER_REGION_MAP,
  REGION_DISPLAY_ORDER,
  REGION_LABEL_KEYS,
} from './constants';

// TICKET_383: Shared executor types (Tier 0)
export type {
  ExecutorMetrics,
  ExecutorTrade,
  EquityPoint,
  Candle,
  ExecutorResult,
} from './types/executor';

// TICKET_383: Shared format utilities (Tier 0)
export {
  formatCurrency,
  formatPercent,
  formatRatio,
  formatDate,
  getColorClass,
  safeNum,
} from './utils/format-utils';

// TICKET_383: Shared downsample utilities (Tier 0)
export {
  MAX_RENDER_POINTS,
  safeMinMax,
  downsampleOHLC,
  downsampleLTTB,
} from './utils/downsample-utils';

// TICKET_383: Shared chart utilities (Tier 0)
export {
  CANDLE_COLOR_BULLISH,
  CANDLE_COLOR_BEARISH,
  CANDLE_COLOR_UNPROCESSED,
  getCandleColor,
  isCandleProcessed,
} from './utils/chart-utils';

// Components
export { DataSourceSelectField } from './components/DataSourceSelectField';

// TICKET_077_31: Shared Combinator (Tier 0)
export { CombinatorConfig } from './components/CombinatorConfig';
export type { CombinatorConfigProps } from './components/CombinatorConfig';
export { CombinatorSection } from './components/CombinatorSection';
export type { CombinatorSectionProps } from './components/CombinatorSection';
export { FitQualityGauge } from './components/FitQualityGauge';
export { MiniProgressBar } from './components/MiniProgressBar';
export { LstmSignalSelectionPanel } from './components/LstmSignalSelectionPanel';
// TICKET_1277_3: persistent, discoverable snapshot collection (Tier 0)
export { SavedSnapshotsSection } from './components/SavedSnapshotsSection';
export type { SavedSnapshotsSectionProps } from './components/SavedSnapshotsSection';
export type {
  CombinatorConfigType,
  CombinatorMode,
  CombinatorMethodOption,
  LstmTrainingStatusSnapshot,
  LstmLiveProgress,
  LstmCompletedRun,
  LstmActiveRun,
  ConfirmSignalsPayload,
  LstmTrainingCandidateUI,
  LstmModelVersionUI,
  LstmModelManifestUI,
  LstmSnapshotEntryUI,
} from './types/combinator';

// TICKET_1015: Shared LSTM data hook (Tier 0)
export { useLstmCombinatorData } from './hooks/useLstmCombinatorData';
export type { UseLstmCombinatorDataResult } from './hooks/useLstmCombinatorData';

// TICKET_1277_3: Shared LSTM snapshot state + operations (Tier 0).
// The single owner consumed by BOTH Alpha Factory and Training Monitor.
export {
  useLstmSnapshotStore,
  getLstmSnapshotState,
  refreshSnapshots,
  saveSnapshot,
  restoreSnapshot,
  renameSnapshot,
  deleteSnapshot,
  startFresh,
  getSnapshotVersions,
  importVersionFromSnapshot,
  clearSnapshotError,
} from './stores/useLstmSnapshotStore';
export type {
  LstmSnapshotState,
  LstmSnapshotError,
  LstmSnapshotResult,
  LstmSnapshotOperation,
  UseLstmSnapshotStoreResult,
} from './stores/useLstmSnapshotStore';

// TICKET_077_31 / TICKET_998: Fit-quality contract (Tier 0)
export {
  assessFitQuality,
  getZoneColor,
  getZoneConfig,
  validateConfig,
  DEFAULT_CONFIG as LSTM_FIT_DEFAULT_CONFIG,
} from './contracts/lstm-fit-quality-contract';
export type {
  FitQualityConfig,
  FitQuality,
  DataSufficiency,
  FitZoneConfig,
  ZoneColor,
} from './contracts/lstm-fit-quality-contract';
