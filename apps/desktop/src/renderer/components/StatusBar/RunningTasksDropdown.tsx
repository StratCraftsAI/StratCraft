/**
 * RunningTasksDropdown Component
 *
 * TICKET_239: Multi-Backtest Tab and Queue Control
 *
 * Dropdown showing all running backtests with progress.
 * Click on a task to navigate to BacktestResultPage and switch to that tab.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useBacktestStatusStore } from '@/stores/useBacktestStatusStore';
import { useAppStore } from '@/stores';
import { Z_INDEX_MODAL } from '@shared/constants/z-index';
import { useDropdown } from '../../hooks/useDropdown';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const TOTAL_BLOCKS = 20;
const FILLED_CHAR = '\u2588';
const EMPTY_CHAR = '\u2591';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function renderProgressBlocks(percent: number): { filled: string; empty: string } {
  const filledCount = Math.round((percent / 100) * TOTAL_BLOCKS);
  const emptyCount = TOTAL_BLOCKS - filledCount;
  return {
    filled: FILLED_CHAR.repeat(filledCount),
    empty: EMPTY_CHAR.repeat(emptyCount),
  };
}

function truncateStrategyName(name: string, maxLength: number = 20): string {
  if (name.length <= maxLength) return name;
  return name.slice(0, maxLength - 1) + '\u2026';
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export interface RunningTasksDropdownProps {
  onNavigateToResult?: () => void;
}

export function RunningTasksDropdown({ onNavigateToResult }: RunningTasksDropdownProps) {
  const { t } = useTranslation('backtest');
  const { isOpen, toggle, close, triggerRef: buttonRef, dropdownRef, triggerProps } = useDropdown<HTMLButtonElement, HTMLDivElement>();

  const runningTasks = useBacktestStatusStore((state) => state.runningTasks);
  const switchTab = useBacktestStatusStore((state) => state.switchTab);
  const setActiveView = useAppStore((state) => state.setActiveView);

  // Count only actually running tasks
  const runningCount = runningTasks.filter((t) => t.status === 'running').length;

  // Handle task click - navigate to result page and switch tab
  const handleTaskClick = (taskId: string) => {
    switchTab(taskId);
    close();
    if (onNavigateToResult) {
      onNavigateToResult();
    } else {
      setActiveView('backtestResult');
    }
  };

  // Don't render if no running tasks
  if (runningCount === 0) {
    return null;
  }

  // Calculate dropdown position
  const buttonRect = buttonRef.current?.getBoundingClientRect();
  const dropdownStyle: React.CSSProperties = buttonRect
    ? {
        position: 'fixed',
        bottom: 32, // Above status bar
        right: buttonRect.right - buttonRect.left + 8,
        zIndex: Z_INDEX_MODAL,
      }
    : {};

  return (
    <>
      {/* Trigger Button */}
      <button
        ref={buttonRef}
        onClick={toggle}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-color-terminal-accent-teal/50 hover:border-color-terminal-accent-teal hover:bg-color-terminal-accent-teal/10 transition-colors"
        title={t('statusBar.backtestsRunning', { count: runningCount })}
        {...triggerProps}
      >
        <span className="text-[10px] font-mono text-color-terminal-accent-teal">
          {t('statusBar.running')} {runningCount}
        </span>
      </button>

      {/* Dropdown */}
      {isOpen &&
        createPortal(
          <div
            ref={dropdownRef}
            role="menu"
            style={dropdownStyle}
            className="w-[300px] rounded-lg border border-color-terminal-border bg-color-terminal-surface shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden"
          >
            {/* Header */}
            <div className="px-3 py-2 border-b border-color-terminal-border bg-color-terminal-panel">
              <span className="font-mono text-[10px] font-semibold text-color-terminal-text uppercase tracking-wider">
                {t('statusBar.runningBacktests')}
              </span>
            </div>

            {/* Task List */}
            <div className="max-h-[240px] overflow-y-auto">
              {runningTasks
                .filter((t) => t.status === 'running')
                .map((task) => {
                  const { filled, empty } = renderProgressBlocks(task.progress);
                  return (
                    <div
                      key={task.taskId}
                      onClick={() => handleTaskClick(task.taskId)}
                      className="px-3 py-2 cursor-pointer hover:bg-color-terminal-surface/50 transition-colors border-b border-color-terminal-border/50 last:border-b-0"
                    >
                      {/* Strategy Name */}
                      <div className="font-mono text-xs text-color-terminal-text mb-1">
                        {truncateStrategyName(task.strategyName)}
                      </div>

                      {/* Progress Bar */}
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] tracking-tight flex-1">
                          <span className="text-color-terminal-accent-teal">{filled}</span>
                          <span className="text-color-terminal-text-muted">{empty}</span>
                        </span>
                        <span className="font-mono text-[10px] text-color-terminal-text-secondary w-8 text-right">
                          {task.progress}%
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

export default RunningTasksDropdown;
