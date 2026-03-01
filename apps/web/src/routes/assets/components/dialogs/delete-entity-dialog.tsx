import { Button } from '@/components/ui/button';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { AssetInstance } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  selectedAsset: AssetInstance | undefined;
  saving: boolean;
  onConfirm: () => void;
}

export function DeleteEntityDialog({ open, onClose, selectedAsset, saving, onConfirm }: Props) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-100">
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          Delete Entity
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Are you sure you want to delete <span className="font-semibold text-slate-800">{selectedAsset?.name}</span>?
        </p>
        {selectedAsset && (selectedAsset.sourceRelations?.length ?? 0) > 0 && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
            This entity has {selectedAsset.sourceRelations?.length} relationship(s) that will also be removed.
          </div>
        )}
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          This will also deactivate all child entities. This action cannot be easily undone.
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="destructive" onClick={onConfirm} disabled={saving}>{saving ? 'Deleting...' : 'Delete Entity'}</Button>
      </DialogFooter>
    </Dialog>
  );
}
