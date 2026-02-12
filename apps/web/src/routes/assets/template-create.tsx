import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createTemplateSchema, type CreateTemplateInput } from '@digilog/shared';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';

export function TemplateCreatePage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');

  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<CreateTemplateInput>({
    resolver: zodResolver(createTemplateSchema),
    defaultValues: { attributeSchema: [], telemetrySchema: [] },
  });

  const { fields: attrFields, append: addAttr, remove: removeAttr } = useFieldArray({ control, name: 'attributeSchema' });
  const { fields: teleFields, append: addTele, remove: removeTele } = useFieldArray({ control, name: 'telemetrySchema' });

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
      <Card>
        <CardHeader>
          <CardTitle>Create Asset Template</CardTitle>
        </CardHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-6">
            {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Template Name *</label>
                <Input {...register('name')} placeholder="e.g., Reactor Template" />
                {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Node Type *</label>
                <Input {...register('nodeType')} placeholder="e.g., building, room, equipment, sensor" />
                {errors.nodeType && <p className="text-sm text-destructive">{errors.nodeType.message}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Input {...register('description')} placeholder="Optional description" />
            </div>

            {/* Attributes */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Attributes (Static Metadata)</h3>
                <Button type="button" variant="outline" size="sm"
                  onClick={() => addAttr({ name: '', dataType: 'text', required: false })}>
                  + Add Attribute
                </Button>
              </div>
              {attrFields.map((field, idx) => (
                <div key={field.id} className="flex gap-2 items-end">
                  <div className="flex-1 space-y-1">
                    <Input {...register(`attributeSchema.${idx}.name`)} placeholder="Field name" />
                  </div>
                  <div className="w-32">
                    <Select {...register(`attributeSchema.${idx}.dataType`)}>
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="date">Date</option>
                      <option value="boolean">Boolean</option>
                      <option value="dropdown">Dropdown</option>
                    </Select>
                  </div>
                  <div className="w-24">
                    <Input {...register(`attributeSchema.${idx}.unit`)} placeholder="Unit" />
                  </div>
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" {...register(`attributeSchema.${idx}.required`)} />
                    Req
                  </label>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeAttr(idx)}>
                    X
                  </Button>
                </div>
              ))}
              {attrFields.length === 0 && (
                <p className="text-sm text-muted-foreground">No attributes defined. Click "+ Add Attribute" to start.</p>
              )}
            </div>

            {/* Telemetry */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Telemetry Points (Time-Series Data)</h3>
                <Button type="button" variant="outline" size="sm"
                  onClick={() => addTele({ name: '', dataType: 'number' })}>
                  + Add Telemetry
                </Button>
              </div>
              {teleFields.map((field, idx) => (
                <div key={field.id} className="flex gap-2 items-end">
                  <div className="flex-1 space-y-1">
                    <Input {...register(`telemetrySchema.${idx}.name`)} placeholder="Point name" />
                  </div>
                  <div className="w-32">
                    <Select {...register(`telemetrySchema.${idx}.dataType`)}>
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                      <option value="text">Text</option>
                    </Select>
                  </div>
                  <div className="w-24">
                    <Input {...register(`telemetrySchema.${idx}.unit`)} placeholder="Unit" />
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeTele(idx)}>
                    X
                  </Button>
                </div>
              ))}
              {teleFields.length === 0 && (
                <p className="text-sm text-muted-foreground">No telemetry defined. Click "+ Add Telemetry" to start.</p>
              )}
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => navigate('/assets/templates')}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Template'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
