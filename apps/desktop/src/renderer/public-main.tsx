import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import App from './App';
import { ErrorBoundary, I18nProvider, ThemeProvider } from '@/components/common';
import { MessageProvider, ModalProvider } from '@/components/host/Message';
import { getViewIdsByPluginId, isKnownViewId } from '@/config/view-registry';
import { initializeStrategyPlugin } from '@/lib/strategy-plugin-bridge';
import { wireNavigationActivation } from '@/lib/navigation-activation';
import { getPluginManager } from '@/lib/plugin-manager';
import { persistenceManager } from '@/services/persistence';
import { initExecutorSubscriptions } from '@/stores/useBacktestStatusStore';
import { REACT_QUERY_DEFAULT_RETRY, REACT_QUERY_STALE_TIME_MS } from '@shared/constants/timing';
import './styles/globals.css';

persistenceManager.initialize();
const manager = getPluginManager({
  pluginsDir: '',
  autoActivate: true,
  enabledPlugins: persistenceManager.getEnabledPlugins(),
  activationViewResolver: {
    resolveViewIds: getViewIdsByPluginId,
    isKnownViewId,
  },
});

manager.initialize()
  .then(() => wireNavigationActivation(manager))
  .catch((error) => console.error('[E:MAIN:PLUGIN_INIT_FAILED]', error));

window.electronAPI?.marketplace?.onInstallComplete?.(({ pluginId }) => {
  manager.refresh()
    .then(() => manager.activatePlugin(pluginId))
    .then((activated) => {
      if (activated) persistenceManager.addEnabledPlugin(pluginId);
    })
    .catch((error) => console.error('[E:MAIN:PLUGIN_INSTALL_REFRESH_FAILED]', error));
});

initializeStrategyPlugin();
initExecutorSubscriptions();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: REACT_QUERY_DEFAULT_RETRY,
      refetchOnWindowFocus: false,
      staleTime: REACT_QUERY_STALE_TIME_MS,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ThemeProvider>
            <MessageProvider>
              <ModalProvider>
                <App />
              </ModalProvider>
            </MessageProvider>
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
