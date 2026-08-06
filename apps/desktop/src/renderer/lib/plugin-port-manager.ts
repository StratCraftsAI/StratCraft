/**
 * Plugin Port Manager (Renderer)
 *
 * TICKET_632_2 / TICKET_1037: Manages MessagePort connections from independent
 * plugin processes. The real MessagePort lives in the preload context (to avoid
 * contextBridge stripping native methods). This manager calls the preload's
 * pluginPort.* wrappers and exposes send/onMessage to the plugin bundle.
 */

// =============================================================================
// Types — the preload's pluginPort API shape, exposed via contextBridge
// =============================================================================

interface PluginPortBridge {
  listen: (pluginId: string) => void;
  isReady: (pluginId: string) => boolean;
  waitForReady: (pluginId: string) => Promise<void>;
  send: (pluginId: string, data: unknown) => void;
  onMessage: (pluginId: string, callback: (data: unknown) => void) => () => void;
  close: (pluginId: string) => void;
}

export interface PluginPortProxy {
  send: (data: unknown) => void;
  onMessage: (callback: (data: unknown) => void) => () => void;
}

// =============================================================================
// Singleton
// =============================================================================

class PluginPortManager {
  private listeningPlugins = new Set<string>();
  private readyPlugins = new Set<string>();
  private cleanups = new Map<string, () => void>();

  private getBridge(): PluginPortBridge {
    return (window as unknown as { electronAPI: { pluginPort: PluginPortBridge } })
      .electronAPI.pluginPort;
  }

  listen(pluginId: string): void {
    if (this.listeningPlugins.has(pluginId)) return;
    this.listeningPlugins.add(pluginId);
    this.getBridge().listen(pluginId);
  }

  isReady(pluginId: string): boolean {
    return this.getBridge().isReady(pluginId);
  }

  async waitForReady(pluginId: string): Promise<void> {
    await this.getBridge().waitForReady(pluginId);
    this.readyPlugins.add(pluginId);
  }

  getProxy(pluginId: string): PluginPortProxy | null {
    if (!this.getBridge().isReady(pluginId)) return null;
    const bridge = this.getBridge();
    return {
      send: (data: unknown) => bridge.send(pluginId, data),
      onMessage: (cb: (data: unknown) => void) => bridge.onMessage(pluginId, cb),
    };
  }

  cleanup(pluginId: string): void {
    this.getBridge().close(pluginId);
    this.listeningPlugins.delete(pluginId);
    this.readyPlugins.delete(pluginId);
    const cleanupFn = this.cleanups.get(pluginId);
    if (cleanupFn) {
      cleanupFn();
      this.cleanups.delete(pluginId);
    }
  }

  cleanupAll(): void {
    for (const pluginId of this.listeningPlugins) {
      this.getBridge().close(pluginId);
    }
    this.listeningPlugins.clear();
    this.readyPlugins.clear();
    for (const fn of this.cleanups.values()) fn();
    this.cleanups.clear();
  }
}

export const pluginPortManager = new PluginPortManager();
