/**
 * Validate attribute values against a template's attribute schema.
 * Returns an array of error messages (empty if all valid).
 */
export function validateAttributeValues(
  attributes: Record<string, any>,
  attributeSchema: any[],
): string[] {
  const errors: string[] = [];
  if (!attributeSchema || attributeSchema.length === 0) return errors;

  for (const schemaDef of attributeSchema) {
    const { fieldName, dataType, required } = schemaDef;
    const value = attributes[fieldName];

    if (required && (value === undefined || value === null || value === '')) {
      errors.push(`"${fieldName}" is required`);
      continue;
    }

    if (value === undefined || value === null || value === '') continue;

    switch (dataType) {
      case 'INTEGER':
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          errors.push(`"${fieldName}" must be an integer`);
        } else if (schemaDef.numericConstraints?.enabled) {
          const c = schemaDef.numericConstraints;
          if (c.min !== undefined && value < c.min) errors.push(`"${fieldName}" must be >= ${c.min}`);
          if (c.max !== undefined && value > c.max) errors.push(`"${fieldName}" must be <= ${c.max}`);
        }
        break;
      case 'FLOAT':
        if (typeof value !== 'number' || !isFinite(value)) {
          errors.push(`"${fieldName}" must be a number`);
        } else if (schemaDef.numericConstraints?.enabled) {
          const c = schemaDef.numericConstraints;
          if (c.min !== undefined && value < c.min) errors.push(`"${fieldName}" must be >= ${c.min}`);
          if (c.max !== undefined && value > c.max) errors.push(`"${fieldName}" must be <= ${c.max}`);
        }
        break;
      case 'BOOLEAN':
        if (typeof value !== 'boolean') {
          errors.push(`"${fieldName}" must be a boolean (true/false)`);
        }
        break;
      case 'TEXT':
      case 'FILE':
        if (typeof value !== 'string') {
          errors.push(`"${fieldName}" must be a text string`);
        }
        break;
      case 'URL':
        if (typeof value !== 'string') {
          errors.push(`"${fieldName}" must be a URL string`);
        } else {
          try { new URL(value); } catch {
            errors.push(`"${fieldName}" must be a valid URL`);
          }
        }
        break;
      case 'DATE':
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          errors.push(`"${fieldName}" must be a valid date (YYYY-MM-DD)`);
        }
        break;
      case 'DATETIME':
        if (typeof value !== 'string' || isNaN(Date.parse(value))) {
          errors.push(`"${fieldName}" must be a valid datetime`);
        }
        break;
      case 'DROPDOWN':
        if (typeof value !== 'string') {
          errors.push(`"${fieldName}" must be a string`);
        } else if (schemaDef.dropdownOptions && !schemaDef.dropdownOptions.includes(value)) {
          errors.push(`"${fieldName}" must be one of: ${schemaDef.dropdownOptions.join(', ')}`);
        }
        break;
    }
  }

  return errors;
}
