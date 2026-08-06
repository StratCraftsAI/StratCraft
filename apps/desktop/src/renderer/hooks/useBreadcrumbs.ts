/**
 * useBreadcrumbs Hook - Single Source of Truth for Breadcrumb Navigation
 *
 * Derives breadcrumb segments from VIEW_REGISTRY + subPagePath store state.
 * Eliminates the dual-track windowApi/store conflict (TICKET_299).
 *
 * @see TICKET_300 - Centralized Breadcrumb Management Refactoring
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/stores';
import { VIEW_REGISTRY } from '@/config/view-registry';
import type { ViewId, ViewConfig } from '@/config/view-registry';

export interface BreadcrumbSegment {
  id: string;
  label: string;
  active: boolean;
  onClick: () => void;
}

export function useBreadcrumbs(): BreadcrumbSegment[] {
  const { t } = useTranslation('ui');
  const activeView = useAppStore(s => s.activeView);
  const subPagePath = useAppStore(s => s.subPagePath);
  const popToSubPage = useAppStore(s => s.popToSubPage);
  const resetSubPages = useAppStore(s => s.resetSubPages);

  const setActiveView = useAppStore(s => s.setActiveView);

  // TICKET_786_4: Resolve breadcrumb label preferring translation key, falling
  // back to the English `shortLabel`/`label` baked into VIEW_REGISTRY.
  const resolveShortLabel = (config: ViewConfig): string => {
    if (config.shortLabelKey) {
      const translated = t(config.shortLabelKey);
      if (translated && translated !== config.shortLabelKey) return translated;
    }
    if (config.labelKey) {
      const translated = t(config.labelKey);
      if (translated && translated !== config.labelKey) return translated;
    }
    return config.shortLabel || config.label;
  };

  return useMemo(() => {
    const viewConfig = VIEW_REGISTRY[activeView as ViewId];
    if (!viewConfig || activeView === 'nexus') return [];

    const segments: BreadcrumbSegment[] = [];
    const hasSubPages = subPagePath.length > 0;

    // Parent view segment (e.g., backtestResult -> BACKTEST as clickable ancestor)
    const parentConfig = viewConfig.parentViewId
      ? VIEW_REGISTRY[viewConfig.parentViewId]
      : undefined;

    if (parentConfig) {
      const parentLabel = resolveShortLabel(parentConfig);
      segments.push({
        id: parentConfig.viewId,
        label: parentLabel,
        active: false,
        onClick: () => setActiveView(parentConfig.viewId as Parameters<typeof setActiveView>[0]),
      });
    }

    // Current view root (e.g., "STRATEGY BUILDER", "BACKTEST NEXUS", "RESULT")
    const viewLabel = resolveShortLabel(viewConfig);
    segments.push({
      id: activeView,
      label: viewLabel,
      active: !hasSubPages,
      onClick: () => {
        if (hasSubPages) {
          // Navigate back to view root - call first sub-page's onNavigate for state reset
          const firstEntry = subPagePath[0];
          resetSubPages();
          firstEntry?.onNavigate?.();
        }
      },
    });

    // Segment 2..N: Sub-page path
    subPagePath.forEach((entry, index) => {
      const isLast = index === subPagePath.length - 1;
      segments.push({
        id: `sub-${index}-${entry.label}`,
        label: entry.label,
        active: isLast,
        onClick: () => {
          if (!isLast) {
            popToSubPage(index);
            entry.onNavigate?.();
          }
        },
      });
    });

    return segments;
  }, [activeView, subPagePath, popToSubPage, resetSubPages, setActiveView, t]);
}
