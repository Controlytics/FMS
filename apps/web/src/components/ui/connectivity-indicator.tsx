import { cn } from '@/lib/cn';

interface ConnectivityIndicatorProps {
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN' | string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

const statusConfig: Record<string, { color: string; pulseColor: string; label: string }> = {
  ONLINE: { color: 'bg-emerald-500', pulseColor: 'bg-emerald-400', label: 'Online' },
  OFFLINE: { color: 'bg-red-500', pulseColor: 'bg-red-400', label: 'Offline' },
  UNKNOWN: { color: 'bg-slate-400', pulseColor: 'bg-slate-300', label: 'Unknown' },
};

const sizeConfig = {
  sm: { dot: 'w-2 h-2', pulse: 'w-2 h-2', text: 'text-xs' },
  md: { dot: 'w-2.5 h-2.5', pulse: 'w-2.5 h-2.5', text: 'text-sm' },
  lg: { dot: 'w-3 h-3', pulse: 'w-3 h-3', text: 'text-sm' },
};

export function ConnectivityIndicator({
  status,
  size = 'md',
  showLabel = false,
  className,
}: ConnectivityIndicatorProps) {
  const config = statusConfig[status] ?? statusConfig.UNKNOWN;
  const sizes = sizeConfig[size];

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="relative flex">
        <span className={cn('rounded-full', sizes.dot, config.color)} />
        {status === 'ONLINE' && (
          <span className={cn('absolute rounded-full animate-ping opacity-75', sizes.pulse, config.pulseColor)} />
        )}
      </span>
      {showLabel && (
        <span className={cn(sizes.text, 'font-medium', {
          'text-emerald-600': status === 'ONLINE',
          'text-red-600': status === 'OFFLINE',
          'text-slate-500': status === 'UNKNOWN' || !statusConfig[status],
        })}>
          {config.label}
        </span>
      )}
    </span>
  );
}
