import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createNodeSchema, type CreateNodeInput } from '@digilog/shared';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';

export function NodeCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const parentId = searchParams.get('parentId');
  const [error, setError] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  const { data: templates } = useSWR('/api/templates?status=active');
  const selectedTemplate = templates?.find((t: any) => t.id === selectedTemplateId);

  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<CreateNodeInput>({
    resolver: zodResolver(createNodeSchema),
    defaultValues: { parentId: parentId ?? undefined, attributes: {} },
  });

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates?.find((t: any) => t.id === templateId);
    if (template) {
      setValue('templateId', templateId);
      setValue('nodeType', template.nodeType);
    }
  };

  const onSubmit = async (data: CreateNodeInput) => {
    setError('');
    try {
      // Collect dynamic attribute values
      if (selectedTemplate) {
        const attrs: Record<string, unknown> = {};
        const schema = selectedTemplate.attributeSchema as Array<{ name: string }>;
        schema.forEach((field) => {
          const el = document.getElementById(`attr-${field.name}`) as HTMLInputElement;
          if (el?.value) attrs[field.name] = el.value;
        });
        data.attributes = attrs;
      }
      await apiClient.post('/api/hierarchy', data);
      navigate(parentId ? `/assets?parentId=${parentId}` : '/assets');
    } catch (err: any) {
      setError(err.message || 'Failed to create asset');
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Create New Asset</CardTitle>
        </CardHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

            {/* Step 1: Select template */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Template</label>
              <Select value={selectedTemplateId} onChange={(e) => handleTemplateSelect(e.target.value)}>
                <option value="">-- Choose a template --</option>
                {templates?.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.nodeType})</option>
                ))}
              </Select>
            </div>

            {/* Step 2: Fill in values */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Asset Name *</label>
              <Input {...register('name')} placeholder="e.g., Reactor R-201" />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Node Type</label>
              <Input {...register('nodeType')} placeholder="Auto-filled from template" />
              {errors.nodeType && <p className="text-sm text-destructive">{errors.nodeType.message}</p>}
            </div>

            <input type="hidden" {...register('parentId')} />
            <input type="hidden" {...register('templateId')} />

            {/* Dynamic attributes from template */}
            {selectedTemplate && (selectedTemplate.attributeSchema as Array<{ name: string; dataType: string; unit?: string; required?: boolean }>).length > 0 && (
              <div className="space-y-3 rounded-md border border-border p-4">
                <h3 className="text-sm font-semibold">Template Attributes</h3>
                {(selectedTemplate.attributeSchema as Array<{ name: string; dataType: string; unit?: string; required?: boolean }>).map((field) => (
                  <div key={field.name} className="space-y-1">
                    <label className="text-sm font-medium">
                      {field.name} {field.unit && `(${field.unit})`} {field.required && '*'}
                    </label>
                    <Input
                      id={`attr-${field.name}`}
                      type={field.dataType === 'number' ? 'number' : 'text'}
                      placeholder={`Enter ${field.name}`}
                    />
                  </div>
                ))}
              </div>
            )}

            {parentId && (
              <div className="text-sm text-muted-foreground">
                This asset will be created as a child of the selected parent node.
              </div>
            )}
          </CardContent>
          <CardFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create Asset'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
