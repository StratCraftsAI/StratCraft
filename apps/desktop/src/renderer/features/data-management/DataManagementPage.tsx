/**
 * DataManagementPage - Main Data Management Center page
 *
 * TICKET_340: Data catalog browser, download queue, and cache statistics.
 * Follows SettingsPage tab pattern with BreadcrumbBar.
 */

import React, { useEffect } from 'react';
import { List, Download, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { BreadcrumbBar } from '@/components/host';
import { MiniNameplate } from '@/components/common';
import { CacheStatsCards } from './components/CacheStatsCards';
import { DataCatalogTable } from './components/DataCatalogTable';
import { DownloadQueuePanel } from './components/DownloadQueuePanel';
import { ImportPanel } from './components/ImportPanel';
import { useDataCatalog } from './hooks/useDataCatalog';
import { useDownloadQueueStore } from '@/stores/useDownloadQueueStore';
import { useAppStore } from '@/stores';

// =============================================================================
// Types
// =============================================================================

// TICKET_308_1a (Phase 7): 'import' is the BYOD package-import surface. The tab
// union is owned by the Zustand store (TICKET_367 page-state layer model);
// derive the local alias from the store action so the two can never drift.
type DataManagementTab = Parameters<
  ReturnType<typeof useAppStore.getState>['setDataManagementTab']
>[0];

// =============================================================================
// Tab Button (reuse SettingsPage pattern)
// =============================================================================

interface TabButtonProps {
  label: string;
  Icon: React.ElementType;
  active: boolean;
  isFirst: boolean;
  isLast: boolean;
  onClick: () => void;
}

const TabButton: React.FC<TabButtonProps> = ({
  label,
  Icon,
  active,
  isFirst,
  isLast,
  onClick,
}) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-1.5 px-4 py-1.5 transition-all duration-200",
      active
        ? "bg-color-terminal-accent-teal/10 text-color-terminal-accent-teal"
        : "bg-transparent text-color-terminal-text-muted hover:text-color-terminal-accent-teal hover:bg-white/5",
      isFirst && "rounded-l",
      isLast && "rounded-r",
      !isLast && "border-r border-dashed border-white/20"
    )}
  >
    <Icon className="w-3 h-3" />
    <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
  </button>
);

// =============================================================================
// Component
// =============================================================================

export function DataManagementPage(): JSX.Element {
  const { t } = useTranslation('ui');
  // TICKET_348: Read tab from global store (set by StatusBar indicator click)
  const activeTab = useAppStore(state => state.dataManagementTab);
  const setActiveTab = useAppStore(state => state.setDataManagementTab);
  const catalog = useDataCatalog();
  const queue = useDownloadQueueStore();

  // TICKET_348: Initialize global download queue subscription
  useEffect(() => {
    queue.init();
  }, [queue.init]);

  const tabs: Array<{ id: DataManagementTab; label: string; Icon: React.ElementType }> = [
    { id: 'catalog', label: t('dataManagement.tabs.catalog'), Icon: List },
    { id: 'downloadQueue', label: t('dataManagement.tabs.downloadQueue'), Icon: Download },
    { id: 'import', label: t('dataManagement.tabs.import'), Icon: Upload },
  ];

  // Tab switcher for BreadcrumbBar rightContent
  const tabSwitcher = (
    <div className="inline-flex border border-dashed border-white/20 rounded">
      {tabs.map((tab, index) => (
        <TabButton
          key={tab.id}
          label={tab.label}
          Icon={tab.Icon}
          active={activeTab === tab.id}
          isFirst={index === 0}
          isLast={index === tabs.length - 1}
          onClick={() => setActiveTab(tab.id)}
        />
      ))}
    </div>
  );

  return (
    <div className="h-full flex flex-col terminal-theme bg-StratCraftsAI">
      {/* Breadcrumb Bar */}
      <BreadcrumbBar
        centerContent={<MiniNameplate text={t('dataManagement.title')} />}
        rightContent={tabSwitcher}
      />

      {/* Stats Cards */}
      <CacheStatsCards stats={catalog.stats} />

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'catalog' && (
          <DataCatalogTable
            segments={catalog.segments}
            total={catalog.total}
            filters={catalog.filters}
            loading={catalog.loading}
            stats={catalog.stats}
            onFiltersChange={catalog.setFilters}
            onDelete={catalog.deleteSegments}
            onRefresh={catalog.refresh}
          />
        )}
        {activeTab === 'downloadQueue' && (
          <DownloadQueuePanel
            tasks={queue.tasks}
            onEnqueue={queue.enqueue}
            onCancel={queue.cancel}
          />
        )}
        {activeTab === 'import' && <ImportPanel />}
      </div>
    </div>
  );
}

export default DataManagementPage;
