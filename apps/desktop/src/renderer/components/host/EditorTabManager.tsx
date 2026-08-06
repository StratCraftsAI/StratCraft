/**
 * EditorTabManager - Tab management for custom editors in Host/Plugin architecture
 *
 * This component manages multiple editor tabs and renders custom editors
 * provided by plugins via CustomEditorProvider.
 *
 * @see TICKET_059 - Host/Plugin Architecture
 */

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { X, FileCode } from 'lucide-react';
import { cn } from '@/lib/utils';
import { windowApi } from '@/lib/plugin-context';
import type { CustomEditorProvider, EditorElement } from '@shared/types';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface EditorTab {
  id: string;
  resourceUri: string;
  viewType: string;
  label: string;
  isDirty?: boolean;
}

interface EditorTabManagerProps {
  className?: string;
  onTabClose?: (tab: EditorTab) => void;
  onTabChange?: (tab: EditorTab) => void;
}

// -----------------------------------------------------------------------------
// EditorContent Component
// -----------------------------------------------------------------------------

interface EditorContentProps {
  provider: CustomEditorProvider;
  resourceUri: string;
  viewType: string;
}

const EditorContent: React.FC<EditorContentProps> = ({
  provider,
  resourceUri,
  viewType,
}) => {
  const { t } = useTranslation('ui');
  const [element, setElement] = useState<EditorElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const editorElement = provider.resolveCustomEditor(resourceUri, viewType);
      setElement(editorElement);
      setError(null);
    } catch (err) {
      console.error('[E:UI:EDITOR_RESOLUTION_FAILED] Failed to resolve editor:', err);
      setError(err instanceof Error ? err.message : 'MSG_EDITOR_LOAD_FAILED');
    }
  }, [provider, resourceUri, viewType]);

  if (error) {
    const displayError = error.startsWith('MSG_')
      ? t(error, { ns: 'errors' })
      : error;

    return (
      <div className="flex items-center justify-center h-full text-color-terminal-error text-sm">
        {t('editor.error')}: {displayError}
      </div>
    );
  }

  if (!element) {
    return (
      <div className="flex items-center justify-center h-full text-color-terminal-text-muted text-sm">
        {t('editor.loading')}
      </div>
    );
  }

  // Render based on element type
  switch (element.type) {
    case 'react': {
      const Component = element.content as React.ComponentType<Record<string, unknown>>;
      return <Component resourceUri={resourceUri} {...(element.props || {})} />;
    }

    case 'html': {
      return (
        <div
          className="w-full h-full overflow-auto"
          dangerouslySetInnerHTML={{ __html: element.content as string }}
        />
      );
    }

    case 'iframe': {
      const url = element.content as string;
      return (
        <iframe
          src={url}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin"
          title={resourceUri}
        />
      );
    }

    default:
      return (
        <div className="flex items-center justify-center h-full text-color-terminal-text-muted text-sm">
          {t('editor.unknownType')}
        </div>
      );
  }
};

// -----------------------------------------------------------------------------
// EditorTabManager Component
// -----------------------------------------------------------------------------

export const EditorTabManager: React.FC<EditorTabManagerProps> = ({
  className,
  onTabClose,
  onTabChange,
}) => {
  const { t } = useTranslation('ui');
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Extract label from resourceUri
  const getTabLabel = useCallback((resourceUri: string): string => {
    const parts = resourceUri.split('/');
    return parts[parts.length - 1] || t('editor.untitled');
  }, [t]);

  // Listen for editor open events
  useEffect(() => {
    const handleEditorOpen = (
      event: CustomEvent<{ resourceUri: string; viewType: string }>
    ) => {
      const { resourceUri, viewType } = event.detail;
      const tabId = `${viewType}:${resourceUri}`;

      setTabs((prev) => {
        // Check if tab already exists
        const existing = prev.find((t) => t.id === tabId);
        if (existing) {
          return prev;
        }

        // Add new tab
        return [
          ...prev,
          {
            id: tabId,
            resourceUri,
            viewType,
            label: getTabLabel(resourceUri),
          },
        ];
      });

      setActiveTabId(tabId);
    };

    window.addEventListener('nexus:editor-open', handleEditorOpen as EventListener);

    return () => {
      window.removeEventListener(
        'nexus:editor-open',
        handleEditorOpen as EventListener
      );
    };
  }, [getTabLabel]);

  // Handle tab selection
  const handleTabClick = useCallback(
    (tab: EditorTab) => {
      setActiveTabId(tab.id);
      onTabChange?.(tab);
    },
    [onTabChange]
  );

  // Handle tab close
  const handleTabClose = useCallback(
    (e: React.MouseEvent, tab: EditorTab) => {
      e.stopPropagation();

      setTabs((prev) => {
        const filtered = prev.filter((t) => t.id !== tab.id);

        // If closing active tab, switch to another
        if (activeTabId === tab.id && filtered.length > 0) {
          setActiveTabId(filtered[filtered.length - 1].id);
        } else if (filtered.length === 0) {
          setActiveTabId(null);
        }

        return filtered;
      });

      onTabClose?.(tab);
    },
    [activeTabId, onTabClose]
  );

  // Get active tab
  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId),
    [tabs, activeTabId]
  );

  // Get provider for active tab
  const activeProvider = useMemo(() => {
    if (!activeTab) return null;
    return windowApi.getCustomEditorProvider(activeTab.viewType);
  }, [activeTab]);

  // No tabs open
  if (tabs.length === 0) {
    return (
      <div className={cn('w-full h-full flex items-center justify-center', className)}>
        <div className="text-color-terminal-text-muted text-sm">
          {t('editor.noEditorsOpen')}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('w-full h-full flex flex-col', className)}>
      {/* Tab Bar */}
      <div className="flex-shrink-0 h-9 bg-color-terminal-surface border-b border-color-terminal-border flex items-center overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              'flex items-center gap-2 h-full px-3 cursor-pointer border-r border-color-terminal-border',
              'transition-colors text-xs',
              activeTabId === tab.id
                ? 'bg-color-terminal-panel text-color-terminal-accent-teal border-b-2 border-b-color-terminal-accent-teal'
                : 'text-color-terminal-text-muted hover:bg-color-terminal-surface-hover'
            )}
            onClick={() => handleTabClick(tab)}
          >
            <FileCode className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate max-w-[120px]">
              {tab.isDirty && <span className="mr-1">*</span>}
              {tab.label}
            </span>
            <button
              className="w-4 h-4 flex items-center justify-center rounded hover:bg-color-terminal-surface-hover"
              onClick={(e) => handleTabClose(e, tab)}
              title={t('editor.close')}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab && activeProvider ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full text-color-terminal-text-muted text-sm">
                {t('editor.loading')}
              </div>
            }
          >
            <EditorContent
              provider={activeProvider}
              resourceUri={activeTab.resourceUri}
              viewType={activeTab.viewType}
            />
          </Suspense>
        ) : activeTab ? (
          <div className="flex items-center justify-center h-full text-color-terminal-text-muted text-sm">
            {t('editor.noProvider', { viewType: activeTab.viewType })}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default EditorTabManager;
