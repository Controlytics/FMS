import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';

interface Props {
  open: boolean;
  onClose: () => void;
  saving: boolean;
  onSubmit: (identifier: { identifierType: string; identifierValue: string; label: string; isPrimary: boolean }) => void;
}

export function AddIdentifierDialog({ open, onClose, saving, onSubmit }: Props) {
  const [newIdentifier, setNewIdentifier] = useState({ identifierType: 'MANUAL', identifierValue: '', label: '', isPrimary: false });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Add Identifier</DialogTitle>
        <DialogDescription>Attach a physical identifier to this entity</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Type</label>
          <Select value={newIdentifier.identifierType} onChange={(e) => setNewIdentifier((p) => ({ ...p, identifierType: e.target.value }))}>
            <option value="QR">QR Code</option>
            <option value="BARCODE">Barcode</option>
            <option value="RFID">RFID</option>
            <option value="NFC">NFC</option>
            <option value="MANUAL">Manual</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Value <span className="text-red-500">*</span></label>
          <Input type="text" value={newIdentifier.identifierValue} onChange={(e) => setNewIdentifier((p) => ({ ...p, identifierValue: e.target.value }))} placeholder="Scan or enter identifier value" autoFocus />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Label</label>
          <Input type="text" value={newIdentifier.label} onChange={(e) => setNewIdentifier((p) => ({ ...p, label: e.target.value }))} placeholder="e.g., Front Panel QR" />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={newIdentifier.isPrimary} onChange={(e) => setNewIdentifier((p) => ({ ...p, isPrimary: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
          <span className="text-sm text-slate-700 font-medium">Primary identifier</span>
        </label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSubmit(newIdentifier)} disabled={saving || !newIdentifier.identifierValue.trim()}>{saving ? 'Adding...' : 'Add Identifier'}</Button>
      </DialogFooter>
    </Dialog>
  );
}
