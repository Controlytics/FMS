/**
 * Template Engine — Resolves dynamic variables in notification templates.
 * Supports ${variable} syntax with nested dot notation.
 */

const VARIABLE_REGEX = /\$\{([^}]+)\}/g;

/**
 * Resolve all ${variable} placeholders in a template string.
 */
export function resolveTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(VARIABLE_REGEX, (match, key: string) => {
    const value = variables[key.trim()];
    if (value === undefined) return match;
    // HTML-escape variable values to prevent XSS in email templates
    const escaped = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return escaped;
  });
}

/**
 * Extract all variable names from a template string.
 */
export function extractVariables(template: string): string[] {
  const vars: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(VARIABLE_REGEX);
  while ((match = regex.exec(template)) !== null) {
    vars.push(match[1].trim());
  }
  return [...new Set(vars)];
}

