/**
 * PluginSettingsPage - Plugin-level settings page
 *
 * TICKET_093: Plugin Settings UI Decoupling
 * Full settings page owned by the plugin, not Host layer.
 *
 * TICKET_646_2: Unified sidebar navigation replacing top tabs.
 * All sections (Config, LLM, Account) are rendered in a single
 * scrollable pane with one left sidebar for navigation.
 *
 * @see TICKET_093 - Plugin Settings Decoupling
 * @see TICKET_081 - Plugin Settings Architecture
 * @see TICKET_646_2 - Unified Sidebar Navigation
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, ArrowLeft, UserCircle, Brain, Coins } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ConfigTab } from './ConfigTab';
import type { CategoryGroup } from './ConfigTab';
import { AccountTab } from './AccountTab';
import { LLMSettingsPanel } from './LLMSettingsPanel';

// =============================================================================
// Types
// =============================================================================

// TICKET_646_2: SettingsTab kept for backward compatibility (defaultTab prop from host)
type SettingsTab = 'config' | 'llm' | 'account';

interface PluginSettingsPageProps {
  pluginId: string;
  pluginName: string;
  onBack?: () => void;
  /** Default tab/section to scroll to when opening settings */
  defaultTab?: SettingsTab;
}

// =============================================================================
// Sidebar Navigation Types
// =============================================================================

interface SidebarGroup {
  id: string;
  labelKey: string;
  items: SidebarItem[];
}

interface SidebarItem {
  id: string;
  label: string;
  labelKey?: string;
  Icon: React.ElementType;
}

// =============================================================================
// MiniNameplate Component
// =============================================================================

interface MiniNameplateProps {
  text: string;
}

const MiniNameplate: React.FC<MiniNameplateProps> = ({ text }) => {
  return (
    <div className="inline-flex items-center px-3 py-1 border border-dashed border-white/30 rounded">
      <span className="text-[12px] font-bold uppercase tracking-[0.2em] text-color-terminal-text-muted">
        {text}
      </span>
    </div>
  );
};

// =============================================================================
// Header Bar Component (simplified - no tab switcher)
// =============================================================================

interface SettingsHeaderBarProps {
  pluginName: string;
  onBack?: () => void;
  t: (key: string) => string;
}

const SettingsHeaderBar: React.FC<SettingsHeaderBarProps> = ({
  pluginName,
  onBack,
  t,
}) => {
  const nameplateText = pluginName.toUpperCase();

  return (
    <div className="h-8 border-b border-color-terminal-border bg-color-terminal-panel flex items-center justify-between px-4 shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
      {/* Left: Back button + label */}
      <div className="flex items-center gap-3">
        {onBack && (
          <>
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-color-terminal-text-muted hover:text-color-terminal-accent-teal transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-[12px] font-bold">{t('pluginSettings.back')}</span>
            </button>
            <div className="h-4 w-px bg-white/20" />
          </>
        )}
        <span className="text-[12px] font-bold uppercase tracking-widest text-color-terminal-text-muted">
          {t('pluginSettings.config')}
        </span>
      </div>

      {/* Center: Nameplate */}
      <div className="flex-1 flex items-center justify-center">
        <MiniNameplate text={nameplateText} />
      </div>

      {/* Right: empty (tab switcher removed in TICKET_646_2) */}
      <div className="w-48" />
    </div>
  );
};

// =============================================================================
// Sidebar Component
// =============================================================================

interface UnifiedSidebarProps {
  groups: SidebarGroup[];
  activeSection: string;
  onSectionClick: (sectionId: string) => void;
  t: (key: string) => string;
}

const UnifiedSidebar: React.FC<UnifiedSidebarProps> = ({
  groups,
  activeSection,
  onSectionClick,
  t,
}) => {
  return (
    <nav className="w-96 flex-shrink-0 border-r border-white/10 py-4 overflow-y-auto">
      {groups.map((group, groupIndex) => (
        <div key={group.id}>
          {/* Group separator (except first) */}
          {groupIndex > 0 && (
            <div className="mx-4 my-2 border-b border-white/10" />
          )}

          {/* Group header */}
          <div className="px-4 py-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              {t(group.labelKey)}
            </span>
          </div>

          {/* Group items */}
          <div className="space-y-0.5 px-2">
            {group.items.map((item) => {
              const Icon = item.Icon;
              const isActive = activeSection === item.id;
              const displayLabel = item.labelKey ? t(item.labelKey) : item.label;
              return (
                <button
                  key={item.id}
                  onClick={() => onSectionClick(item.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors text-left',
                    isActive
                      ? 'text-color-terminal-accent-teal bg-color-terminal-accent-teal/5'
                      : 'text-muted-foreground hover:text-color-terminal-accent-teal hover:bg-white/5'
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{displayLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
};

// =============================================================================
// Main Component
// =============================================================================

// Valid tab values for backward-compatible defaultTab prop
const VALID_TABS: SettingsTab[] = ['config', 'llm', 'account'];

// Map defaultTab values to section id prefixes for initial scroll
const TAB_TO_SECTION_PREFIX: Record<SettingsTab, string> = {
  config: '', // Will scroll to first config category
  llm: 'section-llm',
  account: 'account-plan',
};

export function PluginSettingsPage({
  pluginId,
  pluginName,
  onBack,
  defaultTab = 'config',
}: PluginSettingsPageProps): JSX.Element {
  const { t } = useTranslation('strategy-builder');
  const contentRef = useRef<HTMLDivElement>(null);

  // Dynamic config categories from ConfigTab
  const [configCategories, setConfigCategories] = useState<CategoryGroup[]>([]);

  // Active sidebar section for highlighting
  const [activeSection, setActiveSection] = useState<string>('');

  // TICKET_646_2: Build sidebar groups from config categories + fixed LLM/Account items
  const sidebarGroups: SidebarGroup[] = [];

  // Config group (dynamic from manifest)
  if (configCategories.length > 0) {
    sidebarGroups.push({
      id: 'config',
      labelKey: 'pluginSettings.sidebar.config',
      items: configCategories.map((cat) => ({
        id: cat.name.toLowerCase().replace(/\s+/g, '-'),
        label: cat.name,
        Icon: Settings,
      })),
    });
  }

  // LLM group
  sidebarGroups.push({
    id: 'llm',
    labelKey: 'pluginSettings.sidebar.llm',
    items: [
      {
        id: 'section-llm',
        label: '',
        labelKey: 'pluginSettings.sidebar.keys',
        Icon: Brain,
      },
    ],
  });

  // Account group
  sidebarGroups.push({
    id: 'account',
    labelKey: 'pluginSettings.sidebar.account',
    items: [
      {
        id: 'account-plan',
        label: '',
        labelKey: 'accountTab.nav.plan',
        Icon: UserCircle,
      },
      {
        id: 'account-credit',
        label: '',
        labelKey: 'accountTab.nav.credit',
        Icon: Coins,
      },
    ],
  });

  // Handle categories loaded from ConfigTab
  const handleCategoriesReady = useCallback((categories: CategoryGroup[]) => {
    setConfigCategories(categories);
  }, []);

  // Scroll to section
  const scrollToSection = useCallback((sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveSection(sectionId);
    }
  }, []);

  // Set initial active section based on defaultTab
  useEffect(() => {
    const validTab = VALID_TABS.includes(defaultTab) ? defaultTab : 'config';
    const targetSection = TAB_TO_SECTION_PREFIX[validTab];

    if (validTab === 'config' && configCategories.length > 0) {
      const firstId = configCategories[0].name.toLowerCase().replace(/\s+/g, '-');
      setActiveSection(firstId);
      // Defer scroll to allow DOM to render
      requestAnimationFrame(() => {
        const el = document.getElementById(firstId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } else if (targetSection) {
      setActiveSection(targetSection);
      requestAnimationFrame(() => {
        const el = document.getElementById(targetSection);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [defaultTab, configCategories]);

  // Track scroll position to update active sidebar item
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const allSectionIds: string[] = [];
    for (const group of sidebarGroups) {
      for (const item of group.items) {
        allSectionIds.push(item.id);
      }
    }

    const handleScroll = () => {
      // Find the section closest to the top of the viewport
      let closestId = '';
      let closestDistance = Infinity;

      for (const id of allSectionIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const distance = Math.abs(rect.top - 100); // offset for header
        if (distance < closestDistance) {
          closestDistance = distance;
          closestId = id;
        }
      }

      if (closestId && closestId !== activeSection) {
        setActiveSection(closestId);
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  });

  return (
    <div className="h-full flex flex-col bg-StratCraftsAI terminal-theme">
      {/* Header Bar (no tab switcher) */}
      <SettingsHeaderBar
        pluginName={pluginName}
        onBack={onBack}
        t={t}
      />

      {/* Body: Sidebar + Scrollable Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Unified Sidebar */}
        <UnifiedSidebar
          groups={sidebarGroups}
          activeSection={activeSection}
          onSectionClick={scrollToSection}
          t={t}
        />

        {/* Single Scrollable Content Pane - TICKET_768_2: fills width right of the w-96 rail, p-6 padding (unified with the other settings pages) */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Config Sections (embedded - no sidebar) */}
            <ConfigTab
              pluginId={pluginId}
              embedded
              onCategoriesReady={handleCategoriesReady}
            />

            {/* LLM Section */}
            <div id="section-llm" className="scroll-mt-4">
              <LLMSettingsPanel pluginId={pluginId} />
            </div>

            {/* Account Sections (embedded - no sidebar) */}
            <AccountTab pluginId={pluginId} embedded />
          </div>
        </div>
      </div>
    </div>
  );
}

export default PluginSettingsPage;
export type { PluginSettingsPageProps, SettingsTab };
