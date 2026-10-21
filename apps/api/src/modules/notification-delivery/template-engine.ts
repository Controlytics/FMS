/**
 * Template Engine — Resolves dynamic variables in notification templates.
 * Supports ${variable} syntax with nested dot notation.
 */

const VARIABLE_REGEX = /\$\{([^}]+)\}/g;

/**
 * Where the resolved text is going.
 * - `html`: an e-mail BODY. Values are HTML-escaped so a variable (a device or
 *   user name, an error message) cannot inject markup into the mail.
 * - `text`: everything else — e-mail Subject header, SMS, in-app message. These
 *   are plain text: the web renders in-app messages as text, and an SMS or a
 *   Subject line has no HTML layer at all.
 *
 * D7 (2026-10-21): values used to be escaped for EVERY channel, so SMS bodies,
 * in-app notifications and Subject lines showed `&amp;` / `&quot;` / `&lt;`.
 * The mode is required so a new caller has to choose.
 */
export type TemplateMode = 'html' | 'text';

/** Escape the five characters that are significant in HTML text and attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Inverse of {@link escapeHtml} (for deriving plain text from an HTML body). `&amp;` last, so `&amp;lt;` stays `&lt;`. */
export function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Resolve all ${variable} placeholders in a template string. An unknown
 * placeholder is left as written.
 */
export function resolveTemplate(template: string, variables: Record<string, string>, mode: TemplateMode): string {
  return template.replace(VARIABLE_REGEX, (match, key: string) => {
    const value = variables[key.trim()];
    if (value === undefined) return match;
    return mode === 'html' ? escapeHtml(String(value)) : String(value);
  });
}
