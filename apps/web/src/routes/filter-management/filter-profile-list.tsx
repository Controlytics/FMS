import { useState } from 'react';
import useSWR from 'swr';
import type { FilterProfile, PaginatedResponse } from '../../types/filter';

export function FilterProfileListPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useSWR<PaginatedResponse<FilterProfile>>(`/api/filter-profiles?page=${page}&limit=20`);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Filter Profiles</h1>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 text-sm">
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">Cleaning Profile</th>
                <th className="py-3 px-4">Block Restriction</th>
                <th className="py-3 px-4">Max Cycles</th>
                <th className="py-3 px-4">Active Filters</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {(data?.data ?? []).map((fp) => (
                <tr key={fp.id} className="border-b border-slate-200 hover:bg-white/50 transition-colors">
                  <td className="py-3 px-4 text-slate-800 font-medium">{fp.name}</td>
                  <td className="py-3 px-4 text-slate-600">{fp.cleaningProfileName}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 text-xs bg-slate-100 rounded text-slate-600">{fp.blockRestriction?.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="py-3 px-4 text-slate-500">{fp.maxCleaningCycles ?? 'Unlimited'}</td>
                  <td className="py-3 px-4 text-slate-600">{fp.activeFilterCount}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${fp.isActive ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {fp.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
              {(data?.data ?? []).length === 0 && (
                <tr><td colSpan={6} className="py-12 text-center text-slate-400">No filter profiles found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {!isLoading && (
        <div className="flex items-center justify-between mt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1 border border-slate-200 rounded text-sm disabled:opacity-50">Previous</button>
          <span className="text-sm text-slate-600">Page {page}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={!data?.data || data.data.length < 20}
            className="px-3 py-1 border border-slate-200 rounded text-sm disabled:opacity-50">Next</button>
        </div>
      )}
    </div>
  );
}
