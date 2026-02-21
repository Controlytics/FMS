import type { AttributeDefinition } from '../types';

/** Validate a single attribute value; returns an error message or null. */
export function validateAttrValue(attr: AttributeDefinition, value: any): string | null {
  const c = attr.numericConstraints;
  if (attr.required && (value === undefined || value === null || value === '')) {
    return `${attr.fieldName} is required`;
  }
  if (value === undefined || value === null || value === '') return null;

  switch (attr.dataType) {
    case 'INTEGER':
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'Must be a whole number';
      if (c?.enabled) {
        if (c.min !== undefined && value < c.min) return `Must be >= ${c.min}`;
        if (c.max !== undefined && value > c.max) return `Must be <= ${c.max}`;
      }
      break;
    case 'FLOAT':
      // Allow intermediate typing states like "." or "-"
      if (typeof value === 'string' && (value === '.' || value === '-' || value === '-.')) return 'Must be a valid number';
      if (typeof value === 'number' && !isFinite(value)) return 'Must be a valid number';
      if (typeof value === 'number' && c?.enabled) {
        if (c.min !== undefined && value < c.min) return `Must be >= ${c.min}`;
        if (c.max !== undefined && value > c.max) return `Must be <= ${c.max}`;
      }
      break;
    case 'URL':
      if (typeof value === 'string' && value.trim()) {
        try { new URL(value); } catch { return 'Must be a valid URL (e.g., https://...)'; }
      }
      break;
  }
  return null;
}

/** Check if any attribute has validation errors (used to block wizard Next). */
export function hasAttributeErrors(attrSchema: AttributeDefinition[], values: Record<string, any>): boolean {
  if (!attrSchema) return false;
  return attrSchema.some((attr) => validateAttrValue(attr, values[attr.fieldName] ?? '') !== null);
}
