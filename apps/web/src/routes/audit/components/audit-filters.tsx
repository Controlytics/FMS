import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { checkRangeEdge } from '@/components/ui/date-range-filter';

interface AuditFiltersProps {
  search: string;
  setSearch: (value: string) => void;
  fromDateTime: string;
  setFromDateTime: (value: string) => void;
  toDateTime: string;
  setToDateTime: (value: string) => void;
  setPage: (page: number) => void;
  formatDateTimeDisplay: (datetime: string) => string;
  hasFilters: string | boolean;
  clearFilters: () => void;
}

export function AuditFilters({
  search,
  setSearch,
  fromDateTime,
  setFromDateTime,
  toDateTime,
  setToDateTime,
  setPage,
  formatDateTimeDisplay,
  hasFilters,
  clearFilters,
}: AuditFiltersProps) {
  // This screen keeps its own From/To cards — they are a better design than the
  // generic control — and borrows the ordering rule from it so the two can never
  // disagree. Same contract as DateRangeFilter: an invalid edit is REJECTED,
  // never "fixed" by moving the other end, so setPage(1) still fires exactly
  // once per real change.
  const [rangeHint, setRangeHint] = useState('');
  useEffect(() => {
    if (!rangeHint) return;
    const t = setTimeout(() => setRangeHint(''), 4000);
    return () => clearTimeout(t);
  }, [rangeHint]);

  return (
    <Card className="border border-slate-200 bg-white shadow-xs overflow-hidden">
      <CardContent className="p-5">
        {/* Filter Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-brand-50 text-brand-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Filter Records</h3>
              <p className="text-xs text-slate-500">Search and filter audit entries</p>
            </div>
          </div>
          {hasFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearFilters}
              className="text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-all"
            >
              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear All
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Search Filter */}
          <div className="space-y-2">
            <label htmlFor="audit-filter-search" className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <svg className="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Search
            </label>
            <div className="relative group">
              <div className="relative">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-hover:text-brand-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <Input
                  id="audit-filter-search"
                  placeholder="Search by user, action, target..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="pl-10 h-11"
                />
              </div>
            </div>
          </div>

          {/* From Date & Time - Combined */}
          <div className="space-y-2">
            <label htmlFor="audit-filter-from" className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              From Date & Time
            </label>
            <div className="relative group">
              <div className="relative bg-white rounded-lg border border-slate-300 hover:border-slate-400 focus-within:border-brand-600 focus-within:ring-3 focus-within:ring-brand-600/15 transition-colors overflow-hidden">
                <div className="flex items-center">
                  <div className="flex-shrink-0 px-3 py-2.5 bg-emerald-50 text-emerald-600 border-r border-slate-200">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <input
                    id="audit-filter-from"
                    type="datetime-local"
                    value={fromDateTime}
                    max={toDateTime || undefined}
                    aria-describedby={rangeHint ? 'audit-range-hint' : undefined}
                    onChange={(e) => {
                      const problem = checkRangeEdge('from', e.target.value, toDateTime, 'datetime-local');
                      if (problem) { setRangeHint(problem); return; }
                      setRangeHint('');
                      setFromDateTime(e.target.value);
                      setPage(1);
                    }}
                    className="flex-1 h-[42px] px-3 text-sm text-slate-900 bg-transparent border-0 focus:outline-none focus:ring-0 [color-scheme:light]"
                  />
                </div>
              </div>
            </div>
            {fromDateTime && (
              <p className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {formatDateTimeDisplay(fromDateTime)}
              </p>
            )}
          </div>

          {/* To Date & Time - Combined */}
          <div className="space-y-2">
            <label htmlFor="audit-filter-to" className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <svg className="w-4 h-4 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              To Date & Time
            </label>
            <div className="relative group">
              <div className="relative bg-white rounded-lg border border-slate-300 hover:border-slate-400 focus-within:border-brand-600 focus-within:ring-3 focus-within:ring-brand-600/15 transition-colors overflow-hidden">
                <div className="flex items-center">
                  <div className="flex-shrink-0 px-3 py-2.5 bg-rose-50 text-rose-600 border-r border-slate-200">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <input
                    id="audit-filter-to"
                    type="datetime-local"
                    value={toDateTime}
                    min={fromDateTime || undefined}
                    aria-describedby={rangeHint ? 'audit-range-hint' : undefined}
                    onChange={(e) => {
                      const problem = checkRangeEdge('to', e.target.value, fromDateTime, 'datetime-local');
                      if (problem) { setRangeHint(problem); return; }
                      setRangeHint('');
                      setToDateTime(e.target.value);
                      setPage(1);
                    }}
                    className="flex-1 h-[42px] px-3 text-sm text-slate-900 bg-transparent border-0 focus:outline-none focus:ring-0 [color-scheme:light]"
                  />
                </div>
              </div>
            </div>
            {toDateTime && (
              <p className="text-xs text-rose-600 font-medium flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {formatDateTimeDisplay(toDateTime)}
              </p>
            )}
          </div>
        </div>

        {/* 2026-10-21: both date inputs pointed aria-describedby at this id and
            an inverted range was refused, but nothing rendered it (since d723575),
            so the refusal was silent. Same markup as DateRangeFilter's hint. */}
        {rangeHint && (
          <p id="audit-range-hint" role="alert" className="mt-2 text-[11px] font-medium text-amber-600">
            {rangeHint}
          </p>
        )}

        {/* Active Filters Display */}
        {hasFilters && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Active Filters:</span>
              {search && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-50 text-brand-700 text-xs font-medium border border-brand-100">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Search: {search}
                  <button
                    type="button"
                    aria-label="Remove search filter"
                    onClick={() => setSearch('')}
                    className="ml-1 hover:text-brand-900 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              )}
              {fromDateTime && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-100">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  From: {formatDateTimeDisplay(fromDateTime)}
                  <button
                    type="button"
                    aria-label="Remove from-date filter"
                    onClick={() => setFromDateTime('')}
                    className="ml-1 hover:text-emerald-900 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              )}
              {toDateTime && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-50 text-rose-700 text-xs font-medium border border-rose-100">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  To: {formatDateTimeDisplay(toDateTime)}
                  <button
                    type="button"
                    aria-label="Remove to-date filter"
                    onClick={() => setToDateTime('')}
                    className="ml-1 hover:text-rose-900 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
