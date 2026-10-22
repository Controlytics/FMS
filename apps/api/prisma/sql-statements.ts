/**
 * Split a SQL script into single statements for `$executeRawUnsafe`, which runs
 * one statement per call. Used by seed.ts to apply prisma/sql/invariants.sql.
 *
 * 2026-10-22: the splitter used to buffer the comment lines BETWEEN statements
 * into the next statement and then skip any statement that started with "--".
 * So every statement with a comment above it never ran: 5 of the 17 in
 * invariants.sql, among them block_audit_trail_delete() and the one-IN_PROGRESS
 * partial index. Harmless on a migrations-built DB (the baseline creates them),
 * but on the `db push` path invariants.sql exists for, the triggers were then
 * created against functions that did not exist, and the seed failed.
 *
 * Rules:
 *   - blank lines, `--` comment lines and psql meta-commands (`\echo` ...)
 *     BETWEEN statements are dropped; comments inside a statement, and anything
 *     inside a `$$ ... $$` body, are kept as written;
 *   - a statement ends at a line ending in `;` outside a `$$` body;
 *   - CRLF is normalised to LF, so a function body is stored with the same
 *     bytes whatever line endings the checkout used.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let buf = '';
  let inDollar = false;
  for (const line of sql.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (!inDollar) {
      if (trimmed.startsWith('\\')) continue;
      if (buf === '' && (trimmed === '' || trimmed.startsWith('--'))) continue;
    }
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inDollar = !inDollar;
    buf += line + '\n';
    if (!inDollar && /;\s*$/.test(line)) {
      statements.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) statements.push(buf.trim());
  return statements;
}
