import type { TraceStats } from '../types';
import { formatDuration } from '../helpers';
import { StatCard } from '@/components/ui/stat-card';

// ---------------------------------------------------------------------------
// Stats Cards
// ---------------------------------------------------------------------------

export function StatsCards({ stats, total }: { stats: TraceStats | undefined; total: number }) {
  const statItems = [
    {
      label: 'Success Rate (1h)',
      value: stats ? `${stats.successRate1h.toFixed(1)}%` : '—',
      iconBg: 'bg-emerald-50',
      iconColor: 'text-emerald-600',
      icon: (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      ),
      valueClass: stats && stats.successRate1h < 90 ? 'text-red-600' : 'text-emerald-600',
    },
    {
      label: 'Success Rate (24h)',
      value: stats ? `${stats.successRate24h.toFixed(1)}%` : '—',
      iconBg: 'bg-brand-50',
      iconColor: 'text-brand-600',
      icon: (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      ),
      valueClass: stats && stats.successRate24h < 90 ? 'text-red-600' : 'text-brand-700',
    },
    {
      label: 'Avg Duration',
      value: stats ? formatDuration(Math.round(stats.avgDurationMs)) : '—',
      iconBg: 'bg-brand-50',
      iconColor: 'text-brand-600',
      icon: (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      ),
      valueClass: 'text-brand-700',
    },
    {
      label: 'Total Traces',
      value: total.toLocaleString(),
      iconBg: 'bg-brand-50',
      iconColor: 'text-brand-600',
      icon: (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      ),
      valueClass: 'text-cyan-700',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {statItems.map((item) => (
        <StatCard
          key={item.label}
          label={item.label}
          value={<span className={item.valueClass}>{item.value}</span>}
          icon={item.icon}
          iconBg={item.iconBg}
          iconColor={item.iconColor}
        />
      ))}
    </div>
  );
}
