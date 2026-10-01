import { type SelectHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  variant?: 'default' | 'filled' | 'outlined';
  selectSize?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, variant = 'default', selectSize = 'md', icon, ...props }, ref) => {
    const sizeClasses = {
      sm: 'h-8 text-xs px-2.5 pr-8 [@media(pointer:coarse)]:h-10',
      md: 'h-10 text-sm px-3 pr-9 [@media(pointer:coarse)]:h-11',
      lg: 'h-11 text-base px-4 pr-11 [@media(pointer:coarse)]:h-12',
    };

    const variantClasses = {
      default: [
        'border border-slate-300 bg-white',
        'hover:border-slate-400',
        'focus:outline-none focus:border-brand-600 focus:ring-3 focus:ring-brand-600/15',
      ].join(' '),
      filled: [
        'border border-transparent bg-slate-100',
        'hover:bg-slate-200/70',
        'focus:outline-none focus:bg-white focus:border-brand-600 focus:ring-3 focus:ring-brand-600/15',
      ].join(' '),
      outlined: [
        'border border-slate-400 bg-transparent',
        'hover:border-slate-500',
        'focus:outline-none focus:border-brand-600 focus:ring-3 focus:ring-brand-600/15',
      ].join(' '),
    };

    // Chevron: a plain slate stroke (was an indigo gradient that ignored the theme).
    const chevronSvg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24'%3E%3Cpath stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`;

    return (
      <select
        ref={ref}
        className={cn(
          'flex w-full rounded-lg text-slate-900',
          'cursor-pointer',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-100',
          'appearance-none bg-no-repeat',
          sizeClasses[selectSize],
          variantClasses[variant],
          selectSize === 'sm' ? 'bg-[length:0.875rem] bg-[right_0.5rem_center]' :
          selectSize === 'lg' ? 'bg-[length:1.125rem] bg-[right_0.875rem_center]' :
          'bg-[length:1rem] bg-[right_0.625rem_center]',
          className,
        )}
        style={{
          backgroundImage: chevronSvg,
        }}
        {...props}
      >
        {children}
      </select>
    );
  },
);
Select.displayName = 'Select';
