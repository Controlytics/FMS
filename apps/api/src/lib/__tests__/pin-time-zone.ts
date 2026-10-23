/**
 * Run a test file (or a block) under a fixed time zone, and put the process's
 * zone back EXACTLY as it was afterwards. Not a test file (no `.test.ts`).
 *
 * The suite runs single-fork: every file shares one process, so a zone left
 * behind changes the next files' dates. Two traps (2026-10-23):
 *   - `delete process.env.TZ` does NOT reset Node's zone (measured, Node 24 on
 *     Windows: the zone that was set stays in force), so "restore by deleting"
 *     left the following files in America/New_York;
 *   - setting TZ at a module's top level and never restoring it leaks the zone
 *     to every later file.
 * So the restore puts the variable back, then checks the zone actually in force
 * and, when deleting did not reset it, sets the zone that was in force before.
 *
 *   let restore: () => void;
 *   beforeAll(() => { restore = pinTimeZone('Asia/Kolkata'); });
 *   afterAll(() => restore());
 */
export function pinTimeZone(tz: string): () => void {
  const prevEnv = process.env.TZ;
  const prevZone = currentTimeZone();
  process.env.TZ = tz;
  if (currentTimeZone() !== canonical(tz)) {
    throw new Error(`Could not pin the time zone to ${tz}: still ${currentTimeZone()}.`);
  }
  return () => {
    if (prevEnv === undefined) delete process.env.TZ;
    else process.env.TZ = prevEnv;
    if (currentTimeZone() !== prevZone) process.env.TZ = prevZone;
  };
}

/** The zone Date and Intl are using right now. */
export function currentTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** ICU may report a zone under another name (Asia/Kolkata as Asia/Calcutta). */
function canonical(tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
}
