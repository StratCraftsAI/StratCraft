/**
 * RegimeEditorProvider - Custom editor provider for Regime Editor (Level 4)
 *
 * This provider returns the RegimeEditor React component for the Host to render
 * in an editor tab.
 *
 * @see TICKET_059 - Host/Plugin Architecture
 */

import type { CustomEditorProvider, EditorElement } from '@shared/types';

// Component reference (set during initialization)
let RegimeEditorComponent: React.ComponentType<{
  resourceUri: string;
  strategyInfo?: StrategyInfo;
  onGenerate?: (config: unknown) => Promise<void>;
}> | null = null;

interface StrategyInfo {
  id: string;
  name: string;
  groupId?: string;
  providerId?: string;
}

export class RegimeEditorProvider implements CustomEditorProvider {
  /**
   * Resolve custom editor for a resource
   */
  resolveCustomEditor(resourceUri: string, _viewType: string): EditorElement {
    if (!RegimeEditorComponent) {
      throw new Error('[RegimeEditorProvider] Component not initialized. Call setComponent() first.');
    }
    const strategyInfo = this.parseResourceUri(resourceUri);

    return {
      type: 'react',
      content: RegimeEditorComponent,
      props: {
        resourceUri,
        strategyInfo,
        onGenerate: this.handleGenerate.bind(this),
      },
    };
  }

  /**
   * Called when editor document changes
   */
  onDidChangeDocument(resourceUri: string): void {
    console.debug('[RegimeEditorProvider] Document changed:', resourceUri);
  }

  /**
   * Save document
   */
  async saveDocument(resourceUri: string): Promise<void> {
    console.debug('[RegimeEditorProvider] Saving document:', resourceUri);
    // TODO: Implement save logic
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    console.debug('[RegimeEditorProvider] Disposed');
  }

  /**
   * Set the component (called during plugin initialization)
   */
  static setComponent(
    component: React.ComponentType<{
      resourceUri: string;
      strategyInfo?: StrategyInfo;
      onGenerate?: (config: unknown) => Promise<void>;
    }>
  ): void {
    RegimeEditorComponent = component;
  }

  /**
   * Parse resource URI to extract strategy info
   */
  private parseResourceUri(resourceUri: string): StrategyInfo {
    // URI format: strategy://gen-001 or strategy://provider-nona/group-trend/gen-001
    const parts = resourceUri.replace('strategy://', '').split('/');
    const id = parts[parts.length - 1];

    // Generate a display name from ID
    const name = id
      .replace('gen-', 'Generator ')
      .replace(/-/g, ' ')
      .toUpperCase();

    return {
      id,
      name,
      groupId: parts.length > 2 ? parts[parts.length - 2] : undefined,
      providerId: parts.length > 3 ? parts[0] : undefined,
    };
  }

  /**
   * Handle strategy generation
   */
  private async handleGenerate(config: unknown): Promise<void> {
    console.debug('[RegimeEditorProvider] Generate requested:', config);
    // TODO: Implement generation logic via plugin context
  }

}
