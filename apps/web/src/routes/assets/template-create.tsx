import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createTemplateSchema, type CreateTemplateInput, FORWARD_RELATIONSHIP_TYPES, SCHEDULE_FREQUENCIES } from '@digilog/shared';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';

export function TemplateCreatePage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');

  const { register, handleSubmit, control, watch, setValue, formState: { errors, isSubmitting } } = useForm<CreateTemplateInput>({
    resolver: zodResolver(createTemplateSchema),
    defaultValues: {
      attributeSchema: [], telemetrySchema: [], checklistSchemas: [],
      expectedIdentifiers: [], expectedRelationships: [], defaultSchedules: [],
      statusLifecycle: ['active', 'maintenance', 'offline', 'decommissioned'],
    },
  });

  const { fields: attrFields, append: addAttr, remove: removeAttr } = useFieldArray({ control, name: 'attributeSchema' });
  const { fields: teleFields, append: addTele, remove: removeTele } = useFieldArray({ control, name: 'telemetrySchema' });
  const { fields: idFields, append: addId, remove: removeId } = useFieldArray({ control, name: 'expectedIdentifiers' as any });
  const { fields: relFields, append: addRel, remove: removeRel } = useFieldArray({ control, name: 'expectedRelationships' as any });

  const onSubmit = async (data: CreateTemplateInput) => {
    setError('');
    try {
      await apiClient.post('/api/templates', data);
      navigate('/assets/templates');
    } catch (err: any) {
      setError(err.message || 'Failed to create template');
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <form onSubmit={handleSubmit(onSubmit)}>
        {/* Basic Info */}
        <Card className="mb-4">
          <CardHeader><CardTitle>Basic Info</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Template Name *</label>
                <Input {...register('name')} placeholder="e.g., Reactor Template" />
                {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Node Type *</label>
                <Input {...register('nodeType')} placeholder="e.g., equipment, room" />
                {errors.nodeType && <p className="text-sm text-destructive">{errors.nodeType.message}</p>}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Input {...register('description')} placeholder="Optional description" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Icon URL</label>
              <Input {...register('iconUrl')} placeholder="Optional icon URL" />
            </div>
          </CardContent>
        </Card>

        {/* Attributes */}
        <Card className="mb-4">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Attributes</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={() => addAttr({ name: '', dataType: 'text', required: false })}>+ Add</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {attrFields.map((field, idx) => (
              <div key={field.id} className="flex gap-2 items-end">
                <Input className="flex-1" {...register(`attributeSchema.${idx}.name`)} placeholder="Field name" />
                <Select className="w-28" {...register(`attributeSchema.${idx}.dataType`)}>
                  <option value="text">Text</option><option value="number">Number</option>
                  <option value="date">Date</option><option value="boolean">Boolean</option>
                  <option value="dropdown">Dropdown</option>
                </Select>
                <Input className="w-20" {...register(`attributeSchema.${idx}.unit`)} placeholder="Unit" />
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" {...register(`attributeSchema.${idx}.required`)} />Req</label>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeAttr(idx)}>X</Button>
              </div>
            ))}
            {attrFields.length === 0 && <p className="text-sm text-muted-foreground">No attributes.</p>}
          </CardContent>
        </Card>

        {/* Telemetry */}
        <Card className="mb-4">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Telemetry Points</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={() => addTele({ name: '', dataType: 'number' })}>+ Add</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {teleFields.map((field, idx) => (
              <div key={field.id} className="flex gap-2 items-end">
                <Input className="flex-1" {...register(`telemetrySchema.${idx}.name`)} placeholder="Point name" />
                <Select className="w-28" {...register(`telemetrySchema.${idx}.dataType`)}>
                  <option value="number">Number</option><option value="boolean">Boolean</option><option value="text">Text</option>
                </Select>
                <Input className="w-20" {...register(`telemetrySchema.${idx}.unit`)} placeholder="Unit" />
                <Button type="button" variant="ghost" size="sm" onClick={() => removeTele(idx)}>X</Button>
              </div>
            ))}
            {teleFields.length === 0 && <p className="text-sm text-muted-foreground">No telemetry points.</p>}
          </CardContent>
        </Card>

        {/* Expected Identifiers */}
        <Card className="mb-4">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Expected Identifiers</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={() => addId({ type: 'QR', required: false } as any)}>+ Add</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {idFields.map((field, idx) => (
              <div key={field.id} className="flex gap-2 items-center">
                <Select className="w-32" {...register(`expectedIdentifiers.${idx}.type` as any)}>
                  <option value="QR">QR</option><option value="BARCODE">Barcode</option>
                  <option value="RFID">RFID</option><option value="NFC">NFC</option>
                </Select>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" {...register(`expectedIdentifiers.${idx}.required` as any)} />Required</label>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeId(idx)}>X</Button>
              </div>
            ))}
            {idFields.length === 0 && <p className="text-sm text-muted-foreground">No expected identifiers.</p>}
          </CardContent>
        </Card>

        {/* Expected Relationships */}
        <Card className="mb-4">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Expected Relationships</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={() => addRel({ type: 'CONTAINS', targetType: '' } as any)}>+ Add</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {relFields.map((field, idx) => (
              <div key={field.id} className="flex gap-2 items-end">
                <Select className="w-40" {...register(`expectedRelationships.${idx}.type` as any)}>
                  {FORWARD_RELATIONSHIP_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </Select>
                <Input className="flex-1" {...register(`expectedRelationships.${idx}.targetType` as any)} placeholder="Target type (optional)" />
                <Button type="button" variant="ghost" size="sm" onClick={() => removeRel(idx)}>X</Button>
              </div>
            ))}
            {relFields.length === 0 && <p className="text-sm text-muted-foreground">No expected relationships.</p>}
          </CardContent>
        </Card>

        {/* Status Lifecycle */}
        <Card className="mb-4">
          <CardHeader><CardTitle className="text-base">Status Lifecycle</CardTitle></CardHeader>
          <CardContent>
            <Input {...register('statusLifecycle' as any)} defaultValue="active, maintenance, offline, decommissioned" placeholder="Comma-separated statuses" />
            <p className="text-xs text-muted-foreground mt-1">Comma-separated list of supported asset statuses.</p>
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => navigate('/assets/templates')}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Create Template'}
          </Button>
        </div>
      </form>
    </div>
  );
}
