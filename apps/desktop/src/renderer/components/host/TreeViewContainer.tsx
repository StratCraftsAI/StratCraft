/**
 * TreeViewContainer - Generic tree container for Host/Plugin architecture
 *
 * This component renders a tree structure from a registered TreeDataProvider.
 * It is a pure Host component with no business logic - all data comes from plugins.
 *
 * @see TICKET_059 - Host/Plugin Architecture
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { windowApi } from '@/lib/plugin-context';
import type {
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
} from '@shared/types';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface TreeViewContainerProps {
  viewId: string;
  className?: string;
  onNodeSelect?: (node: TreeItem) => void;
}

interface TreeNodeProps {
  item: TreeItem;
  level: number;
  provider: TreeDataProvider<unknown>;
  expandedNodes: Set<string>;
  selectedNodeId: string | null;
  onToggle: (nodeId: string) => void;
  onSelect: (item: TreeItem) => void;
}

// TreeItemCollapsibleState enum values
const CollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as const;

// -----------------------------------------------------------------------------
// TreeNode Component
// -----------------------------------------------------------------------------

const TreeNode: React.FC<TreeNodeProps> = ({
  item,
  level,
  provider,
  expandedNodes,
  selectedNodeId,
  onToggle,
  onSelect,
}) => {
  const { t } = useTranslation('ui');
  const [children, setChildren] = useState<TreeItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const isExpanded = expandedNodes.has(item.id);
  const isSelected = selectedNodeId === item.id;
  const hasChildren = item.collapsibleState !== CollapsibleState.None;

  console.debug('[TreeNode] Render:', {
    id: item.id,
    label: item.label,
    collapsibleState: item.collapsibleState,
    hasChildren,
    isExpanded,
    childrenLoaded: children.length,
  });

  // Load children when expanded
  useEffect(() => {
    console.debug('[TreeNode] useEffect triggered:', {
      id: item.id,
      isExpanded,
      hasChildren,
      childrenLength: children.length,
    });

    if (isExpanded && hasChildren && children.length === 0) {
      console.debug('[TreeNode] Loading children for:', item.id);
      setIsLoading(true);
      Promise.resolve(provider.getChildren(item))
        .then(async (childElements) => {
          console.debug('[TreeNode] Got child elements:', childElements?.length, 'for', item.id);
          const childItems = await Promise.all(
            childElements.map((el) => provider.getTreeItem(el))
          );
          console.debug('[TreeNode] Converted to TreeItems:', childItems.length);
          setChildren(childItems);
        })
        .catch((error) => {
          console.error('[E:UI:TREE_LOAD_CHILDREN_FAILED] Failed to load children:', error);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [isExpanded, hasChildren, children.length, provider, item]);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (hasChildren) {
        onToggle(item.id);
      }
    },
    [hasChildren, onToggle, item.id]
  );

  const handleSelect = useCallback(() => {
    onSelect(item);
  }, [onSelect, item]);

  const paddingLeft = level * 12 + 8;

  return (
    <div>
      <div
        className={cn(
          'flex items-center h-7 px-2 cursor-pointer transition-colors',
          'hover:bg-color-terminal-surface-hover',
          isSelected && 'bg-color-terminal-accent-teal/10 border-l-2 border-color-terminal-accent-teal'
        )}
        style={{ paddingLeft }}
        onClick={handleSelect}
        title={item.tooltip || item.label}
      >
        {/* Expand/Collapse Toggle */}
        <span
          className={cn(
            'w-4 h-4 flex items-center justify-center mr-1',
            hasChildren ? 'cursor-pointer' : 'opacity-0'
          )}
          onClick={handleToggle}
        >
          {hasChildren &&
            (isExpanded ? (
              <ChevronDown className="w-3 h-3 text-color-terminal-text-muted" />
            ) : (
              <ChevronRight className="w-3 h-3 text-color-terminal-text-muted" />
            ))}
        </span>

        {/* Icon */}
        {item.iconPath && (
          <img
            src={item.iconPath}
            alt=""
            className="w-4 h-4 mr-2"
          />
        )}

        {/* Label */}
        <span
          className={cn(
            'text-xs font-medium truncate',
            isSelected ? 'text-color-terminal-accent-teal' : 'text-color-terminal-text'
          )}
        >
          {item.label}
        </span>

        {/* Description */}
        {item.description && (
          <span className="ml-2 text-[10px] text-color-terminal-text-muted truncate">
            {item.description}
          </span>
        )}
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div>
          {isLoading ? (
            <div
              className="flex items-center h-6 text-[10px] text-color-terminal-text-muted"
              style={{ paddingLeft: paddingLeft + 20 }}
            >
              {t('common.loading')}
            </div>
          ) : (
            children.map((child) => (
              <TreeNode
                key={child.id}
                item={child}
                level={level + 1}
                provider={provider}
                expandedNodes={expandedNodes}
                selectedNodeId={selectedNodeId}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

// -----------------------------------------------------------------------------
// TreeViewContainer Component
// -----------------------------------------------------------------------------

export const TreeViewContainer: React.FC<TreeViewContainerProps> = ({
  viewId,
  className,
  onNodeSelect,
}) => {
  const { t } = useTranslation('ui');
  const [rootItems, setRootItems] = useState<TreeItem[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const provider = useMemo(
    () => windowApi.getTreeDataProvider(viewId),
    [viewId]
  );

  // Load root items
  const loadRootItems = useCallback(async () => {
    if (!provider) {
      setError(t('tree.noProvider', { viewId }));
      return;
    }

    try {
      setError(null);
      const rootElements = await Promise.resolve(provider.getChildren(undefined));
      const items = await Promise.all(
        rootElements.map((el) => provider.getTreeItem(el))
      );
      setRootItems(items);

      // Auto-expand first level
      const toExpand = items
        .filter((item) => item.collapsibleState === CollapsibleState.Expanded)
        .map((item) => item.id);
      if (toExpand.length > 0) {
        setExpandedNodes(new Set(toExpand));
      }
    } catch (err) {
      console.error('[E:UI:TREE_LOAD_ROOT_FAILED] Failed to load root items:', err);
      setError(t('tree.loadFailed'));
    }
  }, [provider, viewId]);

  // Initial load
  useEffect(() => {
    loadRootItems();
  }, [loadRootItems]);

  // Subscribe to tree refresh events
  useEffect(() => {
    const disposable = windowApi.onTreeRefresh(viewId, () => {
      loadRootItems();
    });

    return () => disposable.dispose();
  }, [viewId, loadRootItems]);

  // Subscribe to provider's onDidChangeTreeData
  useEffect(() => {
    if (provider?.onDidChangeTreeData) {
      const disposable = provider.onDidChangeTreeData(() => {
        loadRootItems();
      });
      return () => disposable.dispose();
    }
  }, [provider, loadRootItems]);

  const handleToggle = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (item: TreeItem) => {
      setSelectedNodeId(item.id);
      onNodeSelect?.(item);

      // Execute command if defined
      if (item.command) {
        import('@/lib/plugin-context').then(({ executeCommand }) => {
          executeCommand(item.command!.command, ...(item.command!.arguments || [])).catch(
            (err) => console.error('[E:UI:TREE_COMMAND_FAILED] Command execution failed:', err)
          );
        });
      }
    },
    [onNodeSelect]
  );

  if (!provider) {
    return (
      <div className={cn('flex items-center justify-center h-full text-color-terminal-text-muted text-xs', className)}>
        {t('tree.noProvider', { viewId })}
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex items-center justify-center h-full text-color-terminal-error text-xs', className)}>
        {error}
      </div>
    );
  }

  return (
    <div className={cn('overflow-auto', className)}>
      {rootItems.map((item) => (
        <TreeNode
          key={item.id}
          item={item}
          level={0}
          provider={provider}
          expandedNodes={expandedNodes}
          selectedNodeId={selectedNodeId}
          onToggle={handleToggle}
          onSelect={handleSelect}
        />
      ))}
    </div>
  );
};

export default TreeViewContainer;
