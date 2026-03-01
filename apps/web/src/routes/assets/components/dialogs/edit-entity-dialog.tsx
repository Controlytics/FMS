import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { AttributeForm, hasAttributeErrors } from '../attribute-form';
import type { AssetInstance } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  selectedAsset: AssetInstance | undefined;
  editAsset: { name: string; description: string; status: string; parentId: string | null; attributes: Record<string, any> };
  setEditAsset: React.Dispatch<React.SetStateAction<{ name: string; description: string; status: string; parentId: string | null; attributes: Record<string, any> }>>;
  flatAssetList: { id: string; name: string; depth: number; templateName: string; childCount: number }[];
  selectedAssetId: string | null;
  saving: boolean;
  onSubmit: () => void;
}

export function EditEntityDialog({ open, onClose, selectedAsset, editAsset, setEditAsset, flatAssetList, selectedAssetId, saving, onSubmit }: Props) {
  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Edit Entity</DialogTitle>
        <DialogDescription>Update entity information and attribute values</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Entity Name <span className="text-red-500">*</span></label>
          <Input type="text" value={editAsset.name} onChange={(e) => setEditAsset((p) => ({ ...p, name: e.target.value }))} placeholder="Enter entity name" autoFocus />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Description</label>
          <textarea className="flex w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 hover:border-slate-300 transition-all duration-200 resize-none" rows={3} value={editAsset.description} onChange={(e) => setEditAsset((p) => ({ ...p, description: e.target.value }))} placeholder="Describe this entity..." />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Parent Entity</label>
          <Select value={editAsset.parentId ?? ''} onChange={(e) => setEditAsset((p) => ({ ...p, parentId: e.target.value || null }))}>
            <option value="">None (root level)</option>
            {flatAssetList.filter((a) => a.id !== selectedAssetId).map((a) => (<option key={a.id} value={a.id}>{'\u00A0'.repeat(a.depth * 2)}{a.depth > 0 ? '\u2514 ' : ''}{a.name} ({a.templateName})</option>))}
          </Select>
        </div>
        {selectedAsset?.template?.attributeSchema && (
          <div className="border-t border-slate-100 pt-4">
            <p className="text-sm font-semibold text-slate-700 mb-3">Attributes</p>
            <div className="max-h-[30vh] overflow-y-auto pr-1">
              <AttributeForm attrSchema={(selectedAsset.template.attributeSchema as any) ?? []} values={editAsset.attributes} onChange={(field, value) => setEditAsset((p) => ({ ...p, attributes: { ...p.attributes, [field]: value } }))} />
            </div>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={onSubmit} disabled={saving || !editAsset.name.trim() || (selectedAsset?.template?.attributeSchema && hasAttributeErrors((selectedAsset.template.attributeSchema as any) ?? [], editAsset.attributes))}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
