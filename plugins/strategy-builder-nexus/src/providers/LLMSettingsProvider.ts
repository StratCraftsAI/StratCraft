/**
 * LLMSettingsProvider - Settings View Provider for LLM Configuration
 *
 * Provides the LLM settings view for the Strategy Builder plugin.
 * This provider renders the LLMSettingsPanel component.
 *
 * @see TICKET_089 - LLM Selector Component
 * @see TICKET_090 - LLM API Key Management
 * @see TICKET_081 - Plugin Settings Architecture
 */

import type { ViewProvider, ViewOptions, ViewElement } from '@shared/types';
import { LLMSettingsPanel } from '../components/settings/LLMSettingsPanel';

// Component reference
let LLMSettingsComponent: React.ComponentType<{ pluginId: string }> | null = null;

export class LLMSettingsProvider implements ViewProvider {
  private isVisible = false;

  /**
   * Resolve view element for the LLM Settings
   */
  resolveView(_viewId: string, options?: ViewOptions): ViewElement {
    const pluginId = (options?.pluginId as string) || 'com.stratcraft.strategy-builder-nexus';

    return {
      type: 'react',
      content: LLMSettingsComponent || LLMSettingsPanel,
      props: {
        pluginId,
      },
    };
  }

  /**
   * Called when view becomes visible
   */
  onDidShow(): void {
    this.isVisible = true;
    console.debug('[LLMSettingsProvider] View shown');
  }

  /**
   * Called when view becomes hidden
   */
  onDidHide(): void {
    this.isVisible = false;
    console.debug('[LLMSettingsProvider] View hidden');
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.isVisible = false;
    console.debug('[LLMSettingsProvider] Disposed');
  }

  /**
   * Set the component (called during plugin initialization)
   */
  static setComponent(component: React.ComponentType<{ pluginId: string }>): void {
    LLMSettingsComponent = component;
  }
}
