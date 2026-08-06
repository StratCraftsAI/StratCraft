/**
 * ProviderPortalProvider - View provider for the Provider Portal (Level 2)
 *
 * This provider returns the ProviderPortal React component for the Host to render.
 *
 * @see TICKET_059 - Host/Plugin Architecture
 */

import type { ViewProvider, ViewOptions, ViewElement } from '@shared/types';

// Component reference (set during initialization)
let ProviderPortalComponent: React.ComponentType<{ providerId?: string; providerName?: string }> | null = null;

export class ProviderPortalProvider implements ViewProvider {
  private isVisible = false;

  /**
   * Resolve view element for the Provider Portal
   */
  resolveView(_viewId: string, options?: ViewOptions): ViewElement {
    if (!ProviderPortalComponent) {
      throw new Error('[ProviderPortalProvider] Component not initialized. Call setComponent() first.');
    }
    const providerId = (options?.providerId as string) || 'unknown';
    const providerName = this.getProviderName(providerId);

    return {
      type: 'react',
      content: ProviderPortalComponent,
      props: {
        providerId,
        providerName,
      },
    };
  }

  /**
   * Called when view becomes visible
   */
  onDidShow(): void {
    this.isVisible = true;
    console.debug('[ProviderPortalProvider] View shown');
  }

  /**
   * Called when view becomes hidden
   */
  onDidHide(): void {
    this.isVisible = false;
    console.debug('[ProviderPortalProvider] View hidden');
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.isVisible = false;
    console.debug('[ProviderPortalProvider] Disposed');
  }

  /**
   * Set the component (called during plugin initialization)
   */
  static setComponent(component: React.ComponentType<{ providerId?: string; providerName?: string }>): void {
    ProviderPortalComponent = component;
  }

  /**
   * Get provider name from ID
   */
  private getProviderName(providerId: string): string {
    const providerNames: Record<string, string> = {
      'provider-nona': 'Nona',
      'provider-aaa': 'AAA QUANT TOOLS',
    };
    return providerNames[providerId] || providerId.toUpperCase();
  }

}
