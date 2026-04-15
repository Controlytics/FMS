import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, Type, Table2, BarChart3, List, PenTool, SeparatorHorizontal } from 'lucide-react';
import type { Section } from './template-types';
import { SECTION_LABELS } from './template-types';

const SECTION_ICON: Record<string, React.ReactNode> = {
  text: <Type className="w-4 h-4" />,
  table: <Table2 className="w-4 h-4" />,
  chart: <BarChart3 className="w-4 h-4" />,
  key_value: <List className="w-4 h-4" />,
  signature: <PenTool className="w-4 h-4" />,
  page_break: <SeparatorHorizontal className="w-4 h-4" />,
};

interface Props {
  section: Section;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

function getSummary(section: Section): string {
  switch (section.type) {
    case 'text': return section.content ? section.content.slice(0, 60) + (section.content.length > 60 ? '...' : '') : 'Empty text block';
    case 'table': return section.title || 'Untitled table';
    case 'chart': return `${section.chartType} chart: ${section.title || 'Untitled'}`;
    case 'key_value': return `${section.entries.length} entries: ${section.title || 'Untitled'}`;
    case 'signature': return `${section.signers.length} signers`;
    case 'page_break': return 'Page break';
  }
}

export function SectionCanvasItem({ section, index, isSelected, onSelect, onRemove }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}
      className={`flex items-center gap-2 p-3 rounded-xl border-2 bg-white cursor-pointer transition-colors ${isSelected ? 'border-blue-400 shadow-md' : 'border-slate-200 hover:border-slate-300'}`}
      onClick={onSelect}>
      {/* Drag handle */}
      <button {...attributes} {...listeners} className="p-1 rounded text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing" onClick={e => e.stopPropagation()}>
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Icon + info */}
      <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
        {SECTION_ICON[section.type]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-slate-500 uppercase">{SECTION_LABELS[section.type]}</div>
        <div className="text-sm text-slate-600 truncate">{getSummary(section)}</div>
      </div>

      {/* Remove */}
      <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="p-1 rounded text-slate-300 hover:text-red-500 transition-colors">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
