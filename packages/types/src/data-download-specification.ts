import type {
  ConfirmedWorkloadPlan,
  WorkloadPrelaunchReview,
} from './workload-prelaunch';
import type { DataProviderId } from './data-provider-id';

export const DATA_DOWNLOAD_SPECIFICATION_ID =
  'quantnexus.data-download' as const;
export const DATA_DOWNLOAD_SPECIFICATION_VERSION = '1.0.0' as const;

export interface DataDownloadDraft {
  readonly provider?: DataProviderId;
  readonly symbols?: readonly string[];
  readonly interval?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly priority?: 'critical' | 'normal' | 'background';
  readonly forceDownload?: boolean;
  readonly callerId?: string;
}

export interface DataDownloadDerivedContext {
  readonly version: string;
  readonly providerOnlineRange?: {
    readonly startDate: string | null;
    readonly endDate: string | null;
  };
  readonly existingCoverage?: {
    readonly startDate: string | null;
    readonly endDate: string | null;
    readonly totalBars: number;
  };
  readonly supportedIntervals: readonly string[];
  readonly supportedSymbols: readonly string[] | null;
}

export interface DataDownloadReviewResult {
  readonly review: WorkloadPrelaunchReview;
}

export interface DataDownloadConfirmResult {
  readonly confirmed: ConfirmedWorkloadPlan;
  readonly taskId: string;
}
