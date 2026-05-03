// =============================================
// Loading skeleton
// =============================================

export function LoadingSkeleton() {
  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-4 animate-pulse">
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-5 space-y-3">
        <div className="h-4 bg-slate-200 rounded-lg w-3/4" />
        <div className="h-3 bg-slate-100 rounded-lg w-1/2" />
      </div>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-white rounded-2xl shadow-soft border border-slate-100 p-5 space-y-4"
        >
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-slate-200 flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 bg-slate-200 rounded-lg w-4/5" />
              <div className="h-3 bg-slate-100 rounded-lg w-2/3" />
            </div>
          </div>
          <div className="pl-10 h-12 bg-slate-100 rounded-xl" />
        </div>
      ))}
    </div>
  );
}
