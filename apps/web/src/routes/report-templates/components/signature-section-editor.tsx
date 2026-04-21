import { Plus, Trash2 } from 'lucide-react';
import type { SignatureSection, SignatureConfig, SignerDef } from './template-types';

interface Props {
  section: SignatureSection;
  onChange: (updated: SignatureSection) => void;
  signatureConfig: SignatureConfig;
  onSignatureConfigChange: (sc: SignatureConfig) => void;
}

export function SignatureSectionEditor({ section, onChange, signatureConfig, onSignatureConfigChange }: Props) {
  const addSigner = () => {
    const newSigner: SignerDef = { role: `signer_${signatureConfig.signers.length + 1}`, label: '', required: true };
    onSignatureConfigChange({
      ...signatureConfig,
      signers: [...signatureConfig.signers, newSigner],
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Block Label</label>
        <input value={section.label} onChange={e => onChange({ ...section, label: e.target.value })}
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none" placeholder="Electronic Signature" />
      </div>

      {/* Signature config (shared across template) */}
      <div className="border-t border-slate-100 pt-4">
        <label className="text-sm font-semibold text-slate-700">Signature Configuration</label>
        <p className="text-xs text-slate-400 mb-3">These settings apply to the entire template</p>

        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer mb-3">
          <input type="checkbox" checked={signatureConfig.required}
            onChange={e => onSignatureConfigChange({ ...signatureConfig, required: e.target.checked })}
            className="rounded" />
          Signatures required for this report
        </label>

        <div className="mb-3">
          <label className="text-xs font-medium text-slate-500">Signature Meaning</label>
          <textarea value={signatureConfig.meaning}
            onChange={e => onSignatureConfigChange({ ...signatureConfig, meaning: e.target.value })}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none resize-none" rows={2}
            placeholder="I have reviewed and approve this report" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-slate-500">Signers ({signatureConfig.signers.length})</label>
            <button onClick={addSigner}
              className="flex items-center gap-1 text-xs font-medium hover:text-blue-500 text-theme-primary">
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          <div className="space-y-2">
            {signatureConfig.signers.map((signer, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
                <div className="flex-1 grid grid-cols-2 gap-1.5">
                  <input value={signer.role} placeholder="Role key"
                    onChange={e => {
                      const signers = [...signatureConfig.signers];
                      signers[idx] = { ...signer, role: e.target.value };
                      onSignatureConfigChange({ ...signatureConfig, signers });
                    }}
                    className="border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono outline-none bg-white" />
                  <input value={signer.label} placeholder="Display label"
                    onChange={e => {
                      const signers = [...signatureConfig.signers];
                      signers[idx] = { ...signer, label: e.target.value };
                      onSignatureConfigChange({ ...signatureConfig, signers });
                    }}
                    className="border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none bg-white" />
                </div>
                <label className="flex items-center gap-1 text-xs text-slate-500 cursor-pointer whitespace-nowrap">
                  <input type="checkbox" checked={signer.required}
                    onChange={e => {
                      const signers = [...signatureConfig.signers];
                      signers[idx] = { ...signer, required: e.target.checked };
                      onSignatureConfigChange({ ...signatureConfig, signers });
                    }}
                    className="rounded" />
                  Req
                </label>
                <button onClick={() => onSignatureConfigChange({ ...signatureConfig, signers: signatureConfig.signers.filter((_, i) => i !== idx) })}
                  className="p-0.5 text-slate-300 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Update section signers list to match config */}
        <div className="mt-3">
          <label className="text-xs font-medium text-slate-500">Signers in this block</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {signatureConfig.signers.map(signer => (
              <label key={signer.role} className="flex items-center gap-1 text-xs text-slate-600 cursor-pointer bg-slate-50 px-2 py-1 rounded-lg">
                <input type="checkbox" checked={section.signers.includes(signer.role)}
                  onChange={e => {
                    const signers = e.target.checked
                      ? [...section.signers, signer.role]
                      : section.signers.filter(r => r !== signer.role);
                    onChange({ ...section, signers });
                  }}
                  className="rounded" />
                {signer.label || signer.role}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
