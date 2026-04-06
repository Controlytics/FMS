import { useState, useRef, useCallback, useEffect } from 'react';

interface StageScanDialogProps {
  activeStage: {
    key: string;
    label: string;
    icon: string;
    color: string;
    border: string;
    needsBlock: boolean;
  } | null;
  step: 'block' | 'scan';
  blocks: any[];
  selectedBlock: any;
  scanValue: string;
  remarks: string;
  error: string;
  loading: boolean;
  onScanValueChange: (value: string) => void;
  onRemarksChange: (value: string) => void;
  onClearError: () => void;
  onBlockSelect: (block: any) => void;
  onChangeBlock: () => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function StageScanDialog({
  activeStage,
  step,
  blocks,
  selectedBlock,
  scanValue,
  remarks,
  error,
  loading,
  onScanValueChange,
  onRemarksChange,
  onClearError,
  onBlockSelect,
  onChangeBlock,
  onSubmit,
  onClose,
}: StageScanDialogProps) {
  // RFID: detected tag waiting for Continue/Remove
  const [rfidDetected, setRfidDetected] = useState<string | null>(null);
  const rfidTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset RFID state when dialog opens/closes
  useEffect(() => {
    if (!activeStage) {
      setRfidDetected(null);
    }
  }, [activeStage]);

  // Handle input — detect RFID burst (input stops for 300ms = one tag complete)
  const handleScanInput = useCallback((value: string) => {
    if (rfidDetected) return; // already have a tag, ignore

    onScanValueChange(value);
    onClearError();

    // After 300ms of no new input, tag is complete
    if (rfidTimerRef.current) clearTimeout(rfidTimerRef.current);
    rfidTimerRef.current = setTimeout(() => {
      const tag = value.trim();
      if (tag.length >= 3) {
        setRfidDetected(tag.toUpperCase());
        onScanValueChange(tag.toUpperCase());
      }
    }, 300);
  }, [rfidDetected, onScanValueChange, onClearError]);

  const handleContinue = () => {
    if (rfidDetected) {
      onScanValueChange(rfidDetected);
      onSubmit();
    }
  };

  const handleRemove = () => {
    setRfidDetected(null);
    onScanValueChange('');
    onClearError();
  };

  if (!activeStage) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className={`bg-gradient-to-r ${activeStage.color} px-6 py-4 flex items-center gap-3`}>
          <span className="text-3xl">{activeStage.icon}</span>
          <div>
            <h2 className="text-xl font-bold text-white">{activeStage.label}</h2>
            <p className="text-white/60 text-sm">
              {step === 'block' ? 'Step 1: Select Block' : selectedBlock ? `Block: ${selectedBlock.name}` : 'Scan filter to proceed'}
            </p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          {step === 'block' && (
            <>
              <div className="text-sm text-slate-500 mb-2">Select the block:</div>
              <div className="space-y-2">
                {blocks.length === 0 && <div className="text-center py-6 text-slate-400">No blocks found</div>}
                {blocks.map((block: any) => (
                  <button key={block.id} onClick={() => onBlockSelect(block)}
                    className="w-full text-left px-4 py-4 bg-slate-100 hover:bg-slate-100 border-2 border-transparent hover:border-cyan-600 rounded-xl transition-all">
                    <div className="text-slate-800 font-semibold">{block.name}</div>
                    {block.attributes?.grade && <div className="text-xs text-slate-500 mt-0.5">{block.attributes.grade}</div>}
                  </button>
                ))}
              </div>
              <button onClick={onClose} className="w-full py-3 bg-slate-100 text-slate-600 rounded-xl mt-2">Cancel</button>
            </>
          )}
          {step === 'scan' && (
            <>
              {selectedBlock && (
                <div className="flex items-center gap-2 px-3 py-2 bg-cyan-50 border border-cyan-200 rounded-xl text-sm">
                  <span className="text-cyan-700">{selectedBlock.name}</span>
                  <button onClick={onChangeBlock} className="ml-auto text-xs text-cyan-600">Change</button>
                </div>
              )}

              {/* Tag detected — show Continue / Remove */}
              {rfidDetected ? (
                <div className="p-4 border-2 border-purple-300 bg-purple-50 rounded-xl">
                  <p className="text-xs text-purple-500 font-medium mb-1">Tag Detected</p>
                  <p className="text-xl font-mono font-bold text-purple-800 text-center">{rfidDetected}</p>
                  <div className="flex gap-3 mt-4">
                    <button onClick={handleRemove}
                      className="flex-1 py-2.5 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-xl hover:bg-red-50">
                      Remove
                    </button>
                    <button onClick={handleContinue} disabled={loading}
                      className="flex-1 py-2.5 text-sm font-medium text-white bg-green-600 rounded-xl hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
                      {loading ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                          Continue
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-sm font-medium text-slate-500 mb-1 block">Scan or Enter Filter Identifier</label>
                    <input type="text"
                      className="w-full bg-slate-50 border-2 border-slate-300 rounded-xl px-4 py-4 text-slate-800 text-center font-mono text-xl placeholder:text-slate-300 focus:border-cyan-500 outline-none"
                      placeholder="Scan tag or type filter name"
                      value={scanValue}
                      onChange={e => handleScanInput(e.target.value)}
                      data-rfid="true"
                      autoFocus
                      autoComplete="off"
                      spellCheck={false} />
                  </div>
                  <p className="text-xs text-slate-400 text-center">Hold RFID tag near reader, or type filter name and press Submit</p>
                </>
              )}

              {/* Remarks — only show when no tag detected yet or manual mode */}
              {!rfidDetected && (
                <textarea className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2 text-slate-800 text-sm placeholder:text-slate-400" rows={2}
                  placeholder="Remarks (optional)" value={remarks} onChange={e => onRemarksChange(e.target.value)} />
              )}

              {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}

              {/* Manual submit — only when no RFID tag detected */}
              {!rfidDetected && (
                <div className="flex gap-3">
                  <button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl">Cancel</button>
                  <button onClick={onSubmit} disabled={loading || !scanValue.trim()}
                    className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold disabled:opacity-40 flex items-center justify-center gap-2 hover:bg-green-500 transition-colors">
                    {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> :
                      <><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Submit</>}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
