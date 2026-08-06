/**
 * ViewContainer - Generic view container for Host/Plugin architecture
 *
 * This component renders views provided by plugins via ViewProvider.
 * It handles view lifecycle and mounting of plugin-provided React components.
 *
 * @see TICKET_059 - Host/Plugin Architecture
 */

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { windowApi } from '@/lib/plugin-context';
import type { ViewProvider, ViewOptions, ViewElement } from '@shared/types';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface ViewContainerProps {
  viewId?: string;  // If not provided, listens for nexus:view-change events
  options?: ViewOptions;
  className?: string;
  fallback?: React.ReactNode;
  onViewChange?: (viewId: string, options?: ViewOptions) => void;
}

// -----------------------------------------------------------------------------
// ViewContent Component (renders the actual view)
// -----------------------------------------------------------------------------

interface ViewContentProps {
  provider: ViewProvider;
  viewId: string;
  options?: ViewOptions;
}

const ViewContent: React.FC<ViewContentProps> = ({ provider, viewId, options }) => {
  const { t } = useTranslation('ui');
  const [element, setElement] = useState<ViewElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const viewElement = provider.resolveView(viewId, options);
      setElement(viewElement);
      setError(null);
      provider.onDidShow?.();
    } catch (err) {
      console.error('[E:UI:VIEW_RESOLUTION_FAILED] Failed to resolve view:', err);
      setError(err instanceof Error ? err.message : t('view.failedToLoad'));
    }

    return () => {
      provider.onDidHide?.();
    };
  }, [provider, viewId, options, t]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-color-terminal-error text-sm">
        {t('view.errorPrefix', { error })}
      </div>
    );
  }

  if (!element) {
    return (
      <div className="flex items-center justify-center h-full text-color-terminal-text-muted text-sm">
        {t('view.loadingView')}
      </div>
    );
  }

  // Render based on element type
  switch (element.type) {
    case 'react': {
      const Component = element.content as React.ComponentType<Record<string, unknown>>;
      return <Component {...(element.props || {})} />;
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
          title={viewId}
        />
      );
    }

    default:
      return (
        <div className="flex items-center justify-center h-full text-color-terminal-text-muted text-sm">
          {t('view.unknownViewType')}
        </div>
      );
  }
};

// -----------------------------------------------------------------------------
// ViewContainer Component
// -----------------------------------------------------------------------------

export const ViewContainer: React.FC<ViewContainerProps> = ({
  viewId: propViewId,
  options: propOptions,
  className,
  fallback,
  onViewChange,
}) => {
  const { t } = useTranslation('ui');
  const [currentViewId, setCurrentViewId] = useState<string | null>(propViewId || null);
  const [currentOptions, setCurrentOptions] = useState<ViewOptions | undefined>(propOptions);

  // Listen for view changes if no viewId prop provided
  useEffect(() => {
    if (propViewId) {
      setCurrentViewId(propViewId);
      setCurrentOptions(propOptions);
      return;
    }

    const handleViewChange = (event: CustomEvent<{ viewId: string; options?: ViewOptions }>) => {
      const { viewId, options } = event.detail;
      setCurrentViewId(viewId);
      setCurrentOptions(options);
      onViewChange?.(viewId, options);
    };

    const handleViewClose = (event: CustomEvent<{ viewId: string }>) => {
      if (currentViewId === event.detail.viewId) {
        setCurrentViewId(null);
        setCurrentOptions(undefined);
      }
    };

    window.addEventListener('nexus:view-change', handleViewChange as EventListener);
    window.addEventListener('nexus:view-close', handleViewClose as EventListener);

    // Initialize with current view state
    const current = windowApi.getCurrentView();
    if (current.viewId) {
      setCurrentViewId(current.viewId);
      setCurrentOptions(current.options);
    }

    return () => {
      window.removeEventListener('nexus:view-change', handleViewChange as EventListener);
      window.removeEventListener('nexus:view-close', handleViewClose as EventListener);
    };
  }, [propViewId, propOptions, currentViewId, onViewChange]);

  // Get the provider for current view (reactive to late registration)
  const [provider, setProvider] = useState<ViewProvider | null>(() => {
    if (!currentViewId) return null;
    const p = windowApi.getViewProvider(currentViewId) || null;
    console.info(`[ViewContainer] useState init: viewId='${currentViewId}', provider=${p ? 'FOUND' : 'NULL'}`);
    return p;
  });

  useEffect(() => {
    console.info(`[ViewContainer] useEffect: currentViewId='${currentViewId}'`);
    if (!currentViewId) {
      setProvider(null);
      return;
    }
    const found = windowApi.getViewProvider(currentViewId) || null;
    console.info(`[ViewContainer] useEffect lookup: provider=${found ? 'FOUND' : 'NULL'}`);
    setProvider(found);

    const handleProviderRegistered = (e: CustomEvent<{ viewId: string }>) => {
      console.info(`[ViewContainer] nexus:view-provider-registered event received: ${e.detail.viewId}, matching=${e.detail.viewId === currentViewId}`);
      if (e.detail.viewId === currentViewId) {
        const p = windowApi.getViewProvider(currentViewId) || null;
        console.info(`[ViewContainer] event handler lookup: provider=${p ? 'FOUND' : 'NULL'}`);
        setProvider(p);
      }
    };
    window.addEventListener('nexus:view-provider-registered', handleProviderRegistered as EventListener);
    return () => {
      window.removeEventListener('nexus:view-provider-registered', handleProviderRegistered as EventListener);
    };
  }, [currentViewId]);

  // Render fallback if no view or provider
  if (!currentViewId || !provider) {
    return (
      <div className={cn('w-full h-full', className)}>
        {fallback || (
          <div className="flex items-center justify-center h-full text-color-terminal-text-muted text-sm">
            {currentViewId
              ? t('view.noProvider', { viewId: currentViewId })
              : t('view.noViewSelected')}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn('w-full h-full overflow-hidden', className)}>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full text-color-terminal-text-muted text-sm">
            {t('common.loading')}
          </div>
        }
      >
        <ViewContent
          provider={provider}
          viewId={currentViewId}
          options={currentOptions}
        />
      </Suspense>
    </div>
  );
};

export default ViewContainer;
