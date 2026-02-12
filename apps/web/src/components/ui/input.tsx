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
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...secureHandlers}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
