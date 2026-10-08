import type { PasswordPolicyConfig } from '../schemas/config.js';

/**
 * The fields of the password policy the generator reads. Partial because the
 * API reads the stored `password-policy` row, which may predate a field.
 * A missing flag counts as required and a missing per-class minimum as 1 —
 * the schema defaults — so a sparse row never yields a password the
 * validator then rejects.
 */
export type PasswordGeneratorPolicy = Partial<Pick<PasswordPolicyConfig,
  | 'minLength'
  | 'requireUppercase' | 'requireLowercase' | 'requireNumbers' | 'requireSpecialChars'
  | 'minUppercase' | 'minLowercase' | 'minNumbers' | 'minSpecialChars'>>;

/**
 * Uniform random integer in [0, max) from the platform CSPRNG
 * (`globalThis.crypto` — the browser's Web Crypto, and Node 20's).
 *
 * `Math.random` is not a CSPRNG: these values become temporary passwords, so a
 * predictable one is an account-takeover window. Rejection sampling keeps the
 * distribution uniform — a naive `% max` biases toward low values whenever max
 * doesn't divide 2^32.
 */
function randomIndex(max: number): number {
  const limit = Math.floor(0xFFFFFFFF / max) * max;
  const buf = new Uint32Array(1);
  let v: number;
  do {
    globalThis.crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= limit);
  return v % max;
}

/**
 * The ONE temporary-password generator (2026-10-07). Every temporary password —
 * Users page create / reset / unlock, reset-request approval, and Admin Requests
 * approval (create user, unlock, forgot password) — comes from here.
 *
 * Length is exactly the policy's `minLength`. It is longer only when the
 * per-class minimums alone add up to more than that, because then no password
 * of `minLength` can satisfy the policy.
 *
 * Until 2026-10-07 the API had its own generator for Admin Requests that always
 * produced 14 characters and never read the policy, while the web pages produced
 * `minLength`: the same deployment issued 14- and 8-character temporary
 * passwords, and a policy needing more than 14, or more than one character of a
 * class, would have failed every approval.
 */
export function generatePassword(policy: PasswordGeneratorPolicy): string {
  const classes: Array<[required: boolean | undefined, min: number | undefined, chars: string]> = [
    [policy.requireUppercase, policy.minUppercase, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
    [policy.requireLowercase, policy.minLowercase, 'abcdefghijklmnopqrstuvwxyz'],
    [policy.requireNumbers, policy.minNumbers, '0123456789'],
    [policy.requireSpecialChars, policy.minSpecialChars, '!@#$%^&*()_+-=[]{}|;:,.<>?'],
  ];

  const out: string[] = [];
  let pool = '';
  for (const [required, min, chars] of classes) {
    if (required === false) continue;
    for (let i = 0; i < (min ?? 1); i++) out.push(chars[randomIndex(chars.length)]);
    pool += chars;
  }
  // Every class switched off: the validator then only checks length.
  if (!pool) pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  const targetLength = Math.max(policy.minLength ?? 8, out.length);
  while (out.length < targetLength) out.push(pool[randomIndex(pool.length)]);

  // Fisher-Yates. The required-class characters were pushed first; without a
  // uniform shuffle they would cluster at the front.
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}
