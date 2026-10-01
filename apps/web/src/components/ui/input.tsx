import { type InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  secureField?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, secureField, ...props }, ref) => {
    const secureHandlers = secureField
      ? {
          onCopy: (e: React.ClipboardEvent) => e.preventDefault(),
          onPaste: (e: React.ClipboardEvent) => e.preventDefault(),
          onCut: (e: React.ClipboardEvent) => e.preventDefault(),
          onDragStart: (e: React.DragEvent) => e.preventDefault(),
          onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        }
      : {};

    return (
      <input
        ref={ref}
        className={cn(
          'flex h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900',
          '[@media(pointer:coarse)]:h-11',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          'placeholder:text-slate-400',
          'hover:border-slate-400',
          'focus:outline-none focus:border-brand-600 focus:ring-3 focus:ring-brand-600/15',
          'disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-slate-50 disabled:hover:border-slate-300',
          className,
        )}
        {...secureHandlers}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
