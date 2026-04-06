import { useState, useEffect, useRef, useCallback } from 'react';
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
  // RFID: detected tag waiting for user to Continue or Remove
  const [rfidDetected, setRfidDetected] = useState<string | null>(null);
  const rfidBufferRef = useRef('');
  const rfidTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset when dialog closes or type changes
  useEffect(() => {
    if (!open) {
      setNewIdentifier({ identifierType: 'MANUAL', identifierValue: '', label: '', isPrimary: false });
      setRfidDetected(null);
      rfidBufferRef.current = '';
    }
  }, [open]);

  useEffect(() => {
    setRfidDetected(null);
    setNewIdentifier(p => ({ ...p, identifierValue: '' }));
    rfidBufferRef.current = '';
  }, [newIdentifier.identifierType]);

  // RFID input handler: captures rapid input, detects completion after 300ms pause
  const handleRfidInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (rfidDetected) return; // already have a tag, ignore further input

    const val = e.target.value;
    rfidBufferRef.current = val;

    // After 300ms of no new input, tag scan is complete
    if (rfidTimerRef.current) clearTimeout(rfidTimerRef.current);
    rfidTimerRef.current = setTimeout(() => {
      const tag = rfidBufferRef.current.trim().toUpperCase();
      if (tag.length >= 3) {
        setRfidDetected(tag);
      }
    }, 300);

    setNewIdentifier(p => ({ ...p, identifierValue: val }));
  }, [rfidDetected]);

  const handleRfidContinue = () => {
    if (rfidDetected) {
      setNewIdentifier(p => ({ ...p, identifierValue: rfidDetected }));
      // Keep rfidDetected set — this locks the input
    }
  };

  const handleRfidRemove = () => {
    setRfidDetected(null);
    setNewIdentifier(p => ({ ...p, identifierValue: '' }));
    rfidBufferRef.current = '';
  };

  const isRfid = newIdentifier.identifierType === 'RFID';
  const rfidAccepted = isRfid && rfidDetected && newIdentifier.identifierValue === rfidDetected;

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

        {/* Value field — different for RFID vs others */}
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Value <span className="text-red-500">*</span></label>

          {isRfid ? (
            <>
              {/* RFID: show detected tag card or scan input */}
              {rfidDetected ? (
                <div className="p-3 border-2 border-purple-300 bg-purple-50 rounded-xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-purple-500 font-medium">Tag Detected</p>
                      <p className="text-base font-mono font-bold text-purple-800 mt-0.5">{rfidDetected}</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={handleRfidRemove}
                        className="px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50">
                        Remove
                      </button>
                      {!rfidAccepted && (
                        <button type="button" onClick={handleRfidContinue}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700">
                          Continue
                        </button>
                      )}
                    </div>
                  </div>
                  {rfidAccepted && (
                    <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      Accepted — click "Add Identifier" to save
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={newIdentifier.identifierValue}
                    onChange={handleRfidInput}
                    placeholder="Scan RFID tag or type tag ID..."
                    className="w-full px-4 py-3 border-2 border-purple-300 bg-purple-50 rounded-xl text-sm font-mono text-purple-800 placeholder:text-purple-300 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-200"
                    data-rfid="true"
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p className="text-xs text-slate-400">Hold RFID tag near the reader. Tag ID will appear automatically.</p>
                </>
              )}
            </>
          ) : (
            <Input
              type="text"
              value={newIdentifier.identifierValue}
              onChange={(e) => setNewIdentifier((p) => ({ ...p, identifierValue: e.target.value }))}
              placeholder="Scan or enter identifier value"
              autoFocus
            />
          )}
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
        <Button onClick={() => onSubmit(newIdentifier)} disabled={saving || !newIdentifier.identifierValue.trim() || (isRfid && !rfidAccepted)}>{saving ? 'Adding...' : 'Add Identifier'}</Button>
      </DialogFooter>
    </Dialog>
  );
}
