import { createContext, useContext, useEffect, useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

// Global dialog stack: only the topmost dialog should handle Escape key
const dialogStack: (() => void)[] = [];

// The panel is `aria-labelledby` its DialogTitle; the id comes from here so every
// open dialog (e.g. a re-auth prompt over an edit dialog) has its own.
const DialogTitleIdContext = createContext<string | undefined>(undefined);

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** When true, renders at a higher z-index (z-[60]) to appear above other dialogs */
  priority?: boolean;
}

export function Dialog({ open, onClose, children, className, priority }: DialogProps) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;

    dialogStack.push(onClose);

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Only the topmost dialog handles Escape
        if (dialogStack.length > 0 && dialogStack[dialogStack.length - 1] === onClose) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      const idx = dialogStack.lastIndexOf(onClose);
      if (idx !== -1) dialogStack.splice(idx, 1);
    };
  }, [open, onClose]);

  if (!open) return null;

  const zWrapper = priority ? 'z-[60]' : 'z-50';
  const zContent = priority ? 'z-[60]' : 'z-50';

  return (
    <div className={cn('fixed inset-0 flex items-center justify-center p-4', zWrapper)}>
      <div
        className="fixed inset-0 bg-slate-900/50 animate-fade-in"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
        onMouseDown={(e) => e.preventDefault()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          `relative w-full max-w-lg rounded-xl bg-white p-6`,
          zContent,
          'shadow-2xl border border-slate-200',
          'animate-fade-in',
          'max-h-[90vh] overflow-y-auto',
          className
        )}
      >
        <DialogTitleIdContext.Provider value={titleId}>{children}</DialogTitleIdContext.Provider>
      </div>
    </div>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-5', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const titleId = useContext(DialogTitleIdContext);
  return (
    <h2
      id={titleId}
      className={cn(
        'text-lg font-semibold text-slate-900',
        className
      )}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'mt-6 flex justify-end gap-3 pt-4 border-t border-slate-100',
        className
      )}
      {...props}
    />
  );
}
