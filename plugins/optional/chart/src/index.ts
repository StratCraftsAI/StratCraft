/**
 * Chart Plugin Entry Point
 *
 * This is the plugin's main entry point, defining the activate/deactivate lifecycle
 */

import type { PluginContext, PluginApi } from './types';
import i18n from 'i18next';

// Plugin API implementation
class ChartPluginApi implements PluginApi {
  private context: PluginContext;
  private zoomLevel = 1;

  constructor(context: PluginContext) {
    this.context = context;
  }

  async activate(): Promise<void> {
    this.context.log.info('Chart plugin activated');

    // Register commands
    this.context.commands.register('zoomIn', () => this.zoomIn());
    this.context.commands.register('zoomOut', () => this.zoomOut());
    this.context.commands.register('reset', () => this.reset());
    this.context.commands.register('addIndicator', (indicator: unknown) => this.addIndicator(String(indicator)));

    // Restore state
    const savedZoom = await this.context.storage.get<number>('zoomLevel');
    if (savedZoom) {
      this.zoomLevel = savedZoom;
    }
  }

  async deactivate(): Promise<void> {
    // Save state
    await this.context.storage.set('zoomLevel', this.zoomLevel);
    this.context.log.info('Chart plugin deactivated');
  }

  getConfig(): Record<string, unknown> {
    return {
      zoomLevel: this.zoomLevel,
    };
  }

  setConfig(config: Record<string, unknown>): void {
    if (typeof config.zoomLevel === 'number') {
      this.zoomLevel = config.zoomLevel;
    }
  }

  // Chart commands
  private zoomIn(): void {
    this.zoomLevel = Math.min(this.zoomLevel * 1.2, 10);
    this.context.state.set('zoomLevel', this.zoomLevel);
    this.context.log.debug(`Zoom in: ${this.zoomLevel}`);
  }

  private zoomOut(): void {
    this.zoomLevel = Math.max(this.zoomLevel / 1.2, 0.1);
    this.context.state.set('zoomLevel', this.zoomLevel);
    this.context.log.debug(`Zoom out: ${this.zoomLevel}`);
  }

  private reset(): void {
    this.zoomLevel = 1;
    this.context.state.set('zoomLevel', this.zoomLevel);
    this.context.log.debug('Zoom reset');
  }

  private addIndicator(indicator: string): void {
    this.context.log.info(`Adding indicator: ${indicator}`);
    this.context.ui.showNotification(i18n.t('notification.indicatorAdded', { ns: 'chart', indicator }), 'success');
  }
}

// Module exports
export async function activate(context: PluginContext): Promise<PluginApi> {
  const api = new ChartPluginApi(context);
  await api.activate();
  return api;
}

export async function deactivate(): Promise<void> {
  // Cleanup if needed
}

export default { activate, deactivate };
