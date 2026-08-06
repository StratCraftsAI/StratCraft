/**
 * BacktestHistorySidebar Component (component18)
 *
 * TICKET_077_18: Backtest History Sidebar
 * TICKET_077: StratCraftsAI UI Component Library
 *
 * Zone B sidebar displaying backtest execution state, history records,
 * and checkpoint resume indicators.
 *
 * @see docs/design/TICKET_077_18_BACKTEST_HISTORY_SIDEBAR.md
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { SEMANTIC_COLORS, THEME_COLORS } from '@shared/constants/colors';

// -----------------------------------------------------------------------------
// Icons
// -----------------------------------------------------------------------------

const HistoryIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </svg>
);

const LoaderIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v4" />
    <path d="m16.2 7.8 2.9-2.9" />
    <path d="M18 12h4" />
    <path d="m16.2 16.2 2.9 2.9" />
    <path d="M12 18v4" />
    <path d="m4.9 19.1 2.9-2.9" />
    <path d="M2 12h4" />
    <path d="m4.9 4.9 2.9 2.9" />
  </svg>
);

const ChevronDownIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const TrashIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const PauseIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface BacktestHistoryItem {
  id: string;
  name: string;
  symbol: string;
  timeframe: string;
  totalReturn: number | null;
  startDate: string;
  endDate: string;
  initialCapital: number;
  orderSize: number | null;
  orderSizeUnit: string | null;
  createdAt: string;
  status: 'completed' | 'failed' | 'running';
}

export interface CheckpointBadgeInfo {
  taskId: string;
  progressPercent: number;
}

export interface BacktestHistorySidebarProps {
  /** Current execution state */
  isExecuting: boolean;
  /** Number of completed results */
  resultsCount: number;
  /** History items list */
  historyItems: BacktestHistoryItem[];
  /** Loading state */
  historyLoading: boolean;
  /** Checkpoint info for badge display */
  checkpointInfo?: CheckpointBadgeInfo | null;
  /** Whether checkpoint panel is currently shown */
  showCheckpointPanel?: boolean;
  /** Callback when history item clicked */
  onHistoryItemClick: (taskId: string) => void;
  /** Callback when delete button clicked */
  onDeleteClick: (e: React.MouseEvent, itemId: string) => void;
  /** Callback when checkpoint badge clicked */
  onShowCheckpointPanel?: () => void;
  /** Additional CSS classes */
  className?: string;
}

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

/**
 * Format return value as percentage with sign
 */
const formatReturn = (value: number | null): string => {
  if (value === null) return '-';
  const percent = (value * 100).toFixed(1);
  return value >= 0 ? `+${percent}%` : `${percent}%`;
};

/**
 * Format capital with K suffix for large numbers
 */
const formatCapital = (value: number): string => {
  return value >= 1000
    ? `$${(value / 1000).toFixed(0)}K`
    : `$${value}`;
};

/**
 * Format order size based on unit type
 */
const formatOrderSize = (size: number | null, unit: string | null): string | null => {
  if (size === null || !unit) return null;
  switch (unit) {
    case 'percent': return `${size}%`;
    case 'cash': return `$${size}`;
    default: return `${size}sh`;
  }
};

/**
 * Determine display state based on props
 */
type DisplayState = 'executing' | 'loading' | 'empty' | 'list';

const getDisplayState = (
  isExecuting: boolean,
  resultsCount: number,
  historyLoading: boolean,
  historyItemsLength: number
): DisplayState => {
  if (isExecuting || resultsCount > 0) {
    return 'executing';
  }
  if (historyLoading) {
    return 'loading';
  }
  if (historyItemsLength === 0) {
    return 'empty';
  }
  return 'list';
};

// -----------------------------------------------------------------------------
// Case Status Colors
// -----------------------------------------------------------------------------

const CASE_STATUS_COLORS = {
  completed: SEMANTIC_COLORS.SUCCESS_LIGHT,
  running: SEMANTIC_COLORS.WARNING_LIGHT,
  pending: THEME_COLORS.GRAY_500,
} as const;

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export const BacktestHistorySidebar: React.FC<BacktestHistorySidebarProps> = ({
  isExecuting,
  resultsCount,
  historyItems,
  historyLoading,
  checkpointInfo,
  showCheckpointPanel,
  onHistoryItemClick,
  onDeleteClick,
  onShowCheckpointPanel,
  className,
}) => {
  const { t } = useTranslation('backtest');

  const displayState = getDisplayState(
    isExecuting,
    resultsCount,
    historyLoading,
    historyItems.length
  );

  return (
    <div className={cn(
      'w-96 flex-shrink-0 border-r border-color-terminal-border',
      'bg-color-terminal-panel/30 flex flex-col',
      className
    )}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-color-terminal-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HistoryIcon className="w-4 h-4 text-color-terminal-text-muted" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-color-terminal-text-secondary">
              {t('sidebar.history')}
            </span>
          </div>
          {/* Checkpoint badge */}
          {checkpointInfo && !showCheckpointPanel && (
            <button
              onClick={onShowCheckpointPanel}
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-[10px] rounded',
                'bg-amber-500/15 border border-amber-500/50 text-amber-400',
                'hover:bg-amber-500/25 transition-colors'
              )}
              title={t('sidebar.checkpointTooltip', { percent: checkpointInfo.progressPercent })}
            >
              <PauseIcon className="w-3 h-3" />
              <span>{checkpointInfo.progressPercent}%</span>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {displayState === 'executing' && (
          <ExecutingState isExecuting={isExecuting} />
        )}

        {displayState === 'loading' && (
          <LoadingState />
        )}

        {displayState === 'empty' && (
          <EmptyState />
        )}

        {displayState === 'list' && (
          <HistoryList
            items={historyItems}
            onItemClick={onHistoryItemClick}
            onDeleteClick={onDeleteClick}
          />
        )}
      </div>
    </div>
  );
};

// -----------------------------------------------------------------------------
// Sub-Components
// -----------------------------------------------------------------------------

interface ExecutingStateProps {
  isExecuting: boolean;
}

const ExecutingState: React.FC<ExecutingStateProps> = ({ isExecuting }) => {
  const { t } = useTranslation('backtest');

  return (
    <div className="space-y-1">
      <div className="w-full px-3 py-2 text-left">
        <ChevronDownIcon className="w-3 h-3 inline mr-1 text-color-terminal-text-muted" />
        <span className="text-xs font-bold uppercase text-color-terminal-text-secondary">
          {t('sidebar.backtesting')}
        </span>
      </div>
      {isExecuting && (
        <div className="px-6 py-1.5 text-xs">
          <span style={{ color: CASE_STATUS_COLORS.running }}>
            {t('sidebar.testing')}
          </span>
        </div>
      )}
    </div>
  );
};

const LoadingState: React.FC = () => {
  const { t } = useTranslation('backtest');

  return (
    <div className="px-2 py-8 text-center">
      <LoaderIcon className="w-6 h-6 mx-auto mb-2 text-color-terminal-text-muted animate-spin" />
      <p className="text-[11px] text-color-terminal-text-muted">
        {t('sidebar.loading')}
      </p>
    </div>
  );
};

const EmptyState: React.FC = () => {
  const { t } = useTranslation('backtest');

  return (
    <div className="px-2 py-8 text-center">
      <HistoryIcon className="w-8 h-8 mx-auto mb-3 text-color-terminal-text-muted opacity-50" />
      <p className="text-[11px] text-color-terminal-text-muted">
        {t('sidebar.noHistory')}
      </p>
    </div>
  );
};

interface HistoryListProps {
  items: BacktestHistoryItem[];
  onItemClick: (taskId: string) => void;
  onDeleteClick: (e: React.MouseEvent, itemId: string) => void;
}

const HistoryList: React.FC<HistoryListProps> = ({
  items,
  onItemClick,
  onDeleteClick,
}) => {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <HistoryItemCard
          key={item.id}
          item={item}
          onClick={() => onItemClick(item.id)}
          onDeleteClick={(e) => onDeleteClick(e, item.id)}
        />
      ))}
    </div>
  );
};

interface HistoryItemCardProps {
  item: BacktestHistoryItem;
  onClick: () => void;
  onDeleteClick: (e: React.MouseEvent) => void;
}

const HistoryItemCard: React.FC<HistoryItemCardProps> = ({
  item,
  onClick,
  onDeleteClick,
}) => {
  const { t } = useTranslation('backtest');
  const isProfit = (item.totalReturn ?? 0) >= 0;
  const returnStr = formatReturn(item.totalReturn);
  const capitalStr = formatCapital(item.initialCapital);
  const orderSizeStr = formatOrderSize(item.orderSize, item.orderSizeUnit);

  return (
    <div
      onClick={onClick}
      className={cn(
        'group w-full px-3 py-2 text-left rounded transition-colors cursor-pointer',
        'hover:bg-white/5 border border-transparent hover:border-white/10'
      )}
    >
      {/* Row 1: Strategy name + Return */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-color-terminal-text truncate flex-1">
          {item.name}
        </span>
        <span className={cn(
          'text-xs font-bold ml-2',
          isProfit ? 'text-green-400' : 'text-red-400'
        )}>
          {returnStr}
        </span>
      </div>

      {/* Row 2: Symbol + Timeframe */}
      <div className="flex items-center gap-2 text-[10px] text-color-terminal-text-muted mb-1">
        <span className="text-color-terminal-accent-teal">{item.symbol}</span>
        <span>{item.timeframe}</span>
      </div>

      {/* Row 3: Capital + OrderSize */}
      <div className="flex items-center gap-3 text-[12px] text-color-terminal-text-muted/80 mb-1">
        <span>{t('sidebar.capLabel')} <span className="text-color-terminal-text-secondary">{capitalStr}</span></span>
        {orderSizeStr && (
          <span>{t('sidebar.sizeLabel')} <span className="text-color-terminal-text-secondary">{orderSizeStr}</span></span>
        )}
      </div>

      {/* Row 4: Date range */}
      <div className="text-[12px] text-color-terminal-text-muted/70 mb-1">
        {item.startDate} ~ {item.endDate}
      </div>

      {/* Row 5: Created timestamp + Delete button */}
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-color-terminal-text-muted/50">
          {item.createdAt}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDeleteClick(e);
          }}
          className={cn(
            'p-0.5 rounded transition-all',
            'text-color-terminal-text-muted opacity-50',
            'hover:opacity-100 hover:text-red-400 hover:bg-red-400/10'
          )}
          title={t('sidebar.delete')}
        >
          <TrashIcon className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );
};

export default BacktestHistorySidebar;
