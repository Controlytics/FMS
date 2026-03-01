import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  parentId: string;
  flatAssetList: { id: string; name: string; depth: number; templateName: string; childCount: number }[];
  saving: boolean;
  error: string;
  onSubmit: (parentId: string, targetId: string) => void;
}

export function AttachExistingDialog({ open, onClose, parentId, flatAssetList, saving, error, onSubmit }: Props) {
  const [attachTargetId, setAttachTargetId] = useState('');
  const [attachSearch, setAttachSearch] = useState('');

  const handleClose = () => {
    setAttachTargetId('');
    setAttachSearch('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Attach Existing Entity</DialogTitle>
        <DialogDescription>
          Link an existing entity as a child of{' '}
          <span className="font-semibold text-slate-700">{flatAssetList.find((a) => a.id === parentId)?.name ?? 'this entity'}</span>
          {' '}using a CONTAINS relationship.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Select Entity</label>
          <Input value={attachSearch} onChange={(e) => setAttachSearch(e.target.value)} placeholder="Search entities by name or template..." className="text-sm" autoFocus />
        </div>
        <div className="max-h-64 overflow-y-auto rounded-xl border-2 border-slate-200 bg-white divide-y divide-slate-100">
          {flatAssetList.filter((a) => a.id !== parentId).filter((a) => !attachSearch || a.name.toLowerCase().includes(attachSearch.toLowerCase()) || a.templateName.toLowerCase().includes(attachSearch.toLowerCase())).map((a) => {
            const isSelected = attachTargetId === a.id;
            const isParentNode = a.childCount > 0;
            return (
              <label key={a.id} className={cn('flex items-center gap-3 px-3 py-2.5 transition-colors', isParentNode ? 'opacity-50 cursor-not-allowed bg-slate-50' : 'cursor-pointer hover:bg-slate-50', isSelected && !isParentNode && 'bg-blue-50/60 border-l-2 border-blue-500')} title={isParentNode ? 'Parent nodes with children cannot be attached as a child' : undefined}>
                <input type="radio" name="attachTarget" checked={isSelected} onChange={() => !isParentNode && setAttachTargetId(a.id)} disabled={isParentNode} className="w-4 h-4 text-blue-600 border-slate-300 focus:ring-blue-500" />
                <div className="flex-1 min-w-0">
                  <span className={cn('text-sm font-medium truncate block', isParentNode ? 'text-slate-400' : 'text-slate-700')}>{'\u00A0'.repeat(a.depth * 2)}{a.depth > 0 ? '\u2514 ' : ''}{a.name}</span>
                </div>
                {isParentNode && <span className="text-xs text-amber-600 font-medium flex-shrink-0">Parent Node</span>}
                <span className="text-xs text-slate-400 flex-shrink-0">{a.templateName}</span>
              </label>
            );
          })}
          {flatAssetList.filter((a) => a.id !== parentId).length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-slate-400">No entities available to attach</div>
          )}
        </div>
        {attachTargetId && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Preview</p>
            <p className="text-sm text-slate-700">
              <span className="font-medium">{flatAssetList.find((a) => a.id === parentId)?.name ?? 'Parent'}</span>
              {' '}<span className="text-emerald-600 font-medium">---Contains---&gt;</span>{' '}
              <span className="font-medium">{flatAssetList.find((a) => a.id === attachTargetId)?.name ?? 'Target'}</span>
            </p>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={handleClose}>Cancel</Button>
        <Button onClick={() => onSubmit(parentId, attachTargetId)} disabled={saving || !attachTargetId || attachTargetId === parentId}>
          {saving ? 'Attaching...' : 'Attach Entity'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
