import { Button } from '@/components/ui/button';

interface AuditPaginationProps {
  page: number;
  setPage: (page: number | ((prev: number) => number)) => void;
  perPage: number;
  setPerPage: (perPage: number) => void;
  data: any;
  paginationOptions: number[];
}

export function AuditPagination({
  page,
  setPage,
  perPage,
  setPerPage,
  data,
  paginationOptions,
}: AuditPaginationProps) {
  if (!data || !data.total) return null;

  return (
    <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-3 text-sm text-slate-600">
        <span className="text-slate-500">Rows per page:</span>
        <div className="flex items-center gap-1">
          {paginationOptions.map((opt) => (
            <button
              key={opt}
              onClick={() => { setPerPage(opt); setPage(1); }}
              className={`px-2.5 py-1 rounded-md text-sm font-medium transition-all ${
                perPage === opt
                  ? 'bg-indigo-500 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        <span className="text-slate-300">|</span>
        <span>
          Page <span className="font-semibold text-slate-800">{data.page}</span> of{' '}
          <span className="font-semibold text-slate-800">{data.totalPages}</span>
          <span className="text-slate-400 ml-2">({data.total.toLocaleString()} total records)</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage(1)}
          className="px-3"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((p: number) => p - 1)}
          className="px-4"
        >
          Previous
        </Button>
        <div className="flex items-center gap-1">
          {Array.from({ length: Math.min(5, data.totalPages) }, (_, i) => {
            let pageNum;
            if (data.totalPages <= 5) {
              pageNum = i + 1;
            } else if (page <= 3) {
              pageNum = i + 1;
            } else if (page >= data.totalPages - 2) {
              pageNum = data.totalPages - 4 + i;
            } else {
              pageNum = page - 2 + i;
            }
            return (
              <button
                key={pageNum}
                onClick={() => setPage(pageNum)}
                className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${
                  pageNum === page
                    ? 'bg-indigo-500 text-white shadow-md'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {pageNum}
              </button>
            );
          })}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= data.totalPages}
          onClick={() => setPage((p: number) => p + 1)}
          className="px-4"
        >
          Next
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= data.totalPages}
          onClick={() => setPage(data.totalPages)}
          className="px-3"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </Button>
      </div>
    </div>
  );
}
