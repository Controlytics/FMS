import { Type, Table2, BarChart3, List, PenTool, SeparatorHorizontal } from 'lucide-react';
import { SECTION_LABELS, type SectionType } from './template-types';

const PALETTE_ITEMS: { type: SectionType; icon: React.ReactNode; description: string }[] = [
  { type: 'text', icon: <Type className="w-4 h-4" />, description: 'Rich text with variable tags' },
  { type: 'table', icon: <Table2 className="w-4 h-4" />, description: 'Data table with formatting' },
  { type: 'chart', icon: <BarChart3 className="w-4 h-4" />, description: 'Line, bar, or pie chart' },
  { type: 'key_value', icon: <List className="w-4 h-4" />, description: 'Label-value pairs grid' },
  { type: 'signature', icon: <PenTool className="w-4 h-4" />, description: 'Electronic signature block' },
  { type: 'page_break', icon: <SeparatorHorizontal className="w-4 h-4" />, description: 'Force new page' },
];

interface Props {
  onAdd: (type: SectionType) => void;
}

export function SectionPalette({ onAdd }: Props) {
  return (
    <div className="p-4 border-b border-slate-100">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Sections</h3>
      <div className="space-y-1.5">
        {PALETTE_ITEMS.map(item => (
          <button key={item.type} onClick={() => onAdd(item.type)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-slate-50 transition-colors group">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors">
              {item.icon}
            </div>
            <div>
              <div className="text-sm font-medium text-slate-700">{SECTION_LABELS[item.type]}</div>
              <div className="text-xs text-slate-400">{item.description}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
