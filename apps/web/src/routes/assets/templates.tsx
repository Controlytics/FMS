import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useAuth } from '@/hooks/use-auth';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select } from '@/components/ui/select';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { apiClient } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AttributeDef {
  fieldName: string;
  dataType: 'TEXT' | 'INTEGER' | 'FLOAT' | 'DATE' | 'DATETIME' | 'BOOLEAN' | 'DROPDOWN' | 'URL' | 'FILE';
  required: boolean;
  unit: string;
  defaultValue: string;
  options?: string; // comma-separated, for DROPDOWN
  enableConstraints?: boolean;
  min?: number | '';
  max?: number | '';
  resolution?: number | '';
}

interface IdentifierDef {
  identifierType: 'QR' | 'BARCODE' | 'RFID' | 'NFC' | 'MANUAL';
  label: string;
  required: boolean;
}

interface AlarmRuleDef {
  name: string;
  type: 'HIGH' | 'LOW' | 'HIGH_HIGH' | 'LOW_LOW' | 'RATE_OF_CHANGE' | 'BOOLEAN_STATE' | 'CUSTOM';
  severity: 'WARNING' | 'ALARM' | 'CRITICAL';
  sourceField: string;
  condition: string;
  threshold: number | '';
  deadband: number | '';
  message: string;
  notifyRoles: string; // comma-separated
  enabled: boolean;
}

interface TelemetryDef {
  fieldName: string;
  dataType: string;
  unit: string;
  description: string;
}

interface TemplateData {
  id: string;
  name: string;
  description: string;
  icon: string;
  version: number;
  attributeSchema: AttributeDef[];
  telemetrySchema: TelemetryDef[];
  expectedIdentifiers: IdentifierDef[];
  alarmRules: AlarmRuleDef[];
  isActive: boolean;
  _count?: { instances: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ICONS = [
  { value: 'box', label: 'Box' },
  { value: 'server', label: 'Server' },
  { value: 'camera', label: 'Camera' },
  { value: 'thermometer', label: 'Thermometer' },
  { value: 'building', label: 'Building' },
  { value: 'door-open', label: 'Door' },
  { value: 'truck', label: 'Truck' },
  { value: 'wrench', label: 'Wrench' },
  { value: 'shield', label: 'Shield' },
  { value: 'monitor', label: 'Monitor' },
];

const ATTRIBUTE_DATA_TYPES = ['TEXT', 'INTEGER', 'FLOAT', 'DATE', 'DATETIME', 'BOOLEAN', 'DROPDOWN', 'URL', 'FILE'] as const;
const IDENTIFIER_TYPES = ['QR', 'BARCODE', 'RFID', 'NFC', 'MANUAL'] as const;
const TELEMETRY_DATA_TYPES = ['INTEGER', 'FLOAT', 'BOOLEAN', 'STRING', 'ENUM'] as const;
const ALARM_RULE_TYPES = ['HIGH', 'LOW', 'HIGH_HIGH', 'LOW_LOW', 'RATE_OF_CHANGE', 'BOOLEAN_STATE', 'CUSTOM'] as const;
const ALARM_SEVERITIES = ['WARNING', 'ALARM', 'CRITICAL'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyAttribute(): AttributeDef {
  return { fieldName: '', dataType: 'TEXT', required: false, unit: '', defaultValue: '', options: '', enableConstraints: false, min: '', max: '', resolution: '' };
}

function emptyIdentifier(): IdentifierDef {
  return { identifierType: 'QR', label: '', required: false };
}

function emptyTelemetry(): TelemetryDef {
  return { fieldName: '', dataType: 'FLOAT', unit: '', description: '' };
}

function emptyAlarmRule(): AlarmRuleDef {
  return { name: '', type: 'HIGH', severity: 'ALARM', sourceField: '', condition: '', threshold: '', deadband: '', message: '', notifyRoles: '', enabled: true };
}

interface FormData {
  name: string;
  description: string;
  icon: string;
  attributeSchema: AttributeDef[];
  telemetrySchema: TelemetryDef[];
  expectedIdentifiers: IdentifierDef[];
  alarmRules: AlarmRuleDef[];
}

function emptyForm(): FormData {
  return {
    name: '',
    description: '',
    icon: 'box',
    attributeSchema: [],
    telemetrySchema: [],
    expectedIdentifiers: [],
    alarmRules: [],
  };
}

/** Build the numeric constraint preview string. */
function constraintPreview(min: number | '' | undefined, max: number | '' | undefined, resolution: number | '' | undefined): string | null {
  const mn = typeof min === 'number' ? min : undefined;
  const mx = typeof max === 'number' ? max : undefined;
  const res = typeof resolution === 'number' && resolution > 0 ? resolution : undefined;
  if (mn === undefined || mx === undefined || res === undefined) return null;
  if (mx <= mn) return null;
  const count = Math.floor((mx - mn) / res) + 1;
  if (count <= 0) return null;
  const values: number[] = [];
  for (let i = 0; i < Math.min(3, count); i++) {
    values.push(mn + i * res);
  }
  const last3: number[] = [];
  for (let i = Math.max(0, count - 3); i < count; i++) {
    const v = mn + i * res;
    if (!values.includes(v)) last3.push(v);
  }
  const parts = values.map((v) => String(v));
  if (last3.length > 0) parts.push('...', ...last3.map((v) => String(v)));
  return `Valid values: ${parts.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Collapsible Section Component
// ---------------------------------------------------------------------------

function CollapsibleSection({ title, count, defaultOpen = false, children }: { title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">{title}</span>
          {count !== undefined && (
            <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-[10px]">{count}</Badge>
          )}
        </div>
        <svg
          className={cn('w-4 h-4 text-slate-500 transition-transform duration-200', open && 'rotate-180')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="p-4 space-y-4 bg-white">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Numeric Constraints Panel
// ---------------------------------------------------------------------------

function NumericConstraintsPanel({
  enableConstraints,
  min,
  max,
  resolution,
  onChange,
}: {
  enableConstraints: boolean;
  min: number | '';
  max: number | '';
  resolution: number | '';
  onChange: (field: string, value: unknown) => void;
}) {
  const preview = enableConstraints ? constraintPreview(min, max, resolution) : null;

  return (
    <div className="mt-2 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enableConstraints}
          onChange={(e) => onChange('enableConstraints', e.target.checked)}
          className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
        />
        <span className="text-xs font-medium text-slate-600">Enable Numeric Constraints</span>
      </label>
      {enableConstraints && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Min</label>
              <Input
                type="number"
                value={min}
                onChange={(e) => onChange('min', e.target.value === '' ? '' : Number(e.target.value))}
                className="h-8 text-xs"
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Max</label>
              <Input
                type="number"
                value={max}
                onChange={(e) => onChange('max', e.target.value === '' ? '' : Number(e.target.value))}
                className="h-8 text-xs"
                placeholder="100"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Resolution</label>
              <Input
                type="number"
                value={resolution}
                onChange={(e) => onChange('resolution', e.target.value === '' ? '' : Number(e.target.value))}
                className="h-8 text-xs"
                placeholder="1"
              />
            </div>
          </div>
          {preview && (
            <p className="text-[11px] text-purple-600 font-medium bg-purple-50 px-2 py-1 rounded">{preview}</p>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export function AssetTemplatesPage() {
  const { user } = useAuth();
  const { mutate } = useSWRConfig();
  const reauth = useReauth();

  // Data
  const { data: templatesRes, isLoading } = useSWR<{ data: TemplateData[] }>('/api/assets/templates');
  const templates = templatesRes?.data;

  // Dialog states
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TemplateData | null>(null);

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
    });
    setError('');
    setShowEditDialog(true);
  }, []);

  const openDeleteDialog = useCallback((template: TemplateData) => {
    setDeleteTarget(template);
    setDeleteError('');
    setShowDeleteDialog(true);
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
  // Build the body payload, stripping internal-only fields
  // -----------------------------------------------------------------------

  const buildBody = () => {
    return {
      name: formData.name.trim(),
      description: formData.description.trim(),
      icon: formData.icon,
      attributeSchema: formData.attributeSchema
        .filter((a) => a.fieldName.trim())
        .map(({ enableConstraints, min, max, resolution, options, ...rest }) => ({
          fieldName: rest.fieldName.trim(),
          dataType: rest.dataType,
          required: rest.required,
          ...(rest.defaultValue.trim() ? { defaultValue: rest.defaultValue.trim() } : {}),
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
    };
  };

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      setError('Template name is required');
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
    if (!formData.name.trim()) {
      setError('Template name is required');
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

    reauth.execute(
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
  // Template form (shared between Create and Edit dialogs)
  // -----------------------------------------------------------------------

  const renderTemplateForm = () => (
    <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-1">
      {error && (
        <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-200 p-4">
          <div className="p-2 rounded-lg bg-red-100">
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Section 1: Basic Info */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 text-xs font-bold">1</div>
          Basic Info
        </h3>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Template Name *</label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Temperature Sensor"
            className="h-11"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Description</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Brief description of this template's purpose"
            rows={3}
            className="flex w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 hover:border-slate-300 transition-all duration-200 resize-none"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-slate-700">Icon</label>
          <Select
            value={formData.icon}
            onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
            selectSize="md"
          >
            {ICONS.map((ic) => (
              <option key={ic.value} value={ic.value}>{ic.label}</option>
            ))}
          </Select>
        </div>
      </div>

      {/* Section 2: Attribute Schema */}
      <CollapsibleSection title="Attribute Schema" count={formData.attributeSchema.length} defaultOpen={formData.attributeSchema.length > 0}>
        {formData.attributeSchema.map((attr, idx) => (
          <div key={idx} className="rounded-lg border border-slate-200 p-3 space-y-3 bg-white relative">
            <button
              type="button"
              onClick={() => removeAttribute(idx)}
              className="absolute top-2 right-2 p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="grid grid-cols-3 gap-3 pr-6">
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Field Name</label>
                <Input
                  value={attr.fieldName}
                  onChange={(e) => updateAttribute(idx, 'fieldName', e.target.value)}
                  placeholder="e.g., serialNumber"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Data Type</label>
                <Select
                  value={attr.dataType}
                  onChange={(e) => updateAttribute(idx, 'dataType', e.target.value)}
                  selectSize="sm"
                >
                  {ATTRIBUTE_DATA_TYPES.map((dt) => (
                    <option key={dt} value={dt}>{dt}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Unit</label>
                <Input
                  value={attr.unit}
                  onChange={(e) => updateAttribute(idx, 'unit', e.target.value)}
                  placeholder="e.g., kg, mm"
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Default Value</label>
                <Input
                  value={attr.defaultValue}
                  onChange={(e) => updateAttribute(idx, 'defaultValue', e.target.value)}
                  placeholder="Default"
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={attr.required}
                    onChange={(e) => updateAttribute(idx, 'required', e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-xs font-medium text-slate-600">Required</span>
                </label>
              </div>
            </div>
            {/* DROPDOWN options */}
            {attr.dataType === 'DROPDOWN' && (
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Options (comma-separated)</label>
                <textarea
                  value={attr.options || ''}
                  onChange={(e) => updateAttribute(idx, 'options', e.target.value)}
                  placeholder="Option1, Option2, Option3"
                  rows={2}
                  className="flex w-full rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 hover:border-slate-300 transition-all duration-200 resize-none"
                />
              </div>
            )}
            {/* Numeric constraints */}
            {(attr.dataType === 'INTEGER' || attr.dataType === 'FLOAT') && (
              <NumericConstraintsPanel
                enableConstraints={!!attr.enableConstraints}
                min={attr.min ?? ''}
                max={attr.max ?? ''}
                resolution={attr.resolution ?? ''}
                onChange={(field, value) => updateAttribute(idx, field, value)}
              />
            )}
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addAttribute} className="w-full border-dashed">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Attribute
        </Button>
      </CollapsibleSection>

      {/* Section 3: Telemetry Schema */}
      <CollapsibleSection title="Telemetry Schema" count={formData.telemetrySchema.length} defaultOpen={formData.telemetrySchema.length > 0}>
        {formData.telemetrySchema.map((tel, idx) => (
          <div key={idx} className="rounded-lg border border-slate-200 p-3 space-y-3 bg-white relative">
            <button
              type="button"
              onClick={() => removeTelemetry(idx)}
              className="absolute top-2 right-2 p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="grid grid-cols-4 gap-3 pr-8">
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Field Name</label>
                <Input
                  value={tel.fieldName}
                  onChange={(e) => updateTelemetry(idx, 'fieldName', e.target.value)}
                  placeholder="e.g. temperature"
                  className="text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Data Type</label>
                <Select
                  value={tel.dataType}
                  onChange={(e) => updateTelemetry(idx, 'dataType', e.target.value)}
                  selectSize="sm"
                >
                  {TELEMETRY_DATA_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Unit</label>
                <Input
                  value={tel.unit}
                  onChange={(e) => updateTelemetry(idx, 'unit', e.target.value)}
                  placeholder="e.g. °C, psi, %"
                  className="text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Description</label>
                <Input
                  value={tel.description}
                  onChange={(e) => updateTelemetry(idx, 'description', e.target.value)}
                  placeholder="Optional description"
                  className="text-xs"
                />
              </div>
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addTelemetry} className="w-full border-dashed">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Telemetry Point
        </Button>
      </CollapsibleSection>

      {/* Section 4: Expected Identifiers */}
      <CollapsibleSection title="Expected Identifiers" count={formData.expectedIdentifiers.length} defaultOpen={formData.expectedIdentifiers.length > 0}>
        {formData.expectedIdentifiers.map((ident, idx) => (
          <div key={idx} className="rounded-lg border border-slate-200 p-3 bg-white relative">
            <button
              type="button"
              onClick={() => removeIdentifier(idx)}
              className="absolute top-2 right-2 p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="grid grid-cols-3 gap-3 pr-6">
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Identifier Type</label>
                <Select
                  value={ident.identifierType}
                  onChange={(e) => updateIdentifier(idx, 'identifierType', e.target.value)}
                  selectSize="sm"
                >
                  {IDENTIFIER_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Label</label>
                <Input
                  value={ident.label}
                  onChange={(e) => updateIdentifier(idx, 'label', e.target.value)}
                  placeholder="e.g., Equipment QR Code"
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ident.required}
                    onChange={(e) => updateIdentifier(idx, 'required', e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-xs font-medium text-slate-600">Required</span>
                </label>
              </div>
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addIdentifier} className="w-full border-dashed">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Identifier
        </Button>
      </CollapsibleSection>

      {/* Section 5: Alarm Rules */}
      <CollapsibleSection title="Alarm Rules" count={formData.alarmRules.length}>
        {formData.alarmRules.map((rule, idx) => (
          <div key={idx} className="rounded-lg border border-slate-200 p-3 bg-white relative">
            <button
              type="button"
              onClick={() => removeAlarmRule(idx)}
              className="absolute top-2 right-2 p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="grid grid-cols-3 gap-3 pr-6 mb-2">
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Rule Name *</label>
                <Input
                  value={rule.name}
                  onChange={(e) => updateAlarmRule(idx, 'name', e.target.value)}
                  placeholder="e.g., High Temperature"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Type</label>
                <select
                  value={rule.type}
                  onChange={(e) => updateAlarmRule(idx, 'type', e.target.value)}
                  className="w-full h-8 text-xs rounded-md border border-slate-200 px-2 bg-white"
                >
                  {ALARM_RULE_TYPES.map((t) => (
                    <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Severity</label>
                <select
                  value={rule.severity}
                  onChange={(e) => updateAlarmRule(idx, 'severity', e.target.value)}
                  className="w-full h-8 text-xs rounded-md border border-slate-200 px-2 bg-white"
                >
                  {ALARM_SEVERITIES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-2">
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Source Field</label>
                <Input
                  value={rule.sourceField}
                  onChange={(e) => updateAlarmRule(idx, 'sourceField', e.target.value)}
                  placeholder="e.g., Temperature, Recording Status"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Threshold</label>
                <Input
                  type="number"
                  value={rule.threshold}
                  onChange={(e) => updateAlarmRule(idx, 'threshold', e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g., 85"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Deadband</label>
                <Input
                  type="number"
                  value={rule.deadband}
                  onChange={(e) => updateAlarmRule(idx, 'deadband', e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="Hysteresis value"
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-2">
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Condition / Expression</label>
                <Input
                  value={rule.condition}
                  onChange={(e) => updateAlarmRule(idx, 'condition', e.target.value)}
                  placeholder="e.g., > 85.0, = Off, custom expression"
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Message Template</label>
                <Input
                  value={rule.message}
                  onChange={(e) => updateAlarmRule(idx, 'message', e.target.value)}
                  placeholder="e.g., Temperature exceeded {threshold} for {asset.name}"
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Notify Roles (comma-separated)</label>
                <Input
                  value={rule.notifyRoles}
                  onChange={(e) => updateAlarmRule(idx, 'notifyRoles', e.target.value)}
                  placeholder="e.g., SUPERVISOR, ADMIN"
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => updateAlarmRule(idx, 'enabled', e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Enabled
                </label>
              </div>
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addAlarmRule} className="w-full border-dashed">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Alarm Rule
        </Button>
      </CollapsibleSection>
    </div>
  );

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
                  <h1 className="text-2xl font-bold">Asset Templates</h1>
                  <p className="text-purple-100/80 text-sm">Manage reusable blueprints for asset types</p>
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
                  : 'Get started by creating your first asset template.'}
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
                          onClick={() => openEditDialog(template)}
                          className="text-purple-600 hover:text-purple-700 hover:bg-purple-50"
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
            <h3 className="font-bold text-purple-900 mb-1">About Asset Templates</h3>
            <p className="text-sm text-purple-700">
              Templates define the blueprint for asset types, including attribute schemas,
              expected identifiers, and alarm rules. When you create an asset instance, it inherits the
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
        {renderTemplateForm()}
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
        {renderTemplateForm()}
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

      {/* Reauth Dialog */}
      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
        actionLabel="Asset Template Action"
      />
    </div>
  );
}
