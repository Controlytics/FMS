import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const STEPS = [
  'Select Template',
  'Basic Info',
  'Attributes',
  'Telemetry Config',
  'Register Identifiers',
  'Set Schedule',
  'Review & Create',
] as const;

export function NodeCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const parentId = searchParams.get('parentId');
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [name, setName] = useState('');
  const [nodeType, setNodeType] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('active');
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [identifiers, setIdentifiers] = useState<Array<{ type: string; value: string }>>([]);

  const { data: templates } = useSWR('/api/templates?status=active');
  const selectedTemplate = templates?.find((t: any) => t.id === selectedTemplateId);

  const attrSchema = (selectedTemplate?.attributeSchema ?? []) as Array<{ name: string; dataType: string; unit?: string; required?: boolean }>;
  const teleSchema = (selectedTemplate?.telemetrySchema ?? []) as Array<{ name: string; unit?: string; dataType: string }>;
  const expectedIds = (selectedTemplate?.expectedIdentifiers ?? []) as Array<{ type: string; required: boolean }>;

  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates?.find((t: any) => t.id === templateId);
    if (template) {
      setNodeType(template.nodeType);
      // Initialize identifiers from expected
      const expIds = (template.expectedIdentifiers ?? []) as Array<{ type: string }>;
      setIdentifiers(expIds.map(e => ({ type: e.type, value: '' })));
    }
  };

  const canNext = () => {
    if (step === 0) return !!selectedTemplateId;
    if (step === 1) return !!name.trim() && !!nodeType.trim();
    return true;
  };

  const handleCreate = async () => {
    setError('');
    setSubmitting(true);
    try {
      // Create the node
      const nodeData = {
        parentId: parentId ?? null,
        name,
        nodeType,
        templateId: selectedTemplateId || undefined,
        attributes,
        status,
      };
      const node = await apiClient.post<any>('/api/hierarchy', nodeData);

      // Register identifiers
      for (const id of identifiers) {
        if (id.value.trim()) {
          await apiClient.post(`/api/hierarchy/${node.id}/identifiers`, { type: id.type, value: id.value });
        }
      }

      navigate(parentId ? `/assets?parentId=${parentId}` : '/assets');
    } catch (err: any) {
      setError(err.message || 'Failed to create asset');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Create New Asset</CardTitle>
          {/* Step indicator */}
          <div className="flex gap-1 mt-2">
            {STEPS.map((s, i) => (
              <div key={s} className={`flex-1 h-1 rounded ${i <= step ? 'bg-primary' : 'bg-border'}`} />
            ))}
          </div>
          <p className="text-sm text-muted-foreground mt-1">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

          {/* Step 1: Select Template */}
          {step === 0 && (
            <div className="space-y-3">
              <label className="text-sm font-medium">Select a Template</label>
              <div className="grid grid-cols-2 gap-3">
                {templates?.map((t: any) => (
                  <button key={t.id} type="button"
                    className={`text-left rounded-lg border p-3 transition-all ${selectedTemplateId === t.id ? 'border-primary bg-primary/5 ring-2 ring-primary' : 'border-border hover:border-primary/50'}`}
                    onClick={() => handleSelectTemplate(t.id)}>
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center text-sm font-bold">
                        {t.nodeType.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{t.name}</p>
                        <p className="text-xs text-muted-foreground">{t.nodeType}</p>
                      </div>
                    </div>
                    {t.description && <p className="text-xs text-muted-foreground mt-1">{t.description}</p>}
                  </button>
                ))}
              </div>
              {(!templates || templates.length === 0) && (
                <p className="text-sm text-muted-foreground">No templates available. Create a template first.</p>
              )}
            </div>
          )}

          {/* Step 2: Basic Info */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Asset Name *</label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Reactor R-201" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Node Type</label>
                <Input value={nodeType} onChange={e => setNodeType(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <Select value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="active">Active</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </div>
              {parentId && <p className="text-xs text-muted-foreground">Will be created as a child of the selected parent node.</p>}
            </div>
          )}

          {/* Step 3: Attributes */}
          {step === 2 && (
            <div className="space-y-3">
              {attrSchema.length > 0 ? (
                attrSchema.map(field => (
                  <div key={field.name} className="space-y-1">
                    <label className="text-sm font-medium">
                      {field.name} {field.unit && `(${field.unit})`} {field.required && <span className="text-destructive">*</span>}
                    </label>
                    <Input
                      type={field.dataType === 'number' ? 'number' : 'text'}
                      value={attributes[field.name] ?? ''}
                      onChange={e => setAttributes(prev => ({ ...prev, [field.name]: e.target.value }))}
                      placeholder={`Enter ${field.name}`}
                    />
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No attributes defined in the template. You can skip this step.</p>
              )}
            </div>
          )}

          {/* Step 4: Telemetry Config */}
          {step === 3 && (
            <div className="space-y-3">
              {teleSchema.length > 0 ? (
                <>
                  <p className="text-sm text-muted-foreground">Review telemetry points from the template:</p>
                  {teleSchema.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 rounded border border-border p-2">
                      <Badge variant="outline">{t.dataType}</Badge>
                      <span className="text-sm font-medium">{t.name}</span>
                      {t.unit && <span className="text-xs text-muted-foreground">({t.unit})</span>}
                    </div>
                  ))}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No telemetry points defined. You can skip this step.</p>
              )}
            </div>
          )}

          {/* Step 5: Register Identifiers */}
          {step === 4 && (
            <div className="space-y-3">
              {identifiers.map((id, idx) => (
                <div key={idx} className="flex gap-2 items-end">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">{id.type}</label>
                    <Select value={id.type} onChange={e => {
                      const updated = [...identifiers];
                      updated[idx] = { ...updated[idx], type: e.target.value };
                      setIdentifiers(updated);
                    }}>
                      <option value="QR">QR</option><option value="BARCODE">Barcode</option>
                      <option value="RFID">RFID</option><option value="NFC">NFC</option>
                      <option value="MANUAL">Manual</option>
                    </Select>
                  </div>
                  <Input className="flex-1" value={id.value} onChange={e => {
                    const updated = [...identifiers];
                    updated[idx] = { ...updated[idx], value: e.target.value };
                    setIdentifiers(updated);
                  }} placeholder={`Enter ${id.type} code`} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setIdentifiers(identifiers.filter((_, i) => i !== idx))}>X</Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setIdentifiers([...identifiers, { type: 'QR', value: '' }])}>+ Add Identifier</Button>
            </div>
          )}

          {/* Step 6: Set Schedule */}
          {step === 5 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Schedules can be configured after asset creation by attaching checklists and setting up recurring schedules from the asset detail page.
              </p>
            </div>
          )}

          {/* Step 7: Review & Create */}
          {step === 6 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Review Summary</h3>
              <div className="rounded border border-border p-3 space-y-2 text-sm">
                <div><strong>Template:</strong> {selectedTemplate?.name ?? 'None'}</div>
                <div><strong>Name:</strong> {name}</div>
                <div><strong>Type:</strong> {nodeType}</div>
                <div><strong>Status:</strong> {status}</div>
                {Object.keys(attributes).length > 0 && (
                  <div>
                    <strong>Attributes:</strong>
                    <ul className="list-disc list-inside ml-2">
                      {Object.entries(attributes).filter(([, v]) => v).map(([k, v]) => <li key={k}>{k}: {v}</li>)}
                    </ul>
                  </div>
                )}
                {identifiers.filter(id => id.value).length > 0 && (
                  <div>
                    <strong>Identifiers:</strong>
                    <ul className="list-disc list-inside ml-2">
                      {identifiers.filter(id => id.value).map((id, i) => <li key={i}>{id.type}: {id.value}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="gap-2">
          {step > 0 && (
            <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>Back</Button>
          )}
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
          <div className="flex-1" />
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canNext()}>
              Next
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting ? 'Creating...' : 'Create Asset'}
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
