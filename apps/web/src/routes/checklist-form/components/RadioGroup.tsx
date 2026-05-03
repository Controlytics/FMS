// MCQ â€” radio group
export interface RadioGroupProps {
  options: string[];
  value: string | null;
  onChange: (v: string) => void;
}
export function RadioGroup({ options, value, onChange }: RadioGroupProps) {
  return (
    <div className="space-y-2">
      {options.map((opt) => (
        <label
          key={opt}
          onClick={() => onChange(opt)}
          className={[
            'flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all duration-150',
            value === opt
              ? 'border-blue-500 bg-blue-50'
              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
          ].join(' ')}
        >
          <div
            className={[
              'w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0',
              value === opt ? 'border-blue-500' : 'border-slate-300',
            ].join(' ')}
          >
            {value === opt && (
              <div className="w-2 h-2 rounded-full bg-blue-500" />
            )}
          </div>
          <span className="text-sm text-slate-700 font-medium">{opt}</span>
        </label>
      ))}
    </div>
  );
}
