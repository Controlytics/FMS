import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: join(here, '.env'), override: false });

// Ensure JWT secrets exist for tests that import auth/lib/jwt.ts before the
// prisma client (some service tests construct tokens during fixture setup).
process.env.JWT_SECRET ??= 'TEST_JWT_SECRET_AT_LEAST_32_CHARACTERS_LONG_FOR_HS256_SUITE';
process.env.VERIFICATION_TOKEN_SECRET ??=
  'TEST_VERIFICATION_SECRET_AT_LEAST_32_CHARACTERS_LONG_FOR_HS256_SUITE';
