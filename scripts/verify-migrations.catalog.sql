-- Catalog fingerprint for scripts/verify-migrations.ps1 (D-DB-1, 2026-10-22).
--
-- READ-ONLY. One line per database object that `prisma migrate diff` cannot
-- see, because schema.prisma has no way to express it. The drift guard runs
-- this against the scratch DB built from migrations and against the reference
-- DB, and FAILS on any line that is not in both.
--
-- What it covers, and why each one matters:
--   index      every index in public, by its full definition — so a partial
--              unique index loses its WHERE (asset_instances_active_name_key,
--              idx_cleaning_cycles_one_in_progress_per_filter) or its
--              expression, and the guard sees it. Prisma's diff passed a
--              dropped partial index as "empty migration".
--   trigger    every user trigger, its definition AND its enabled state —
--              audit_trail_no_delete (21 CFR §11 no-delete guard) dropped, or
--              left DISABLED by an interrupted hard-delete, is a difference.
--   function   every function in public that no extension owns, by an md5 of
--              its full definition — the trigger bodies (block_audit_trail_delete,
--              the mirror functions, the consistency checks).
--   constraint CHECK and EXCLUDE constraints (Prisma models neither).
--   sequence   every sequence's shape — the stand-alone deviation_number_seq /
--              qnn_seq are invisible to Prisma.
--   extension  installed extensions (the baseline needs ltree + pgcrypto).
--
-- Each line is "<kind> | <identity> | <definition>"; the guard compares the
-- lines as plain strings. Never add anything instance-specific here (oids,
-- sequence values, row counts, owners): it would make two identical schemas
-- differ.
-- A fixed search_path makes pg_get_*def() qualify names the same way on both
-- sides, whatever the connecting role's own search_path is.
SET search_path = public, pg_catalog;

SELECT kind || ' | ' || ident || ' | ' || def
FROM (
  SELECT 'index' AS kind, c.relname::text AS ident, pg_get_indexdef(i.indexrelid) AS def
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  WHERE c.relnamespace = 'public'::regnamespace

  UNION ALL
  SELECT 'trigger', t.tgrelid::regclass::text || '.' || t.tgname,
         pg_get_triggerdef(t.oid) || ' [enabled=' || t.tgenabled::text || ']'
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace

  UNION ALL
  -- Hashed with "--" line comments removed and whitespace runs collapsed, so
  -- the comparison is about what the function DOES. Two live reasons, both
  -- from the seed, which re-applies some of prisma/sql/invariants.sql on top
  -- of the migrations (seed.ts applyInvariants):
  --   * invariants.sql's check_asset_relationship_pair() carries a 2-line
  --     comment the baseline's copy lacks; every seeded DB (dev, test, every
  --     install) differs from a migrations-only DB by exactly that comment.
  --   * a CRLF checkout of invariants.sql (core.autocrlf=true) stores "\r\n"
  --     where the LF baseline stores "\n" (digilog_db: 4 of 6 bodies).
  -- Cost: a change confined to whitespace or to text after "--" on a line
  -- (e.g. inside a string literal) goes unseen. A real logic change does not.
  SELECT 'function', p.oid::regprocedure::text,
         'md5=' || md5(btrim(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), '--.*$', '', 'gn'), '\s+', ' ', 'g')))
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.prokind IN ('f', 'p')
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
    )

  UNION ALL
  SELECT 'constraint', con.conrelid::regclass::text || '.' || con.conname, pg_get_constraintdef(con.oid)
  FROM pg_constraint con
  WHERE con.connamespace = 'public'::regnamespace AND con.contype IN ('c', 'x')

  UNION ALL
  SELECT 'sequence', s.seqrelid::regclass::text,
         format_type(s.seqtypid, NULL) || ' start ' || s.seqstart || ' inc ' || s.seqincrement
           || ' min ' || s.seqmin || ' max ' || s.seqmax || ' cycle ' || s.seqcycle
  FROM pg_sequence s
  JOIN pg_class c ON c.oid = s.seqrelid
  WHERE c.relnamespace = 'public'::regnamespace

  UNION ALL
  SELECT 'extension', e.extname::text, ''
  FROM pg_extension e
) x
ORDER BY 1;
