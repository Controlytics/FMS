import { useState } from 'react';
import { useParams } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function PmScheduleDetailPage() {
  const { entityId } = useParams<{ entityId: string }>();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: schedule, isLoading } = useSWR(entityId ? `/api/pm-schedules/${entityId}?year=${year}` : null);
  const [starting, setStarting] = useState<string | null>(null);

  const startPm = async (entryId: string) => {
    setStarting(entryId);
    try {
      await apiClient.post('/api/pm-executions', { scheduleEntryId: entryId, entityId });
      mutate(`/api/pm-schedules/${entityId}?year=${year}`);
    } catch (e: any) { console.error(e.message); }
    setStarting(null);
  };

  if (isLoading) return <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">PM Schedule</h1>
        <div className="flex items-center gap-3">
          <button onClick={() => setYear(y => y - 1)} className="px-3 py-1.5 bg-gray-700 text-gray-300 rounded-lg">←</button>
          <span className="text-lg font-semibold text-gray-100">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="px-3 py-1.5 bg-gray-700 text-gray-300 rounded-lg">→</button>
        </div>
      </div>

      {!schedule ? (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 text-center">
          <p className="text-gray-400">No PM schedule exists for {year}.</p>
          <button className="mt-4 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500">Create Schedule</button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4 text-sm text-gray-400">
            <span>Version: <span className="text-gray-200">v{schedule.version}</span></span>
            <span className={`px-2 py-0.5 text-xs rounded-full ${schedule.status === 'ACTIVE' ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`}>{schedule.status}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {(schedule.entries ?? []).map((entry: any) => {
              const exec = entry.execution;
              const now = new Date();
              const windowEnd = new Date(entry.windowEnd);
              const windowStart = new Date(entry.windowStart);
              const isOverdue = !exec && now > windowEnd;
              const isDue = !exec && now >= windowStart && now <= windowEnd;
              const isCompleted = exec?.status === 'COMPLETED';
              const isInProgress = exec?.status === 'IN_PROGRESS';

              return (
                <div key={entry.id} className={`bg-gray-800 border rounded-xl p-4 ${isOverdue ? 'border-red-600' : isDue ? 'border-amber-600' : isCompleted ? 'border-green-600' : isInProgress ? 'border-blue-600' : 'border-gray-700'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-lg font-semibold text-gray-100">{MONTHS[entry.month - 1]}</span>
                    {isCompleted && <span className="px-2 py-0.5 text-xs bg-green-900 text-green-300 rounded-full">Completed</span>}
                    {isInProgress && <span className="px-2 py-0.5 text-xs bg-blue-900 text-blue-300 rounded-full">In Progress</span>}
                    {isOverdue && <span className="px-2 py-0.5 text-xs bg-red-900 text-red-300 rounded-full">Overdue</span>}
                    {isDue && <span className="px-2 py-0.5 text-xs bg-amber-900 text-amber-300 rounded-full">Due</span>}
                  </div>
                  <div className="text-sm text-gray-400 space-y-1">
                    <div>Planned: <span className="text-gray-300">{new Date(entry.plannedDate).toLocaleDateString()}</span></div>
                    <div>Window: <span className="text-gray-300">{new Date(entry.windowStart).toLocaleDateString()} - {new Date(entry.windowEnd).toLocaleDateString()}</span></div>
                    <div>Tolerance: <span className="text-gray-300">{entry.toleranceDays} days</span></div>
                  </div>
                  {exec && (
                    <div className="mt-2 pt-2 border-t border-gray-700 text-sm text-gray-400">
                      {exec.startedAt && <div>Started: {new Date(exec.startedAt).toLocaleString()}</div>}
                      {exec.completedAt && <div>Done: {new Date(exec.completedAt).toLocaleString()}</div>}
                      {exec.isWithinWindow === false && <span className="text-xs text-amber-400">Out of window</span>}
                    </div>
                  )}
                  {!exec && (isDue || isOverdue) && (
                    <button onClick={() => startPm(entry.id)} disabled={starting === entry.id}
                      className="mt-3 w-full py-2 bg-cyan-600 text-white rounded-lg text-sm hover:bg-cyan-500 disabled:opacity-50">
                      {starting === entry.id ? 'Starting...' : 'Start PM'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
