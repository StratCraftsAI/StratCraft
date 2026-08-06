export interface LstmFitQualityReportRequest {
  limit?: number;
  include_incompatible?: boolean;
  include_process_state?: boolean;
}

export type LstmFitQualityConstructionErrorCode =
  | 'LSTM_MANIFEST_MISSING'
  | 'LSTM_MANIFEST_UNREADABLE'
  | 'LSTM_MANIFEST_INVALID'
  | 'LSTM_AUDIT_MISSING'
  | 'LSTM_AUDIT_UNREADABLE'
  | 'LSTM_AUDIT_INVALID'
  | 'LSTM_TERMINAL_COMPLETE_MISSING'
  | 'LSTM_GATE_VERDICT_MISSING'
  | 'LSTM_EVENT_LOG_INVALID'
  | 'LSTM_FOLD_METRICS_INVALID'
  | 'LSTM_EVIDENCE_IDENTITY_MISMATCH'
  | 'LSTM_FIT_QUALITY_INTERNAL_ERROR';

export interface LstmFitQualityConstructionErrorPayload {
  code: LstmFitQualityConstructionErrorCode;
  category: 'storage' | 'internal';
  source: string;
  message: string;
  remedy: string;
}

export type LstmFitQualityReadResult =
  | {
      success: true;
      data: LstmFitQualityReport;
    }
  | {
      success: false;
      error: string;
      errorDetails: LstmFitQualityConstructionErrorPayload;
    };

export type LstmFitQualityAssessmentClassification = 'verified' | 'partially_verified' | 'not_verified';

export interface LstmFitQualityGateSummary {
  g1: 'pass' | 'fail' | 'exempt' | null;
  g2: 'pass' | 'fail' | 'exempt' | null;
  g3: 'pass' | 'fail' | 'exempt' | null;
  bypassReason: string | null;
}

export interface LstmFitQualityVersionReport {
  versionId: string;
  runId: string | null;
  signalCount: number;
  compatible: boolean;
  registration: 'registered' | 'held' | null;
  runtimeSeconds: number | null;
  peakRssMb: number | null;
  meanValSharpe: number | null;
  valSharpes: number[];
  valSharpeStd: number | null;
  negativeFoldCount: number;
  earlyStopFolds: number[];
  gate: LstmFitQualityGateSummary;
  fitQuality: {
    zone: string;
    detail: string;
  };
  evidenceWarnings: string[];
}

export interface LstmFitQualityComparison {
  baselineVersion: string | null;
  candidateVersion: string | null;
  validity: 'controlled' | 'directional_only' | 'not_available';
  reason: string;
}

export interface LstmFitQualityProcessState {
  activeTrainerObserved: boolean;
  checkedRunIds: string[];
  evidence: string[];
}

export interface LstmFitQualityAssessment {
  classification: LstmFitQualityAssessmentClassification;
  overfitEvidence: 'no_strong_overfit_signal' | 'overfit_signal' | 'insufficient_evidence';
  riskPoints: string[];
  missingEvidence: string[];
  recommendedNextStep: string;
}

export interface LstmFitQualityReport {
  activeVersion: string | null;
  modelType: string | null;
  successfulSharedEncoderRegistrations: number;
  generatedAt: string;
  versions: LstmFitQualityVersionReport[];
  comparison: LstmFitQualityComparison;
  processState?: LstmFitQualityProcessState;
  assessment: LstmFitQualityAssessment;
}
