import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';

// `default` is the theme's brand colour (was a hardcoded blue that ignored the
// selected theme). Every filled variant clears AA contrast with its white label.
const variants = {
  default: 'bg-brand-600 text-white hover:bg-brand-700 shadow-xs',
  destructive: 'bg-red-600 text-white hover:bg-red-700 shadow-xs',
  outline: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-400 shadow-xs',
  secondary: 'bg-slate-100 text-slate-800 hover:bg-slate-200',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  link: 'text-brand-700 underline-offset-4 hover:underline',
  success: 'bg-emerald-700 text-white hover:bg-emerald-800 shadow-xs',
} as const;

// Touch devices (the tablet) keep a 44px target; a mouse gets the denser size.
const sizes = {
  default: 'h-10 px-4 [@media(pointer:coarse)]:h-11',
  sm: 'h-8 px-3 text-[13px] [@media(pointer:coarse)]:h-10',
  lg: 'h-11 px-6 text-base [@media(pointer:coarse)]:h-12',
  icon: 'h-10 w-10 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium',
        // Focus ring comes from the global :focus-visible rule (theme colour).
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
