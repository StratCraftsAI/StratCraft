/**
 * Backend C++ Validation Report Types (TICKET_650 Phase 4)
 *
 * Types for the backend 6-layer validation pipeline (ISSUE_7221):
 * L1: Contract Shape, L2: Security Scan, L3: Compilation,
 * L4: Symbol Verification, L5: Isolated Load Test, L6: Smoke Test
 */

export type ValidationLayerName = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';
export type ValidationLayerStatus = 'pass' | 'fail' | 'skip';
export type ValidationReportStatus = 'ok' | 'fail' | 'skip';

export interface ValidationLayer {
  status: ValidationLayerStatus;
  errors?: string[];
  compile_time_ms?: number; // L3 only
}

export interface ValidationReport {
  task_id: string;
  code_kind: 'cpp' | 'python';
  status: ValidationReportStatus;
  failed_layer?: ValidationLayerName;
  error_code?: string;
  error_message?: string;
  stderr_excerpt?: string;
  validation_layers: Partial<Record<ValidationLayerName, ValidationLayer>>;
}

/** Error code to user-facing message mapping */
export const VALIDATION_ERROR_MESSAGES: Record<string, string> = {
  EMPTY_CODE: 'Strategy code is empty',
  MISSING_REQUIRED_INCLUDE: 'Missing required nonabt include headers',
  MISSING_REQUIRED_CLASS: 'Strategy class not found in code',
  DANGEROUS_API_USAGE: 'Dangerous API usage detected (system calls, file I/O, etc.)',
  INLINE_ASSEMBLY_FORBIDDEN: 'Inline assembly is not allowed in strategies',
  COMPILE_FAILED: 'C++ compilation failed',
  COMPILE_TIMEOUT: 'C++ compilation timed out (exceeded 60s)',
  COMPILER_NOT_FOUND: 'C++ compiler not found on server',
  INCLUDE_ROOT_MISSING: 'nonabackTrader headers not configured on server',
  MISSING_EXPORT_SYMBOL: 'Required export symbol missing from compiled artifact',
  LOAD_CRASHED: 'Strategy crashed during isolated load test',
  LOAD_TIMEOUT: 'Strategy timed out during isolated load test',
  SMOKE_CRASHED: 'Strategy crashed during smoke test',
};

/** Human-readable labels for each validation layer */
export const VALIDATION_LAYER_LABELS: Record<ValidationLayerName, string> = {
  L1: 'Contract Shape',
  L2: 'Security Scan',
  L3: 'Compilation',
  L4: 'Symbol Verification',
  L5: 'Isolated Load Test',
  L6: 'Smoke Test',
};
