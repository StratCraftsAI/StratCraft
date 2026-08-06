/**
 * Download Status Indicator Component
 *
 * Displays active download count in the status bar with animated download icon.
 * Click navigates to Data Management > Download Queue tab.
 * Hidden when no active downloads.
 *
 * @see TICKET_348 - Download Status Bar Indicator
 */

import React, { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDownloadQueueStore, selectActiveCount, selectHasActiveDownloads } from '@/stores/useDownloadQueueStore';
import { useAppStore } from '@/stores';

// -----------------------------------------------------------------------------
// Icons
// -----------------------------------------------------------------------------

const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export function DownloadStatusIndicator() {
  const { t } = useTranslation('ui');
  const init = useDownloadQueueStore(state => state.init);
  const activeCount = useDownloadQueueStore(selectActiveCount);
  const hasActive = useDownloadQueueStore(selectHasActiveDownloads);
  const setActiveView = useAppStore(state => state.setActiveView);
  const setDataManagementTab = useAppStore(state => state.setDataManagementTab);

  // Initialize global IPC subscription on mount
  useEffect(() => {
    init();
  }, [init]);

  const handleClick = useCallback(() => {
    setDataManagementTab('downloadQueue');
    setActiveView('dataManagement');
  }, [setActiveView, setDataManagementTab]);

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-color-terminal-surface/50 transition-colors cursor-pointer"
      title={t('backtestConsole.viewDownloadQueue')}
    >
      <DownloadIcon
        className={
          hasActive
            ? 'w-3 h-3 text-color-terminal-accent-teal animate-pulse'
            : 'w-3 h-3 text-color-terminal-text-muted'
        }
      />
      {hasActive && (
        <span className="text-[10px] font-mono">
          <span className="text-color-terminal-text-muted">{t('backtestConsole.taskLabel')}</span>
          <span className="text-color-terminal-accent-gold ml-0.5">{activeCount}</span>
        </span>
      )}
    </button>
  );
}

export default DownloadStatusIndicator;
