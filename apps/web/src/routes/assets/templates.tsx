import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useReauth } from '@/hooks/use-reauth';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { ReauthDialog } from '@/components/reauth-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Link } from 'react-router-dom';
import { apiClient } from '@/lib/api-client';
import { TemplateFormEditor } from './components/template-form-editor';
import { TemplateViewDialog } from './components/template-view-dialog';
import type { TemplateData, FormData } from './template-types';
import type { AuditRecord } from './types';
import {
  emptyForm,
  emptyAttribute,
  emptyIdentifier,
  emptyTelemetry,
  emptyAlarmRule,
  emptyChecklistItem,
} from './template-types';

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export function AssetTemplatesPage() {
  const { mutate } = useSWRConfig();
  const reauth = useReauth();
  const { formatDateTime } = useDatetimeFormat();

  // Data
  const { data: templatesRes, isLoading } = useSWR<{ data: TemplateData[] }>('/api/assets/templates?isActive=true');
  const templates = templatesRes?.data;

  // Dialog states
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateData | null>(null);
  const [viewTemplate, setViewTemplate] = useState<TemplateData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TemplateData | null>(null);

  // Audit history for viewed template
  const [viewAuditTab, setViewAuditTab] = useState(false);
  const { data: templateAuditData } = useSWR<{ data: AuditRecord[] }>(
    viewTemplate && viewAuditTab
      ? `/api/audit?targetType=asset_template&targetId=${viewTemplate.id}&limit=50`
      : null,
  );
  const templateAuditRecords = templateAuditData?.data ?? [];

  // Form state
  const [formData, setFormData] = useState<FormData>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Search
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounce search
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchTerm]);

  // Filtered templates
  const filteredTemplates = useMemo(() => {
    if (!templates) return [];
    return templates.filter((t) => {
      const matchesSearch =
        !debouncedSearch ||
        t.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        t.description?.toLowerCase().includes(debouncedSearch.toLowerCase());
      return matchesSearch;
    });
  }, [templates, debouncedSearch]);

  // -----------------------------------------------------------------------
  // Form helpers
  // -----------------------------------------------------------------------

  const resetForm = useCallback(() => {
    setFormData(emptyForm());
    setError('');
  }, []);

  const openCreateDialog = useCallback(() => {
    resetForm();
    setShowCreateDialog(true);
  }, [resetForm]);

  const openEditDialog = useCallback((template: TemplateData) => {
    setSelectedTemplate(template);
    setFormData({
      name: template.name,
      description: template.description || '',
      icon: template.icon || 'box',
      maxParentConnections: template.maxParentConnections ?? 1,
      maxConnections: template.maxConnections ?? 10,
      attributeSchema: (template.attributeSchema || []).map((a: any) => ({
        ...emptyAttribute(),
        fieldName: a.fieldName || '',
        dataType: a.dataType || 'TEXT',
        required: a.required || false,
        unit: a.unit || '',
        defaultValue: a.defaultValue != null ? String(a.defaultValue) : '',
        options: Array.isArray(a.dropdownOptions) ? a.dropdownOptions.join(', ') : (a.options || ''),
        enableConstraints: a.numericConstraints?.enabled || false,
        min: a.numericConstraints?.min ?? '',
        max: a.numericConstraints?.max ?? '',
        resolution: a.numericConstraints?.resolution ?? '',
      })),
      telemetrySchema: (template.telemetrySchema || []).map((t: any) => ({
        ...emptyTelemetry(),
        fieldName: t.fieldName || '',
        dataType: t.dataType || 'FLOAT',
        unit: t.unit || '',
        description: t.description || '',
      })),
      expectedIdentifiers: (template.expectedIdentifiers || []).map((i: any) => ({
        ...emptyIdentifier(),
        identifierType: i.identifierType || 'QR',
        label: i.label || '',
        required: i.required || false,
      })),
      alarmRules: (template.alarmRules || []).map((a: any) => ({
        ...emptyAlarmRule(),
        name: a.name || '',
        type: a.type || 'HIGH',
        severity: a.severity || 'ALARM',
        sourceField: a.sourceField || '',
        condition: a.condition || '',
        threshold: a.threshold ?? '',
        deadband: a.deadband ?? '',
        message: a.message || '',
        notifyRoles: Array.isArray(a.notifyRoles) ? a.notifyRoles.join(', ') : (a.notifyRoles || ''),
        enabled: a.enabled !== false,
      })),
      checklistSchema: (template.checklistSchema || []).map((c: any) => ({
        ...emptyChecklistItem(),
        question: c.question || '',
        questionType: c.questionType || 'PASS_FAIL',
        required: c.required || false,
        section: c.section || '',
        description: c.description || '',
        options: Array.isArray(c.options) ? c.options.join(', ') : (c.options || ''),
        passCriteria: c.passCriteria || '',
        numericUnit: c.numericUnit || '',
        numericMin: c.numericMin ?? '',
        numericMax: c.numericMax ?? '',
        calculatedExpression: c.calculatedExpression || '',
        conditionalField: c.conditionalField || '',
        conditionalValue: c.conditionalValue || '',
      })),
    });
    setError('');
    setShowEditDialog(true);
  }, []);

  const openDeleteDialog = useCallback((template: TemplateData) => {
    setDeleteTarget(template);
    setDeleteError('');
    setShowDeleteDialog(true);
  }, []);

  const openViewDialog = useCallback((template: TemplateData) => {
    setViewTemplate(template);
    setViewAuditTab(false);
    setShowViewDialog(true);
  }, []);

  // -----------------------------------------------------------------------
  // Attribute schema helpers
  // -----------------------------------------------------------------------

  const addAttribute = () => {
    setFormData((prev) => ({
      ...prev,
      attributeSchema: [...prev.attributeSchema, emptyAttribute()],
    }));
  };

  const updateAttribute = (index: number, field: string, value: unknown) => {
    setFormData((prev) => {
      const updated = [...prev.attributeSchema];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, attributeSchema: updated };
    });
  };

  const removeAttribute = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      attributeSchema: prev.attributeSchema.filter((_, i) => i !== index),
    }));
  };

  // -----------------------------------------------------------------------
  // Telemetry helpers
  // -----------------------------------------------------------------------

  const addTelemetry = () => {
    setFormData((prev) => ({
      ...prev,
      telemetrySchema: [...prev.telemetrySchema, emptyTelemetry()],
    }));
  };

  const updateTelemetry = (index: number, field: string, value: unknown) => {
    setFormData((prev) => {
      const updated = [...prev.telemetrySchema];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, telemetrySchema: updated };
    });
  };

  const removeTelemetry = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      telemetrySchema: prev.telemetrySchema.filter((_, i) => i !== index),
    }));
  };

  // -----------------------------------------------------------------------
  // Identifier helpers
  // -----------------------------------------------------------------------

  const addIdentifier = () => {
    setFormData((prev) => ({
      ...prev,
      expectedIdentifiers: [...prev.expectedIdentifiers, emptyIdentifier()],
    }));
  };

  const updateIdentifier = (index: number, field: string, value: unknown) => {
    setFormData((prev) => {
      const updated = [...prev.expectedIdentifiers];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, expectedIdentifiers: updated };
    });
  };

  const removeIdentifier = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      expectedIdentifiers: prev.expectedIdentifiers.filter((_, i) => i !== index),
    }));
  };

  // -----------------------------------------------------------------------
  // Alarm rule helpers
  // -----------------------------------------------------------------------

  const addAlarmRule = () => {
    setFormData((prev) => ({
      ...prev,
      alarmRules: [...prev.alarmRules, emptyAlarmRule()],
    }));
  };

  const updateAlarmRule = (index: number, field: string, value: unknown) => {
    setFormData((prev) => {
      const updated = [...prev.alarmRules];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, alarmRules: updated };
    });
  };

  const removeAlarmRule = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      alarmRules: prev.alarmRules.filter((_, i) => i !== index),
    }));
  };

  // -----------------------------------------------------------------------
  // Checklist helpers
  // -----------------------------------------------------------------------

  const addChecklistItem = () => {
    setFormData((prev) => ({
      ...prev,
      checklistSchema: [...prev.checklistSchema, emptyChecklistItem()],
    }));
  };

  const updateChecklistItem = (index: number, field: string, value: unknown) => {
    setFormData((prev) => {
      const updated = [...prev.checklistSchema];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, checklistSchema: updated };
    });
  };

  const removeChecklistItem = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      checklistSchema: prev.checklistSchema.filter((_, i) => i !== index),
    }));
  };

  // -----------------------------------------------------------------------
  // Build the body payload, stripping internal-only fields
  // -----------------------------------------------------------------------

  const buildBody = () => {
    return {
      name: formData.name.trim(),
      description: formData.description.trim(),
      icon: formData.icon,
      maxParentConnections: formData.maxParentConnections,
      maxConnections: formData.maxConnections,
      attributeSchema: formData.attributeSchema
        .filter((a) => a.fieldName.trim())
        .map(({ enableConstraints, min, max, resolution, options, ...rest }) => ({
          fieldName: rest.fieldName.trim(),
          dataType: rest.dataType,
          required: rest.required,
          ...(() => {
            const dv = rest.defaultValue;
            if (dv === '' || dv === undefined || dv === null) return {};
            if (rest.dataType === 'INTEGER') {
              const n = parseInt(String(dv), 10);
              return isNaN(n) ? {} : { defaultValue: n };
            }
            if (rest.dataType === 'FLOAT') {
              const n = parseFloat(String(dv));
              return isNaN(n) ? {} : { defaultValue: n };
            }
            if (rest.dataType === 'BOOLEAN') {
              return { defaultValue: String(dv) === 'true' };
            }
            const s = String(dv).trim();
            return s ? { defaultValue: s } : {};
          })(),
          ...(rest.unit.trim() ? { unit: rest.unit.trim() } : {}),
          ...(rest.dataType === 'DROPDOWN'
            ? { dropdownOptions: options ? options.split(',').map((o) => o.trim()).filter(Boolean) : [] }
            : {}),
          ...((rest.dataType === 'INTEGER' || rest.dataType === 'FLOAT') && enableConstraints
            ? {
                numericConstraints: {
                  enabled: true,
                  ...(typeof min === 'number' ? { min } : {}),
                  ...(typeof max === 'number' ? { max } : {}),
                  ...(typeof resolution === 'number' ? { resolution } : {}),
                },
              }
            : {}),
        })),
      telemetrySchema: formData.telemetrySchema
        .filter((t) => t.fieldName.trim())
        .map((t) => ({
          fieldName: t.fieldName.trim(),
          dataType: t.dataType,
          ...(t.unit.trim() ? { unit: t.unit.trim() } : {}),
          ...(t.description.trim() ? { description: t.description.trim() } : {}),
        })),
      expectedIdentifiers: formData.expectedIdentifiers
        .filter((i) => i.label.trim())
        .map((i) => ({ identifierType: i.identifierType, label: i.label.trim(), required: i.required })),
      alarmRules: formData.alarmRules
        .filter((a) => a.name.trim())
        .map(({ threshold, deadband, ...rest }) => ({
          name: rest.name.trim(),
          type: rest.type,
          severity: rest.severity,
          ...(rest.sourceField.trim() ? { sourceField: rest.sourceField.trim() } : {}),
          ...(rest.condition.trim() ? { condition: rest.condition.trim() } : {}),
          ...(typeof threshold === 'number' ? { threshold } : {}),
          ...(typeof deadband === 'number' ? { deadband } : {}),
          ...(rest.message.trim() ? { message: rest.message.trim() } : {}),
          notifyRoles: rest.notifyRoles ? rest.notifyRoles.split(',').map((r) => r.trim()).filter(Boolean) : [],
          enabled: rest.enabled,
        })),
      checklistSchema: formData.checklistSchema
        .filter((c) => c.question.trim())
        .map(({ numericMin, numericMax, options, ...rest }) => ({
          question: rest.question.trim(),
          questionType: rest.questionType,
          required: rest.required,
          ...(rest.section.trim() ? { section: rest.section.trim() } : {}),
          ...(rest.description.trim() ? { description: rest.description.trim() } : {}),
          ...(options.trim() ? { options: options.split(',').map((o) => o.trim()).filter(Boolean) } : { options: [] }),
          ...(rest.passCriteria.trim() ? { passCriteria: rest.passCriteria.trim() } : {}),
          ...(rest.numericUnit.trim() ? { numericUnit: rest.numericUnit.trim() } : {}),
          ...(typeof numericMin === 'number' ? { numericMin } : {}),
          ...(typeof numericMax === 'number' ? { numericMax } : {}),
          ...(rest.calculatedExpression.trim() ? { calculatedExpression: rest.calculatedExpression.trim() } : {}),
          ...(rest.conditionalField.trim() ? { conditionalField: rest.conditionalField.trim() } : {}),
          ...(rest.conditionalValue.trim() ? { conditionalValue: rest.conditionalValue.trim() } : {}),
        })),
    };
  };

  // -----------------------------------------------------------------------
  // Form-level validation
  // -----------------------------------------------------------------------

  const validateForm = (): string | null => {
    if (!formData.name.trim()) return 'Template name is required';

    // Validate attributes
    for (const attr of formData.attributeSchema) {
      if (!attr.fieldName.trim()) continue; // will be filtered out
      const dv = attr.defaultValue;

      // Check INTEGER default is valid integer
      if (attr.dataType === 'INTEGER' && dv !== '') {
        const n = Number(dv);
        if (isNaN(n) || !Number.isInteger(n)) return `Attribute "${attr.fieldName}": default value must be a whole number`;
        if (attr.enableConstraints) {
          if (typeof attr.min === 'number' && n < attr.min) return `Attribute "${attr.fieldName}": default value must be >= ${attr.min}`;
          if (typeof attr.max === 'number' && n > attr.max) return `Attribute "${attr.fieldName}": default value must be <= ${attr.max}`;
        }
      }
      // Check FLOAT default is valid number
      if (attr.dataType === 'FLOAT' && dv !== '') {
        const n = Number(dv);
        if (isNaN(n)) return `Attribute "${attr.fieldName}": default value must be a valid number`;
        if (attr.enableConstraints) {
          if (typeof attr.min === 'number' && n < attr.min) return `Attribute "${attr.fieldName}": default value must be >= ${attr.min}`;
          if (typeof attr.max === 'number' && n > attr.max) return `Attribute "${attr.fieldName}": default value must be <= ${attr.max}`;
        }
      }
      // Check URL default is valid
      if (attr.dataType === 'URL' && dv !== '') {
        try { new URL(dv); } catch { return `Attribute "${attr.fieldName}": default value must be a valid URL`; }
      }
      // Check DROPDOWN default is one of the options
      if (attr.dataType === 'DROPDOWN' && dv !== '') {
        const opts = attr.options ? attr.options.split(',').map(o => o.trim()).filter(Boolean) : [];
        if (opts.length > 0 && !opts.includes(dv)) return `Attribute "${attr.fieldName}": default value must be one of the dropdown options`;
      }
      // Validate numeric constraints logic
      if ((attr.dataType === 'INTEGER' || attr.dataType === 'FLOAT') && attr.enableConstraints) {
        if (typeof attr.min === 'number' && typeof attr.max === 'number' && attr.min >= attr.max) {
          return `Attribute "${attr.fieldName}": min must be less than max`;
        }
        if (typeof attr.resolution === 'number' && attr.resolution <= 0) {
          return `Attribute "${attr.fieldName}": resolution must be greater than 0`;
        }
        if (attr.dataType === 'INTEGER' && typeof attr.resolution === 'number' && !Number.isInteger(attr.resolution)) {
          return `Attribute "${attr.fieldName}": resolution must be a whole number for INTEGER type`;
        }
      }
    }

    // Validate telemetry
    for (const tel of formData.telemetrySchema) {
      if (!tel.fieldName.trim()) continue;
      // fieldName must not contain spaces or special characters
      if (!/^[a-zA-Z0-9_.-]+$/.test(tel.fieldName.trim())) {
        return `Telemetry "${tel.fieldName}": field name should only contain letters, numbers, underscore, dot, or hyphen`;
      }
    }

    return null;
  };

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------

  const handleCreate = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError('');

    try {
      const body = buildBody();

      await reauth.execute(
        'CREATE_ASSET_TEMPLATE',
        async (password?: string) => {
          if (password) {
            await apiClient.postWithReauth('/api/assets/templates', body, password);
          } else {
            await apiClient.post('/api/assets/templates', body);
          }
        },
        {
          onSuccess: () => {
            mutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/assets'));
            setShowCreateDialog(false);
            resetForm();
            setSaving(false);
          },
          onError: (err: unknown) => {
            const e = err as any;
            const msg = e?.message || e?.error || 'Failed to create template';
            setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
            setSaving(false);
          },
        },
      );
    } catch (e: unknown) {
      const err = e as any;
      setError(err?.message || String(err) || 'Unexpected error creating template');
      setSaving(false);
    }
  };

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  const handleUpdate = async () => {
    if (!selectedTemplate) return;
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError('');

    try {
      const body = buildBody();

      await reauth.execute(
        'UPDATE_ASSET_TEMPLATE',
        async (password?: string) => {
          if (password) {
            await apiClient.putWithReauth(`/api/assets/templates/${selectedTemplate.id}`, body, password);
          } else {
            await apiClient.put(`/api/assets/templates/${selectedTemplate.id}`, body);
          }
        },
        {
          onSuccess: () => {
            mutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/assets'));
            setShowEditDialog(false);
            setSelectedTemplate(null);
            setSaving(false);
          },
          onError: (err: unknown) => {
            const e = err as any;
            const msg = e?.message || e?.error || 'Failed to update template';
            setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
            setSaving(false);
          },
        },
      );
    } catch (e: unknown) {
      const err = e as any;
      setError(err?.message || String(err) || 'Unexpected error updating template');
      setSaving(false);
    }
  };

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');

    await reauth.execute(
      'DELETE_ASSET_TEMPLATE',
      async (password?: string) => {
        if (password) {
          await apiClient.deleteWithReauth(`/api/assets/templates/${deleteTarget.id}`, password);
        } else {
          await apiClient.delete(`/api/assets/templates/${deleteTarget.id}`);
        }
      },
      {
        onSuccess: () => {
          mutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/assets'));
          setShowDeleteDialog(false);
          setDeleteTarget(null);
          setDeleting(false);
        },
        onError: (err: any) => {
          setDeleteError(err.message || 'Failed to delete template');
          setDeleting(false);
        },
      },
    );
  };

  // -----------------------------------------------------------------------
  // Form change handler for the extracted TemplateFormEditor
  // -----------------------------------------------------------------------

  const handleFormChange = useCallback((updates: Partial<FormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  }, []);

  // Shared form editor props
  const formEditorProps = {
    formData,
    error,
    onFormChange: handleFormChange,
    onAddAttribute: addAttribute,
    onUpdateAttribute: updateAttribute,
    onRemoveAttribute: removeAttribute,
    onAddTelemetry: addTelemetry,
    onUpdateTelemetry: updateTelemetry,
    onRemoveTelemetry: removeTelemetry,
    onAddIdentifier: addIdentifier,
    onUpdateIdentifier: updateIdentifier,
    onRemoveIdentifier: removeIdentifier,
    onAddAlarmRule: addAlarmRule,
    onUpdateAlarmRule: updateAlarmRule,
    onRemoveAlarmRule: removeAlarmRule,
    onAddChecklistItem: addChecklistItem,
    onUpdateChecklistItem: updateChecklistItem,
    onRemoveChecklistItem: removeChecklistItem,
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 via-purple-600 to-indigo-600 p-6 text-white shadow-2xl">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0zNiAxOGMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNiIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMSkiIHN0cm9rZS13aWR0aD0iMiIvPjwvZz48L3N2Zz4=')] opacity-30" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/assets"
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-sm transition-all duration-200 border border-white/10"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="p-3 rounded-xl bg-white/20 backdrop-blur-sm shadow-lg">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Entity Templates</h1>
                  <p className="text-purple-100/80 text-sm">Manage reusable blueprints for entity types</p>
                </div>
              </div>
            </div>
          </div>
          <Button
            onClick={openCreateDialog}
            className="bg-white text-purple-600 hover:bg-purple-50 shadow-lg font-semibold"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Template
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="flex-1 relative">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search templates..."
            className="pl-10"
          />
        </div>
      </div>

      {/* Templates Table */}
      <Card className="border-0 shadow-xl overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-16 text-center">
              <svg className="w-8 h-8 animate-spin mx-auto mb-3 text-purple-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-slate-500">Loading templates...</p>
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="p-16 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-slate-700 mb-1">No templates found</h3>
              <p className="text-sm text-slate-500 mb-4">
                {debouncedSearch
                  ? 'Try adjusting your search criteria.'
                  : 'Get started by creating your first entity template.'}
              </p>
              {!debouncedSearch && (
                <Button onClick={openCreateDialog} className="bg-gradient-to-r from-purple-500 to-indigo-600">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create Template
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="font-semibold text-slate-600">Name</TableHead>
                  <TableHead className="font-semibold text-slate-600 text-center">Attributes</TableHead>
                  <TableHead className="font-semibold text-slate-600 text-center">Instances</TableHead>
                  <TableHead className="font-semibold text-slate-600 text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTemplates.map((template) => (
                  <TableRow key={template.id} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-purple-100 text-purple-600 flex-shrink-0">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" />
                          </svg>
                        </div>
                        <div>
                          <p className="font-semibold text-slate-800">{template.name}</p>
                          {template.description && (
                            <p className="text-xs text-slate-500 max-w-xs truncate">{template.description}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm font-medium text-slate-700">
                        {template.attributeSchema?.length || 0}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm font-medium text-slate-700">
                        {template._count?.instances ?? 0}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openViewDialog(template)}
                          className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                          title="View template details"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(template)}
                          className="text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                          title="Edit template"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openDeleteDialog(template)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          title="Delete template"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Info Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-purple-50 via-indigo-50 to-blue-50 border border-purple-100/50 p-5">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 p-3 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-lg shadow-purple-500/25">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-purple-900 mb-1">About Entity Templates</h3>
            <p className="text-sm text-purple-700">
              Templates define the blueprint for entity types, including attribute schemas,
              expected identifiers, and alarm rules. When you create an entity instance, it inherits the
              structure defined in its template. Templates can be versioned to track changes over time.
            </p>
          </div>
        </div>
      </div>

      {/* Create Template Dialog */}
      <Dialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)} className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-100 text-purple-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            Create New Template
          </DialogTitle>
        </DialogHeader>
        <TemplateFormEditor {...formEditorProps} />
        {error && <p className="text-sm text-red-600 text-right px-1 mt-2">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { setShowCreateDialog(false); setSaving(false); }}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={saving}
            className="bg-gradient-to-r from-purple-500 to-indigo-600"
          >
            {saving ? 'Creating...' : 'Create Template'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Edit Template Dialog */}
      <Dialog open={showEditDialog} onClose={() => { setShowEditDialog(false); setSelectedTemplate(null); setSaving(false); }} className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-100 text-purple-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            Edit Template: {selectedTemplate?.name}
          </DialogTitle>
        </DialogHeader>
        <TemplateFormEditor {...formEditorProps} />
        {error && <p className="text-sm text-red-600 text-right px-1 mt-2">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { setShowEditDialog(false); setSelectedTemplate(null); setSaving(false); }}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleUpdate}
            disabled={saving}
            className="bg-gradient-to-r from-purple-500 to-indigo-600"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onClose={() => setShowDeleteDialog(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-100 text-red-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            Delete Template
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {deleteError && (
            <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-200 p-4">
              <div className="p-2 rounded-lg bg-red-100">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm text-red-700">{deleteError}</p>
            </div>
          )}

          <p className="text-slate-600">
            Are you sure you want to delete the template{' '}
            <span className="font-semibold text-slate-800">{deleteTarget?.name}</span>?
          </p>

          {deleteTarget?._count?.instances && deleteTarget._count.instances > 0 ? (
            <div className="flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-200 p-4">
              <div className="p-2 rounded-lg bg-amber-100">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <p className="text-sm text-amber-700">
                This template has <strong>{deleteTarget._count.instances}</strong> active instance{deleteTarget._count.instances > 1 ? 's' : ''}.
                Deleting the template will leave these instances without a template reference.
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              This action cannot be undone. The template will be permanently removed from the system.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            disabled={deleting}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {deleting ? 'Deleting...' : 'Delete Template'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* View Template Dialog */}
      <TemplateViewDialog
        open={showViewDialog}
        template={viewTemplate}
        onClose={() => { setShowViewDialog(false); setViewTemplate(null); }}
        onEdit={() => { setShowViewDialog(false); const t = viewTemplate; setViewTemplate(null); if (t) openEditDialog(t); }}
        formatDateTime={formatDateTime}
        auditRecords={templateAuditRecords}
        viewAuditTab={viewAuditTab}
        setViewAuditTab={setViewAuditTab}
      />

      {/* Reauth Dialog */}
      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
        actionLabel="Entity Template Action"
      />
    </div>
  );
}
