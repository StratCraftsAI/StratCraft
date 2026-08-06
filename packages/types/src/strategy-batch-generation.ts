export type BatchGenerationStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface BatchGenerationResult {
  algorithmId: number;
  strategyName: string;
}

export interface BatchGenerationItemError {
  index: number;
  error: string;
}

export interface BatchGenerationSkip {
  index: number;
  strategyName: string;
  reason: string;
}

export interface BatchGenerationState {
  runId: string | null;
  status: BatchGenerationStatus;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  currentName: string | null;
  results: BatchGenerationResult[];
  errors: BatchGenerationItemError[];
  skippedReasons: BatchGenerationSkip[];
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  error: string | null;
}
