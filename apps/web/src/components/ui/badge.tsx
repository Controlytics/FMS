import { cn } from '@/lib/cn';

const variants = {
  default: 'bg-gradient-to-r from-[#1e3a5f] to-[#2d4a6f] text-white',
  secondary: 'bg-slate-100 text-slate-700 border border-slate-200',
  destructive: 'bg-gradient-to-r from-red-500 to-red-600 text-white',
  outline: 'text-slate-700 border-2 border-slate-300 bg-white',
  success: 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white',
  warning: 'bg-gradient-to-r from-amber-400 to-orange-500 text-white',
} as const;

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof variants;
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold transition-all duration-200',
        'shadow-sm',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
