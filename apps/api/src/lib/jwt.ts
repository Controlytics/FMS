import * as jose from 'jose';
import { randomBytes } from 'node:crypto';

function getSecret(envVar: string, name: string): Uint8Array {
  const value = process.env[envVar];
  if (!value || value.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`FATAL: ${envVar} must be set to a string of at least 32 characters in production.`);
    }
    // Dev-only: generate random secret per process start and warn
    const generated = randomBytes(32).toString('hex');
    console.warn(`WARNING: ${envVar} not set or too short. Using random secret for this session. Set ${envVar} in .env for persistent sessions.`);
    return new TextEncoder().encode(generated);
  }
  return new TextEncoder().encode(value);
}

const JWT_SECRET = getSecret('JWT_SECRET', 'JWT signing');
const VERIFY_SECRET = getSecret('VERIFICATION_TOKEN_SECRET', 'Verification token');

export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  sessionId: string;
}

export async function signToken(payload: JwtPayload, expirationHours = 8): Promise<string> {
  return new jose.SignJWT(payload as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${expirationHours}h`)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  const { payload } = await jose.jwtVerify(token, JWT_SECRET);
  return payload as unknown as JwtPayload;
}

export async function signVerificationToken(userId: string): Promise<string> {
  return new jose.SignJWT({ sub: userId, purpose: 'reauth' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(VERIFY_SECRET);
}

export async function verifyVerificationToken(token: string): Promise<{ sub: string }> {
  const { payload } = await jose.jwtVerify(token, VERIFY_SECRET);
  return { sub: payload.sub as string };
}
