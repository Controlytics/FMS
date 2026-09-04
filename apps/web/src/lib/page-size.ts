/**
 * Page size for calls that want EVERY row of a list.
 *
 * Operator decision 2026-09-04: no record caps anywhere. The backend honours
 * whatever limit a caller sends (and the hierarchy routes return everything
 * when limit is omitted), but most list routes default to 20 rows when the
 * caller sends nothing - so a fetch-all call has to say so. One constant, so
 * the intent is greppable and no page carries its own magic number again.
 */
export const ALL_ROWS = 1_000_000;
