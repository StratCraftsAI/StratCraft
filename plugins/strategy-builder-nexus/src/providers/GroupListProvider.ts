/**
 * GroupListProvider - View provider for the Strategy Group List (Level 3)
 *
 * This provider returns the StrategyGroupList React component for the Host to render.
 *
 * @see TICKET_059 - Host/Plugin Architecture
 */

import type { ViewProvider, ViewOptions, ViewElement } from '@shared/types';

// Component reference (set during initialization)
let GroupListComponent: React.ComponentType<{ groupId?: string }> | null = null;

export class GroupListProvider implements ViewProvider {
  private isVisible = false;

  /**
   * Resolve view element for the Group List
   */
  resolveView(_viewId: string, options?: ViewOptions): ViewElement {
    if (!GroupListComponent) {
      throw new Error('[GroupListProvider] Component not initialized. Call setComponent() first.');
    }
    const groupId = (options?.groupId as string) || 'unknown';

    return {
      type: 'react',
      content: GroupListComponent,
      props: {
        groupId,
      },
    };
  }

  /**
   * Called when view becomes visible
   */
  onDidShow(): void {
    this.isVisible = true;
    console.debug('[GroupListProvider] View shown');
  }

  /**
   * Called when view becomes hidden
   */
  onDidHide(): void {
    this.isVisible = false;
    console.debug('[GroupListProvider] View hidden');
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.isVisible = false;
    console.debug('[GroupListProvider] Disposed');
  }

  /**
   * Set the component (called during plugin initialization)
   */
  static setComponent(component: React.ComponentType<{ groupId?: string }>): void {
    GroupListComponent = component;
  }

}
