import * as jose from 'jose';

if (!process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is required. Set it to a random 64+ character string.');
}
if (!process.env.VERIFICATION_TOKEN_SECRET) {
  throw new Error('FATAL: VERIFICATION_TOKEN_SECRET environment variable is required. Set it to a random 64+ character string.');
}

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
const VERIFY_SECRET = new TextEncoder().encode(process.env.VERIFICATION_TOKEN_SECRET);

export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  sessionId: string;
}

export async function signToken(payload: JwtPayload): Promise<string> {
  return new jose.SignJWT(payload as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
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
