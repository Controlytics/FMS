import { cn } from '@/lib/cn';
import { getCategoryColor, getCategoryIcon } from '../constants';
import type { NodeType } from '../types';

// ---------------------------------------------------------------------------
// Node palette item (draggable)
// ---------------------------------------------------------------------------

export function PaletteNode({
  nodeType,
  onDragStart,
}: {
  nodeType: NodeType;
  onDragStart: (event: React.DragEvent, nodeType: NodeType) => void;
}) {
  const colors = getCategoryColor(nodeType.category);
  const iconPath = getCategoryIcon(nodeType.category);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, nodeType)}
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg border cursor-grab active:cursor-grabbing',
        'hover:shadow-md transition-all duration-150 select-none group',
        colors.light,
      )}
      title={nodeType.description}
    >
      <div className={cn('p-1 rounded flex-shrink-0', colors.bg)}>
        <svg className={cn('w-3 h-3', colors.text)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-700 truncate">{nodeType.name}</p>
        <p className="text-[10px] text-slate-400 truncate">{nodeType.type}</p>
      </div>
      <svg className="w-3 h-3 text-slate-300 group-hover:text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
      </svg>
    </div>
  );
}
