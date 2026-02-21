import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { FloatInput } from './float-input';
import { validateAttrValue } from '../lib/attribute-validation';
import type { AttributeDefinition } from '../types';

// Re-export validation helpers so consumers can import from one place
export { validateAttrValue, hasAttributeErrors } from '../lib/attribute-validation';

export function AttributeForm({
  attrSchema,
  values,
  onChange,
}: {
  attrSchema: AttributeDefinition[];
  values: Record<string, any>;
  onChange: (field: string, value: any) => void;
}) {
  if (!attrSchema || attrSchema.length === 0) {
    return <p className="text-sm text-slate-500 italic">This template has no attributes defined.</p>;
  }

  return (
    <div className="space-y-4">
      {attrSchema.map((attr) => {
        const value = values[attr.fieldName] ?? '';
        const constraints = attr.numericConstraints;
        const errMsg = validateAttrValue(attr, value);

        return (
          <div key={attr.fieldName} className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              {attr.fieldName}
              {attr.required && <span className="text-red-500">*</span>}
              <Badge variant="outline" className="text-xs font-normal px-1.5 py-0.5">
                {attr.dataType}
              </Badge>
              {attr.unit && (
                <span className="text-xs text-slate-400 font-normal">({attr.unit})</span>
              )}
            </label>

            {attr.dataType === 'TEXT' && (
              <Input
                type="text"
                value={value}
                onChange={(e) => onChange(attr.fieldName, e.target.value)}
                placeholder={`Enter ${attr.fieldName}`}
              />
            )}

            {attr.dataType === 'INTEGER' && (
              <>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={value}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '' || v === '-') { onChange(attr.fieldName, ''); return; }
                    if (/^-?\d+$/.test(v)) onChange(attr.fieldName, parseInt(v, 10));
                  }}
                  placeholder={`Enter ${attr.fieldName} (whole numbers only)`}
                  className={errMsg ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}
                />
                {constraints?.enabled && (
                  <p className="text-xs text-slate-400">
                    Range: {constraints.min ?? '-\u221E'} to {constraints.max ?? '+\u221E'}
                    {constraints.resolution ? ` | Step: ${constraints.resolution}` : ''}
                  </p>
                )}
              </>
            )}

            {attr.dataType === 'FLOAT' && (
              <>
                <FloatInput
                  value={value}
                  onValueChange={(v) => onChange(attr.fieldName, v)}
                  placeholder={`Enter ${attr.fieldName} (decimal number)`}
                  className={errMsg ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}
                />
                {constraints?.enabled && (
                  <p className="text-xs text-slate-400">
                    Range: {constraints.min ?? '-\u221E'} to {constraints.max ?? '+\u221E'}
                    {constraints.resolution ? ` | Step: ${constraints.resolution}` : ''}
                  </p>
                )}
              </>
            )}

            {attr.dataType === 'DATE' && (
              <Input
                type="date"
                value={value}
                onChange={(e) => onChange(attr.fieldName, e.target.value)}
              />
            )}

            {attr.dataType === 'DATETIME' && (
              <Input
                type="datetime-local"
                value={value}
                onChange={(e) => onChange(attr.fieldName, e.target.value)}
              />
            )}

            {attr.dataType === 'BOOLEAN' && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!value}
                  onChange={(e) => onChange(attr.fieldName, e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-600">
                  {value ? 'Yes' : 'No'}
                </span>
              </label>
            )}

            {attr.dataType === 'DROPDOWN' && (
              <Select
                value={value}
                onChange={(e) => onChange(attr.fieldName, e.target.value)}
              >
                <option value="">Select...</option>
                {(attr.dropdownOptions ?? []).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </Select>
            )}

            {attr.dataType === 'URL' && (
              <Input
                type="url"
                value={value}
                onChange={(e) => onChange(attr.fieldName, e.target.value)}
                placeholder="https://..."
                className={errMsg ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}
              />
            )}

            {attr.dataType === 'FILE' && (
              <Input
                type="text"
                value={value}
                onChange={(e) => onChange(attr.fieldName, e.target.value)}
                placeholder="File path (upload coming soon)"
              />
            )}

            {/* Inline validation error */}
            {errMsg && (
              <p className="text-xs text-red-500 font-medium">{errMsg}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
