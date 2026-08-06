interface ElectronAPI {
  data: {
    getProviderList: () => Promise<Array<{ id: string; name: string; capabilities?: { requiresAuth?: boolean; intervals?: string[]; maxLookback?: Record<string, string> } }>>;
    checkProvidersProgressive: () => Promise<{ success: boolean; error?: string }>;
    onProviderStatus: (callback: (event: { id: string; status: 'connected' | 'disconnected' | 'error'; latencyMs?: number; error?: string }) => void) => () => void;
    searchSymbols: (query: string, provider?: string) => Promise<{ results: Array<{ symbol: string; name: string; exchange?: string; type?: string; startTime?: string; endTime?: string }>; totalCount: number; truncated: boolean }>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
