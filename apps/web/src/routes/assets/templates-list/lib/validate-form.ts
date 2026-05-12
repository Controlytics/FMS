import type { FormData } from '../../template-types';

/**
 * Validate the FormData; return the first human-readable error string or
 * `null` if everything is valid. Extracted verbatim from templates.tsx.
 *
 * Mirrors the server's stricter validation but is allowed to be a subset —
 * the server is the source of truth.
 */
export function validateForm(formData: FormData): string | null {
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
}
