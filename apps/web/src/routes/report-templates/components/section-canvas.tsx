import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import type { Section } from './template-types';
import { SectionCanvasItem } from './section-canvas-item';

interface Props {
  sections: Section[];
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
  onRemove: (idx: number) => void;
}

export function SectionCanvas({ sections, selectedIdx, onSelect, onReorder, onRemove }: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIdx = sections.findIndex(s => s.id === active.id);
    const toIdx = sections.findIndex(s => s.id === over.id);
    if (fromIdx !== -1 && toIdx !== -1) onReorder(fromIdx, toIdx);
  };

  if (sections.length === 0) {
    return (
      <div className="border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-slate-100 flex items-center justify-center">
          <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" /></svg>
        </div>
        <p className="text-slate-400 font-medium">No sections yet</p>
        <p className="text-slate-300 text-sm mt-1">Click a section type in the palette to add one</p>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={handleDragEnd}>
      <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {sections.map((section, idx) => (
            <SectionCanvasItem
              key={section.id}
              section={section}
              index={idx}
              isSelected={selectedIdx === idx}
              onSelect={() => onSelect(idx)}
              onRemove={() => onRemove(idx)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
