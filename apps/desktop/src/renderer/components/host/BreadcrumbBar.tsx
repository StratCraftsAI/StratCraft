/**
 * BreadcrumbBar - Centralized breadcrumb navigation
 *
 * TICKET_300: Refactored to use useBreadcrumbs hook as single source of truth.
 * Breadcrumb segments are derived from VIEW_REGISTRY + subPagePath store state.
 * No more dual-track windowApi/store conflict.
 *
 * TICKET_555: AuthWidget removed from BreadcrumbBar and promoted to Toolbar
 * for global visibility across all pages.
 *
 * @see TICKET_300 - Centralized Breadcrumb Management Refactoring
 * @see TICKET_555 - Global AuthWidget Toolbar Promotion
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Home, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore, useAssistantStore } from '@/stores';
import { useBreadcrumbs } from '@/hooks/useBreadcrumbs';

// -----------------------------------------------------------------------------
// Sub-component: BreadcrumbSegment (Arrow style)
// -----------------------------------------------------------------------------

interface BreadcrumbSegmentProps {
  label: string;
  icon?: string;
  active?: boolean;
  isFirst?: boolean;
  onClick: () => void;
  IconComponent?: React.ElementType;
}

const BreadcrumbSegment: React.FC<BreadcrumbSegmentProps> = ({
  label,
  icon,
  active,
  isFirst,
  onClick,
  IconComponent,
}) => {
  // Styles for the rectangular part
  const baseClasses = "h-full flex items-center gap-1.5 px-3 border-y border-l transition-all duration-200";
  const activeClasses = "text-color-terminal-accent-teal border-color-terminal-accent-teal/30 bg-color-terminal-accent-teal/10 font-bold";
  const inactiveClasses = "text-color-terminal-text-muted border-white/10 bg-white/5 hover:text-color-terminal-accent-teal hover:border-color-terminal-accent-teal/30 hover:bg-white/10";

  // SVG specific colors to match Tailwind classes
  const strokeColor = active ? "rgba(100, 255, 218, 0.3)" : "rgba(255, 255, 255, 0.1)";
  const fillColor = active ? "rgba(100, 255, 218, 0.1)" : "rgba(255, 255, 255, 0.05)";

  return (
    <div className="flex items-center h-6 group cursor-pointer" onClick={onClick}>
      {/* Rectangular part */}
      <div className={cn(
        baseClasses,
        isFirst && "rounded-l-md",
        active ? activeClasses : inactiveClasses,
        "border-r-0" // SVG provides the right border
      )}>
        {IconComponent && <IconComponent className="w-3 h-3 opacity-60 group-hover:opacity-100 transition-opacity" />}
        {icon && <img src={icon} alt="" className="w-3 h-3" />}
        <span className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap">{label}</span>
      </div>

      {/* Triangular Tip - Now with closed path for consistent border and fill */}
      <svg
        className="h-6 w-3 overflow-visible transition-all duration-200"
        viewBox="0 0 12 24"
        preserveAspectRatio="none"
      >
        <path
          d="M0 0 L12 12 L0 24 L0 0 Z"
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth="1"
          strokeLinecap="round"
          className={cn(
            "transition-all duration-200",
            !active && "group-hover:fill-[rgba(255,255,255,0.1)] group-hover:stroke-[rgba(100,255,218,0.3)]"
          )}
          style={{ vectorEffect: 'non-scaling-stroke' }}
        />
      </svg>
    </div>
  );
};

// -----------------------------------------------------------------------------
// Main BreadcrumbBar Component
// -----------------------------------------------------------------------------

interface BreadcrumbBarProps {
  className?: string;
  showHome?: boolean;
  homeLabel?: string;
  onHomeClick?: () => void;
  /** Additional content to display in the center zone */
  centerContent?: React.ReactNode;
  /** Additional content to display in the right zone */
  rightContent?: React.ReactNode;
}

export const BreadcrumbBar: React.FC<BreadcrumbBarProps> = ({
  className,
  showHome = true,
  onHomeClick,
  centerContent,
  rightContent,
}) => {
  const { t } = useTranslation('ui');
  const activeView = useAppStore(state => state.activeView);
  const setActiveView = useAppStore(state => state.setActiveView);
  const assistantEnabled = useAssistantStore((s) => s.assistantEnabled);
  const panelOpen = useAssistantStore((s) => s.panelOpen);
  const togglePanel = useAssistantStore((s) => s.togglePanel);

  // TICKET_300: Single source of truth - derived from VIEW_REGISTRY + subPagePath
  const segments = useBreadcrumbs();

  const handleHomeClick = useCallback(() => {
    onHomeClick ? onHomeClick() : setActiveView('nexus');
  }, [onHomeClick, setActiveView]);

  if (activeView === 'nexus') return null;

  return (
    <div className={cn(
      'h-8 border-b border-color-terminal-border bg-color-terminal-panel flex items-center justify-between px-4 shadow-[0_1px_3px_rgba(0,0,0,0.3)]',
      className
    )}>
      <div className="flex items-center gap-2">
        {showHome && (
          <BreadcrumbSegment
            label={t('nav.nexusHub').toUpperCase()}
            isFirst={true}
            active={false}
            onClick={handleHomeClick}
            IconComponent={Home}
          />
        )}

        {segments.map((seg) => (
          <BreadcrumbSegment
            key={seg.id}
            label={seg.label}
            active={seg.active}
            isFirst={false}
            onClick={seg.onClick}
          />
        ))}
      </div>

      {/* Center Zone */}
      {centerContent && (
        <div className="flex-1 flex items-center justify-center">
          {centerContent}
        </div>
      )}

      {/* Right Zone */}
      <div className="flex items-center gap-4">
        {rightContent}

        {/* TICKET_593_1: Assistant Mode Toggle */}
        {assistantEnabled && (
          <button
            onClick={togglePanel}
            title={t('assistant.tooltip')}
            className={cn(
              'p-1.5 rounded transition-colors',
              panelOpen
                ? 'text-color-terminal-accent-teal bg-color-terminal-accent-teal/10'
                : 'text-color-terminal-text-muted hover:text-color-terminal-accent-teal hover:bg-white/10'
            )}
            data-testid="assistant-toggle"
          >
            <BookOpen className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

export default BreadcrumbBar;
