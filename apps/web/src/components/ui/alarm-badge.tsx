import useSWR from 'swr';
import { cn } from '@/lib/cn';

interface AlarmBadgeProps {
  className?: string;
}

export function AlarmBadge({ className }: AlarmBadgeProps) {
  const { data } = useSWR<{ data: any[]; total: number }>('/api/alarms?status=ACTIVE&pageSize=1', {
    refreshInterval: 15000,
    dedupingInterval: 10000,
  });

  const count = data?.total ?? 0;

  if (count === 0) return null;

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center min-w-5 h-5 px-1.5',
        'rounded-full text-xs font-bold',
        'bg-red-500 text-white',
        'animate-pulse',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
