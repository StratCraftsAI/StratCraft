// -----------------------------------------------------------------------
// TICKET_1361 P0: Corrective Layer constants
// Single source of truth for all magic numbers. TICKET_179 mandate.
// -----------------------------------------------------------------------

// -- Schema versioning ---------------------------------------------------

export const CORRECTIVE_SCHEMA_VERSION = 1 as const;

// -- Configuration defaults & bounds -------------------------------------

export const DEFAULT_GATE_THRESHOLD = 0.5;
export const MIN_GATE_THRESHOLD = 0.0;
export const MAX_GATE_THRESHOLD = 1.0;

export const DEFAULT_SIZING_EXPONENT = 1.0;
export const MIN_SIZING_EXPONENT = 0.1;
export const MAX_SIZING_EXPONENT = 5.0;

// -- Feature contract ----------------------------------------------------

export const POP_FEATURE_SCHEMA_VERSION = 1 as const;
export const POP_FEATURE_COUNT_V1 = 14 as const;

// -- Training discipline -------------------------------------------------

export const MIN_CANDIDATES_FOR_TRAINING = 200;
export const MIN_POSITIVE_CLASS_SUPPORT = 30;
export const MIN_NEGATIVE_CLASS_SUPPORT = 30;
export const MIN_CALIBRATION_BIN_SUPPORT = 10;
export const DEFAULT_PURGE_EMBARGO_BARS = 0;
export const DEFAULT_N_WALK_FORWARD_FOLDS = 5;
export const MIN_WALK_FORWARD_FOLDS = 3;
export const MAX_WALK_FORWARD_FOLDS = 20;
export const DEFAULT_BOOTSTRAP_SAMPLES = 1000;
export const DEFAULT_BOOTSTRAP_BLOCK_SIZE = 10;

// -- Artifact manifest ---------------------------------------------------

export const ARTIFACT_FORMAT_ONNX = 'onnx' as const;
export const GOLDEN_VECTOR_TOLERANCE = 1e-6;

// -- Sizing policy -------------------------------------------------------

export const SIZING_POLICY_IDS = ['gate', 'sizing', 'hybrid'] as const;

// -- Outcome label -------------------------------------------------------

export const OUTCOME_TYPES = ['actual', 'shadow', 'censored'] as const;

// -- Lifecycle states ----------------------------------------------------

export const CORRECTIVE_STATES = ['disabled', 'collect_only', 'enabled'] as const;

// -- Training job states -------------------------------------------------

export const TRAINING_JOB_STATES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

// -- Error codes ---------------------------------------------------------

export const CORRECTIVE_ERROR_CODES = {
  CONFIG_INVALID_STATE_TRANSITION: 'E_COR_001',
  CONFIG_ARTIFACT_REQUIRED_FOR_ENABLED: 'E_COR_002',
  CONFIG_THRESHOLD_OUT_OF_RANGE: 'E_COR_003',
  CONFIG_UNKNOWN_SIZING_POLICY: 'E_COR_004',
  CONFIG_UNKNOWN_PROVIDER: 'E_COR_005',

  ARTIFACT_NOT_FOUND: 'E_ART_001',
  ARTIFACT_HASH_MISMATCH: 'E_ART_002',
  ARTIFACT_SCHEMA_INCOMPATIBLE: 'E_ART_003',
  ARTIFACT_FEATURE_SCHEMA_MISMATCH: 'E_ART_004',
  ARTIFACT_GOLDEN_VECTOR_FAILED: 'E_ART_005',
  ARTIFACT_ONNX_UNSUPPORTED_OPERATOR: 'E_ART_006',
  ARTIFACT_CORRUPT: 'E_ART_007',

  PREFLIGHT_ARTIFACT_LOAD_FAILED: 'E_PRE_001',
  PREFLIGHT_FEATURE_SCHEMA_MISMATCH: 'E_PRE_002',
  PREFLIGHT_GOLDEN_VECTOR_DIVERGED: 'E_PRE_003',
  PREFLIGHT_MODEL_VERSION_MISMATCH: 'E_PRE_004',

  INFERENCE_NON_FINITE_INPUT: 'E_INF_001',
  INFERENCE_NON_FINITE_OUTPUT: 'E_INF_002',
  INFERENCE_FEATURE_COUNT_MISMATCH: 'E_INF_003',
  INFERENCE_ONNX_RUNTIME_ERROR: 'E_INF_004',

  DATASET_ORPHAN_CANDIDATE: 'E_DAT_001',
  DATASET_DUPLICATE_OUTCOME: 'E_DAT_002',
  DATASET_SCHEMA_VERSION_MISMATCH: 'E_DAT_003',
  DATASET_NON_FINITE_FEATURE: 'E_DAT_004',
  DATASET_INSUFFICIENT_SAMPLES: 'E_DAT_005',
  DATASET_INSUFFICIENT_CLASS_SUPPORT: 'E_DAT_006',

  TRAINING_ALREADY_RUNNING: 'E_TRN_001',
  TRAINING_DATASET_NOT_READY: 'E_TRN_002',
  TRAINING_WORKER_CRASHED: 'E_TRN_003',
  TRAINING_CALIBRATION_FAILED: 'E_TRN_004',
  TRAINING_HOLDOUT_LEAK_DETECTED: 'E_TRN_005',
} as const;

export type CorrectiveErrorCode =
  (typeof CORRECTIVE_ERROR_CODES)[keyof typeof CORRECTIVE_ERROR_CODES];
