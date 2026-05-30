import { useEffect } from 'react';
import { themeButton } from '@/lib/theme-styles';

export interface SuccessItem {
  id: string;
  title: string;
  message?: string;
}

// App-wide success confirmation modal. Shown (via ToastProvider) whenever
// `toast.success(...)` is called — i.e. after any successful save-type action.
// Requires the operator to acknowledge with OK (Esc / backdrop also dismiss).
export function SuccessDialog({ item, onDismiss }: { item: SuccessItem; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(item.id); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item.id, onDismiss]);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[80] p-4"
      onClick={() => onDismiss(item.id)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-6 py-4 flex items-center gap-3"
          style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}
        >
          <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-white">{item.title}</h2>
        </div>

        <div className="px-6 py-5">
          <p className="text-sm text-slate-600">
            {item.message ?? 'Your changes have been saved successfully.'}
          </p>
        </div>

        <div className="px-6 pb-5">
          <button
            autoFocus
            onClick={() => onDismiss(item.id)}
            className="w-full py-2.5 text-white rounded-lg font-semibold hover:opacity-90 transition-all"
            style={themeButton}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
