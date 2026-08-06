/**
 * StrategyTree Component
 * 
 * Persistent navigation tree for TICKET_059 4-Level Hierarchy.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  ChevronRight, 
  ChevronDown, 
  LayoutDashboard, 
  Cloud, 
  Folder, 
  FileCode,
  Circle
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TreeNode {
  id: string;
  label: string;
  type: 'hub' | 'provider' | 'group' | 'generator';
  status?: 'running' | 'warning' | 'error' | 'idle';
  metadata?: string; // Secondary text (e.g., "Last run: 2h ago")
  badge?: number; // Badge count (e.g., 3 for 3 active generators)
  metrics?: string; // Metrics text (e.g., "98.4%")
  children?: TreeNode[];
}

interface StrategyTreeProps {
  data: TreeNode[];
  onSelect: (node: TreeNode) => void;
  activeId?: string;
}

export const StrategyTree: React.FC<StrategyTreeProps> = ({ data, onSelect, activeId }) => {
  const { t } = useTranslation('ui');
  return (
    <div className="flex flex-col h-full bg-color-terminal-panel py-2 select-none overflow-y-auto">
      <div className="px-4 py-2 text-xs font-bold uppercase text-color-terminal-text-secondary tracking-widest">
        {t('accessibility.strategyNavigator')}
      </div>
      <div className="flex-1 mt-2">
        {data.map((node) => (
          <TreeItem key={node.id} node={node} level={0} onSelect={onSelect} activeId={activeId} />
        ))}
      </div>
    </div>
  );
};

interface TreeItemProps {
  node: TreeNode;
  level: number;
  onSelect: (node: TreeNode) => void;
  activeId?: string;
}

const TreeItem: React.FC<TreeItemProps> = ({ node, level, onSelect, activeId }) => {
  const [isExpanded, setIsExpanded] = useState(level < 1); // Expand Level 0 by default
  const hasChildren = node.children && node.children.length > 0;
  const isActive = activeId === node.id;

  const getIcon = () => {
    switch (node.type) {
      case 'hub': return <LayoutDashboard className="w-4 h-4" />;
      case 'provider': return <Cloud className="w-4 h-4 text-color-terminal-accent-teal" />;
      case 'group': return <Folder className="w-4 h-4 text-color-terminal-accent-gold" />;
      case 'generator': return <FileCode className="w-4 h-4" />;
    }
  };

  const getStatusColor = () => {
    switch (node.status) {
      case 'running': return 'text-color-terminal-accent-teal';
      case 'warning': return 'text-color-terminal-accent-gold';
      case 'error': return 'text-color-terminal-accent-red';
      default: return 'text-color-terminal-text-secondary opacity-30';
    }
  };

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          "group flex items-center gap-2 px-3 py-1.5 cursor-pointer",
          "transition-all duration-200",
          "hover:bg-gradient-to-r hover:from-color-terminal-accent-teal/5 hover:to-transparent",
          isActive && [
            "bg-gradient-to-r from-color-terminal-accent-teal/10 to-transparent",
            "text-color-terminal-accent-teal",
            "border-r-2 border-color-terminal-accent-teal",
            "shadow-[inset_0_0_10px_rgba(94,234,212,0.1)]"
          ],
          !isActive && "text-color-terminal-text-secondary"
        )}
        style={{ paddingLeft: `${(level * 12) + 12}px` }}
        onClick={() => {
          if (hasChildren) setIsExpanded(!isExpanded);
          onSelect(node);
        }}
      >
        {/* Expand/Collapse Icon */}
        <div className="w-3 flex items-center justify-center">
          {hasChildren && (
            <ChevronRight 
              className={cn(
                "w-3 h-3 transition-transform duration-200",
                isExpanded && "rotate-90"
              )} 
            />
          )}
        </div>

        {/* Node Type Icon with Badge */}
        <div className="relative flex-shrink-0">
          {getIcon()}
          {node.badge !== undefined && node.badge > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[12px] h-3 px-1
                           bg-color-terminal-accent-gold rounded-full 
                           text-[6px] flex items-center justify-center 
                           font-bold text-black leading-none">
              {node.badge}
            </span>
          )}
        </div>

        {/* Node Label with Metadata */}
        <div className="flex-1 flex items-center justify-between min-w-0">
          <div className="flex flex-col min-w-0">
            <span className={cn(
              "text-small truncate font-medium",
              isActive && "font-bold"
            )}>
              {node.label}
            </span>
            {node.metadata && (
              <span className="text-micro text-color-terminal-text-muted truncate">
                {node.metadata}
              </span>
            )}
          </div>

          {/* Status Indicators */}
          <div className="flex items-center gap-1.5 ml-2">
            {node.type === 'generator' && node.status && (
              <>
                <Circle className={cn(
                  "w-2 h-2 fill-current",
                  getStatusColor(),
                  (node.status === 'running' || node.status === 'error') && "animate-pulse"
                )} />
                {node.metrics && (
                  <span className="text-micro font-mono text-color-terminal-text-muted">
                    {node.metrics}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Children with Connection Lines */}
      {hasChildren && isExpanded && (
        <div className="flex flex-col border-l border-color-terminal-border/30 ml-6">
          {node.children!.map((child) => (
            <TreeItem 
              key={child.id} 
              node={child} 
              level={level + 1} 
              onSelect={onSelect} 
              activeId={activeId} 
            />
          ))}
        </div>
      )}
    </div>
  );
};

