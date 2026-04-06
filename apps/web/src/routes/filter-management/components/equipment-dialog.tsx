import { useState, useEffect } from 'react';

interface EquipmentDialogProps {
  dialog: {
    filterId: string;
    filterName: string;
    stage: { key: string; label: string; color: string };
    groups: any[];
    cycleEquipmentGroup?: any;
    block?: { id: string; name: string };
  } | null;
  onClose: () => void;
  onSubmit: (groupId: string, readings: Record<string, number>) => void;
  loading: boolean;
  error: string;
}

function generateReadingOptions(opMin: number, opMax: number, leastCount: number): number[] {
  const options: number[] = [];
  if (leastCount <= 0 || opMin >= opMax) return options;
  for (let v = opMin, i = 0; v <= opMax + 1e-9 && i < 10000; v = Math.round((v + leastCount) * 1e10) / 1e10, i++) {
    options.push(v);
  }
  return options;
}

export function EquipmentDialog({ dialog, onClose, onSubmit, loading, error }: EquipmentDialogProps) {
  const [selectedEquipmentGroup, setSelectedEquipmentGroup] = useState<any>(null);
  const [instrumentReadings, setInstrumentReadings] = useState<Record<string, number>>({});
  const [internalError, setInternalError] = useState('');

  // Reset internal state when dialog opens/closes
  useEffect(() => {
    if (dialog) {
      if (dialog.cycleEquipmentGroup) {
        setSelectedEquipmentGroup(dialog.cycleEquipmentGroup);
      } else {
        setSelectedEquipmentGroup(null);
      }
      setInstrumentReadings({});
      setInternalError('');
    }
  }, [dialog]);

  if (!dialog) return null;

  const displayError = error || internalError;

  const handleSubmit = () => {
    if (!selectedEquipmentGroup) {
      setInternalError('Please select an equipment group');
      return;
    }

    const stageInstruments = (selectedEquipmentGroup.instruments ?? []).filter((i: any) => i.stageKey === dialog.stage.key);
    for (const inst of stageInstruments) {
      if (instrumentReadings[inst.id] === undefined) {
        setInternalError(`Please select a value for ${inst.description}`);
        return;
      }
    }

    setInternalError('');
    onSubmit(selectedEquipmentGroup.id, instrumentReadings);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[55] p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <div className={`bg-gradient-to-r ${dialog.stage.key === 'DRY_IN' ? 'from-amber-600 to-amber-700' : 'from-sky-600 to-sky-700'} px-6 py-4 shrink-0`}>
          <h2 className="text-lg font-bold text-white">
            {dialog.stage.key === 'DRY_IN' ? 'Dryer Temperature Reading' : 'Equipment & Pressure Readings'}
          </h2>
          <p className="text-white/70 text-sm">{dialog.filterName} &rarr; {dialog.stage.label}</p>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Equipment Group Selection (for WASH_IN when groups available, skip for DRY_IN with pre-selected) */}
          {!dialog.cycleEquipmentGroup && (
            <>
              <div className="text-sm text-slate-500 mb-1">Select Equipment Group:</div>
              <div className="space-y-2">
                {dialog.groups.map((g: any) => (
                  <button key={g.id} onClick={() => { setSelectedEquipmentGroup(g); setInstrumentReadings({}); setInternalError(''); }}
                    className={`w-full text-left px-4 py-3 rounded-xl transition-all ${selectedEquipmentGroup?.id === g.id ? 'bg-cyan-50 border-2 border-cyan-500' : 'bg-slate-100 border-2 border-transparent hover:border-slate-300'}`}>
                    <div className="text-sm font-medium text-slate-800">{g.name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {g.instruments?.map((i: any) => i.instrumentId).join(', ')}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Instrument Readings */}
          {selectedEquipmentGroup && (
            <div className="space-y-4 mt-2">
              <div className="text-sm text-slate-500">
                {dialog.stage.key === 'DRY_IN' ? 'Record dryer temperature:' : 'Record pressure readings:'}
              </div>
              {(selectedEquipmentGroup.instruments ?? [])
                .filter((inst: any) => inst.stageKey === dialog.stage.key)
                .map((inst: any) => {
                  const options = generateReadingOptions(inst.operatingMin, inst.operatingMax, inst.leastCount);
                  return (
                    <div key={inst.id} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-medium text-slate-700">{inst.description}</span>
                          <span className="ml-2 text-xs text-slate-400 font-mono">{inst.instrumentId}</span>
                        </div>
                        <span className="text-xs text-slate-400">{inst.operatingMin}–{inst.operatingMax} {inst.uom}</span>
                      </div>
                      <select
                        value={instrumentReadings[inst.id] ?? ''}
                        onChange={e => setInstrumentReadings(prev => ({ ...prev, [inst.id]: Number(e.target.value) }))}
                        className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2.5 text-slate-800 text-sm focus:border-cyan-500 outline-none">
                        <option value="">Select value...</option>
                        {options.map((v) => (
                          <option key={v} value={v}>{v} {inst.uom}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
            </div>
          )}

          {displayError && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{displayError}</div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex gap-3 shrink-0">
          <button onClick={onClose}
            className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl">Cancel</button>
          <button onClick={handleSubmit} disabled={loading || !selectedEquipmentGroup}
            className={`flex-1 py-3 text-white rounded-xl font-bold disabled:opacity-40 flex items-center justify-center gap-2 transition-colors ${dialog.stage.key === 'DRY_IN' ? 'bg-amber-600 hover:bg-amber-500' : 'bg-cyan-600 hover:bg-cyan-500'}`}>
            {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> :
              <><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>Submit</>}
          </button>
        </div>
      </div>
    </div>
  );
}
