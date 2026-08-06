/**
 * CheckpointBadge Component
 *
 * TICKET_176_1: Checkpoint Resume UI
 *
 * Small badge shown in header when checkpoint exists.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@shared/utils/format-locale';

// Format time distance without external dependency
const formatTimeAgo = (dateString: string, t: (key: string, options?: Record<string, unknown>) => string): string => {
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

interface CheckpointBadgeProps {
  progressPercent: number;
  createdAt: string;
  onClick?: () => void;
}

export const CheckpointBadge: React.FC<CheckpointBadgeProps> = ({
  progressPercent,
  createdAt,
  onClick,
}) => {
  const { t } = useTranslation('backtest');
  const timeAgo = React.useMemo(() => formatTimeAgo(createdAt, t), [createdAt, t]);

  return (
    <div
      className="checkpoint-badge"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick?.();
        }
      }}
    >
      <span className="checkpoint-badge-icon">&#x23F8;</span>
      <span className="checkpoint-badge-text">{t('checkpoint.percentSaved', { percent: progressPercent })}</span>
      <span className="checkpoint-badge-time">{timeAgo}</span>

      <style>{`
        .checkpoint-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 12px;
          background: rgba(255, 193, 7, 0.15);
          border: 1px solid var(--color-warning, #ffc107);
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          transition: background 0.2s;
          user-select: none;
        }

        .checkpoint-badge:hover {
          background: rgba(255, 193, 7, 0.25);
        }

        .checkpoint-badge:focus {
          outline: 2px solid var(--color-terminal-accent-primary, #00d4aa);
          outline-offset: 2px;
        }

        .checkpoint-badge-icon {
          font-size: 14px;
        }

        .checkpoint-badge-text {
          color: var(--color-text-primary, #fff);
          font-weight: 500;
        }

        .checkpoint-badge-time {
          color: var(--color-text-secondary, #888);
          font-size: 12px;
        }
      `}</style>
    </div>
  );
};

export default CheckpointBadge;
