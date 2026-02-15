import { useState } from 'react';
import useSWR from 'swr';
import { Badge } from '@/components/ui/badge';

interface AssetTreeProps {
  selectedId?: string;
  onSelect: (id: string) => void;
}

interface TreeNodeData {
  id: string;
  name: string;
  nodeType: string;
  status: string;
  _count?: { children: number };
}

export function AssetTree({ selectedId, onSelect }: AssetTreeProps) {
  const { data: roots } = useSWR('/api/hierarchy');

  return (
    <div className="space-y-0.5">
      {(roots ?? []).map((node: TreeNodeData) => (
        <TreeNode key={node.id} node={node} level={0} selectedId={selectedId} onSelect={onSelect} />
      ))}
      {(!roots || roots.length === 0) && (
        <p className="text-xs text-muted-foreground p-2">No assets yet.</p>
      )}
    </div>
  );
}

function TreeNode({ node, level, selectedId, onSelect }: {
  node: TreeNodeData;
  level: number;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(level < 1);
  const hasChildren = (node._count?.children ?? 0) > 0;

  const { data: children } = useSWR(
    expanded && hasChildren ? `/api/hierarchy?parentId=${node.id}` : null,
  );

  const isSelected = selectedId === node.id;
  const statusDot = node.status === 'active' ? 'bg-green-500' : node.status === 'maintenance' ? 'bg-yellow-500' : 'bg-gray-400';

  return (
    <div>
      <button
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm transition-colors ${
          isSelected ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => onSelect(node.id)}
      >
        {/* Expand/collapse */}
        {hasChildren ? (
          <span
            className="w-4 text-center text-xs cursor-pointer text-muted-foreground"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            {expanded ? '▾' : '▸'}
          </span>
        ) : (
          <span className="w-4" />
        )}

        {/* Status dot */}
        <span className={`h-2 w-2 rounded-full ${statusDot}`} />

        {/* Type icon */}
        <span className="text-xs text-muted-foreground w-5 text-center">
          {node.nodeType.charAt(0).toUpperCase()}
        </span>

        {/* Name */}
        <span className="truncate flex-1">{node.name}</span>

        {/* Child count */}
        {hasChildren && (
          <Badge variant="outline" className="text-[10px] px-1 py-0">{node._count?.children}</Badge>
        )}
      </button>

      {/* Children */}
      {expanded && children && (
        <div>
          {children.map((child: TreeNodeData) => (
            <TreeNode key={child.id} node={child} level={level + 1} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
