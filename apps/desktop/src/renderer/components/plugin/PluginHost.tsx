/**
 * PluginHost - Plugin host component
 *
 * Responsibilities:
 * 1. Load and render plugin UI components
 * 2. Provide error boundary isolation
 * 3. Support trusted mode and sandbox mode
 * 4. Manage plugin component lifecycle
 */

import React, { Component, Suspense, lazy, useEffect, useState, useRef } from 'react';
import type { PluginManifest, MainViewContribution, SidePanelContribution, BottomPanelContribution } from '@shared/types';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';

// =============================================================================
// Types
// =============================================================================

interface PluginHostProps {
  pluginId: string;
  manifest: PluginManifest;
  contribution: MainViewContribution | SidePanelContribution | BottomPanelContribution;
  className?: string;
}

interface PluginErrorBoundaryProps {
  pluginId: string;
  children: React.ReactNode;
  onError?: (error: Error) => void;
}

interface PluginErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// =============================================================================
// Plugin Error Boundary
// =============================================================================

class PluginErrorBoundary extends Component<PluginErrorBoundaryProps, PluginErrorBoundaryState> {
  state: PluginErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): PluginErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(`[E:PLUGIN:RUNTIME_ERROR] Plugin error [${this.props.pluginId}]:`, error, errorInfo);
    this.props.onError?.(error);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    const t = i18n.t.bind(i18n);
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 bg-destructive/5 rounded-lg">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div className="text-center">
            <h3 className="text-sm font-semibold text-destructive">{t('ui:plugin.error')}</h3>
            <p className="mt-1 text-xs text-muted-foreground max-w-xs">
              {this.state.error?.message || t('ui:plugin.errorOccurred')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              {t('ui:plugin.pluginLabel', { pluginId: this.props.pluginId })}
            </p>
          </div>
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <RefreshCw className="h-3 w-3" />
            {t('ui:common.retry')}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// =============================================================================
// Loading Component
// =============================================================================

function PluginLoading({ title }: { title: string }): JSX.Element {
  const { t } = useTranslation('ui');
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {t('plugin.loadingPlugin', { title })}
      </p>
    </div>
  );
}

// =============================================================================
// Trusted Plugin Host (direct loading)
// =============================================================================

function TrustedPluginHost({ pluginId, manifest, contribution, className }: PluginHostProps): JSX.Element {
  const { t } = useTranslation(['ui', 'errors']);
  const [PluginComponent, setPluginComponent] = useState<React.ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadComponent(): Promise<void> {
      try {
        const pluginPath = (manifest as PluginManifest & { _path?: string })._path || '';
        const entryPath = contribution.entry;
        const fullPath = `${pluginPath}/${entryPath}`;

        // Dynamically load component
        const module = await import(/* webpackIgnore: true */ fullPath);
        const Component = module.default || module[contribution.id] || Object.values(module)[0];

        if (!mounted) return;

        if (typeof Component === 'function') {
          setPluginComponent(() => Component);
        } else {
          // TICKET_786 D.1: sentinel; translated below via errors:MSG_PLUGIN_INVALID_COMPONENT
          throw new Error('PLUGIN_INVALID_COMPONENT');
        }
      } catch (err) {
        if (!mounted) return;
        // TICKET_786 D.1: translate sentinel codes before exposing to UI
        const raw = err instanceof Error ? err.message : t('errors:MSG_PLUGIN_LOAD_FAILED', { reason: '' });
        const message = raw === 'PLUGIN_INVALID_COMPONENT'
          ? t('errors:MSG_PLUGIN_INVALID_COMPONENT')
          : raw;
        setError(message);
        console.error(`[E:PLUGIN:LOAD_FAILED] Failed to load plugin [${pluginId}]:`, err);
      }
    }

    loadComponent();

    return () => {
      mounted = false;
    };
  }, [pluginId, manifest, contribution]);

  if (error) {
    return (
      <div className={`flex h-full flex-col items-center justify-center gap-3 p-6 ${className ?? ''}`}>
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground text-center">
          {t('plugin.failedToLoad', { error })}
        </p>
      </div>
    );
  }

  if (!PluginComponent) {
    return <PluginLoading title={contribution.title} />;
  }

  return (
    <PluginErrorBoundary pluginId={pluginId}>
      <div className={className}>
        <PluginComponent />
      </div>
    </PluginErrorBoundary>
  );
}

// =============================================================================
// Sandboxed Plugin Host (iframe isolation)
// =============================================================================

function SandboxedPluginHost({ pluginId, manifest, contribution, className }: PluginHostProps): JSX.Element {
  const { t } = useTranslation('ui');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const pluginPath = (manifest as PluginManifest & { _path?: string })._path || '';
    const entryPath = contribution.entry;

    // Build iframe content
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <!-- TICKET_091: Relaxed CSP for plugin network access -->
        <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: wss:;">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body, #root { min-height: 100%; }
          body { font-family: Inter, system-ui, -apple-system, sans-serif; }
        </style>
      </head>
      <body>
        <div id="root"></div>
        <script type="module" src="${pluginPath}/${entryPath}"></script>
      </body>
      </html>
    `;

    // Set iframe content
    try {
      iframe.srcdoc = htmlContent;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('plugin.sandboxError', { error: '' }));
    }

    // Listen to messages
    function handleMessage(event: MessageEvent): void {
      if (event.source !== iframeRef.current?.contentWindow) return;

      const { type, payload } = event.data || {};

      switch (type) {
        case 'plugin:ready':
          setLoaded(true);
          break;
        case 'plugin:error':
          setError(payload?.message || t('plugin.error'));
          break;
        case 'plugin:command':
          // Forward command to host
          window.dispatchEvent(new CustomEvent('plugin:command', {
            detail: { pluginId, ...payload },
          }));
          break;
      }
    }

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [pluginId, manifest, contribution]);

  if (error) {
    return (
      <div className={`flex h-full flex-col items-center justify-center gap-3 p-6 ${className ?? ''}`}>
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground text-center">
          {t('plugin.sandboxError', { error })}
        </p>
      </div>
    );
  }

  return (
    <div className={`relative h-full w-full ${className ?? ''}`}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-background">
          <PluginLoading title={contribution.title} />
        </div>
      )}
      <iframe
        ref={iframeRef}
        title={contribution.title}
        className="h-full w-full border-0"
        sandbox="allow-scripts allow-same-origin"
        style={{ opacity: loaded ? 1 : 0 }}
      />
    </div>
  );
}

// =============================================================================
// Main PluginHost Component
// =============================================================================

export function PluginHost(props: PluginHostProps): JSX.Element {
  const { manifest } = props;

  // Select rendering method based on isolation mode
  if (manifest.isolation === 'sandbox') {
    return <SandboxedPluginHost {...props} />;
  }

  // Use trusted mode by default
  return <TrustedPluginHost {...props} />;
}

// =============================================================================
// Plugin Container Components
// =============================================================================

interface PluginContainerProps {
  pluginId: string;
  manifest: PluginManifest;
  contributions: MainViewContribution[] | SidePanelContribution[] | BottomPanelContribution[];
  activeId?: string;
  className?: string;
}

/**
 * Main view container - render mainView contribution points
 */
export function MainViewContainer({
  pluginId,
  manifest,
  contributions,
  activeId,
  className,
}: PluginContainerProps): JSX.Element | null {
  const activeContribution = contributions.find(c => c.id === activeId) ?? contributions[0];

  if (!activeContribution) {
    return null;
  }

  return (
    <PluginHost
      pluginId={pluginId}
      manifest={manifest}
      contribution={activeContribution}
      className={className}
    />
  );
}

/**
 * Side panel container - render sidePanel contribution points
 */
export function SidePanelContainer({
  pluginId,
  manifest,
  contributions,
  activeId,
  className,
}: PluginContainerProps): JSX.Element | null {
  const activeContribution = contributions.find(c => c.id === activeId) ?? contributions[0];

  if (!activeContribution) {
    return null;
  }

  return (
    <div className={`h-full ${className ?? ''}`}>
      <div className="border-b px-3 py-2">
        <h3 className="text-sm font-medium">{activeContribution.title}</h3>
      </div>
      <div className="flex-1 overflow-auto">
        <PluginHost
          pluginId={pluginId}
          manifest={manifest}
          contribution={activeContribution}
        />
      </div>
    </div>
  );
}

/**
 * Bottom panel container - render bottomPanel contribution points
 */
export function BottomPanelContainer({
  pluginId,
  manifest,
  contributions,
  activeId,
  className,
}: PluginContainerProps): JSX.Element | null {
  const activeContribution = contributions.find(c => c.id === activeId) ?? contributions[0];

  if (!activeContribution) {
    return null;
  }

  return (
    <div className={`h-full ${className ?? ''}`}>
      <PluginHost
        pluginId={pluginId}
        manifest={manifest}
        contribution={activeContribution}
      />
    </div>
  );
}

// =============================================================================
// Export
// =============================================================================

export default PluginHost;
