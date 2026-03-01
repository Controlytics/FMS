import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';

const RELATIONSHIP_LABELS: Record<string, string> = {
  CONTAINS: 'Contains', CONTAINED_IN: 'Contained In', CONNECTED_TO: 'Connected To',
  FEEDS: 'Feeds', FED_BY: 'Fed By', DEPENDS_ON: 'Depends On',
  DEPENDED_ON_BY: 'Depended On By', BACKS_UP: 'Backs Up', BACKED_UP_BY: 'Backed Up By',
  MONITORS: 'Monitors', MONITORED_BY: 'Monitored By', CUSTOM: 'Custom',
};

const ALL_RELATIONSHIP_TYPES = [
  'CONTAINS', 'CONTAINED_IN', 'CONNECTED_TO', 'FEEDS', 'FED_BY',
  'DEPENDS_ON', 'DEPENDED_ON_BY', 'BACKS_UP', 'BACKED_UP_BY',
  'MONITORS', 'MONITORED_BY', 'CUSTOM',
];

interface Props {
  open: boolean;
  onClose: () => void;
  initialSource: string;
  flatAssetList: { id: string; name: string; depth: number; templateName: string; childCount: number }[];
  saving: boolean;
  onSubmit: (source: string, targets: string[], type: string, customLabel: string, notes: string) => void;
}

export function LinkEntitiesDialog({ open, onClose, initialSource, flatAssetList, saving, onSubmit }: Props) {
  const [linkSource, setLinkSource] = useState(initialSource);
  const [linkTargets, setLinkTargets] = useState<string[]>([]);
  const [linkType, setLinkType] = useState('CONTAINS');
  const [linkCustomLabel, setLinkCustomLabel] = useState('');
  const [linkNotes, setLinkNotes] = useState('');
  const [linkTargetSearch, setLinkTargetSearch] = useState('');

  // Reset when opening
  const handleClose = () => {
    setLinkSource('');
    setLinkTargets([]);
    setLinkType('CONTAINS');
    setLinkCustomLabel('');
    setLinkNotes('');
    setLinkTargetSearch('');
    onClose();
  };

  // Sync initial source
  if (open && initialSource && !linkSource) setLinkSource(initialSource);

  return (
    <Dialog open={open} onClose={handleClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Link Entities</DialogTitle>
        <DialogDescription>Create relationships between entities. Select one source and one or more targets.</DialogDescription>
      </DialogHeader>
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Source Entity</label>
          <Select value={linkSource} onChange={(e) => setLinkSource(e.target.value)}>
            <option value="">Select source entity...</option>
            {flatAssetList.map((a) => (<option key={a.id} value={a.id}>{'\u00A0'.repeat(a.depth * 2)}{a.depth > 0 ? '\u2514 ' : ''}{a.name} ({a.templateName})</option>))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Relationship Type</label>
          <div className="space-y-1">
            {ALL_RELATIONSHIP_TYPES.map((type) => (
              <label key={type} className={cn('flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors cursor-pointer', linkType === type ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50')}>
                <input type="radio" name="linkType" value={type} checked={linkType === type} onChange={() => setLinkType(type)} className="w-4 h-4 text-blue-600 border-slate-300 focus:ring-blue-500" />
                <span className="text-sm font-medium text-slate-700">{RELATIONSHIP_LABELS[type] || type}</span>
              </label>
            ))}
          </div>
          {linkType === 'CUSTOM' && <Input type="text" placeholder="Enter custom relationship label" value={linkCustomLabel} onChange={(e) => setLinkCustomLabel(e.target.value)} className="mt-2" />}
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Target Entities{linkTargets.length > 0 && <span className="ml-2 text-xs font-normal text-blue-600">({linkTargets.length} selected)</span>}</label>
          {linkTargets.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pb-1 max-h-24 overflow-y-auto">
              {linkTargets.map((tid) => {
                const asset = flatAssetList.find((a) => a.id === tid);
                return (
                  <span key={tid} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-xs font-medium text-blue-700">
                    {asset?.name ?? 'Unknown'}
                    <button type="button" onClick={() => setLinkTargets((prev) => prev.filter((id) => id !== tid))} className="ml-0.5 p-0.5 rounded hover:bg-blue-200 transition-colors">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <Input value={linkTargetSearch} onChange={(e) => setLinkTargetSearch(e.target.value)} placeholder="Search entities..." className="text-sm" />
          <div className="max-h-48 overflow-y-auto rounded-xl border-2 border-slate-200 bg-white divide-y divide-slate-100">
            {flatAssetList.filter((a) => a.id !== linkSource).filter((a) => !linkTargetSearch || a.name.toLowerCase().includes(linkTargetSearch.toLowerCase()) || a.templateName.toLowerCase().includes(linkTargetSearch.toLowerCase())).map((a) => {
              const isChecked = linkTargets.includes(a.id);
              const isParentNode = a.childCount > 0 && linkType === 'CONTAINS';
              return (
                <label key={a.id} className={cn('flex items-center gap-3 px-3 py-2 transition-colors', isParentNode ? 'opacity-50 cursor-not-allowed bg-slate-50' : 'cursor-pointer hover:bg-slate-50', isChecked && !isParentNode && 'bg-blue-50/60')} title={isParentNode ? 'Parent nodes with children cannot be a target of CONTAINS' : undefined}>
                  <input type="checkbox" checked={isChecked} disabled={isParentNode} onChange={() => { if (isParentNode) return; setLinkTargets((prev) => isChecked ? prev.filter((id) => id !== a.id) : [...prev, a.id]); }} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                  <span className={cn('text-sm', isParentNode ? 'text-slate-400' : 'text-slate-700')}>{'\u00A0'.repeat(a.depth * 2)}{a.depth > 0 ? '\u2514 ' : ''}{a.name}</span>
                  {isParentNode && <span className="text-xs text-amber-600 font-medium">Parent Node</span>}
                  <span className="text-xs text-slate-400 ml-auto">{a.templateName}</span>
                </label>
              );
            })}
          </div>
        </div>
        {linkSource && linkTargets.length > 0 && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1.5 max-h-32 overflow-y-auto">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider sticky top-0 bg-slate-50">Preview</p>
            {linkTargets.map((tid) => (
              <p key={tid} className="text-sm text-slate-700">
                <span className="font-medium">{flatAssetList.find((a) => a.id === linkSource)?.name ?? 'Source'}</span>
                {' '}<span className="text-blue-600 font-medium">---{RELATIONSHIP_LABELS[linkType] || linkType}---&gt;</span>{' '}
                <span className="font-medium">{flatAssetList.find((a) => a.id === tid)?.name ?? 'Target'}</span>
              </p>
            ))}
          </div>
        )}
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Notes (optional)</label>
          <textarea className="flex w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 hover:border-slate-300 transition-all duration-200 resize-none" rows={2} value={linkNotes} onChange={(e) => setLinkNotes(e.target.value)} placeholder="Add notes about this relationship..." />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={handleClose}>Cancel</Button>
        <Button onClick={() => onSubmit(linkSource, linkTargets, linkType, linkCustomLabel, linkNotes)} disabled={saving || !linkSource || linkTargets.length === 0 || linkTargets.includes(linkSource)}>
          {saving ? 'Linking...' : `Link ${linkTargets.length > 1 ? `${linkTargets.length} Entities` : 'Entities'}`}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
