/**
 * SidePanel Component
 *
 * Navigation sidebar using VIEW_REGISTRY for centralized configuration.
 *
 * @see TICKET_062 - Plugin activation flow fix
 * @see TICKET_069 - Centralized View Registry
 * @see TICKET_080 - Plugin Storage Configuration (settings gear icon)
 * @see TICKET_1335_1 - Research Environment entry in the bottom system rail
 */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PackageCheck, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores';
import { getSidebarItems, type ViewId, type ViewConfig } from '@/config';

// -----------------------------------------------------------------------------
// SidePanel Component
// -----------------------------------------------------------------------------

export function SidePanel() {
  const { t } = useTranslation('ui');
  const { activeView, setActiveView } = useAppStore();
  const collapsed = true;

  // Get sidebar items from registry
  const navItems = useMemo(() => getSidebarItems(), []);

  // Handle navigation
  const handleNavigation = useCallback((viewId: ViewId) => {
    setActiveView(viewId);
  }, [setActiveView]);

  /**
   * TICKET_1335_1 AC2: the two bottom system-tool entries are mutually
   * exclusive BY CONSTRUCTION -- each is a straight equality against the one
   * `activeView`, so no rule has to keep them in sync and neither can be
   * highlighted while the other is. Settings' existing behaviour is unchanged;
   * the new entry simply participates in the same derivation.
   */
  const isResearchEnvironmentActive = activeView === 'researchEnvironment';
  const isSettingsActive = activeView === 'settings';

  return (
    <div
      data-onboarding="sidebar"
      className={cn(
        "h-full flex flex-col border-r border-white/5 transition-all duration-300 relative z-50",
        "w-12",
        "bg-color-terminal-panel/80 backdrop-blur-md"
      )}
    >
      <nav className="flex-1 py-4 flex flex-col gap-1 px-2">
        {navItems.map((item) => (
          <NavButton
            key={item.viewId}
            item={item}
            collapsed={collapsed}
            isActive={activeView === item.viewId}
            onClick={() => handleNavigation(item.viewId)}
          />
        ))}

        <div className="flex-1" />

        {/* TICKET_1335_1 D1/AC1: Research Environment sits directly above the
            Settings gear in the bottom system-tool zone. */}
        <SystemRailButton
          onboardingId="sidebar-research-environment"
          onClick={() => setActiveView('researchEnvironment')}
          label={t('toolbar.researchEnvironment')}
          icon={PackageCheck}
          isActive={isResearchEnvironmentActive}
        />

        {/* Settings gear icon at bottom - navigates to Settings Page */}
        <SystemRailButton
          onboardingId="sidebar-settings"
          onClick={() => setActiveView('settings')}
          label={t('toolbar.systemSettings')}
          icon={Settings}
          isActive={isSettingsActive}
        />
      </nav>
    </div>
  );
}

// -----------------------------------------------------------------------------
// SystemRailButton Component (TICKET_1335_1)
// -----------------------------------------------------------------------------

interface SystemRailButtonProps {
  onboardingId: string;
  onClick: () => void;
  label: string;
  icon: React.ElementType;
  isActive: boolean;
}

/**
 * One entry in the bottom system-tool zone.
 *
 * TICKET_1335_1 AC11: this exists so accessibility cannot regress on one bottom
 * entry and not the other. Previously the Settings gear was written inline with
 * only a `title`; a screen reader announced it as an unlabelled button, and
 * nothing conveyed which system page was current. Extracting the shape means
 * `aria-label` and `aria-current` are supplied once for every entry rather than
 * per call site, so adding a third entry later cannot silently omit them.
 *
 * `aria-current="page"` rather than `aria-pressed`: these buttons navigate to a
 * view, they do not toggle a setting.
 *
 * FOCUS RING (AC11): Tailwind's preflight removes the UA focus outline, and
 * nothing replaced it here -- live measurement in the running app reported
 * `outline: none 0px` and `box-shadow: none` on this button, so a keyboard user
 * had NO indication of where focus was in the bottom rail. The icon's own colour
 * cannot serve as the indicator: it is identical to the `isActive` colour, so on
 * the active entry focus would be entirely invisible.
 *
 * The ring matches the one the Research Environment page already uses on its own
 * controls, so the two halves of this feature indicate focus the same way rather
 * than each inventing a treatment. `ring-offset` separates the ring from the
 * icon against the dark rail so it reads as a ring and not a glow.
 */
const SystemRailButton: React.FC<SystemRailButtonProps> = ({
  onboardingId,
  onClick,
  label,
  icon: Icon,
  isActive,
}) => (
  <button
    data-onboarding={onboardingId}
    onClick={onClick}
    className={cn(
      "flex items-center justify-center py-2.5 rounded-lg transition-colors duration-200 group",
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400",
      "focus-visible:ring-offset-2 focus-visible:ring-offset-color-terminal-panel",
    )}
    title={label}
    aria-label={label}
    aria-current={isActive ? 'page' : undefined}
  >
    <Icon className={cn(
      "w-5 h-5 transition-colors duration-200",
      isActive
        ? "text-color-terminal-accent-teal"
        : "text-gray-400 group-hover:text-color-terminal-accent-teal"
    )} />
  </button>
);

// -----------------------------------------------------------------------------
// NavButton Component
// -----------------------------------------------------------------------------

interface NavButtonProps {
  item: ViewConfig;
  collapsed: boolean;
  isActive: boolean;
  onClick: () => void;
}

const NavButton: React.FC<NavButtonProps> = ({ item, collapsed, isActive, onClick }) => {
  const Icon = item.icon;

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-200 group",
        collapsed && "justify-center px-0"
      )}
      title={collapsed ? item.label : undefined}
    >
      <Icon className={cn(
        "w-5 h-5 transition-colors duration-200",
        isActive
          ? "text-color-terminal-accent-teal"
          : "text-gray-400 group-hover:text-color-terminal-accent-teal"
      )} />

      {!collapsed && (
        <span className={cn(
          "text-xs font-bold uppercase tracking-wider transition-colors duration-200",
          isActive
            ? "text-color-terminal-accent-teal"
            : "text-gray-400 group-hover:text-color-terminal-accent-teal"
        )}>
          {item.label}
        </span>
      )}
    </button>
  );
};
