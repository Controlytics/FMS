/**
 * ONE normaliser for a scanned RFID value (2026-10-06).
 *
 * KC-series UKB readers upper/lower-case inconsistently and sometimes deliver
 * the same EPC two or three times concatenated when the physical scan is
 * unsteady ("ABCD1234ABCD1234"). Four screens each carried their own copy of
 * this rule; the Status view's "Scan RFID" popup carried none and compared the
 * raw text against the stored tag, so a real, assigned tag read "Tag Not
 * Assigned" there. Keep every scan path on this function.
 */
export function normalizeRfidScan(raw: string | null | undefined): string {
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

/** Case-insensitive match of a normalised scan against a stored identifier value. */
export function rfidValuesMatch(stored: string | null | undefined, scanned: string): boolean {
  if (!stored) return false;
  return String(stored).trim().toUpperCase() === scanned;
}
