/**
 * Canonical form of an RFID tag value — the SERVER copy of the tablet/web scan
 * normaliser `apps/web/src/lib/rfid-scan.ts` `normalizeRfidScan` (C-07,
 * 2026-10-19).
 *
 * Every scan LOOKUP already went through that normaliser (upper-case, reader
 * line terminators stripped, a doubled or tripled EPC collapsed), but nothing
 * normalised the WRITE: the tablet and web assign inputs only trimmed, and the
 * server stored whatever arrived. A stuttered or lower-case assign therefore
 * stored a value no later scan could ever match. Canonicalising once, here, in
 * `identifierService.create` covers every client and the typed filter create.
 *
 * The two copies MUST stay identical — `__tests__/rfid-canonical.test.ts` runs
 * the web function against this one over the web test cases and a generated
 * corpus, so a change to one without the other fails the api suite.
 * (Not moved into packages/shared: the web file is outside this change's scope
 * and the web bundle imports it directly.)
 */
export function canonicalRfidValue(raw: string | null | undefined): string {
  let sv = String(raw ?? '').replace(/[\r\n\t]/g, '').trim().toUpperCase();
  if (sv.length >= 6 && sv.length % 2 === 0) {
    const half = sv.length / 2;
    if (sv.substring(0, half) === sv.substring(half)) sv = sv.substring(0, half);
  }
  if (sv.length >= 9 && sv.length % 3 === 0) {
    const third = sv.length / 3;
    if (
      sv.substring(0, third) === sv.substring(third, third * 2) &&
      sv.substring(0, third) === sv.substring(third * 2)
    ) {
      sv = sv.substring(0, third);
    }
  }
  return sv;
}

/** Same tag regardless of stored casing / stray whitespace. */
export function sameRfidValue(a: string | null | undefined, b: string | null | undefined): boolean {
  return canonicalRfidValue(a) === canonicalRfidValue(b);
}
