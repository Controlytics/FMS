import { useState } from 'react';
import useSWR from 'swr';
import { cn } from '@/lib/cn';

interface HelpArticle {
  id: string;
  key: string;
  title: string;
  content: string;
  category: string;
}

interface HelpButtonProps {
  articleKey: string;
  className?: string;
}

export function HelpButton({ articleKey, className }: HelpButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center justify-center w-6 h-6 rounded-full',
          'bg-slate-100 text-slate-500 hover:bg-blue-100 hover:text-blue-600',
          'transition-colors text-xs font-bold',
          className,
        )}
        title="Help"
      >
        ?
      </button>
      {open && <HelpPanel articleKey={articleKey} onClose={() => setOpen(false)} />}
    </>
  );
}

function HelpPanel({ articleKey, onClose }: { articleKey: string; onClose: () => void }) {
  const { data: article, isLoading } = useSWR<HelpArticle>(`/api/help/${articleKey}`);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-white shadow-2xl border-l border-slate-200 animate-slide-in overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="font-semibold text-slate-800">Help</h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <div className="text-center py-8">
              <svg className="w-6 h-6 animate-spin mx-auto text-cyan-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : article ? (
            <div>
              <h2 className="text-lg font-bold text-slate-800 mb-4">{article.title}</h2>
              <div className="prose prose-sm prose-slate max-w-none">
                {/* Simple markdown-like rendering */}
                {article.content.split('\n').map((line, i) => {
                  if (line.startsWith('### ')) return <h4 key={i} className="text-sm font-bold text-slate-700 mt-4 mb-2">{line.slice(4)}</h4>;
                  if (line.startsWith('## ')) return <h3 key={i} className="text-base font-bold text-slate-800 mt-5 mb-2">{line.slice(3)}</h3>;
                  if (line.startsWith('# ')) return <h2 key={i} className="text-lg font-bold text-slate-800 mt-5 mb-2">{line.slice(2)}</h2>;
                  if (line.startsWith('- ')) return <li key={i} className="text-sm text-slate-600 ml-4">{line.slice(2)}</li>;
                  if (line.startsWith('```')) return null;
                  if (line.trim() === '') return <div key={i} className="h-2" />;
                  return <p key={i} className="text-sm text-slate-600 mb-2">{line}</p>;
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-slate-500">Help article not found.</p>
              <p className="text-xs text-slate-400 mt-1">Key: {articleKey}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
