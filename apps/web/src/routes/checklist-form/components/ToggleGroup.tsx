// Toggle button group (PASS_FAIL / YES_NO / YES_NO_NA)
export interface ToggleGroupProps {
  options: { label: string; value: string; activeClass: string }[];
  value: string | null;
  onChange: (v: string) => void;
  disabled?: boolean;
}
export function ToggleGroup({ options, value, onChange, disabled }: ToggleGroupProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={[
            'flex-1 min-w-[80px] px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all duration-150 active:scale-[0.98]',
            value === opt.value
              ? `${opt.activeClass} border-transparent shadow-md`
              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50',
            disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
