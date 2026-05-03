import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { ChecklistItemDef } from '../../template-types';
import { CHECKLIST_QUESTION_TYPES } from '../../template-types';
import { RemoveButton } from './remove-button';

const QUESTION_TYPE_LABELS: Record<string, string> = {
  PASS_FAIL: 'Pass / Fail',
  YES_NO: 'Yes / No',
  YES_NO_NA: 'Yes / No / N/A',
  MCQ: 'Multiple Choice (Single)',
  MULTI_SELECT: 'Multiple Choice (Multi)',
  TEXT: 'Free Text',
  NUMERIC: 'Numeric',
  DROPDOWN: 'Dropdown',
  PHOTO: 'Photo / Evidence',
  DATE_TIME: 'Date / Time',
  SIGNATURE: 'Signature',
  YES_NO_COMMENT: 'Yes / No + Comment',
  CALCULATED: 'Calculated Field',
  CONDITIONAL: 'Conditional',
};

export function ChecklistItemRow({ item, idx, onUpdate, onRemove }: {
  item: ChecklistItemDef;
  idx: number;
  onUpdate: (index: number, field: string, value: unknown) => void;
  onRemove: (index: number) => void;
}) {
  const needsOptions = ['MCQ', 'MULTI_SELECT', 'DROPDOWN'].includes(item.questionType);
  const needsNumeric = item.questionType === 'NUMERIC';
  const needsPassCriteria = item.questionType === 'PASS_FAIL';
  const needsCalculated = item.questionType === 'CALCULATED';
  const needsConditional = item.questionType === 'CONDITIONAL';

  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-3 bg-white relative">
      <RemoveButton onClick={() => onRemove(idx)} />
      <div className="grid grid-cols-3 gap-3 pr-6">
        <div className="col-span-2 space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Question *</label>
          <Input
            value={item.question}
            onChange={(e) => onUpdate(idx, 'question', e.target.value)}
            placeholder="e.g., Is the equipment clean?"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Type</label>
          <Select
            value={item.questionType}
            onChange={(e) => onUpdate(idx, 'questionType', e.target.value)}
            selectSize="sm"
          >
            {CHECKLIST_QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>{QUESTION_TYPE_LABELS[t] || t}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Section</label>
          <Input
            value={item.section}
            onChange={(e) => onUpdate(idx, 'section', e.target.value)}
            placeholder="e.g., Pre-Operation Checks"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Description / Help</label>
          <Input
            value={item.description}
            onChange={(e) => onUpdate(idx, 'description', e.target.value)}
            placeholder="Help text for the operator"
            className="h-8 text-xs"
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={item.required}
              onChange={(e) => onUpdate(idx, 'required', e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
            />
            <span className="text-xs font-medium text-slate-600">Required</span>
          </label>
        </div>
      </div>
      {/* Options for MCQ / MULTI_SELECT / DROPDOWN */}
      {needsOptions && (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Options (comma-separated)</label>
          <textarea
            value={item.options || ''}
            onChange={(e) => onUpdate(idx, 'options', e.target.value)}
            placeholder="Option1, Option2, Option3"
            rows={2}
            className="flex w-full rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 hover:border-slate-300 transition-all duration-200 resize-none"
          />
        </div>
      )}
      {/* Pass criteria */}
      {needsPassCriteria && (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Pass Criteria</label>
          <Input
            value={item.passCriteria}
            onChange={(e) => onUpdate(idx, 'passCriteria', e.target.value)}
            placeholder="e.g., No visible contamination"
            className="h-8 text-xs"
          />
        </div>
      )}
      {/* Numeric constraints */}
      {needsNumeric && (
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Unit</label>
            <Input
              value={item.numericUnit}
              onChange={(e) => onUpdate(idx, 'numericUnit', e.target.value)}
              placeholder="e.g., °C, PSI"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Min</label>
            <Input
              type="number"
              value={item.numericMin}
              onChange={(e) => onUpdate(idx, 'numericMin', e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="Min value"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Max</label>
            <Input
              type="number"
              value={item.numericMax}
              onChange={(e) => onUpdate(idx, 'numericMax', e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="Max value"
              className="h-8 text-xs"
            />
          </div>
        </div>
      )}
      {/* Calculated expression */}
      {needsCalculated && (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Calculated Expression</label>
          <Input
            value={item.calculatedExpression}
            onChange={(e) => onUpdate(idx, 'calculatedExpression', e.target.value)}
            placeholder="e.g., {field1} + {field2}"
            className="h-8 text-xs"
          />
        </div>
      )}
      {/* Conditional logic */}
      {needsConditional && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Depends On (Question)</label>
            <Input
              value={item.conditionalField}
              onChange={(e) => onUpdate(idx, 'conditionalField', e.target.value)}
              placeholder="e.g., Is equipment clean?"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Show When Value Is</label>
            <Input
              value={item.conditionalValue}
              onChange={(e) => onUpdate(idx, 'conditionalValue', e.target.value)}
              placeholder="e.g., No, Fail"
              className="h-8 text-xs"
            />
          </div>
        </div>
      )}
    </div>
  );
}
