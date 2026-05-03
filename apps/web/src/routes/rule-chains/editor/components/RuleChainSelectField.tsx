import useSWR from 'swr';

// ---------------------------------------------------------------------------
// Rule chain select field — fetches chains list via SWR
// ---------------------------------------------------------------------------

export function RuleChainSelectField({
  fieldKey,
  label,
  description,
  value,
  onChange,
  currentChainId,
}: {
  fieldKey: string;
  label: string;
  description?: string;
  value: string;
  onChange: (val: string) => void;
  currentChainId: string;
}) {
  const { data: chainsRes } = useSWR<{ data: Array<{ id: string; name: string; isRoot: boolean }> }>(
    '/api/rule-chains',
  );
  const chains = (chainsRes?.data ?? []).filter((c) => c.id !== currentChainId);

  return (
    <div>
      <label className="text-xs font-medium text-slate-600 block mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-9 w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 transition-all"
      >
        <option value="">Select a rule chain...</option>
        {chains.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}{c.isRoot ? ' (Root)' : ''}
          </option>
        ))}
      </select>
      {description && <p className="text-[10px] text-slate-400 mt-0.5">{description}</p>}
    </div>
  );
}
