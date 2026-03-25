import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';


export function FilterProfileListPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useSWR(`/api/filter-profiles?page=${page}&limit=20`);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">Filter Profiles</h1>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-sm">
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">Cleaning Profile</th>
                <th className="py-3 px-4">Block Restriction</th>
                <th className="py-3 px-4">Max Cycles</th>
                <th className="py-3 px-4">Active Filters</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {(data?.data ?? []).map((fp: any) => (
                <tr key={fp.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                  <td className="py-3 px-4 text-gray-100 font-medium">{fp.name}</td>
                  <td className="py-3 px-4 text-gray-300">{fp.cleaningProfileName}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 text-xs bg-gray-700 rounded text-gray-300">{fp.blockRestriction?.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="py-3 px-4 text-gray-400">{fp.maxCleaningCycles ?? 'Unlimited'}</td>
                  <td className="py-3 px-4 text-gray-300">{fp.activeFilterCount}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${fp.isActive ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`}>
                      {fp.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
              {(data?.data ?? []).length === 0 && (
                <tr><td colSpan={6} className="py-12 text-center text-gray-500">No filter profiles found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
