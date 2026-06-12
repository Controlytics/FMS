import { useState } from 'react';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useReauth } from '@/hooks/use-reauth';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { ReauthDialog } from '@/components/reauth-dialog';
import { prettyStage, detailRows, type StageApprovalSummary } from '@/lib/stage-approval';

const STATUS_CHIP: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 border-rose-200',
};
const STATUS_LABEL: Record<string, string> = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' };

export function StageApprovalsPage() {
  const { toast } = useToast();
  const reauth = useReauth();
  const { formatDate } = useDatetimeFormat();
  const [tab, setTab] = useState<'queue' | 'all'>('queue');

  const { data: queueData, mutate: mutateQueue } = useSWR<{ data: StageApprovalSummary[] }>('/api/stage-approvals/queue', { refreshInterval: 30000 });
  const { data: allData, mutate: mutateAll } = useSWR<{ data: StageApprovalSummary[] }>('/api/stage-approvals');

  const queue = queueData?.data ?? [];
  const all = allData?.data ?? [];

  const [dlg, setDlg] = useState<{ item: StageApprovalSummary; action: 'approve' | 'reject' } | null>(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => { mutateQueue(); mutateAll(); };
  const openDlg = (item: StageApprovalSummary, action: 'approve' | 'reject') => { setDlg({ item, action }); setRemarks(''); };

  const submit = () => {
    if (!dlg) return;
    const { item, action } = dlg;
    if (action === 'reject' && remarks.trim().length < 3) { toast.error('Remarks required', 'Add at least 3 characters.'); return; }
    const url = `/api/stage-approvals/${item.id}/${action}`;
    const body: Record<string, unknown> = { remarks: remarks.trim() || undefined };
    const reauthAction = action === 'approve' ? 'APPROVE_CLEANING_STAGE' : 'REJECT_CLEANING_STAGE';

    setBusy(true);
    reauth.execute(reauthAction, async (pw?: string) => {
      if (pw) await apiClient.postWithReauth(url, body, pw);
      else await apiClient.post(url, body);
    }, {
      onSuccess: () => {
        toast.success('Done', action === 'approve' ? 'Cleaning stage approved' : 'Cleaning stage rejected');
        setDlg(null); setBusy(false); refresh();
      },
      onError: (e: any) => { toast.error('Failed', e?.message ?? 'Action failed'); setBusy(false); },
    });
  };

  const Row = ({ r, inQueue }: { r: StageApprovalSummary; inQueue: boolean }) => (
    <div className="grid grid-cols-[1.6fr_1fr_1fr_auto] items-center gap-3 px-4 py-3 hover:bg-slate-50/50">
      <div>
        <div className="text-[14px] font-medium text-slate-800">{r.detailsSnapshot?.filterName ?? r.filterId}</div>
        <div className="text-[11px] text-slate-400">
          {prettyStage(r.stageKey)} · {[r.detailsSnapshot?.block, r.detailsSnapshot?.ahu].filter(Boolean).join(' / ') || '—'}
        </div>
      </div>
      <div className="text-[12px] text-slate-600">
        <div>By: <span className="font-mono">{r.requestedByName}</span></div>
        <div className="text-[11px] text-slate-400">{formatDate(r.requestedAt)}</div>
        {r.decidedByName && <div>{r.status === 'APPROVED' ? 'Approved' : 'Rejected'}: <span className="font-mono">{r.decidedByName}</span></div>}
      </div>
      <div>
        <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_CHIP[r.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
          {inQueue ? 'Verify now' : (STATUS_LABEL[r.status] ?? r.status)}
        </span>
        {r.status === 'REJECTED' && r.decisionRemarks && <div className="text-[11px] text-rose-500 mt-1">{r.decisionRemarks}</div>}
      </div>
      <div className="flex items-center gap-2 justify-end">
        {inQueue ? (
          <>
            <button onClick={() => openDlg(r, 'approve')} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700">Verify & Approve</button>
            <button onClick={() => openDlg(r, 'reject')} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-rose-600 border border-rose-200 hover:bg-rose-50">Reject</button>
          </>
        ) : null}
      </div>
    </div>
  );

  const list = tab === 'queue' ? queue : all;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800">Stage Approvals</h1>
      <p className="text-sm text-slate-500 mt-1 mb-5">Cleaning stages (Wash Out / Dry Out) paused at the QA interlock. Verify the filter details, then approve to release the operator or reject to send it back for re-cleaning. Your password is your signature.</p>

      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => setTab('queue')} className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab === 'queue' ? 'text-white bg-gradient-to-r from-teal-500 to-cyan-600' : 'text-slate-600 bg-slate-100'}`}>
          To Action {queue.length > 0 && <span className="ml-1 px-1.5 rounded-full bg-white/30 text-[11px]">{queue.length}</span>}
        </button>
        <button onClick={() => setTab('all')} className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab === 'all' ? 'text-white bg-gradient-to-r from-teal-500 to-cyan-600' : 'text-slate-600 bg-slate-100'}`}>All</button>
      </div>

      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden divide-y divide-slate-100">
        {list.length === 0 ? (
          <div className="text-sm text-slate-400 py-12 text-center">{tab === 'queue' ? 'Nothing awaiting your approval.' : 'No stage approvals yet.'}</div>
        ) : (
          list.map((r) => <Row key={r.id} r={r} inQueue={tab === 'queue'} />)
        )}
      </div>

      {/* Verify + decide dialog */}
      {dlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setDlg(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 rounded-t-2xl text-white" style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
              <h3 className="font-bold">{dlg.action === 'approve' ? 'Verify & approve stage' : 'Reject stage'}</h3>
              <p className="text-white/80 text-[12px] mt-0.5">{prettyStage(dlg.item.stageKey)} — {dlg.item.detailsSnapshot?.filterName ?? dlg.item.filterId}</p>
            </div>
            <div className="p-6 space-y-4">
              {/* Frozen detail snapshot the approver verifies */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 divide-y divide-slate-100">
                {detailRows(dlg.item.detailsSnapshot).map((row) => (
                  <div key={row.label} className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-[11px] uppercase tracking-wider text-slate-400">{row.label}</span>
                    <span className="text-[13px] font-medium text-slate-700">{row.value}</span>
                  </div>
                ))}
              </div>
              {dlg.action === 'reject' && (
                <p className="text-[12px] text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                  Rejecting sends this filter back to <b>{prettyStage(dlg.item.rejectToStateKey)}</b> for re-cleaning.
                </p>
              )}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Remarks {dlg.action === 'reject' && <span className="text-rose-500">*</span>}</label>
                <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                  placeholder={dlg.action === 'reject' ? 'Reason for rejection (required)' : 'Optional remarks'} />
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 rounded-b-2xl flex justify-end gap-2">
              <button onClick={() => setDlg(null)} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
              <button onClick={submit} disabled={busy}
                className={`px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 ${dlg.action === 'reject' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                {busy ? 'Working…' : (dlg.action === 'reject' ? 'Reject' : 'Approve')}
              </button>
            </div>
          </div>
        </div>
      )}

      <ReauthDialog open={reauth.isOpen} password={reauth.password} error={reauth.error} isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword} onConfirm={reauth.confirm} onCancel={() => { reauth.cancel(); setBusy(false); }} />
    </div>
  );
}
