/**
 * Ambient type declarations for the minimal plugin.
 * Declare only the subset of host APIs your plugin uses.
 */

declare global {
  interface Window {
    electronAPI: Record<string, unknown>;
  }

  // eslint-disable-next-line no-var
  var nexus: {
    window: {
      registerViewProvider: (
        viewId: string,
        provider: { render: () => React.ReactElement }
      ) => void;
    };
  };
}

export {};
