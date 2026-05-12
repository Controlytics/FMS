import type { FormData } from '../../template-types';

/**
 * Build the API request payload from FormData, stripping internal-only UI
 * fields (e.g. `enableConstraints`, `min`/`max`/`resolution` outside the
 * `numericConstraints` object) and normalising defaults / unit strings.
 *
 * Extracted verbatim from templates.tsx — no behavioural changes.
 */
export function buildBody(formData: FormData) {
  return {
    name: formData.name.trim(),
    description: formData.description.trim(),
    icon: formData.icon,
    templateKind: formData.templateKind,
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
    dataIngestionEnabled: formData.dataIngestionEnabled,
    ...(formData.transportType ? { transportType: formData.transportType } : { transportType: null }),
    credentialType: formData.credentialType || 'TOKEN',
    inactivityTimeout: formData.inactivityTimeout,
    defaultMaxDataRate: formData.defaultMaxDataRate,
    autoProvision: formData.autoProvision,
    ...(formData.defaultRuleChainId ? { defaultRuleChainId: formData.defaultRuleChainId } : { defaultRuleChainId: null }),
  };
}
