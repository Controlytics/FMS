/**
 * The seed applies prisma/sql/invariants.sql statement by statement
 * (seed.ts applyInvariants -> prisma/sql-statements.ts). Until 2026-10-22 the
 * splitter dropped every statement with a comment above it — 5 of 17, among
 * them block_audit_trail_delete() and the one-IN_PROGRESS partial index — and
 * the seed runs on every customer upgrade, so each statement must also be safe
 * to run again on a database that already has the object.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitSqlStatements } from '../../prisma/sql-statements.js';

const invariants = readFileSync(join(__dirname, '..', '..', 'prisma', 'sql', 'invariants.sql'), 'utf8');
const head = (s: string) => s.split('\n')[0];

describe('splitSqlStatements', () => {
  it('keeps a statement that has a comment block above it (the 2026-10-22 bug)', () => {
    const out = splitSqlStatements('-- why this exists\n-- more\n\nCREATE INDEX IF NOT EXISTS a ON t (x);\n\n-- next\nDROP TRIGGER IF EXISTS b ON t;\n');
    expect(out).toEqual(['CREATE INDEX IF NOT EXISTS a ON t (x);', 'DROP TRIGGER IF EXISTS b ON t;']);
  });

  it('keeps a $$ body whole — its semicolons and its comments — and normalises CRLF', () => {
    const sql = '-- header\r\nCREATE OR REPLACE FUNCTION f() RETURNS trigger AS $$\r\nBEGIN\r\n  -- inside the body\r\n  RAISE EXCEPTION \'no\';\r\nEND;\r\n$$ LANGUAGE plpgsql;\r\n';
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('-- inside the body');
    expect(out[0]).toContain("RAISE EXCEPTION 'no';");
    expect(out[0]).not.toContain('\r');
    expect(out[0].endsWith('$$ LANGUAGE plpgsql;')).toBe(true);
  });

  it('a one-line $$ body does not leave the splitter stuck inside a body', () => {
    const out = splitSqlStatements('CREATE OR REPLACE FUNCTION g() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;\nSELECT 2;\n');
    expect(out).toEqual(['CREATE OR REPLACE FUNCTION g() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;', 'SELECT 2;']);
  });

  it('drops psql meta-commands and trailing comments', () => {
    expect(splitSqlStatements('\\echo hi\nSELECT 1;\n-- the end\n')).toEqual(['SELECT 1;']);
  });
});

describe('prisma/sql/invariants.sql as the seed applies it', () => {
  const statements = splitSqlStatements(invariants);

  it('every statement reaches the database — none starts with a comment', () => {
    for (const s of statements) expect(s.startsWith('--'), head(s)).toBe(false);
    const heads = statements.map(head).join('\n');
    // The five the old splitter skipped.
    expect(heads).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_cleaning_cycles_one_in_progress_per_filter/);
    expect(heads).toMatch(/CREATE OR REPLACE FUNCTION check_filter_event_consistency\(\)/);
    expect(heads).toMatch(/CREATE OR REPLACE FUNCTION inverse_relationship_type\(/);
    expect(heads).toMatch(/CREATE OR REPLACE FUNCTION block_audit_trail_delete\(\)/);
    expect(heads).toMatch(/CREATE OR REPLACE FUNCTION public\.fn_mirror_asset_instance\(\)/);
    // Migration-only until 2026-10-22; now here too, so a `db push` DB has it.
    expect(heads).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS asset_instances_active_name_key/);
  });

  it('every statement is safe to run again (the seed runs on every upgrade)', () => {
    statements.forEach((s, i) => {
      const h = head(s);
      const idempotent =
        /^CREATE OR REPLACE FUNCTION /i.test(h) ||
        /^CREATE (UNIQUE )?INDEX IF NOT EXISTS /i.test(h) ||
        /^DROP TRIGGER IF EXISTS /i.test(h) ||
        /^CREATE (CONSTRAINT )?TRIGGER /i.test(h);
      expect(idempotent, h).toBe(true);
      // A CREATE TRIGGER is only re-runnable straight after the DROP of the same trigger.
      const trig = h.match(/^CREATE (?:CONSTRAINT )?TRIGGER (\w+)/i);
      if (trig) {
        const prev = head(statements[i - 1] ?? '');
        expect(prev, `${trig[1]} must follow its DROP TRIGGER IF EXISTS`).toMatch(new RegExp(`^DROP TRIGGER IF EXISTS ${trig[1]} ON `, 'i'));
      }
    });
  });
});
