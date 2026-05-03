import type { TemplateData, FormData } from '../../template-types';
import {
  emptyAttribute,
  emptyIdentifier,
  emptyTelemetry,
  emptyAlarmRule,
  emptyChecklistItem,
} from '../../template-types';

/**
 * Map an existing TemplateData record into the editable FormData shape used
 * by the create / edit dialogs. Mirrors the mapping that previously lived
 * inline in `openEditDialog` inside templates.tsx — extracted verbatim.
 */
export function templateToForm(template: TemplateData): FormData {
  return {
    name: template.name,
    description: template.description || '',
    icon: template.icon || 'box',
    templateKind: template.templateKind ?? 'OTHER',
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
    dataIngestionEnabled: template.dataIngestionEnabled || false,
    transportType: template.transportType || '',
    credentialType: template.credentialType || 'TOKEN',
    inactivityTimeout: template.inactivityTimeout ?? 60,
    defaultMaxDataRate: template.defaultMaxDataRate ?? 600,
    autoProvision: template.autoProvision !== false,
    defaultRuleChainId: template.defaultRuleChainId || '',
  };
}
