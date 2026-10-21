/**
 * Helpers for the backup route suites (coverage campaign 2026-10-21). Lives
 * under __tests__: excluded from coverage, never collected as a test file.
 */

/**
 * Build a multipart/form-data body carrying one file. `before` fields are
 * written ahead of the file part and `after` fields behind it — the web restore
 * page appends `force` AFTER the file, so both orders matter.
 */
export function multipart(
  file: Buffer | string,
  filename = 'backup.json',
  before: Record<string, string> = {},
  after: Record<string, string> = {},
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----covbackup${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const field = (k: string, v: string) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(before)) parts.push(field(k, v));
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.isBuffer(file) ? file : Buffer.from(file, 'utf-8'),
    Buffer.from('\r\n'),
  );
  for (const [k, v] of Object.entries(after)) parts.push(field(k, v));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/** A multipart body with fields only — no file part at all. */
export function multipartNoFile(fields: Record<string, string>): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----covbackupnf${Date.now().toString(36)}`;
  const body = Object.entries(fields)
    .map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
    .join('') + `--${boundary}--\r\n`;
  return { payload: Buffer.from(body), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
