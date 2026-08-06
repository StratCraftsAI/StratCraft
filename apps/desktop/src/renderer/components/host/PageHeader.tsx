/**
 * PageHeader - Standardized header for Host/Plugin architecture
 *
 * Displays the title of the active view/plugin and contextual actions.
 * Automatically resolves titles from the Plugin Registry based on the active ID.
 *
 * @see TICKET_055_2 - Plugin Metadata & UI Contribution Specification
 */

import React, { useMemo } from 'react';
import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getPluginManager } from '@/lib/plugin-manager';
import { resolveManifestI18n } from '@/lib/manifest-i18n';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface PageHeaderProps {
  className?: string;
  pluginId?: string;
  viewId?: string;
  title?: string;
  subtitle?: string;
  rightContent?: React.ReactNode;
  /** Show settings button */
  showSettings?: boolean;
  /** Callback when settings button is clicked */
  onSettingsClick?: () => void;
}

// -----------------------------------------------------------------------------
// PageHeader Component
// -----------------------------------------------------------------------------

export const PageHeader: React.FC<PageHeaderProps> = ({
  className,
  pluginId,
  viewId,
  title: manualTitle,
  subtitle,
  rightContent,
  showSettings = false,
  onSettingsClick,
}) => {
  const { t, i18n } = useTranslation('ui');

  // Resolve title from manifest if not provided manually.
  // TICKET_786_6 Phase 1: route the manifest through resolveManifestI18n so
  // *Key sibling fields fold into the active locale; depending on i18n.language
  // keeps this memo locale-reactive.
  const resolvedTitle = useMemo(() => {
    if (manualTitle) return manualTitle;
    if (!pluginId) return '';

    try {
      const manager = getPluginManager();
      const plugin = manager.getPlugin(pluginId);
      if (!plugin) return pluginId;

      const manifest = resolveManifestI18n(plugin.manifest);

      // If viewId is provided, look for it in contributes.views
      if (viewId && manifest.contributes?.views) {
        for (const containerId in manifest.contributes.views) {
          const views = manifest.contributes.views[containerId];
          const view = views.find((v) => v.id === viewId);
          if (view) return view.name;
        }
      }

      // Fallback to plugin displayName
      return manifest.displayName || manifest.name;
    } catch (e) {
      console.warn('[W:UI:TITLE_RESOLUTION_FAILED] Failed to resolve title:', e);
      return pluginId;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, viewId, manualTitle, i18n.language]);

  // Determine if settings button should be visible
  const shouldShowSettings = showSettings || !!onSettingsClick;

  return (
    <div
      className={cn(
        'h-14 flex items-center justify-between border-b border-color-terminal-border pb-4 mb-6',
        className
      )}
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight terminal-mono glow-text uppercase">
          {resolvedTitle}
        </h1>
        {subtitle && (
          <p className="text-color-terminal-text-secondary text-xs uppercase tracking-widest mt-1">
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex items-center gap-4">
        {rightContent}
        {shouldShowSettings && (
          <button
            onClick={onSettingsClick}
            className="p-2 hover:bg-white/5 rounded-full transition-colors text-color-terminal-text-secondary hover:text-color-terminal-accent-teal"
            title={t('common.pluginSettings')}
          >
            <Settings className="w-4 h-4" />
          </button>
        )}
      </div>

      <style>{`
        .glow-text {
          text-shadow: 0 0 10px rgba(230, 241, 255, 0.3);
        }
      `}</style>
    </div>
  );
};

export default PageHeader;
