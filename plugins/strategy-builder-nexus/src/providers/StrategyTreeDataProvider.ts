/**
 * StrategyTreeDataProvider - Provides tree data for the strategy explorer
 *
 * This provider implements TreeDataProvider to provide hierarchical strategy data
 * to the Host's TreeViewContainer.
 *
 * @see TICKET_059 - Host/Plugin Architecture
 */

import i18n from 'i18next';
import type {
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Disposable,
} from '@shared/types';
import { safeForEach } from '@shared/utils/safe-emit';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface StrategyNode {
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
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as const;

// -----------------------------------------------------------------------------
// Mock Data (to be replaced with real data source)
// -----------------------------------------------------------------------------

function getMockTreeData(): StrategyNode[] {
  return [
    {
      id: 'hub',
      label: i18n.t('tree.globalDashboard', { ns: 'strategy-builder' }),
      type: 'hub',
      level: 1,
      children: [],
    },
    {
      id: 'provider-nona',
      label: i18n.t('tree.nona', { ns: 'strategy-builder' }),
      type: 'provider',
      level: 2,
      children: [],
    },
    {
      id: 'provider-aaa',
      label: i18n.t('tree.aaaQuantTools', { ns: 'strategy-builder' }),
      type: 'provider',
      level: 2,
      children: [],
    },
  ];
}

// -----------------------------------------------------------------------------
// StrategyTreeDataProvider
// -----------------------------------------------------------------------------

type ChangeListener = (node: StrategyNode | undefined) => void;

export class StrategyTreeDataProvider implements TreeDataProvider<StrategyNode> {
  private changeListeners = new Set<ChangeListener>();
  private nodeMap = new Map<string, StrategyNode>();
  private treeData: StrategyNode[];

  constructor() {
    this.treeData = getMockTreeData();
    // Build node map for quick lookup
    this.buildNodeMap(this.treeData);
  }

  // Event: onDidChangeTreeData
  onDidChangeTreeData = (listener: ChangeListener): Disposable => {
    this.changeListeners.add(listener);
    return {
      dispose: () => {
        this.changeListeners.delete(listener);
      },
    };
  };

  /**
   * Get tree item representation for a node
   */
  getTreeItem(element: StrategyNode): TreeItem {
    const hasChildren = element.children && element.children.length > 0;
    const isHubOrProvider = element.type === 'hub' || element.type === 'provider';

    let collapsibleState: TreeItemCollapsibleState;
    if (!hasChildren && element.type !== 'hub') {
      collapsibleState = CollapsibleState.None;
    } else if (isHubOrProvider) {
      collapsibleState = CollapsibleState.Expanded;
    } else {
      collapsibleState = CollapsibleState.Collapsed;
    }

    return {
      id: element.id,
      label: element.label,
      description: this.getDescription(element),
      tooltip: this.getTooltip(element),
      iconPath: this.getIconPath(element),
      collapsibleState,
      command: {
        command: 'strategy.selectNode',
        title: i18n.t('tree.selectNode', { ns: 'strategy-builder' }),
        arguments: [element],
      },
      contextValue: element.type,
    };
  }

  /**
   * Get children of a node
   */
  getChildren(element?: StrategyNode): StrategyNode[] {
    if (!element) {
      // Root level: return top-level nodes
      return this.treeData;
    }
    return element.children || [];
  }

  /**
   * Get parent of a node
   */
  getParent(element: StrategyNode): StrategyNode | undefined {
    if (!element.parentId) return undefined;
    return this.nodeMap.get(element.parentId);
  }

  /**
   * Refresh the tree
   */
  refresh(node?: StrategyNode): void {
    safeForEach(this.changeListeners, '[E:STRATEGY:TREE_REFRESH_FAILED] [StrategyTreeDataProvider] Refresh listener error:', node);
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private buildNodeMap(nodes: StrategyNode[]): void {
    for (const node of nodes) {
      this.nodeMap.set(node.id, node);
      if (node.children) {
        this.buildNodeMap(node.children);
      }
    }
  }

  private getDescription(node: StrategyNode): string | undefined {
    if (node.status) {
      return node.status.toUpperCase();
    }
    return undefined;
  }

  private getTooltip(node: StrategyNode): string {
    const parts = [node.label];
    if (node.status) {
      parts.push(`Status: ${node.status}`);
    }
    return parts.join('\n');
  }

  private getIconPath(node: StrategyNode): string | undefined {
    // Icon paths relative to plugin resources
    const iconMap: Record<string, string> = {
      hub: 'resources/icons/hub.svg',
      provider: 'resources/icons/provider.svg',
      group: 'resources/icons/group.svg',
      generator: 'resources/icons/generator.svg',
    };
    return iconMap[node.type];
  }
}
