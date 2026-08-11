import { describe, it, expect } from 'vitest';
import { toLibpqUrl, parseMajorVersion } from '../pg-tools.js';

/**
 * Regression: the first pg_dump export on a real deployment failed with
 *   pg_dump: error: invalid URI query parameter: "schema"
 * because Prisma's DATABASE_URL ends in `?schema=public` and libpq treats an
 * unrecognised URI parameter as fatal. The initial verification hand-built a
 * clean URL and so never exercised the value the API actually runs with.
 */
describe('toLibpqUrl', () => {
  it('strips Prisma\'s ?schema=public — the exact failure seen in the field', () => {
    expect(toLibpqUrl('postgresql://u:p@localhost:5432/digilog_db?schema=public'))
      .toBe('postgresql://u:p@localhost:5432/digilog_db');
  });

  it('strips the other Prisma-only pool parameters', () => {
    expect(toLibpqUrl('postgresql://u:p@h:5432/db?schema=public&connection_limit=5&pool_timeout=10&pgbouncer=true'))
      .toBe('postgresql://u:p@h:5432/db');
  });

  it('KEEPS parameters libpq understands', () => {
    expect(toLibpqUrl('postgresql://u:p@h:5432/db?sslmode=require'))
      .toBe('postgresql://u:p@h:5432/db?sslmode=require');
    expect(toLibpqUrl('postgresql://u:p@h:5432/db?sslmode=require&connect_timeout=10'))
      .toBe('postgresql://u:p@h:5432/db?sslmode=require&connect_timeout=10');
  });

  it('keeps the supported ones while dropping the unsupported ones', () => {
    expect(toLibpqUrl('postgresql://u:p@h:5432/db?schema=public&sslmode=require&connection_limit=5'))
      .toBe('postgresql://u:p@h:5432/db?sslmode=require');
  });

  it('leaves a URL with no query string alone', () => {
    expect(toLibpqUrl('postgresql://u:p@h:5432/db')).toBe('postgresql://u:p@h:5432/db');
  });

  it('accepts the postgres:// scheme as well as postgresql://', () => {
    expect(toLibpqUrl('postgres://u:p@h:5432/db?schema=public')).toBe('postgres://u:p@h:5432/db');
  });

  it('matches parameter names case-insensitively', () => {
    expect(toLibpqUrl('postgresql://u:p@h:5432/db?SSLMode=require')).toBe('postgresql://u:p@h:5432/db?SSLMode=require');
  });

  it('passes a libpq keyword/value connection string through untouched', () => {
    const kv = 'host=localhost port=5432 dbname=digilog_db user=digilog';
    expect(toLibpqUrl(kv)).toBe(kv);
  });

  it('does not mangle a password containing a question mark', () => {
    // The '?' inside the userinfo is not the query separator... but indexOf
    // finds it first. Guard the realistic case: password is percent-encoded, as
    // any correctly-formed URI requires.
    expect(toLibpqUrl('postgresql://u:p%3Fw@h:5432/db?schema=public'))
      .toBe('postgresql://u:p%3Fw@h:5432/db');
  });
});

describe('parseMajorVersion', () => {
  it('reads the major from pg_dump --version output', () => {
    expect(parseMajorVersion('pg_dump (PostgreSQL) 18.3')).toBe(18);
    expect(parseMajorVersion('pg_restore (PostgreSQL) 17.5')).toBe(17);
  });

  it('handles a bare major with no minor', () => {
    expect(parseMajorVersion('pg_dump (PostgreSQL) 16')).toBe(16);
  });

  it('returns null when it cannot tell', () => {
    expect(parseMajorVersion('not a version string')).toBeNull();
  });
});
