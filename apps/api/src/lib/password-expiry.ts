/**
 * Compute whether a user's password is expired under the live policy.
 *
 * Replaces direct reads of `users.password_expires_at`. That column is a
 * frozen snapshot baked in at password-change / create / unlock / reset
 * time — when an admin lowers `passwordExpiryDays` later, no existing
 * user's stored value moves, so the policy change has no effect.
 * Deriving from `passwordChangedAt` + the live policy makes policy edits
 * apply to everyone, but on a fresh clock (see policyUpdatedAt below).
 *
 * `passwordExpiryDays === 0` (or absent) means "no expiry" — matches the
 * `changePassword` semantics: `expiryDays > 0 ? ... : null`.
 *
 * Falls back to `createdAt` when `passwordChangedAt` is null (legacy
 * users created before the column was populated).
 *
 * **Policy-change grace period (`policyUpdatedAt`).** The anchor is floored
 * at the policy's own `updatedAt` timestamp. Lowering the policy (e.g.
 * 120 → 1 day) therefore grants every user a fresh `days`-long window
 * from the moment the admin clicked Save, rather than instantly expiring
 * everyone whose last password change is older than the new window.
 * Without this floor, dropping the policy from 120 to 1 mass-locks
 * everyone including superadmin the moment the policy is saved — the
 * exact bug reported on 2026-05-25.
 */
export function isPasswordExpired(
  passwordChangedAt: Date | null,
  createdAt: Date,
  passwordExpiryDays: number | undefined | null,
  policyUpdatedAt: Date | null,
): boolean {
  if (!passwordExpiryDays || passwordExpiryDays <= 0) return false;
  const passwordAnchor = passwordChangedAt ?? createdAt;
  if (!passwordAnchor) return false;
  const anchor =
    policyUpdatedAt && policyUpdatedAt.getTime() > passwordAnchor.getTime()
      ? policyUpdatedAt
      : passwordAnchor;
  const expiresAt = anchor.getTime() + passwordExpiryDays * 86_400_000;
  return expiresAt < Date.now();
}
