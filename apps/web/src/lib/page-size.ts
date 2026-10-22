/**
 * Page size for calls that want EVERY row of a list.
 *
 * Operator decision 2026-09-04: no record caps anywhere. The backend honours
 * whatever limit a caller sends (and the hierarchy routes return everything
 * when limit is omitted), but most list routes default to 20 rows when the
 * caller sends nothing - so a fetch-all call has to say so. One constant, so
 * the intent is greppable and no page carries its own magic number again.
 *
 * Only for a table that stays SMALL however long the plant runs (audit
 * 2026-10-22, every use checked): user accounts (the picker lists), checklist
 * and cleaning profiles, the filter register, IN_PROGRESS cycles (at most one
 * per filter), one year's PM entries. Never for a table that grows with use —
 * cycles, events, audit rows, notifications, block-change requests: those are
 * paged on the server or narrowed to the ids / window actually needed.
 */
export const ALL_ROWS = 1_000_000;
