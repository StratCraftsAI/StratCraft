/**
 * CheckpointResumePanel Component
 *
 * TICKET_176_1: Checkpoint Resume UI
 *
 * Panel showing checkpoint details and resume/discard actions.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@shared/utils/format-locale';

// Format time distance without external dependency
const formatTimeAgo = (dateString: string, t: (key: string, params?: Record<string, number>) => string): string => {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return t('checkpoint.justNow');
    if (diffMin < 60) return t('checkpoint.minutesAgo', { count: diffMin });
    if (diffHour < 24) return t('checkpoint.hoursAgo', { count: diffHour });
    if (diffDay < 7) return t('checkpoint.daysAgo', { count: diffDay });
    return date.toLocaleDateString(getIntlLocale());
  } catch {
    return t('checkpoint.recently');
  }
};

// =============================================================================
// Types
// =============================================================================

interface CheckpointMetrics {
  totalPnl?: number;
  totalReturn?: number;
  totalTrades?: number;
  winRate?: number;
}

interface OpenPosition {
  symbol: string;
  size: number;
  price: number;
}

interface CheckpointInfo {
  taskId: string;
  barIndex: number;
  totalBars: number;
  createdAt: string;
  progressPercent: number;
  intermediateResults?: {
    metrics?: CheckpointMetrics;
    openPositions?: OpenPosition[];
  };
  dataValidation: 'valid' | 'file_missing' | 'hash_mismatch' | 'pending';
}

interface CheckpointResumePanelProps {
  checkpoint: CheckpointInfo;
  onResume: () => void;
  onDiscard: () => void;
  isResuming?: boolean;
}

// =============================================================================
// Sub-components
// =============================================================================

const DataValidationWarning: React.FC<{
  status: 'file_missing' | 'hash_mismatch' | 'pending';
  t: (key: string) => string;
}> = ({ status, t }) => {
  const messageKeys = {
    file_missing: {
      title: 'checkpoint.dataNotFound',
      description: 'checkpoint.dataNotFoundDesc',
      action: 'checkpoint.dataNotFoundHint',
    },
    hash_mismatch: {
      title: 'checkpoint.dataChanged',
      description: 'checkpoint.dataChangedDesc',
      action: 'checkpoint.dataChangedHint',
    },
    pending: {
      title: 'checkpoint.validating',
      description: 'checkpoint.validatingDesc',
      action: null,
    },
  };

  const keys = messageKeys[status];

  return (
    <div className={`data-validation-warning ${status}`}>
      <div className="warning-icon">&#x26A0;</div>
      <div className="warning-content">
        <h4>{t(keys.title)}</h4>
        <p>{t(keys.description)}</p>
        {keys.action && <p className="warning-action">{t(keys.action)}</p>}
      </div>
    </div>
  );
};

const MetricItem: React.FC<{ label: string; value: string | number }> = ({
  label,
  value,
}) => (
  <div className="metric-item">
    <span className="metric-label">{label}</span>
    <span className="metric-value">{value}</span>
  </div>
);

const PositionList: React.FC<{ positions: OpenPosition[] }> = ({ positions }) => (
  <div className="position-list">
    {positions.map((pos, idx) => (
      <div key={idx} className="position-item">
        <span className="position-symbol">{pos.symbol}</span>
        <span className="position-size">{pos.size > 0 ? '+' : ''}{pos.size}</span>
        <span className="position-price">@ ${pos.price.toFixed(2)}</span>
      </div>
    ))}
  </div>
);

// =============================================================================
// Main Component
// =============================================================================

export const CheckpointResumePanel: React.FC<CheckpointResumePanelProps> = ({
  checkpoint,
  onResume,
  onDiscard,
  isResuming = false,
}) => {
  const { t } = useTranslation('backtest');
  const { intermediateResults, dataValidation, progressPercent } = checkpoint;
  const metrics = intermediateResults?.metrics;
  const openPositions = intermediateResults?.openPositions;

  const timeAgo = React.useMemo(() => formatTimeAgo(checkpoint.createdAt, t), [checkpoint.createdAt, t]);

  const formatCurrency = (value?: number) => {
    if (value === undefined || value === null) return '-';
    return value >= 0 ? `+$${value.toFixed(2)}` : `-$${Math.abs(value).toFixed(2)}`;
  };

  const formatPercent = (value?: number) => {
    if (value === undefined || value === null) return '-';
    return `${(value * 100).toFixed(2)}%`;
  };

  return (
    <div className="checkpoint-resume-panel">
      {/* Header */}
      <div className="checkpoint-resume-header">
        <h3>{t('checkpoint.available')}</h3>
        <span className="checkpoint-progress">
          {t('checkpoint.completed', { percent: progressPercent, processed: checkpoint.barIndex, total: checkpoint.totalBars })}
        </span>
      </div>

      {/* Saved time */}
      <div className="checkpoint-time">{t('checkpoint.saved', { time: timeAgo })}</div>

      {/* Data Validation Warning */}
      {dataValidation !== 'valid' && (
        <DataValidationWarning status={dataValidation} t={t} />
      )}

      {/* Intermediate Metrics Summary */}
      {metrics && (
        <div className="checkpoint-metrics-summary">
          <MetricItem label={t('checkpoint.pnl')} value={formatCurrency(metrics.totalPnl)} />
          <MetricItem label={t('checkpoint.return')} value={formatPercent(metrics.totalReturn)} />
          <MetricItem label={t('checkpoint.trades')} value={metrics.totalTrades ?? '-'} />
          <MetricItem label={t('checkpoint.winRate')} value={formatPercent(metrics.winRate)} />
        </div>
      )}

      {/* Open Positions */}
      {openPositions && openPositions.length > 0 && (
        <div className="checkpoint-open-positions">
          <h4>{t('checkpoint.openPositions')}</h4>
          <PositionList positions={openPositions} />
        </div>
      )}

      {/* Actions */}
      <div className="checkpoint-actions">
        <button
          className="btn btn-primary"
          onClick={onResume}
          disabled={isResuming || dataValidation !== 'valid'}
        >
          {isResuming ? t('checkpoint.resuming') : t('checkpoint.resume')}
        </button>
        <button
          className="btn btn-secondary"
          onClick={onDiscard}
          disabled={isResuming}
        >
          {t('checkpoint.discardStartNew')}
        </button>
      </div>

      <style>{`
        .checkpoint-resume-panel {
          background: var(--color-surface-elevated, #1a1a2e);
          border: 1px solid var(--color-border, #333);
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 20px;
        }

        .checkpoint-resume-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .checkpoint-resume-header h3 {
          color: var(--color-warning, #ffc107);
          margin: 0;
          font-size: 16px;
          font-weight: 600;
        }

        .checkpoint-progress {
          color: var(--color-text-secondary, #888);
          font-size: 14px;
        }

        .checkpoint-time {
          color: var(--color-text-secondary, #888);
          font-size: 12px;
          margin-bottom: 16px;
        }

        /* Metrics Summary */
        .checkpoint-metrics-summary {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin-bottom: 16px;
          padding: 12px;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 6px;
        }

        .metric-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }

        .metric-label {
          font-size: 12px;
          color: var(--color-text-secondary, #888);
        }

        .metric-value {
          font-size: 14px;
          font-weight: 600;
          color: var(--color-text-primary, #fff);
        }

        /* Open Positions */
        .checkpoint-open-positions {
          margin-bottom: 16px;
        }

        .checkpoint-open-positions h4 {
          font-size: 12px;
          color: var(--color-text-secondary, #888);
          margin: 0 0 8px 0;
        }

        .position-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .position-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 4px;
          font-size: 13px;
        }

        .position-symbol {
          font-weight: 600;
          color: var(--color-text-primary, #fff);
        }

        .position-size {
          color: var(--color-terminal-accent-primary, #00d4aa);
        }

        .position-price {
          color: var(--color-text-secondary, #888);
        }

        /* Data Validation Warning */
        .data-validation-warning {
          display: flex;
          gap: 12px;
          padding: 12px 16px;
          border-radius: 6px;
          margin-bottom: 16px;
        }

        .data-validation-warning.file_missing {
          background: rgba(220, 53, 69, 0.1);
          border: 1px solid var(--color-error, #dc3545);
        }

        .data-validation-warning.hash_mismatch {
          background: rgba(255, 193, 7, 0.1);
          border: 1px solid var(--color-warning, #ffc107);
        }

        .data-validation-warning.pending {
          background: rgba(0, 123, 255, 0.1);
          border: 1px solid var(--color-info, #007bff);
        }

        .warning-icon {
          font-size: 20px;
        }

        .warning-content h4 {
          margin: 0 0 4px 0;
          font-size: 14px;
          color: var(--color-text-primary, #fff);
        }

        .warning-content p {
          margin: 0;
          font-size: 12px;
          color: var(--color-text-secondary, #888);
        }

        .warning-action {
          margin-top: 4px !important;
          font-style: italic;
        }

        /* Actions */
        .checkpoint-actions {
          display: flex;
          gap: 12px;
          margin-top: 20px;
        }

        .btn {
          padding: 10px 20px;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }

        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-primary {
          background: var(--color-terminal-accent-primary, #00d4aa);
          color: #000;
        }

        .btn-primary:hover:not(:disabled) {
          background: var(--color-terminal-accent-primary-hover, #00f5c4);
        }

        .btn-secondary {
          background: transparent;
          border: 1px solid var(--color-border, #333);
          color: var(--color-text-primary, #fff);
        }

        .btn-secondary:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.05);
        }
      `}</style>
    </div>
  );
};

export default CheckpointResumePanel;
