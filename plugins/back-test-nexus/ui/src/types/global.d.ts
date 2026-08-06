/**
 * Global type declarations for Electron API
 * TICKET_136: Added data API types
 */

interface DataEnsureConfig {
  symbol: string;
  startDate: string;
  endDate: string;
  interval: string;
  provider?: string;
  forceDownload?: boolean;
  callerId?: string;
}

interface DataEnsureResult {
  success: boolean;
  symbol: string;
  dataType?: 'forex' | 'stock' | 'crypto';
  coverage?: {
    symbol: string;
    interval: string;
    startDate: string;
    endDate: string;
    totalBars: number;
    completeness: number;
  };
  source?: string;
  dataPath?: string;
  error?: string;
}

interface DataCoverageConfig {
  symbol: string;
  startDate: string;
  endDate: string;
  interval: string;
}

interface DataCoverageResult {
  symbol: string;
  interval: string;
  startDate: string;
  endDate: string;
  totalBars: number;
  completeness: number;
  missingRanges?: Array<{ start: string; end: string }>;
  error?: string;
}

interface SymbolSearchResult {
  symbol: string;
  name: string;
  type: 'forex' | 'stock' | 'crypto';
  status: string;
}

interface ConnectionCheckResult {
  provider: string;
  connected: boolean;
  latencyMs?: number;
  lastCheck: string;
  error?: string;
}

interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  plan: 'FREE' | 'PRO' | 'ENT';
}

interface AuthStateData {
  isAuthenticated: boolean;
  user: AuthUser | null;
}

declare global {
  interface Window {
    electronAPI: {
      database: {
        // TICKET_771 Step 2 / Layer 2b: signature anchored on the canonical
        // preload contract (apps/desktop/src/preload/index.ts) via the
        // shared/types/algorithm types. Do NOT redeclare the shape inline
        // here -- the previous inline declaration drifted (required
        // strategyType, missing userId default) and caused the build break
        // TICKET_770 had to patch.
        getAlgorithms: (
          params: import('@shared/types/algorithm').GetAlgorithmsOptions,
        ) => Promise<import('@shared/types/algorithm').GetAlgorithmsResult>;
      };
      data: {
        ensure: (config: DataEnsureConfig) => Promise<DataEnsureResult>;
        checkCoverage: (config: DataCoverageConfig) => Promise<DataCoverageResult>;
        searchSymbols: (query: string) => Promise<{ results: SymbolSearchResult[]; totalCount: number; truncated: boolean }>;
        checkConnection: (provider: string) => Promise<ConnectionCheckResult>;
        onProgress: (callback: (event: unknown, data: unknown) => void) => () => void;
        cancelDownload: () => void;
        // TICKET_883: Provider status cache API
        listProviders: () => Promise<Array<{ id: string; name: string; status: 'connected' | 'disconnected' | 'not-configured' | 'error' | 'checking'; capabilities: Record<string, unknown>; latencyMs?: number; error?: string }>>;
        refreshProviderStatus: () => Promise<Array<{ id: string; name: string; status: 'connected' | 'disconnected' | 'not-configured' | 'error' | 'checking'; capabilities: Record<string, unknown>; latencyMs?: number; error?: string }>>;
        onProviderStatusChanged: (callback: (entries: Array<{ id: string; name: string; status: 'connected' | 'disconnected' | 'not-configured' | 'error' | 'checking'; capabilities: Record<string, unknown>; latencyMs?: number; error?: string }>) => void) => () => void;
        // TICKET_332: Legacy progressive status (deprecated, kept for compat)
        getProviderList: () => Promise<Array<{ id: string; name: string; capabilities?: { requiresAuth?: boolean; intervals?: string[]; maxLookback?: Record<string, string> } }>>;
        checkProvidersProgressive: () => Promise<{ started: boolean; count: number }>;
        onProviderStatus: (callback: (event: { id: string; status: 'connected' | 'disconnected' | 'error' | 'not-configured'; latencyMs?: number; error?: string }) => void) => () => void;
        // TICKET_909: Imported packages for data source dropdown
        listImportedPackages: () => Promise<Array<{ packageName: string; adjustMode: string; sourceDialect: string; createdAt: number }>>;
      };
      auth: {
        getState: () => Promise<{
          success: boolean;
          data?: AuthStateData;
          error?: string;
        }>;
        getUser: () => Promise<{
          success: boolean;
          data?: {
            id: string;
            email: string;
            name: string;
            avatar?: string;
            plan: 'FREE' | 'PRO' | 'GOLD';
          } | null;
          error?: string;
        }>;
        onStateChanged: (callback: (data: AuthStateData) => void) => () => void;
      };
      credential: {
        get: (pluginId: string, key: string) => Promise<{
          success: boolean;
          value?: string;
          errorCode?: number;
          errorMessage?: string;
        }>;
        set: (pluginId: string, key: string, value: string) => Promise<{
          success: boolean;
          errorMessage?: string;
        }>;
        delete: (pluginId: string, key: string) => Promise<{
          success: boolean;
          errorMessage?: string;
        }>;
        has: (pluginId: string, key: string) => Promise<{
          success: boolean;
          exists: boolean;
          errorMessage?: string;
        }>;
        list: (pluginId: string) => Promise<{
          success: boolean;
          keys: string[];
          errorMessage?: string;
        }>;
        getAuditLog: (pluginId?: string, maxEntries?: number) => Promise<{
          success: boolean;
          entries: Array<{
            timestamp: number;
            operation: 'get' | 'set' | 'delete';
            pluginId: string;
            key: string;
            tier: number;
          }>;
          errorMessage?: string;
        }>;
        validateApiKey: (provider: string, apiKey: string) => Promise<{
          success: boolean;
          data?: {
            valid: boolean;
            keyType?: string;
            error?: string;
          };
          errorMessage?: string;
        }>;
      };
      plugin: {
        getManifest: (pluginId: string) => Promise<{
          success: boolean;
          manifest?: unknown;
          error?: string;
        }>;
        getConfig: (pluginId: string) => Promise<{
          success: boolean;
          config?: Record<string, unknown>;
          error?: string;
        }>;
        setConfig: (pluginId: string, key: string, value: unknown) => Promise<{
          success: boolean;
          error?: string;
        }>;
        isInstalled: (pluginId: string) => Promise<{
          success: boolean;
          installed: boolean;
          error?: string;
        }>;
      };
    };
  }

  // TICKET_770: Host-injected nexus API. Plugins access via
  // globalThis.nexus?.window?.showConfirm() etc.; the host's actual
  // implementation lives in apps/desktop/src/renderer/lib/plugin-context.ts
  // and this declaration is the plugin-side subset we currently consume.
  // eslint-disable-next-line no-var
  var nexus: {
    window?: {
      showAlert(message: string, options?: { title?: string; action?: string }): Promise<void>;
      showConfirm(
        message: string,
        options?: {
          title?: string;
          variant?: 'confirm' | 'destructive';
          okText?: string;
          cancelText?: string;
        },
      ): Promise<boolean>;
      showNotification(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void;
    };
  } | undefined;
}

export {};
