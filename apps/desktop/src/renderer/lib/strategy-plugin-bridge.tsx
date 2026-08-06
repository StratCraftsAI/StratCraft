/**
 * Strategy Plugin Bridge
 *
 * This module bridges the first-party Strategy Plugin with the Host.
 * It registers the existing React components as plugin providers.
 *
 * @see TICKET_059 - Host/Plugin Architecture
 */

import React from 'react';
import i18n from 'i18next';
import { windowApi, getCommandRegistry } from './plugin-context';
// TICKET_300: getPluginManager import removed (was only used for breadcrumb hub label)
import type {
  TreeDataProvider,
  ViewProvider,
  CustomEditorProvider,
  TreeItem,
  TreeItemCollapsibleState,
  ViewElement,
  EditorElement,
  ViewOptions,
  Disposable,
} from '@shared/types';
import { PLUGIN_IDS } from '@shared/constants';

// Import existing components
import { StrategyHub } from '@/features/strategy/components/hub/StrategyHub';
import { ProviderPortal } from '@/features/strategy/components/hub/ProviderPortal';
import { StrategyGroupList } from '@/features/strategy/components/hub/StrategyGroupList';

// Import from Plugin (TICKET_076: Plugin UI Migration, TICKET_079: Dynamic Page Routing)
import { EDITOR_PROVIDERS, getEditorComponent } from '@plugins/strategy-builder-nexus/editors';

// Import editor resolver for registration (TICKET_079)
import { registerEditorComponent } from './plugin-editor-resolver';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface StrategyNode {
  id: string;
  label: string;
  type: 'hub' | 'provider' | 'group' | 'generator';
  status?: 'running' | 'warning' | 'error' | 'idle';
  children?: StrategyNode[];
  level: number;
  parentId?: string;
  resourceUri?: string;
}

// TreeItemCollapsibleState values
const CollapsibleState = {
  None: 0 as TreeItemCollapsibleState,
  Collapsed: 1 as TreeItemCollapsibleState,
  Expanded: 2 as TreeItemCollapsibleState,
};

// -----------------------------------------------------------------------------
// Mock Tree Data
// -----------------------------------------------------------------------------

const mockTreeData: StrategyNode[] = [
  {
    id: 'hub',
    label: 'GLOBAL DASHBOARD',
    type: 'hub',
    level: 1,
    children: [],
  },
  {
    id: 'provider-nona',
    label: 'Nona',
    type: 'provider',
    level: 2,
    children: [],
  },
  {
    id: 'provider-aaa',
    label: 'AAA QUANT TOOLS',
    type: 'provider',
    level: 2,
    children: [],
  },
];

// -----------------------------------------------------------------------------
// StrategyTreeDataProvider Implementation
// -----------------------------------------------------------------------------

class StrategyTreeDataProvider implements TreeDataProvider<StrategyNode> {
  private nodeMap = new Map<string, StrategyNode>();
  private changeListeners = new Set<(node: StrategyNode | undefined) => void>();

  constructor() {
    this.buildNodeMap(mockTreeData);
  }

  onDidChangeTreeData = (
    listener: (node: StrategyNode | undefined) => void
  ): Disposable => {
    this.changeListeners.add(listener);
    return {
      dispose: () => {
        this.changeListeners.delete(listener);
      },
    };
  };

  getTreeItem(element: StrategyNode): TreeItem {
    const hasChildren = element.children && element.children.length > 0;
    const isExpandable = element.type === 'hub' || element.type === 'provider';

    let collapsibleState: TreeItemCollapsibleState;
    if (!hasChildren && element.type !== 'hub') {
      collapsibleState = CollapsibleState.None;
    } else if (isExpandable) {
      collapsibleState = CollapsibleState.Expanded;
    } else {
      collapsibleState = CollapsibleState.Collapsed;
    }

    return {
      id: element.id,
      label: element.label,
      description: element.status?.toUpperCase(),
      tooltip: `${element.label}${element.status ? ` - ${element.status}` : ''}`,
      collapsibleState,
      command: {
        command: 'strategy.selectNode',
        title: i18n.t('strategyTree.selectNode', { ns: 'ui' }),
        arguments: [element],
      },
      contextValue: element.type,
    };
  }

  getChildren(element?: StrategyNode | { id: string }): StrategyNode[] {
    console.debug('[StrategyTreeDataProvider] getChildren called with:', element);

    if (!element) {
      console.debug('[StrategyTreeDataProvider] Returning root nodes:', mockTreeData.length);
      return mockTreeData;
    }

    // If element is a TreeItem (has id but no children), look up the original node
    const node = this.nodeMap.get(element.id);
    if (!node) {
      console.warn('[W:STRATEGY:NODE_NOT_FOUND] [StrategyTreeDataProvider] Node not found in map:', element.id);
      return [];
    }

    const children = node.children || [];
    console.debug('[StrategyTreeDataProvider] Returning children for', node.id, ':', children.length);
    return children;
  }

  getParent(element: StrategyNode): StrategyNode | undefined {
    if (!element.parentId) return undefined;
    return this.nodeMap.get(element.parentId);
  }

  refresh(node?: StrategyNode): void {
    for (const listener of this.changeListeners) {
      listener(node);
    }
  }

  private buildNodeMap(nodes: StrategyNode[]): void {
    for (const node of nodes) {
      this.nodeMap.set(node.id, node);
      if (node.children) {
        this.buildNodeMap(node.children);
      }
    }
  }
}

// -----------------------------------------------------------------------------
// View Providers
// -----------------------------------------------------------------------------

class StrategyHubViewProvider implements ViewProvider {
  resolveView(_viewId: string, _options?: ViewOptions): ViewElement {
    return {
      type: 'react',
      content: StrategyHub,
      props: {},
    };
  }

  onDidShow(): void {
    console.debug('[StrategyHubViewProvider] View shown');
  }

  onDidHide(): void {
    console.debug('[StrategyHubViewProvider] View hidden');
  }
}

class ProviderPortalViewProvider implements ViewProvider {
  resolveView(_viewId: string, options?: ViewOptions): ViewElement {
    const providerId = (options?.nodeId as string) || 'unknown';
    const providerName = this.getProviderName(providerId);

    return {
      type: 'react',
      content: ProviderPortal,
      props: { providerId, providerName },
    };
  }

  private getProviderName(providerId: string): string {
    const names: Record<string, string> = {
      'provider-nona': 'Nona',
      'provider-aaa': 'AAA QUANT TOOLS',
    };
    return names[providerId] || providerId.toUpperCase();
  }
}

class GroupListViewProvider implements ViewProvider {
  resolveView(_viewId: string, _options?: ViewOptions): ViewElement {
    return {
      type: 'react',
      content: StrategyGroupList,
      props: {},
    };
  }
}

// -----------------------------------------------------------------------------
// Custom Editor Provider (TICKET_079: Dynamic Resolution)
// -----------------------------------------------------------------------------

/**
 * Creates a CustomEditorProvider for a given viewType
 * Dynamically resolves the component from EDITOR_PROVIDERS
 */
function createEditorProvider(viewType: string): CustomEditorProvider {
  return {
    resolveCustomEditor(_resourceUri: string, _viewType: string): EditorElement {
      const EditorComponent = getEditorComponent(viewType);

      if (!EditorComponent) {
        console.error(`[E:STRATEGY:EDITOR_COMPONENT_NOT_FOUND] [EditorProvider] Component not found for viewType: ${viewType}`);
        // Return a fallback error component
        return {
          type: 'react',
          content: () => React.createElement('div', {
            style: { padding: 20, color: 'red' }
          }, i18n.t('renderer.plugin.editorNotFound', { ns: 'errors', viewType })),
          props: {},
        };
      }

      return {
        type: 'react',
        content: EditorComponent,
        props: {
          onGenerate: async (config: unknown) => {
            console.debug(`[EditorProvider:${viewType}] Generate:`, config);
          },
          onSettingsClick: () => {
            console.debug(`[EditorProvider:${viewType}] Settings clicked`);
          },
        },
      };
    },
  };
}

// -----------------------------------------------------------------------------
// Plugin Initialization
// -----------------------------------------------------------------------------

const disposables: Disposable[] = [];

// TICKET_300: getHubLabel removed - breadcrumb labels now derived from VIEW_REGISTRY

/**
 * Initialize the Strategy Plugin Bridge
 *
 * This registers all providers with the Host's windowApi.
 */
export function initializeStrategyPlugin(): void {
  console.info('[StrategyPluginBridge] Initializing...');

  // Register TreeDataProvider
  const treeProvider = new StrategyTreeDataProvider();
  disposables.push(
    windowApi.registerTreeDataProvider('strategy.tree', treeProvider)
  );
  console.debug('[StrategyPluginBridge] TreeDataProvider registered');

  // Register ViewProviders
  disposables.push(
    windowApi.registerViewProvider('strategy.hub', new StrategyHubViewProvider())
  );
  disposables.push(
    windowApi.registerViewProvider('strategy.providerPortal', new ProviderPortalViewProvider())
  );
  disposables.push(
    windowApi.registerViewProvider('strategy.groupList', new GroupListViewProvider())
  );
  console.debug('[StrategyPluginBridge] ViewProviders registered');

  // Register CustomEditorProviders dynamically (TICKET_079)
  // First, register all editor components to the resolver
  for (const [viewType, provider] of Object.entries(EDITOR_PROVIDERS)) {
    registerEditorComponent(viewType, provider.component);
    console.debug(`[StrategyPluginBridge] Registered editor component: ${viewType}`);
  }

  // Then, register CustomEditorProviders for each viewType
  for (const viewType of Object.keys(EDITOR_PROVIDERS)) {
    disposables.push(
      windowApi.registerCustomEditorProvider(viewType, createEditorProvider(viewType))
    );
  }
  console.debug('[StrategyPluginBridge] CustomEditorProviders registered:', Object.keys(EDITOR_PROVIDERS));

  // Register Commands
  const commandRegistry = getCommandRegistry();

  // Command: strategy.selectNode - Handle tree node selection
  // TICKET_300: Removed windowApi.setBreadcrumb - breadcrumbs now managed centrally
  commandRegistry.set('strategy.selectNode', (...args: unknown[]) => {
    const node = args[0];
    if (!node || typeof node !== 'object' || !('id' in node) || !('type' in node)) {
      throw new Error('strategy.selectNode requires a StrategyNode argument');
    }
    const strategyNode = node as StrategyNode;
    console.debug('[StrategyPluginBridge] Node selected:', strategyNode.id, strategyNode.type);

    // Open appropriate view or editor based on node type
    switch (strategyNode.type) {
      case 'hub':
        windowApi.openView('strategy.hub');
        break;
      case 'provider':
        windowApi.openView('strategy.providerPortal', { nodeId: strategyNode.id, nodeLabel: strategyNode.label });
        break;
      case 'group':
        windowApi.openView('strategy.groupList', { nodeId: strategyNode.id, nodeLabel: strategyNode.label });
        break;
      case 'generator':
        windowApi.openEditor(strategyNode.resourceUri || `strategy://${strategyNode.id}`, 'strategy.regimeEditor');
        break;
    }
  });

  // Command: strategy.openHub - Navigate to hub view
  // TICKET_300: Removed windowApi.setBreadcrumb - breadcrumbs now managed centrally
  commandRegistry.set('strategy.openHub', () => {
    windowApi.openView('strategy.hub');
  });

  // Command: strategy.refresh - Refresh tree
  commandRegistry.set('strategy.refresh', () => {
    treeProvider.refresh();
  });

  console.debug('[StrategyPluginBridge] Commands registered');
  console.info('[StrategyPluginBridge] Initialized successfully');
}

/**
 * Dispose the Strategy Plugin Bridge
 */
export function disposeStrategyPlugin(): void {
  console.info('[StrategyPluginBridge] Disposing...');

  for (const disposable of disposables) {
    disposable.dispose();
  }
  disposables.length = 0;

  console.info('[StrategyPluginBridge] Disposed');
}
