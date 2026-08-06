/**
 * BacktestTabBar Component
 *
 * TICKET_239: Multi-Backtest Tab and Queue Control
 *
 * Displays tabs for multiple running/completed backtests.
 * Each tab shows: Symbol - Strategy Name with status indicator.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useBacktestStatusStore } from '@/stores/useBacktestStatusStore';
import type { BacktestTask, BacktestTaskStatus } from '@/stores/useBacktestStatusStore';

// -----------------------------------------------------------------------------
// Icons
// -----------------------------------------------------------------------------

const PlayIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

// Pending/waiting icon (clock)
const ClockIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const CloseIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// -----------------------------------------------------------------------------
// Status Icon Component
// -----------------------------------------------------------------------------

interface StatusIconProps {
  status: BacktestTaskStatus;
}

const StatusIcon: React.FC<StatusIconProps> = ({ status }) => {
  switch (status) {
    case 'preparing':
      return <ClockIcon className="w-2.5 h-2.5 text-color-terminal-accent-teal animate-pulse" />;
    case 'running':
      return <PlayIcon className="w-2.5 h-2.5 text-color-terminal-accent-teal animate-pulse" />;
    case 'completed':
      return <CheckIcon className="w-2.5 h-2.5 text-green-400" />;
    case 'failed':
    case 'cancelled':
      return <XIcon className="w-2.5 h-2.5 text-red-400" />;
    case 'pending':
      return <ClockIcon className="w-2.5 h-2.5 text-yellow-400 animate-pulse" />;
    default:
      // Debug: log unexpected status
      console.warn('[W:BACKTEST:UNEXPECTED_TASK_STATUS] Unexpected task status:', status);
      return null;
  }
};

// -----------------------------------------------------------------------------
// Tab Item Component
// -----------------------------------------------------------------------------

interface TabItemProps {
  task: BacktestTask;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  t: (key: string) => string;
}

const TabItem = React.forwardRef<HTMLDivElement, TabItemProps>(({ task, isActive, onSelect, onClose, onContextMenu, t }, ref) => {
  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  // Truncate strategy name
  const displayName = task.strategyName.length > 16
    ? task.strategyName.slice(0, 15) + '\u2026'
    : task.strategyName;

  return (
    <div
      ref={ref}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={`
        flex items-center gap-1.5 px-3 py-1.5 cursor-pointer
        border-r border-color-terminal-border
        transition-colors
        ${isActive
          ? 'bg-color-terminal-surface text-color-terminal-text border-b-2 border-b-color-terminal-accent-teal'
          : 'bg-color-terminal-bg/50 text-color-terminal-text-secondary hover:bg-color-terminal-surface/50'
        }
      `}
    >
      {/* Status Icon */}
      <StatusIcon status={task.status} />

      {/* Strategy Name */}
      <span className="text-xs font-mono whitespace-nowrap">{displayName}</span>

      {/* Status label */}
      {task.status === 'preparing' && (
        <span className="text-[10px] text-color-terminal-accent-teal font-mono">
          {t('tabBar.prep')}
        </span>
      )}
      {task.status === 'running' && (
        <span className="text-[10px] text-color-terminal-accent-teal font-mono">
          {task.progress}%
        </span>
      )}
      {task.status === 'pending' && (
        <span className="text-[10px] text-yellow-400 font-mono">
          {t('tabBar.wait')}
        </span>
      )}

      {/* Close Button */}
      <button
        onClick={handleClose}
        className="ml-1 p-0.5 rounded hover:bg-color-terminal-surface transition-colors"
        title={t('tabBar.closeTab')}
      >
        <CloseIcon className="w-3 h-3 text-color-terminal-text-muted hover:text-color-terminal-text" />
      </button>
    </div>
  );
});

// -----------------------------------------------------------------------------
// Tab Context Menu Component
// -----------------------------------------------------------------------------

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  taskId: string | null;
}

const initialContextMenu: ContextMenuState = { visible: false, x: 0, y: 0, taskId: null };

interface TabContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  t: (key: string) => string;
}

const TabContextMenu: React.FC<TabContextMenuProps> = ({ state, onClose, onCloseTab, onCloseOthers, onCloseAll, t }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.visible) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeydown);
    };
  }, [state.visible, onClose]);

  if (!state.visible) return null;

  const menuItemClass =
    'w-full text-left px-3 py-1.5 text-xs font-mono text-color-terminal-text hover:bg-color-terminal-surface/80 transition-colors cursor-pointer';

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 min-w-[120px] py-1 rounded border border-color-terminal-border bg-color-terminal-panel shadow-lg"
      style={{ left: state.x, top: state.y }}
    >
      <button className={menuItemClass} onClick={onCloseTab}>{t('tabBar.close')}</button>
      <button className={menuItemClass} onClick={onCloseOthers}>{t('tabBar.closeOthers')}</button>
      <button className={menuItemClass} onClick={onCloseAll}>{t('tabBar.closeAll')}</button>
    </div>,
    document.body
  );
};

// -----------------------------------------------------------------------------
// BacktestTabBar Component
// -----------------------------------------------------------------------------

export interface BacktestTabBarProps {
  className?: string;
  onTabClose?: (taskId: string) => void;
  onTabCloseOthers?: (taskId: string) => void;
  onTabCloseAll?: () => void;
}

export const BacktestTabBar: React.FC<BacktestTabBarProps> = ({ className = '', onTabClose, onTabCloseOthers, onTabCloseAll }) => {
  const { t } = useTranslation('backtest');
  const runningTasks = useBacktestStatusStore((state) => state.runningTasks);
  const activeTabId = useBacktestStatusStore((state) => state.activeTabId);
  const switchTab = useBacktestStatusStore((state) => state.switchTab);
  const closeTab = useBacktestStatusStore((state) => state.closeTab);

  // TICKET_421: Track tab DOM elements for auto-scroll
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // TICKET_421: Auto-scroll to active tab when activeTabId changes
  useEffect(() => {
    if (!activeTabId) return;
    const el = tabRefs.current.get(activeTabId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeTabId]);

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(initialContextMenu);

  const handleContextMenu = useCallback((e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, taskId });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(initialContextMenu);
  }, []);

  const handleContextClose = useCallback(() => {
    if (contextMenu.taskId) {
      (onTabClose ?? closeTab)(contextMenu.taskId);
    }
    setContextMenu(initialContextMenu);
  }, [contextMenu.taskId, onTabClose, closeTab]);

  const handleContextCloseOthers = useCallback(() => {
    if (contextMenu.taskId && onTabCloseOthers) {
      onTabCloseOthers(contextMenu.taskId);
    }
    setContextMenu(initialContextMenu);
  }, [contextMenu.taskId, onTabCloseOthers]);

  const handleContextCloseAll = useCallback(() => {
    setContextMenu(initialContextMenu);
    if (onTabCloseAll) {
      onTabCloseAll();
    }
  }, [onTabCloseAll]);

  // Don't render if no tabs
  if (runningTasks.length === 0) {
    return null;
  }

  return (
    <div className={`flex items-center border-b border-color-terminal-border bg-color-terminal-panel ${className}`}>
      {/* Tab List */}
      <div className="flex items-center overflow-x-auto">
        {runningTasks.map((task) => (
          <TabItem
            key={task.taskId}
            ref={(el) => {
              if (el) {
                tabRefs.current.set(task.taskId, el);
              } else {
                tabRefs.current.delete(task.taskId);
              }
            }}
            task={task}
            isActive={task.taskId === activeTabId}
            onSelect={() => switchTab(task.taskId)}
            onClose={() => (onTabClose ?? closeTab)(task.taskId)}
            onContextMenu={(e) => handleContextMenu(e, task.taskId)}
            t={t}
          />
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Context Menu */}
      <TabContextMenu
        state={contextMenu}
        onClose={handleCloseContextMenu}
        onCloseTab={handleContextClose}
        onCloseOthers={handleContextCloseOthers}
        onCloseAll={handleContextCloseAll}
        t={t}
      />
    </div>
  );
};

export default BacktestTabBar;
