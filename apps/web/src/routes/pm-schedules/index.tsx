import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

export function PmScheduleListPage() {
  const navigate = useNavigate();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: pmConfig } = useSWR('/api/config/dynamic/filter-pm-schedule');

  if (pmConfig && !(pmConfig.value as any)?.enabled) {
    return (
      <div className="p-6">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 text-center">
          <div className="text-4xl mb-4">📋</div>
          <h2 className="text-xl font-semibold text-gray-300 mb-2">PM Module Disabled</h2>
          <p className="text-gray-500">Preventive Maintenance scheduling is currently disabled. Enable it in Configuration settings.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">PM Schedules</h1>
        <div className="flex items-center gap-3">
          <button onClick={() => setYear(y => y - 1)} className="px-3 py-1.5 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600">←</button>
          <span className="text-lg font-semibold text-gray-100">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="px-3 py-1.5 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600">→</button>
        </div>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <div className="text-center py-8">
          <p className="text-gray-400">PM schedules are managed per AHU. Select an AHU to view or create its schedule.</p>
          <button onClick={() => navigate('/assets')} className="mt-4 px-5 py-2 bg-cyan-600 text-white rounded-lg text-sm hover:bg-cyan-500">
            Go to Assets
          </button>
        </div>
      </div>
    </div>
  );
}
