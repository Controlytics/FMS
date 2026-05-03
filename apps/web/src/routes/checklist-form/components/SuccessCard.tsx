// =============================================
// Success card
// =============================================

export function SuccessCard({
  entityName,
  onBack,
}: {
  entityName: string;
  onBack: () => void;
}) {
  return (
    <div className="max-w-lg mx-auto px-4 py-12 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-elevated border border-slate-100 p-8 text-center space-y-6">
        {/* Green checkmark */}
        <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
          <svg
            className="w-10 h-10 text-emerald-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-bold text-slate-800">
            Checklist Submitted
          </h2>
          <p className="text-sm text-slate-500">
            Your checklist for{' '}
            <span className="font-semibold text-slate-700">{entityName}</span>{' '}
            has been recorded successfully.
          </p>
        </div>

        {/* Compliance badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-200">
          <svg
            className="w-4 h-4 text-emerald-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
          <span className="text-sm font-semibold text-emerald-700">
            21 CFR Part 11 Compliant
          </span>
        </div>

        <button
          type="button"
          onClick={onBack}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-[#1e3a5f] to-[#3b82f6] text-white text-sm font-semibold shadow-md hover:shadow-lg active:scale-[0.98] transition-all"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to Entity
        </button>
      </div>
    </div>
  );
}
