import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { AttributeForm, hasAttributeErrors } from '../attribute-form';
import type { AssetTemplate } from '../../types';

const ICON_MAP: Record<string, string> = {
  box: '\uD83D\uDCE6', server: '\uD83D\uDDA5\uFE0F', camera: '\uD83D\uDCF9',
  thermometer: '\uD83C\uDF21\uFE0F', building: '\uD83C\uDFE2', 'door-open': '\uD83D\uDEAA',
  truck: '\uD83D\uDE9B', wrench: '\uD83D\uDD27', shield: '\uD83D\uDEE1\uFE0F',
  monitor: '\uD83D\uDCFA', flask: '\uD83E\uDDEA', gauge: '\uD83D\uDCCA', zap: '\u26A1',
  cpu: '\uD83D\uDDA5\uFE0F', fan: '\uD83C\uDF00', droplet: '\uD83D\uDCA7',
  wind: '\uD83C\uDF2C\uFE0F', beaker: '\uD83E\uDDEA',
};
function getIcon(iconKey: string): string { return ICON_MAP[iconKey] || '\uD83D\uDCE6'; }

interface Props {
  open: boolean;
  onClose: () => void;
  templates: AssetTemplate[];
  flatAssetList: { id: string; name: string; depth: number; templateName: string; childCount: number }[];
  initialParentId?: string | null;
  saving: boolean;
  error: string;
  onSubmit: (templateId: string, asset: { name: string; description: string; status: string; parentId: string | null; attributes: Record<string, any> }) => void;
}

export function AddEntityWizard({ open, onClose, templates, flatAssetList, initialParentId, saving, error, onSubmit }: Props) {
  const [wizardStep, setWizardStep] = useState(1);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateSearch, setTemplateSearch] = useState('');
  const [newAsset, setNewAsset] = useState({
    name: '', description: '', status: 'Active', parentId: initialParentId ?? null as string | null, attributes: {} as Record<string, any>,
  });

  const { data: selectedTemplateDetail } = useSWR<AssetTemplate>(
    selectedTemplateId ? `/api/assets/templates/${selectedTemplateId}` : null,
  );

  // Reset when opening
  useEffect(() => {
    if (open) {
      setWizardStep(1);
      setSelectedTemplateId(null);
      setTemplateSearch('');
      setNewAsset({ name: '', description: '', status: 'Active', parentId: initialParentId ?? null, attributes: {} });
    }
  }, [open, initialParentId]);

  // Initialize attributes from template defaults
  useEffect(() => {
    if (selectedTemplateDetail && open) {
      const defaults: Record<string, any> = {};
      for (const attr of selectedTemplateDetail.attributeSchema ?? []) {
        if (attr.defaultValue !== undefined && attr.defaultValue !== null) {
          defaults[attr.fieldName] = attr.defaultValue;
        } else if (attr.dataType === 'BOOLEAN') {
          defaults[attr.fieldName] = false;
        }
      }
      setNewAsset((prev) => ({ ...prev, attributes: defaults }));
    }
  }, [selectedTemplateDetail, open]);

  const handleClose = () => { onClose(); };

  return (
    <Dialog open={open} onClose={handleClose} className="max-w-3xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Add New Entity</DialogTitle>
        <DialogDescription>
          {wizardStep === 1 && 'Step 1: Select a template for your new entity'}
          {wizardStep === 2 && 'Step 2: Enter basic information'}
          {wizardStep === 3 && 'Step 3: Fill in attribute values'}
          {wizardStep === 4 && 'Step 4: Review and create'}
        </DialogDescription>
      </DialogHeader>

      {/* Step Indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3, 4].map((step) => (
          <div key={step} className="flex items-center gap-2">
            <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors', wizardStep === step ? 'bg-blue-600 text-white' : wizardStep > step ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400')}>
              {wizardStep > step ? (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>) : step}
            </div>
            {step < 4 && <div className={cn('w-12 h-0.5', wizardStep > step ? 'bg-emerald-500' : 'bg-slate-200')} />}
          </div>
        ))}
      </div>

      {/* Step 1: Select Template */}
      {wizardStep === 1 && (
        <div className="space-y-4">
          <Input type="text" placeholder="Search templates..." value={templateSearch} onChange={(e) => setTemplateSearch(e.target.value)} className="h-9 text-sm" />
          <div className="grid grid-cols-2 gap-3 max-h-[40vh] overflow-y-auto">
            {templates.filter((t) => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase())).map((t) => (
              <button key={t.id} className={cn('text-left p-4 rounded-xl border-2 transition-all duration-200', selectedTemplateId === t.id ? 'border-blue-500 bg-blue-50 shadow-md' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50')} onClick={() => setSelectedTemplateId(t.id)}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{getIcon(t.icon)}</span>
                  <div><p className="font-semibold text-slate-800 text-sm">{t.name}</p></div>
                </div>
                {t.description && <p className="text-xs text-slate-500 line-clamp-2">{t.description}</p>}
                <p className="text-xs text-slate-400 mt-2">{(t.attributeSchema as any)?.length ?? 0} attributes</p>
              </button>
            ))}
            {templates.filter((t) => !templateSearch || t.name.toLowerCase().includes(templateSearch.toLowerCase())).length === 0 && (
              <div className="col-span-2 text-center py-8 text-slate-400 text-sm">No templates found. Create one in the Template Manager first.</div>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Basic Info */}
      {wizardStep === 2 && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Entity Name <span className="text-red-500">*</span></label>
            <Input type="text" value={newAsset.name} onChange={(e) => setNewAsset((p) => ({ ...p, name: e.target.value }))} placeholder="Enter entity name" autoFocus />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Description</label>
            <textarea className="flex w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 hover:border-slate-300 transition-all duration-200 resize-none" rows={3} value={newAsset.description} onChange={(e) => setNewAsset((p) => ({ ...p, description: e.target.value }))} placeholder="Describe this entity..." />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-slate-700">Parent Entity</label>
            <Select value={newAsset.parentId ?? ''} onChange={(e) => setNewAsset((p) => ({ ...p, parentId: e.target.value || null }))}>
              <option value="">None (root level)</option>
              {flatAssetList.map((a) => (<option key={a.id} value={a.id}>{'\u00A0'.repeat(a.depth * 2)}{a.depth > 0 ? '\u2514 ' : ''}{a.name} ({a.templateName})</option>))}
            </Select>
          </div>
        </div>
      )}

      {/* Step 3: Attributes */}
      {wizardStep === 3 && (
        <div className="max-h-[50vh] overflow-y-auto pr-1">
          {selectedTemplateDetail ? (
            <AttributeForm attrSchema={selectedTemplateDetail.attributeSchema ?? []} values={newAsset.attributes} onChange={(field, value) => setNewAsset((p) => ({ ...p, attributes: { ...p.attributes, [field]: value } }))} />
          ) : (
            <div className="flex items-center justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent" /></div>
          )}
        </div>
      )}

      {/* Step 4: Review */}
      {wizardStep === 4 && (
        <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{selectedTemplateDetail ? getIcon(selectedTemplateDetail.icon) : ''}</span>
                <div>
                  <p className="font-semibold text-slate-800">{newAsset.name}</p>
                  <Badge variant="secondary" className="text-xs">{selectedTemplateDetail?.name}</Badge>
                </div>
              </div>
              {newAsset.description && <p className="text-sm text-slate-600">{newAsset.description}</p>}
              <div className="text-sm">
                <span className="text-slate-500">Parent:</span>{' '}
                <span className="font-medium">{newAsset.parentId ? flatAssetList.find((a) => a.id === newAsset.parentId)?.name ?? 'Unknown' : 'None'}</span>
              </div>
              {Object.keys(newAsset.attributes).length > 0 && selectedTemplateDetail && (
                <div className="border-t border-slate-100 pt-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Attributes</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {(selectedTemplateDetail.attributeSchema ?? []).map((attr) => {
                      const val = newAsset.attributes[attr.fieldName];
                      if (val === undefined || val === null || val === '') return null;
                      let display: string;
                      const c = attr.numericConstraints;
                      switch (attr.dataType) {
                        case 'BOOLEAN': display = val ? 'Yes' : 'No'; break;
                        case 'FLOAT':
                          if (typeof val === 'number' && Number.isInteger(val)) {
                            const precision = c?.enabled && c.resolution ? Math.max(1, Math.max(0, -Math.floor(Math.log10(c.resolution)))) : 1;
                            display = val.toFixed(precision);
                          } else { display = String(val); }
                          break;
                        default: display = String(val);
                      }
                      return (
                        <div key={attr.fieldName}>
                          <span className="text-slate-500">{attr.fieldName}:</span>{' '}
                          <span className="font-medium text-slate-800">{display}</span>
                          {attr.unit && <span className="text-xs text-slate-400 ml-1">{attr.unit}</span>}
                          <Badge variant="outline" className="text-[10px] ml-1.5 px-1 py-0">{attr.dataType}</Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {error && <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      <DialogFooter className="mt-6">
        <Button variant="outline" onClick={() => { if (wizardStep === 1) handleClose(); else setWizardStep((s) => s - 1); }}>
          {wizardStep === 1 ? 'Cancel' : 'Previous'}
        </Button>
        {wizardStep < 4 ? (
          <Button onClick={() => setWizardStep((s) => s + 1)} disabled={(wizardStep === 1 && !selectedTemplateId) || (wizardStep === 2 && !newAsset.name.trim()) || (wizardStep === 3 && selectedTemplateDetail && hasAttributeErrors(selectedTemplateDetail.attributeSchema ?? [], newAsset.attributes))}>Next</Button>
        ) : (
          <Button onClick={() => onSubmit(selectedTemplateId!, newAsset)} disabled={saving}>{saving ? 'Creating...' : 'Create Entity'}</Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
