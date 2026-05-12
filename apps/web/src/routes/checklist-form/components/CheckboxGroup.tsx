// MULTI_SELECT â€” checkbox group
export interface CheckboxGroupProps {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}
export function CheckboxGroup({ options, value, onChange }: CheckboxGroupProps) {
  const toggle = (opt: string) => {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  };
  return (
    <div className="space-y-2">
      {options.map((opt) => (
        <label
          key={opt}
          onClick={() => toggle(opt)}
          className={[
            'flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all duration-150',
            value.includes(opt)
              ? 'border-blue-500 bg-blue-50'
              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
          ].join(' ')}
        >
          <div
            className={[
              'w-4 h-4 rounded-lg border-2 flex items-center justify-center flex-shrink-0',
              value.includes(opt)
                ? 'border-blue-500 bg-blue-500'
                : 'border-slate-300 bg-white',
            ].join(' ')}
          >
            {value.includes(opt) && (
              <svg
                className="w-3 h-3 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
          </div>
          <span className="text-sm text-slate-700 font-medium">{opt}</span>
        </label>
      ))}
    </div>
  );
}
