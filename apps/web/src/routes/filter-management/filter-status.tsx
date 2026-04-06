import { useState } from 'react';
import useSWR from 'swr';
import { useNavigate } from 'react-router-dom';
import { CLEANING_STAGES_STATUS } from '../../lib/filter-constants';
import type { FilterInstance, PaginatedResponse } from '../../types/filter';

const ALL_STAGES = CLEANING_STAGES_STATUS;

export function FilterStatusPage() {
  const navigate = useNavigate();
  const [selectedStage, setSelectedStage] = useState<string | null>(null);

  // Fetch all filters
  const { data: instances, isLoading } = useSWR<PaginatedResponse<FilterInstance>>('/api/assets/instances?limit=200');
  const allFilters = (instances?.data ?? []).filter((f) => f.currentLifecycleState || f.filterSet);

  // Count filters per stage
  const stageCounts: Record<string, number> = {};
  allFilters.forEach((f) => {
    const state = f.currentLifecycleState ?? 'UNKNOWN';
    stageCounts[state] = (stageCounts[state] ?? 0) + 1;
  });

  // Filters in selected stage
  const filtersInStage = selectedStage
    ? allFilters.filter((f) => f.currentLifecycleState === selectedStage)
    : [];

  const selectedStageInfo = ALL_STAGES.find(s => s.key === selectedStage);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Filter Status</h1>
          <p className="text-slate-500 mt-1">Click on a stage to see filters in that state</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-cyan-600">{allFilters.length}</div>
          <div className="text-xs text-slate-400">Total Filters</div>
        </div>
      </div>

      {/* Stage Blocks Grid */}
      <div className="grid grid-cols-3 gap-3">
        {ALL_STAGES.map((stage) => {
          const count = stageCounts[stage.key] ?? 0;
          const isActive = selectedStage === stage.key;

          return (
            <button
              key={stage.key}
              onClick={() => setSelectedStage(isActive ? null : stage.key)}
              className={`bg-gradient-to-br ${stage.color} border-2 ${isActive ? 'border-cyan-400 ring-2 ring-cyan-400/30 scale-[1.03]' : stage.border} rounded-2xl p-4 text-center transition-all hover:scale-[1.02] active:scale-[0.98] relative`}
            >
              <div className="text-2xl mb-1">{stage.icon}</div>
              <div className="text-white font-semibold text-xs">{stage.label}</div>

              {/* Count badge */}
              <div className={`mt-2 inline-flex items-center justify-center min-w-[28px] h-7 rounded-full font-bold text-sm ${
                count > 0 ? 'bg-white/20 text-white' : 'bg-white/5 text-white/30'
              }`}>
                {count}
              </div>

              {/* Active indicator */}
              {isActive && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-cyan-400 rounded-full border-2 border-white" />
              )}
            </button>
          );
        })}
      </div>

      {/* Filters in Selected Stage */}
      {selectedStage && (
        <div className={`${selectedStageInfo?.activeBg ?? 'bg-slate-50'} border border-slate-200 rounded-2xl p-5`}>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-2xl">{selectedStageInfo?.icon}</span>
            <div>
              <h2 className="text-lg font-bold text-slate-800">{selectedStageInfo?.label}</h2>
              <p className="text-sm text-slate-500">{filtersInStage.length} filter(s) in this stage</p>
            </div>
          </div>

          {filtersInStage.length === 0 ? (
            <div className="text-center py-8 text-slate-400">No filters in this stage</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtersInStage.map((filter) => (
                <div
                  key={filter.id}
                  className="bg-white border border-slate-200 rounded-xl p-4 hover:border-cyan-600 transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-slate-800">{filter.name}</span>
                    {filter.filterSet && (
                      <span className={`px-2 py-0.5 text-[10px] rounded-full font-medium ${
                        filter.filterSet === 'SET_A' ? 'bg-indigo-50 text-indigo-700' : 'bg-purple-50 text-purple-700'
                      }`}>
                        Set {filter.filterSet.replace('SET_', '')}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 text-xs text-slate-500">
                    {filter.parentId && (
                      <div className="flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
                        Parent: {filter.template?.name ?? 'Entity'}
                      </div>
                    )}
                    {filter.attributes?.class && (
                      <div>Class: {filter.attributes.class}</div>
                    )}
                    {filter.attributes?.size && (
                      <div>Size: {filter.attributes.size}</div>
                    )}
                  </div>

                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => navigate(`/filters/${filter.id}/trace`)}
                      className="flex-1 py-1.5 text-xs bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors text-center"
                    >
                      Traceability
                    </button>
                    <button
                      onClick={() => navigate(`/filters/${filter.id}/operate`)}
                      className="flex-1 py-1.5 text-xs bg-cyan-700 text-white rounded-lg hover:bg-cyan-600 transition-colors text-center"
                    >
                      Operate
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
