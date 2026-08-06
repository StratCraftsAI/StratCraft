import type {
  DataDownloadDraft,
  DataDownloadDerivedContext,
  StructuredWorkloadValidationError,
  WorkloadJsonValue,
  WorkloadPrelaunchReview,
} from '@StratCraft/types';
import {
  DATA_DOWNLOAD_SPECIFICATION_ID,
  DATA_DOWNLOAD_SPECIFICATION_VERSION,
  DATA_PROVIDER_IDS,
  ALL_INTERVALS,
} from '@StratCraft/types';
import {
  resolvePrelaunchReview,
  type WorkloadParameterSpecification,
} from './index';

export const DATA_DOWNLOAD_DEFAULT_SOURCE =
  'packages/types/src/provider-registry.ts:DEFAULT_PROVIDER_SYMBOLS:v1';

export const DATA_DOWNLOAD_PARAMETER_SPECIFICATION: WorkloadParameterSpecification = {
  id: DATA_DOWNLOAD_SPECIFICATION_ID,
  version: DATA_DOWNLOAD_SPECIFICATION_VERSION,
  parameters: [
    {
      id: 'provider',
      label: 'Data provider',
      required: true,
      editable: true,
      impact: ['scope', 'cost'],
      supportedChoices: [...DATA_PROVIDER_IDS],
    },
    {
      id: 'symbols',
      label: 'Symbols',
      required: true,
      editable: true,
      impact: ['scope', 'cost', 'duration'],
    },
    {
      id: 'interval',
      label: 'Bar interval',
      required: true,
      editable: true,
      impact: ['scope', 'cost', 'duration'],
      supportedChoices: [...ALL_INTERVALS],
    },
    {
      id: 'startDate',
      label: 'Start date (inclusive)',
      required: true,
      editable: true,
      impact: ['scope', 'cost', 'duration'],
    },
    {
      id: 'endDate',
      label: 'End date (inclusive)',
      required: true,
      editable: true,
      impact: ['scope', 'cost', 'duration'],
    },
    {
      id: 'priority',
      label: 'Queue priority',
      required: true,
      editable: true,
      impact: ['duration'],
      defaultValue: 'background',
      defaultSource: 'data-download-queue.ts:CALLER_PRIORITY:v1',
      supportedChoices: ['critical', 'normal', 'background'],
    },
    {
      id: 'forceDownload',
      label: 'Force re-download',
      required: true,
      editable: true,
      impact: ['cost', 'duration'],
      defaultValue: false,
      defaultSource: 'data-download-queue.ts:EnqueueConfig:v1',
    },
    {
      id: 'callerId',
      label: 'Queue caller',
      required: true,
      editable: false,
      impact: [],
      defaultValue: 'data-manager',
      defaultSource: 'data-download-queue.ts:EnqueueConfig:v1',
    },
    {
      id: 'providerOnlineStart',
      label: 'Provider online range start',
      required: false,
      editable: false,
      impact: ['scope'],
    },
    {
      id: 'providerOnlineEnd',
      label: 'Provider online range end',
      required: false,
      editable: false,
      impact: ['scope'],
    },
    {
      id: 'existingCoverageStart',
      label: 'Cached coverage start',
      required: false,
      editable: false,
      impact: ['cost', 'duration'],
    },
    {
      id: 'existingCoverageEnd',
      label: 'Cached coverage end',
      required: false,
      editable: false,
      impact: ['cost', 'duration'],
    },
    {
      id: 'existingCoverageBars',
      label: 'Cached bar count',
      required: false,
      editable: false,
      impact: ['cost', 'duration'],
    },
  ],
};

function flattenDraft(
  draft: DataDownloadDraft,
): Record<string, WorkloadJsonValue | undefined> {
  return {
    provider: draft.provider,
    symbols: draft.symbols ? [...draft.symbols] : undefined,
    interval: draft.interval,
    startDate: draft.startDate,
    endDate: draft.endDate,
    priority: draft.priority,
    forceDownload: draft.forceDownload,
    callerId: draft.callerId,
  };
}

function validateDataDownload(
  values: Readonly<Record<string, WorkloadJsonValue>>,
): readonly StructuredWorkloadValidationError[] {
  const errors: StructuredWorkloadValidationError[] = [];

  const provider = values.provider;
  if (typeof provider === 'string' && !(DATA_PROVIDER_IDS as readonly string[]).includes(provider)) {
    errors.push({
      code: 'DOWNLOAD_PROVIDER_UNKNOWN',
      parameterIds: ['provider'],
      message: `Unknown data provider '${provider}'.`,
      remediation: `Choose one of: ${DATA_PROVIDER_IDS.join(', ')}.`,
    });
  }

  const symbols = values.symbols;
  if (Array.isArray(symbols) && symbols.length === 0) {
    errors.push({
      code: 'DOWNLOAD_SYMBOLS_EMPTY',
      parameterIds: ['symbols'],
      message: 'No symbols specified.',
      remediation: 'Provide at least one valid symbol for the selected provider.',
    });
  }

  const interval = values.interval;
  if (typeof interval === 'string' && !(ALL_INTERVALS as readonly string[]).includes(interval)) {
    errors.push({
      code: 'DOWNLOAD_INTERVAL_UNSUPPORTED',
      parameterIds: ['interval'],
      message: `Unsupported interval '${interval}'.`,
      remediation: `Choose one of: ${ALL_INTERVALS.join(', ')}.`,
    });
  }

  const startDate = values.startDate;
  const endDate = values.endDate;
  if (typeof startDate === 'string' && typeof endDate === 'string') {
    const startMs = Date.parse(startDate);
    const endMs = Date.parse(endDate);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      errors.push({
        code: 'DOWNLOAD_DATE_INVALID',
        parameterIds: ['startDate', 'endDate'],
        message: 'Start or end date is not a valid date string.',
        remediation: 'Provide dates in YYYY-MM-DD format.',
      });
    } else if (startMs >= endMs) {
      errors.push({
        code: 'DOWNLOAD_WINDOW_INVALID',
        parameterIds: ['startDate', 'endDate'],
        message: 'Start date must be before end date.',
        remediation: 'Swap or correct the date range.',
      });
    }

    const onlineStart = values.providerOnlineStart;
    const onlineEnd = values.providerOnlineEnd;
    if (
      Number.isFinite(startMs) && Number.isFinite(endMs)
      && typeof onlineStart === 'string' && typeof onlineEnd === 'string'
    ) {
      const onlineStartMs = Date.parse(onlineStart);
      const onlineEndMs = Date.parse(onlineEnd);
      if (Number.isFinite(onlineStartMs) && Number.isFinite(onlineEndMs)) {
        if (startMs < onlineStartMs || endMs > onlineEndMs) {
          errors.push({
            code: 'DOWNLOAD_OUTSIDE_ONLINE_RANGE',
            parameterIds: ['startDate', 'endDate'],
            message: `Requested window ${startDate} to ${endDate} exceeds provider online range ${onlineStart} to ${onlineEnd}.`,
            remediation: 'Constrain the date range to the provider online window.',
          });
        }
      }
    }
  }

  return errors;
}

export function resolveDataDownloadReview(
  draft: DataDownloadDraft,
  context: DataDownloadDerivedContext,
): WorkloadPrelaunchReview {
  return resolvePrelaunchReview(DATA_DOWNLOAD_PARAMETER_SPECIFICATION, {
    explicit: flattenDraft(draft),
    derived: {
      providerOnlineStart: context.providerOnlineRange?.startDate ?? undefined,
      providerOnlineEnd: context.providerOnlineRange?.endDate ?? undefined,
      existingCoverageStart: context.existingCoverage?.startDate ?? undefined,
      existingCoverageEnd: context.existingCoverage?.endDate ?? undefined,
      existingCoverageBars: context.existingCoverage?.totalBars ?? undefined,
    },
    derivedContextVersion: context.version,
    estimatedWork: {
      symbols: Array.isArray(draft.symbols) ? draft.symbols.length : 0,
      supportedIntervals: [...context.supportedIntervals],
    },
  }, validateDataDownload);
}
