import { useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { apiClient } from '../../lib/api-client';
import { useAuth } from '../../hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';

interface RetiredFilter {
  id: string; name: string; updatedAt: string; filterSet: string | null; attributes: any;
  preRetireParentId: string | null; preRetireParentName: string | null;
}

interface ReplacementRecord {
  id: string; oldFilterId: string; oldFilterName: string;
  newFilterId: string; newFilterName: string;
  remarks: string | null; replacedAt: string; performedBy: string;
}

export function FilterDataManagementPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { formatDateTime } = useDatetimeFormat();
  const [tab, setTab] = useState<string>('retirements');
  const [processing, setProcessing] = useState(false);
  const [search, setSearch] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; type: 'retirement' | 'replacement'; name: string } | null>(null);
  const [unretireDialog, setUnretireDialog] = useState<{ id: string; name: string; preRetireParentId: string | null; preRetireParentName: string | null } | null>(null);
  const [unretireParentId, setUnretireParentId] = useState('');

  const { data: retirements, isLoading: retLoading } = useSWR<RetiredFilter[]>('/api/filters/retirements');
  const { data: replacements, isLoading: repLoading } = useSWR<ReplacementRecord[]>('/api/filters/replacements');

  // Generic data tabs — all columns editable, matching actual screen layouts
  const genericTabs = [
    { key: 'cleaning-cycles', label: 'Cleaning Cycles', endpoint: '/api/super-admin/data/cleaning-cycles', idField: 'id',
      columns: ['cycleCode', 'filterId', 'ahuId', 'status', 'cleaningReasonKey', 'cleaningReasonLabel', 'cleaningJustification', 'cleaningAreaId', 'equipmentGroupId', 'profileId', 'profileVersion', 'sequenceNumber', 'startedAt', 'completedAt', 'terminatedAt', 'terminationReason', 'dryerDurationMinutes', 'dryerStartedAt'] },
    { key: 'filter-events', label: 'Filter Events', endpoint: '/api/super-admin/data/filter-events', idField: 'id',
      columns: ['eventType', 'filterId', 'cycleId', 'fromState', 'toState', 'performedBy', 'performedAt', 'cleaningAreaId', 'equipmentId', 'blockId', 'remarks', 'checksum', 'ipAddress', 'createdAt'] },
    { key: 'audit-trail', label: 'Audit Trail', endpoint: '/api/super-admin/data/audit-trail', idField: 'id',
      columns: ['action', 'userId', 'userName', 'userRole', 'targetType', 'targetId', 'timestamp', 'ipAddress', 'sessionId'] },
    { key: 'alarms', label: 'Alarms', endpoint: '/api/super-admin/data/alarms', idField: 'id',
      columns: ['severity', 'status', 'alarmType', 'message', 'entityId', 'acknowledgedBy', 'acknowledgedAt', 'clearedBy', 'clearedAt', 'createdAt'] },
    { key: 'notifications', label: 'Notifications', endpoint: '/api/super-admin/data/notifications', idField: 'id',
      columns: ['type', 'title', 'message', 'forUserId', 'forRole', 'targetUserId', 'isRead', 'readAt', 'createdAt', 'createdBy'] },
    { key: 'admin-requests', label: 'Admin Requests', endpoint: '/api/super-admin/data/admin-requests', idField: 'id',
      columns: ['requestType', 'status', 'requesterName', 'requesterEmployeeId', 'requesterEmail', 'remarks', 'adminRemarks', 'processedBy', 'requestedAt', 'processedAt'] },
    { key: 'block-changes', label: 'Block Changes', endpoint: '/api/super-admin/data/block-change-requests', idField: 'id',
      columns: ['filterId', 'filterName', 'fromBlockId', 'fromBlockName', 'toBlockId', 'toBlockName', 'status', 'reason', 'requestedBy', 'requestedByName', 'processedBy', 'processedByName', 'processedComment', 'createdAt', 'processedAt'] },
    { key: 'pm-entries', label: 'PM Entries', endpoint: '/api/super-admin/data/pm-entries', idField: 'id',
      columns: ['scheduleId', 'month', 'plannedDate', 'toleranceDays', 'windowStart', 'windowEnd', 'approvalStatus', 'approvalRemarks', 'submittedBy', 'submittedByName', 'approvedBy', 'approvedByName', 'approvedAt', 'notes'] },
  ];
  const activeGenericTab = genericTabs.find(t => t.key === tab);
  const { data: genericData, isLoading: genericLoading } = useSWR(
    activeGenericTab ? `${activeGenericTab.endpoint}?limit=50` : null
  );
  const genericRows: any[] = (genericData as any)?.data ?? [];

  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="bg-white border border-red-200 rounded-2xl p-12 text-center max-w-md shadow-lg">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-red-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Access Restricted</h2>
          <p className="text-slate-500 text-sm">This page is available to Super Admin only.</p>
        </div>
      </div>
    );
  }

  const refreshAll = () => { globalMutate('/api/filters/retirements'); globalMutate('/api/filters/replacements'); };

  const filteredRetirements = (retirements ?? []).filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()));
  const filteredReplacements = (replacements ?? []).filter(r => !search ||
    r.oldFilterName.toLowerCase().includes(search.toLowerCase()) ||
    r.newFilterName.toLowerCase().includes(search.toLowerCase()) ||
    r.performedBy.toLowerCase().includes(search.toLowerCase()));

  const handleEditRetirement = async (id: string) => {
    setProcessing(true);
    try {
      const body: any = {};
      if (editFields.name !== undefined) body.name = editFields.name;
      if (editFields.filterSet !== undefined) body.filterSet = editFields.filterSet;
      if (editFields.updatedAt !== undefined) body.updatedAt = editFields.updatedAt;
      await apiClient.put(`/api/super-admin/filter-data/retirements/${id}`, body);
      toast.success('Updated', 'Retirement record updated silently');
      setEditingId(null); setEditFields({}); refreshAll();
    } catch (e: any) { toast.error('Error', e?.message ?? 'Failed'); }
    setProcessing(false);
  };

  const handleDeleteRetirement = async (id: string) => {
    setProcessing(true);
    try {
      await apiClient.delete(`/api/super-admin/filter-data/retirements/${id}`);
      toast.success('Deleted', 'Retirement record permanently removed');
      setConfirmDelete(null); refreshAll();
    } catch (e: any) { toast.error('Error', e?.message ?? 'Failed'); }
    setProcessing(false);
  };

  const handleUnretire = async (id: string) => {
    setProcessing(true);
    try {
      await apiClient.post(`/api/super-admin/filter-data/retirements/${id}/unretire`, { parentId: unretireParentId || undefined });
      toast.success('Unretired', 'Filter restored to Active status');
      setUnretireDialog(null); setUnretireParentId(''); refreshAll();
    } catch (e: any) { toast.error('Error', e?.message ?? 'Failed'); }
    setProcessing(false);
  };

  const handleEditReplacement = async (id: string) => {
    setProcessing(true);
    try {
      const body: any = {};
      for (const f of ['remarks', 'performedBy', 'replacedAt', 'oldFilterId', 'oldFilterName', 'newFilterId', 'newFilterName']) {
        if (editFields[f] !== undefined) body[f] = editFields[f];
      }
      await apiClient.put(`/api/super-admin/filter-data/replacements/${id}`, body);
      toast.success('Updated', 'Replacement record updated silently');
      setEditingId(null); setEditFields({}); refreshAll();
    } catch (e: any) { toast.error('Error', e?.message ?? 'Failed'); }
    setProcessing(false);
  };

  const handleDeleteReplacement = async (id: string) => {
    setProcessing(true);
    try {
      await apiClient.delete(`/api/super-admin/filter-data/replacements/${id}`);
      toast.success('Deleted', 'Replacement record permanently removed');
      setConfirmDelete(null); refreshAll();
    } catch (e: any) { toast.error('Error', e?.message ?? 'Failed'); }
    setProcessing(false);
  };

  const handleDeleteGeneric = async (id: string) => {
    if (!activeGenericTab) return;
    setProcessing(true);
    try {
      await apiClient.delete(`${activeGenericTab.endpoint}/${id}`);
      toast.success('Deleted', 'Record permanently removed');
      setConfirmDelete(null);
      globalMutate(`${activeGenericTab.endpoint}?limit=50`);
    } catch (e: any) { toast.error('Error', e?.message ?? 'Failed'); }
    setProcessing(false);
  };

  const isLoading = tab === 'retirements' ? retLoading : tab === 'replacements' ? repLoading : genericLoading;

  return (
    <div className="h-full flex flex-col space-y-4 p-4 overflow-hidden">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm shrink-0">
        <div className="h-1 bg-gradient-to-r from-red-500 via-rose-500 to-pink-500" />
        <div className="px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 shadow-lg shadow-red-500/20">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800 tracking-tight">Filter Data Management</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px] font-bold border border-red-100">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" /></svg>
                  SUPER ADMIN
                </span>
                <span className="text-[12px] text-slate-400">Changes are not recorded in the audit trail</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-2xl font-bold text-slate-800">
                {tab === 'retirements' ? retirements?.length ?? 0 : tab === 'replacements' ? replacements?.length ?? 0 : (genericData as any)?.total ?? genericRows.length}
              </div>
              <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Records</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs + Search */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 flex-wrap">
          {[
            { key: 'retirements', label: 'Retirements' },
            { key: 'replacements', label: 'Replacements' },
            ...genericTabs.map(t => ({ key: t.key, label: t.label })),
          ].map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setEditingId(null); setSearch(''); }}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                tab === t.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
            className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 w-52 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 outline-none" />
        </div>
      </div>

      {/* Main Content — fills remaining height, scrolls internally */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-[13px] text-slate-400">Loading records...</span>
          </div>
        ) : tab === 'retirements' ? (
          /* ─── Retirements ─── */
          filteredRetirements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                <svg className="w-7 h-7 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </div>
              <span className="text-slate-400 font-medium">{search ? 'No results found' : 'No retired filters'}</span>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  <th className="text-left px-5 py-3.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Filter Name</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Original Parent</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Filter Set</th>
                  <th className="text-left px-5 py-3.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Retired At</th>
                  <th className="text-right px-5 py-3.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRetirements.map(r => {
                  const isEditing = editingId === r.id;
                  return (
                    <tr key={r.id} className={`group transition-colors ${isEditing ? 'bg-cyan-50/30' : 'hover:bg-slate-50/50'}`}>
                      <td className="px-5 py-3.5">
                        {isEditing ? (
                          <input value={editFields.name ?? r.name} onChange={e => setEditFields(p => ({ ...p, name: e.target.value }))} autoFocus
                            className="border border-cyan-300 rounded-lg px-3 py-1.5 text-[13px] w-56 bg-white focus:ring-2 focus:ring-cyan-100 outline-none" />
                        ) : (
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
                            </div>
                            <span className="text-[13px] font-semibold text-slate-800">{r.name}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-[13px]">
                        {r.preRetireParentName ? (
                          <span className="text-slate-600">{r.preRetireParentName}</span>
                        ) : (
                          <span className="text-slate-300 text-[12px]">--</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {isEditing ? (
                          <select value={editFields.filterSet ?? r.filterSet ?? ''} onChange={e => setEditFields(p => ({ ...p, filterSet: e.target.value }))}
                            className="border border-cyan-300 rounded-lg px-3 py-1.5 text-[13px] bg-white focus:ring-2 focus:ring-cyan-100 outline-none">
                            <option value="">None</option>
                            <option value="SET_A">Set A</option>
                            <option value="SET_B">Set B</option>
                          </select>
                        ) : (
                          r.filterSet ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">{r.filterSet.replace('_', ' ')}</span>
                          ) : (
                            <span className="text-slate-300 text-[12px]">--</span>
                          )
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-[12px] tabular-nums whitespace-nowrap">
                        {isEditing ? (
                          <input type="datetime-local" value={editFields.updatedAt ?? r.updatedAt?.slice(0, 16)}
                            onChange={e => setEditFields(p => ({ ...p, updatedAt: e.target.value }))}
                            className="border border-cyan-300 rounded-lg px-2 py-1 text-[11px] bg-white w-44" />
                        ) : (
                          <span className="text-slate-400">{formatDateTime(r.updatedAt)}</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5 justify-end">
                          {isEditing ? (
                            <>
                              <button onClick={() => handleEditRetirement(r.id)} disabled={processing}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-cyan-600 text-white text-[11px] font-semibold rounded-lg hover:bg-cyan-700 disabled:opacity-50 transition-colors">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                Save
                              </button>
                              <button onClick={() => { setEditingId(null); setEditFields({}); }}
                                className="px-3 py-1.5 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-lg hover:bg-slate-200 transition-colors">Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { setEditingId(r.id); setEditFields({ name: r.name, filterSet: r.filterSet ?? '', updatedAt: r.updatedAt?.slice(0, 16) ?? '' }); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-slate-500 text-[11px] font-medium rounded-lg hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                Edit
                              </button>
                              <button onClick={() => setUnretireDialog({ id: r.id, name: r.name, preRetireParentId: r.preRetireParentId, preRetireParentName: r.preRetireParentName })}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-emerald-600 text-[11px] font-medium rounded-lg hover:bg-emerald-50 transition-colors opacity-0 group-hover:opacity-100">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                Restore
                              </button>
                              <button onClick={() => setConfirmDelete({ id: r.id, type: 'retirement', name: r.name })}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-red-500 text-[11px] font-medium rounded-lg hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : tab === 'replacements' ? (
          /* ─── Replacements ─── */
          filteredReplacements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                <svg className="w-7 h-7 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </div>
              <span className="text-slate-400 font-medium">{search ? 'No results found' : 'No replacement records'}</span>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  <th className="text-left px-3 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Old Filter Name</th>
                  <th className="text-left px-3 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Old Filter ID</th>
                  <th className="text-left px-3 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">New Filter Name</th>
                  <th className="text-left px-3 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">New Filter ID</th>
                  <th className="text-left px-3 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Performed By</th>
                  <th className="text-left px-3 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Remarks</th>
                  <th className="text-left px-3 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Date</th>
                  <th className="text-right px-3 py-3.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredReplacements.map(r => {
                  const isEditing = editingId === r.id;
                  return (
                    <tr key={r.id} className={`group transition-colors ${isEditing ? 'bg-cyan-50/30' : 'hover:bg-slate-50/50'}`}>
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <input value={editFields.oldFilterName ?? r.oldFilterName} onChange={e => setEditFields(p => ({ ...p, oldFilterName: e.target.value }))}
                            className="border border-cyan-300 rounded px-2 py-1 text-[11px] bg-white w-32" />
                        ) : (
                          <span className="text-[12px] font-semibold text-slate-500 line-through">{r.oldFilterName}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <input value={editFields.oldFilterId ?? r.oldFilterId} onChange={e => setEditFields(p => ({ ...p, oldFilterId: e.target.value }))}
                            className="border border-cyan-300 rounded px-2 py-1 text-[10px] font-mono bg-white w-36" />
                        ) : (
                          <span className="text-[10px] font-mono text-slate-300" title={r.oldFilterId}>{r.oldFilterId?.slice(0, 8)}...</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <input value={editFields.newFilterName ?? r.newFilterName} onChange={e => setEditFields(p => ({ ...p, newFilterName: e.target.value }))}
                            className="border border-cyan-300 rounded px-2 py-1 text-[11px] bg-white w-32" />
                        ) : (
                          <span className="text-[12px] font-semibold text-slate-800">{r.newFilterName}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <input value={editFields.newFilterId ?? r.newFilterId} onChange={e => setEditFields(p => ({ ...p, newFilterId: e.target.value }))}
                            className="border border-cyan-300 rounded px-2 py-1 text-[10px] font-mono bg-white w-36" />
                        ) : (
                          <span className="text-[10px] font-mono text-slate-300" title={r.newFilterId}>{r.newFilterId?.slice(0, 8)}...</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[12px]">
                        {isEditing ? (
                          <input value={editFields.performedBy ?? r.performedBy} onChange={e => setEditFields(p => ({ ...p, performedBy: e.target.value }))}
                            className="border border-cyan-300 rounded px-2 py-1 text-[11px] bg-white w-28" />
                        ) : (
                          <span className="text-slate-600">{r.performedBy}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[12px] max-w-[150px]">
                        {isEditing ? (
                          <input value={editFields.remarks ?? r.remarks ?? ''} onChange={e => setEditFields(p => ({ ...p, remarks: e.target.value }))}
                            className="border border-cyan-300 rounded px-2 py-1 text-[11px] bg-white w-32" />
                        ) : (
                          <span className="text-slate-400 truncate block" title={r.remarks ?? ''}>{r.remarks || '--'}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-[12px] tabular-nums whitespace-nowrap">
                        {isEditing ? (
                          <input type="datetime-local" value={editFields.replacedAt ?? r.replacedAt?.slice(0, 16)}
                            onChange={e => setEditFields(p => ({ ...p, replacedAt: e.target.value }))}
                            className="border border-cyan-300 rounded px-2 py-1 text-[11px] bg-white w-44" />
                        ) : (
                          <span className="text-slate-400">{formatDateTime(r.replacedAt)}</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5 justify-end">
                          {isEditing ? (
                            <>
                              <button onClick={() => handleEditReplacement(r.id)} disabled={processing}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-cyan-600 text-white text-[11px] font-semibold rounded-lg hover:bg-cyan-700 disabled:opacity-50 transition-colors">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                Save
                              </button>
                              <button onClick={() => { setEditingId(null); setEditFields({}); }}
                                className="px-3 py-1.5 bg-slate-100 text-slate-600 text-[11px] font-semibold rounded-lg hover:bg-slate-200 transition-colors">Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { setEditingId(r.id); setEditFields({ oldFilterName: r.oldFilterName, oldFilterId: r.oldFilterId, newFilterName: r.newFilterName, newFilterId: r.newFilterId, performedBy: r.performedBy, remarks: r.remarks ?? '', replacedAt: r.replacedAt?.slice(0, 16) ?? '' }); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-slate-500 text-[11px] font-medium rounded-lg hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                Edit
                              </button>
                              <button onClick={() => setConfirmDelete({ id: r.id, type: 'replacement', name: r.oldFilterName })}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-red-500 text-[11px] font-medium rounded-lg hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : null}

        {/* ─── Generic Data Tables (all columns editable) ─── */}
        {activeGenericTab && tab !== 'retirements' && tab !== 'replacements' && (
          genericLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-[13px] text-slate-400">Loading {activeGenericTab.label}...</span>
            </div>
          ) : genericRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <span className="text-slate-400 font-medium">No records found</span>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                  {activeGenericTab.columns.map(col => (
                    <th key={col} className="text-left px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{col.replace(/([A-Z])/g, ' $1').trim()}</th>
                  ))}
                  <th className="text-right px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider sticky right-0 bg-slate-50/80">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {genericRows.map((row: any) => {
                  const rowId = row[activeGenericTab.idField];
                  const isRowEditing = editingId === rowId;
                  return (
                    <tr key={rowId} className={`group transition-colors ${isRowEditing ? 'bg-cyan-50/30' : 'hover:bg-slate-50/50'}`}>
                      {activeGenericTab.columns.map(col => {
                        const rawVal = row[col];
                        const isDate = rawVal && typeof rawVal === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(rawVal);
                        const isBool = typeof rawVal === 'boolean';
                        const displayVal = isDate ? formatDateTime(rawVal) : isBool ? (rawVal ? 'Yes' : 'No') : String(rawVal ?? '--');
                        const isBadge = ['status', 'approvalStatus', 'severity', 'eventType', 'action', 'requestType', 'alarmType'].includes(col);

                        if (isRowEditing) {
                          return (
                            <td key={col} className="px-3 py-2">
                              {isBool ? (
                                <select value={editFields[col] ?? String(rawVal)} onChange={e => setEditFields(p => ({ ...p, [col]: e.target.value }))}
                                  className="border border-cyan-300 rounded px-2 py-1 text-[11px] bg-white w-16">
                                  <option value="true">Yes</option>
                                  <option value="false">No</option>
                                </select>
                              ) : isDate ? (
                                <input type="datetime-local" value={editFields[col] ?? (rawVal ? rawVal.slice(0, 16) : '')}
                                  onChange={e => setEditFields(p => ({ ...p, [col]: e.target.value }))}
                                  className="border border-cyan-300 rounded px-2 py-1 text-[11px] bg-white w-40" />
                              ) : (
                                <input value={editFields[col] ?? String(rawVal ?? '')}
                                  onChange={e => setEditFields(p => ({ ...p, [col]: e.target.value }))}
                                  className="border border-cyan-300 rounded px-2 py-1 text-[11px] bg-white w-full min-w-[80px]" />
                              )}
                            </td>
                          );
                        }

                        return (
                          <td key={col} className="px-3 py-2.5 text-[11px] text-slate-600 max-w-[180px] truncate" title={displayVal}>
                            {isBadge ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                {displayVal}
                              </span>
                            ) : displayVal}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 sticky right-0 bg-white">
                        <div className="flex items-center gap-1 justify-end">
                          {isRowEditing ? (
                            <>
                              <button onClick={async () => {
                                setProcessing(true);
                                try {
                                  const body: any = {};
                                  for (const [k, v] of Object.entries(editFields)) {
                                    if (typeof row[k] === 'boolean') body[k] = v === 'true';
                                    else body[k] = v;
                                  }
                                  await apiClient.put(activeGenericTab.endpoint + '/' + rowId, body);
                                  toast.success('Updated', 'Record updated silently');
                                  setEditingId(null); setEditFields({});
                                  globalMutate(activeGenericTab.endpoint + '?limit=50');
                                } catch (e: any) { toast.error('Error', e?.message ?? 'Failed'); }
                                setProcessing(false);
                              }} disabled={processing}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-cyan-600 text-white text-[10px] font-semibold rounded-lg disabled:opacity-50">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                Save
                              </button>
                              <button onClick={() => { setEditingId(null); setEditFields({}); }}
                                className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[10px] font-semibold rounded-lg">Cancel</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => {
                                setEditingId(rowId);
                                const fields: Record<string, string> = {};
                                activeGenericTab.columns.forEach(col => {
                                  const v = row[col];
                                  if (v && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) fields[col] = v.slice(0, 16);
                                  else if (typeof v === 'boolean') fields[col] = String(v);
                                  else fields[col] = String(v ?? '');
                                });
                                setEditFields(fields);
                              }}
                                className="inline-flex items-center gap-1 px-2 py-1 text-slate-500 text-[10px] font-medium rounded-lg hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                Edit
                              </button>
                              <button onClick={() => setConfirmDelete({ id: rowId, type: 'generic' as any, name: row.cycleCode || row.filterName || row.action || row.message || row.title || row.requestType || 'Record' })}
                                className="inline-flex items-center gap-1 px-2 py-1 text-red-500 text-[10px] font-medium rounded-lg hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-red-500 to-rose-500" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-slate-800">Permanent Deletion</h3>
                  <p className="text-[12px] text-slate-400">This action cannot be undone</p>
                </div>
              </div>
              <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
                <p className="text-[13px] text-red-800">
                  <strong>{confirmDelete.name}</strong> {confirmDelete.type} record will be permanently removed with no trace in the system.
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-200 transition-colors">Cancel</button>
                <button onClick={() => {
                  if (confirmDelete.type === 'retirement') handleDeleteRetirement(confirmDelete.id);
                  else if (confirmDelete.type === 'replacement') handleDeleteReplacement(confirmDelete.id);
                  else handleDeleteGeneric(confirmDelete.id);
                }}
                  disabled={processing}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-red-700 transition-colors">
                  {processing ? 'Deleting...' : 'Delete Forever'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unretire Dialog */}
      {unretireDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-emerald-500 to-teal-500" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-slate-800">Restore Filter</h3>
                  <p className="text-[12px] text-slate-400">Unretire and set back to Active</p>
                </div>
              </div>
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 mb-4">
                <p className="text-[13px] text-emerald-800">
                  <strong>{unretireDialog.name}</strong> will be restored to Active status. The retirement audit record will be removed.
                </p>
                {unretireDialog.preRetireParentName && (
                  <p className="text-[12px] text-emerald-700 mt-1.5">
                    Original parent: <strong>{unretireDialog.preRetireParentName}</strong> — will be auto-restored
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setUnretireDialog(null); setUnretireParentId(''); }}
                  className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-200 transition-colors">Cancel</button>
                <button onClick={() => handleUnretire(unretireDialog.id)} disabled={processing}
                  className="flex-1 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 shadow-lg shadow-emerald-500/25 hover:from-emerald-500 hover:to-teal-500 transition-all">
                  {processing ? 'Restoring...' : 'Restore Filter'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
