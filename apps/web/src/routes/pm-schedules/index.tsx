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
        <p className="text-gray-400 text-center py-8">
          Select an AHU from the Assets page to view or create its PM schedule.
          <br /><br />
          <span className="text-sm text-gray-500">PM schedules are managed per AHU entity. Navigate to an AHU asset and access its PM schedule from there.</span>
        </p>
      </div>
    </div>
  );
}
