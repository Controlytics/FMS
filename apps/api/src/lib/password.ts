import bcrypt from 'bcrypt';

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10);

// Pre-computed dummy hash for timing-safe user enumeration prevention
const DUMMY_HASH = '$2b$12$LJ3m4ys3Lg2VBe2TFhMKjeMaHGfVredEoJESQqHGCfsMpV1VXRP.W';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Run a dummy bcrypt compare to prevent timing-based user enumeration */
export async function dummyVerify(password: string): Promise<void> {
  await bcrypt.compare(password, DUMMY_HASH);
}
