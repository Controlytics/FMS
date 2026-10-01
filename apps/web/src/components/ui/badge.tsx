import { cn } from '@/lib/cn';

const variants = {
  default: 'bg-slate-100 text-slate-700 border border-slate-200',
  secondary: 'bg-slate-100 text-slate-700 border border-slate-200',
  destructive: 'bg-red-50 text-red-700 border border-red-200',
  outline: 'text-slate-700 border border-slate-300 bg-white',
  success: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  warning: 'bg-amber-50 text-amber-800 border border-amber-200',
} as const;

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof variants;
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
