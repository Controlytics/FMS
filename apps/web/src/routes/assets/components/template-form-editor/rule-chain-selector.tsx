import useSWR from 'swr';
import { Select } from '@/components/ui/select';

export function RuleChainSelector({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { data } = useSWR<{ data: Array<{ id: string; name: string; description?: string; isActive: boolean }> }>(
    '/api/rule-chains',
    { revalidateOnFocus: false, dedupingInterval: 30000 },
  );
  const chains = data?.data?.filter((c) => c.isActive) ?? [];

  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">Default Rule Chain</label>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">None (no rule chain)</option>
        {chains.map((chain) => (
          <option key={chain.id} value={chain.id}>
            {chain.name}
          </option>
        ))}
      </Select>
      <p className="text-xs text-slate-500 mt-1">
        Rule chain to process incoming data (telemetry, attributes, events). Handles filtering, alarms, and notifications.
      </p>
    </div>
  );
}
