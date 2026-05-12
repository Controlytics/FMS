import { Handle, Position } from 'reactflow';
import { cn } from '@/lib/cn';
import { getCategoryColor, getCategoryIcon } from '../constants';
import type { CustomNodeData } from '../types';

// ---------------------------------------------------------------------------
// Custom React Flow node component
// ---------------------------------------------------------------------------

export function CustomRuleNode({ data }: { data: CustomNodeData }) {
  const colors = getCategoryColor(data.category);
  const iconPath = getCategoryIcon(data.category);

  return (
    <div
      className={cn(
        'rounded-xl border-2 shadow-lg min-w-[160px] max-w-[220px] overflow-hidden transition-all duration-150',
        data.selected
          ? `${colors.border} shadow-xl ring-2 ring-offset-1`
          : 'border-slate-200',
        data.debugEnabled && 'ring-2 ring-orange-400 ring-offset-1',
      )}
      style={{ background: 'white' }}
    >
      {/* Header */}
      <div className={cn('flex items-center gap-2 px-3 py-2', colors.bg)}>
        <svg
          className={cn('w-3.5 h-3.5 flex-shrink-0', colors.text)}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
        </svg>
        <span className={cn('text-xs font-semibold truncate flex-1', colors.text)}>
          {data.category}
        </span>
        {data.isFirst && (
          <span className="text-[9px] font-bold bg-white/30 text-white rounded px-1 py-0.5 flex-shrink-0">
            FIRST
          </span>
        )}
        {data.debugEnabled && (
          <div className="w-2 h-2 rounded-full bg-orange-300 animate-pulse flex-shrink-0" title="Debug active" />
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <p className="text-xs font-semibold text-slate-800 truncate">{data.label}</p>
        <p className="text-[10px] text-slate-400 mt-0.5 truncate">{data.nodeType}</p>
      </div>

      {/* Connection handles */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-slate-400 !border-2 !border-white hover:!bg-blue-500 !-left-1.5"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-slate-400 !border-2 !border-white hover:!bg-green-500 !-right-1.5"
      />
    </div>
  );
}
