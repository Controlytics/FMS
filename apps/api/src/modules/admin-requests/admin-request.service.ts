import { PrismaClient } from '@prisma/client';
import { auditLog } from '../../lib/audit.js';
import { stripHtml } from '../../lib/sanitize.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { userService, assertCanManageTarget } from '../users/user.service.js';
import { userRepository } from '../users/user.repository.js';
import { updateUserSchema, generatePassword } from '@digilog/shared';
import type { PasswordGeneratorPolicy } from '@digilog/shared';
import { authRepository } from '../auth/auth.repository.js';
import type { RequestContext } from '../../types/context.js';

const prisma = new PrismaClient();

/**
 * What the request is ABOUT — the subject — not who asked for it.
 *
 * 2026-09-02 (operator report): the audit name was built from the REQUESTER, so
 * a request by 101010 (ADMIN) to create user 101021 as SUPERVISOR was recorded
 * as `"Create User — Admin User (101010)"`. The account being created, and the
 * role being asked for, appeared nowhere in the trail — the two facts an
 * inspector most needs. Same for unlock/enable/disable, which named the
 * requester instead of the account being acted on.
 *
 * Requester and subject are frequently different people, and for CREATE_USER the
 * subject does not exist yet, so it can only come from the submitted payload.
 */
export function describeRequestSubject(requestType: string, data: Record<string, any>): string {
  const username = String(data?.username ?? '').trim();
  switch (requestType) {
    case 'CREATE_USER': {
      const fullName = String(data?.fullName ?? '').trim();
      const role = String(data?.requestedRole ?? '').trim();
      const who = [username || '(no user ID)', fullName ? `(${fullName})` : ''].filter(Boolean).join(' ');
      return role ? `${who}, role ${role}` : who;
    }
    case 'MODIFY_USER': {
      const field = String(data?.modifyField ?? '').trim();
      const value = data?.newValue === undefined || data?.newValue === null ? '' : String(data.newValue).trim();
      if (!field) return username || '(no user ID)';
      // "101020, role OPERATOR -> SUPERVISOR"; older rows without currentRole
      // keep the original "101020, role -> SUPERVISOR".
      const from = data?.currentRole ? `${String(data.currentRole).trim()} ` : '';
      return `${username || '(no user ID)'}, ${field} ${from}-> ${value || '(blank)'}`;
    }
    default:
      // UNLOCK / ENABLE_ACCOUNT / DISABLE_ACCOUNT / FORGOT_PASSWORD all act on
      // one existing account.
      return username || '(no user ID)';
  }
}

/**
 * The subject as STRUCTURED fields alongside the readable label, so an inspector
 * can filter on the target account without parsing a sentence.
 */
export function subjectFields(requestType: string, data: Record<string, any>) {
  const out: Record<string, unknown> = {
    targetUsername: String(data?.username ?? '').trim() || null,
  };
  if (requestType === 'CREATE_USER') {
    out.targetFullName = String(data?.fullName ?? '').trim() || null;
    out.requestedRole = String(data?.requestedRole ?? '').trim() || null;
  }
  if (requestType === 'MODIFY_USER') {
    out.modifyField = String(data?.modifyField ?? '').trim() || null;
    if (data?.currentRole) out.currentRole = data.currentRole;
    out.newValue = data?.newValue ?? null;
  }
  return out;
}

/**
 * The requester's role, resolved SERVER-side from their employee ID.
 *
 * 2026-09-02: the audit rows recorded who submitted a request but never their
 * role — `ADMIN_REQUEST_SUBMITTED` passed `userId` and omitted `userRole`
 * entirely, so `audit_trail.user_role` was blank on every submission. An
 * inspector could see that 101010 asked for an account change but not the
 * authority they held when they asked.
 *
 * Never taken from the client: the contact-admin form is a PUBLIC endpoint, so a
 * self-declared role would be an unauthenticated claim written into a §11
 * record. Returns null when the ID matches no user (legacy rows, typos) — the
 * audit clause degrades to the id alone rather than asserting something false.
 */
async function resolveRequesterRole(employeeId: string | null | undefined): Promise<string | null> {
  const id = (employeeId ?? '').trim();
  if (!id) return null;
  try {
    const user = await userRepository.findByUsername(id);
    return (user as any)?.role ?? null;
  } catch {
    return null;
  }
}

/**
 * 2026-10-01 (operator request): a Modify User request changes the ROLE only.
 * The public form offers nothing else, and the server refuses anything else, so
 * a hand-crafted submission cannot ask for an email / name / status change.
 *
 * `currentRole` is stamped from the users table, never taken from the client,
 * so the approver sees the real "from" role as it was when the request was made.
 * Requests submitted before this change (other fields) can still be approved —
 * executeApproval is unchanged.
 */
async function validateRoleChangeRequest(raw: Record<string, unknown>): Promise<Record<string, unknown>> {
  const username = String(raw.username ?? '').trim();
  const newRole = String(raw.newValue ?? '').trim();
  if (String(raw.modifyField ?? '').trim() !== 'role') {
    throw new ValidationError('Only the role can be changed through a Modify User request');
  }
  if (!username) throw new ValidationError('Employee ID of the account to modify is required');
  if (!newRole) throw new ValidationError('New role is required');
  const user = await prisma.user.findUnique({ where: { username }, select: { role: true } });
  if (!user) throw new ValidationError(`Employee ID "${username}" does not exist`);
  // A SUPER_ADMIN account is never the subject of, nor the result of, a public request.
  if (user.role === 'SUPER_ADMIN' || newRole === 'SUPER_ADMIN') {
    throw new ValidationError('This role change cannot be requested here');
  }
  const role = await prisma.role.findUnique({ where: { name: newRole }, select: { isActive: true } });
  if (!role?.isActive) throw new ValidationError(`Role "${newRole}" is not an active role`);
  if (newRole === user.role) throw new ValidationError('The new role must differ from the current role');
  return { username, modifyField: 'role', currentRole: user.role, newValue: newRole };
}

export const adminRequestService = {
  async create(data: {
    requestType: string;
    requesterName: string;
    requesterEmployeeId?: string;
    requesterEmail?: string;
    requestData: Record<string, unknown>;
    remarks?: string;
  }) {
    // Audit 2026-09-04 (Low #3): the public user-lookup now returns a MASKED name,
    // which the form echoes back as requesterName. When the employee ID matches a
    // user, the record carries that user's real name from the users table, not
    // whatever the caller typed.
    let requesterName = stripHtml(data.requesterName);
    if (data.requesterEmployeeId) {
      const known = await prisma.user.findUnique({ where: { username: stripHtml(data.requesterEmployeeId) }, select: { fullName: true } });
      if (known?.fullName) requesterName = known.fullName;
    }
    if (data.requestType === 'MODIFY_USER') {
      data = { ...data, requestData: await validateRoleChangeRequest(data.requestData ?? {}) };
    }
    const request = await prisma.adminRequest.create({
      data: {
        requestType: data.requestType,
        requesterName,
        requesterEmployeeId: data.requesterEmployeeId ? stripHtml(data.requesterEmployeeId) : null,
        requesterEmail: data.requesterEmail ?? null,
        requestData: data.requestData as any,
        remarks: data.remarks ? stripHtml(data.remarks) : null,
        status: 'PENDING',
      },
    });

    // Audit log (no userId since this is a public endpoint)
    const requesterLabel = request.requesterEmployeeId
      ? `${request.requesterName} (${request.requesterEmployeeId})`
      : request.requesterName;
    // The NAME describes the subject; the requester is carried separately by
    // {requesterClause}. It used to be the requester in both places.
    const subject = describeRequestSubject(request.requestType, data.requestData ?? {});
    const submittedName = `${formatRequestType(request.requestType)}: ${subject}`;
    const requesterRole = await resolveRequesterRole(request.requesterEmployeeId);
    await auditLog({
      // Audit 2026-09-24 (api #4): the submit endpoint is PUBLIC, so the typed
      // employee id is a claim, not an identity — it must not land in user_id
      // as if that user had acted. The claim stays in afterValue.
      userId: `unverified:${request.requesterEmployeeId ?? 'unknown'}`,
      // Was omitted entirely, leaving audit_trail.user_role blank on every
      // submission. The requester's authority is part of the record.
      userRole: requesterRole ?? undefined,
      action: 'ADMIN_REQUEST_SUBMITTED',
      targetType: 'admin_request',
      targetId: request.id,
      afterValue: {
        name: submittedName,
        requestType: request.requestType,
        operation: formatRequestType(request.requestType),
        requesterName: request.requesterName,
        requesterEmployeeId: request.requesterEmployeeId,
        requesterRole,
        ...subjectFields(request.requestType, data.requestData ?? {}),
      },
      reason: `${formatRequestType(request.requestType)} request for ${subject}, submitted by ${requesterLabel}`,
      signatureMeaning: `Admin request (${formatRequestType(request.requestType)}) for ${subject}, submitted by ${requesterLabel}`,
    });

    // Create notification for admins
    await prisma.notification.create({
      data: {
        type: 'USER_CREATION_REQUEST_SUBMITTED',
        title: `New ${formatRequestType(request.requestType)} Request`,
        message: `${request.requesterName} submitted a ${formatRequestType(request.requestType).toLowerCase()} request.`,
        forRole: 'SUPER_ADMIN',
        metadata: { requestId: request.id, requestType: request.requestType },
      },
    });

    return request;
  },

  async list(status?: string) {
    const where = status ? { status } : {};
    return prisma.adminRequest.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
    });
  },

  async pendingCount() {
    return prisma.adminRequest.count({ where: { status: 'PENDING' } });
  },

  async getById(id: string) {
    return prisma.adminRequest.findUnique({ where: { id } });
  },

  async process(
    id: string,
    action: 'approve' | 'reject',
    adminRemarks: string,
    ctx: RequestContext,
  ) {
    const request = await prisma.adminRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundError('Request not found');
    if (request.status !== 'PENDING') throw new ValidationError('Request has already been processed');

    const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';

    // CLAIM the request before executing anything.
    //
    // This used to execute first and update after, so a failed action left the
    // request PENDING and retryable. But the PENDING check above is a
    // check-then-act with no lock: two admins clicking Approve within the same
    // moment both passed it and both ran executeApproval, issuing TWO temp
    // passwords for one FORGOT_PASSWORD request. The first admin's password is
    // overwritten by the second before they can read it out, so it fails at
    // login — and two audit rows claim the same approval.
    //
    // Claiming atomically means the loser matches zero rows and stops before any
    // side effect. The retry-on-failure contract is preserved by the catch below.
    const claimed = await prisma.adminRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: newStatus,
        adminRemarks: adminRemarks ? stripHtml(adminRemarks) : null,
        processedBy: ctx.userId,
        processedAt: new Date(),
      },
    });
    if (claimed.count === 0) throw new ValidationError('Request has already been processed');

    let actionOutcome: ActionOutcome = {};
    if (action === 'approve') {
      try {
        actionOutcome = await executeApproval(request, ctx);
      } catch (err) {
        // Hand the request back so the admin can retry — the original
        // "if it fails, leave it PENDING" intent. Scoped to our own claim, so a
        // revert can never clobber someone else's decision.
        await prisma.adminRequest.updateMany({
          where: { id, status: newStatus, processedBy: ctx.userId },
          data: { status: 'PENDING', adminRemarks: null, processedBy: null, processedAt: null },
        });
        throw err;
      }
    }

    const updated = await prisma.adminRequest.findUniqueOrThrow({ where: { id } });

    // Audit log
    const requesterLabel = request.requesterEmployeeId
      ? `${request.requesterName} (${request.requesterEmployeeId})`
      : request.requesterName;
    const subject = describeRequestSubject(request.requestType, (request.requestData ?? {}) as Record<string, any>);
    const processedName = `${formatRequestType(request.requestType)}: ${subject}`;
    // Re-resolved at approval time rather than read back from anything the
    // submit path stashed — the role is whatever it is now, and the submitted
    // payload must not become a channel for asserting authority.
    const requesterRole = await resolveRequesterRole(request.requesterEmployeeId);
    const auditCommon = {
      operation: formatRequestType(request.requestType),
      requesterName: request.requesterName,
      requesterEmployeeId: request.requesterEmployeeId,
      requesterRole,
      ...subjectFields(request.requestType, (request.requestData ?? {}) as Record<string, any>),
    };
    await auditLog({
      userId: ctx.userId,
      userRole: ctx.userRole,
      action: action === 'approve' ? 'ADMIN_REQUEST_APPROVED' : 'ADMIN_REQUEST_REJECTED',
      targetType: 'admin_request',
      targetId: id,
      beforeValue: { name: processedName, status: 'PENDING', ...auditCommon },
      afterValue: {
        name: processedName, status: newStatus, adminRemarks, ...auditCommon,
        // Only meaningful on an APPROVAL. A rejection never calls
        // executeApproval, so `actionOutcome` is empty and the old
        // `!== false` default made every rejected row claim actionTaken=true —
        // asserting an action for a request that was explicitly refused.
        actionTaken: action === 'approve' ? actionOutcome.actionTaken !== false : false,
        outcome: actionOutcome.message ?? null,
      },
      // 2026-09-02: both of these named neither the subject nor the signer —
      // the signature meaning read literally "... approved by admin", the word
      // "admin", on a 21 CFR Part 11 electronic signature. The meaning of a
      // signature has to say who signed it and what for.
      reason: `${formatRequestType(request.requestType)} request for ${subject} ${newStatus.toLowerCase()} by ${ctx.userId} — ${adminRemarks}`
        + (actionOutcome.message ? ` (${actionOutcome.message})` : ''),
      signatureMeaning: `Admin request (${formatRequestType(request.requestType)}) for ${subject}, `
        + `${newStatus.toLowerCase()} by ${ctx.userId} (${ctx.userRole})`
        + (action === 'approve' && actionOutcome.actionTaken === false ? ' — no action was required' : ''),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      sessionId: ctx.sessionId,
    });

    return { ...updated, ...actionOutcome };
  },
};

async function executeApproval(
  request: { id: string; requestType: string; requestData: unknown; requesterName: string; requesterEmail: string | null },
  ctx: RequestContext,
): Promise<ActionOutcome> {
  const data = (request.requestData ?? {}) as Record<string, any>;
  switch (request.requestType) {
    case 'CREATE_USER': {
      // Email is optional (no longer mandatory on the contact-admin form).
      const email = String(data.email ?? '').trim();
      const fullName = String(data.fullName ?? request.requesterName).trim();
      const requestedRole = String(data.requestedRole ?? '').trim();
      const department = data.department ? String(data.department).trim() : undefined;
      if (!requestedRole) throw new ValidationError('Request is missing requested role');

      // Username: prefer the requester-supplied User ID (collected on the
      // contact-admin form). Legacy requests submitted before that field
      // existed have no `username` → fall back to an email-derived handle.
      const requestedUsername = String(data.username ?? '').trim();
      let username: string;
      if (requestedUsername) {
        if (requestedUsername.length < 6 || requestedUsername.length > 50) {
          throw new ValidationError('Requested User ID must be 6–50 characters');
        }
        const existing = await userRepository.findByUsername(requestedUsername);
        if (existing) throw new ValidationError(`User ID "${requestedUsername}" is already taken`);
        username = requestedUsername;
      } else {
        username = await generateUniqueUsername(email);
      }
      const temporaryPassword = await generateTempPassword();

      await userService.create(
        {
          username,
          fullName,
          email: email || undefined,
          department,
          role: requestedRole,
          password: temporaryPassword,
        },
        ctx,
      );
      return { username, temporaryPassword, message: `User "${username}" created.` };
    }

    case 'UNLOCK': {
      const { user, targetUsername } = await loadManageableTarget(data, ctx);
      // 2026-09-02: this used to unlock UNCONDITIONALLY. Approving an unlock for
      // an account that was never locked reset its password, forced a change,
      // terminated every live session, and wrote an ACCOUNT_UNLOCKED row
      // asserting a transition that never happened — a destructive no-reason
      // reset plus a false §11 record. The public user-lookup deliberately does
      // not expose status (enumeration oracle), so this check can only live here.
      //
      // Only LOCKED is unlockable. EXPIRED is deliberately NOT treated as
      // unlockable: unlock() issues a temporary password, so doing it here would
      // silently perform a password reset nobody asked for — the same surprise
      // this fix removes. Forgot Password is the request for that.
      if (user.status !== 'LOCKED') {
        return {
          username: targetUsername, actionTaken: false,
          message: `No action taken — account "${targetUsername}" is not locked (current status: ${user.status}).`
            + (user.status === 'EXPIRED'
              ? ' Its password has expired; submit a Forgot Password request to issue a new one.'
              : ''),
        };
      }
      const temporaryPassword = await generateTempPassword();
      await userService.unlock(user.id, temporaryPassword, ctx);
      return { username: targetUsername, temporaryPassword, actionTaken: true, message: `Account "${targetUsername}" unlocked.` };
    }

    case 'ENABLE_ACCOUNT': {
      const { user, targetUsername } = await loadManageableTarget(data, ctx);
      if (user.status === 'ENABLED') {
        return {
          username: targetUsername, actionTaken: false,
          message: `No action taken — account "${targetUsername}" is already enabled.`,
        };
      }
      // A LOCKED account is not enabled by flipping status: it still holds the
      // failed-attempt count and no usable password. Say so instead of half-doing it.
      if (user.status === 'LOCKED') {
        return {
          username: targetUsername, actionTaken: false,
          message: `No action taken — account "${targetUsername}" is locked, not disabled. Submit an Unlock Account request to restore access.`,
        };
      }
      await userService.enable(user.id, ctx);
      return { username: targetUsername, actionTaken: true, message: `Account "${targetUsername}" enabled (was ${user.status}).` };
    }

    case 'DISABLE_ACCOUNT': {
      const { user, targetUsername } = await loadManageableTarget(data, ctx);
      if (user.status === 'DISABLED') {
        return {
          username: targetUsername, actionTaken: false,
          message: `No action taken — account "${targetUsername}" is already disabled.`,
        };
      }
      await userService.disable(user.id, ctx);
      return { username: targetUsername, actionTaken: true, message: `Account "${targetUsername}" disabled (was ${user.status}).` };
    }

    case 'FORGOT_PASSWORD': {
      const targetUsername = String(data.username ?? '').trim();
      if (!targetUsername) throw new ValidationError('Request is missing username');
      const user = await userRepository.findByUsername(targetUsername);
      if (!user) throw new NotFoundError(`User "${targetUsername}" not found`);
      const temporaryPassword = await generateTempPassword();
      await userService.resetPassword(user.id, temporaryPassword, ctx);
      return { username: targetUsername, temporaryPassword, message: `Password reset for "${targetUsername}".` };
    }

    case 'MODIFY_USER': {
      const targetUsername = String(data.username ?? '').trim();
      const field = String(data.modifyField ?? '').trim();
      const newValue = data.newValue;
      if (!targetUsername) throw new ValidationError('Request is missing username');
      if (!field) throw new ValidationError('Request is missing modifyField');
      const allowed = new Set(['fullName', 'email', 'department', 'role', 'status']);
      if (!allowed.has(field)) throw new ValidationError(`Field "${field}" cannot be modified via admin request`);
      const user = await userRepository.findByUsername(targetUsername);
      if (!user) throw new NotFoundError(`User "${targetUsername}" not found`);
      // Audit 2026-09-24 (F6): `requestData` comes from the PUBLIC, unauthenticated
      // submit endpoint (`additionalProperties: true`) and was passed straight to
      // userService.update — bypassing updateUserSchema. A non-string email blew
      // up with a 500 for the approver; `status: 'EXPIRED'` / `'LOCKED'` (valid
      // Prisma enum values the schema forbids) went through. Validate exactly as
      // PUT /api/users/:id does.
      const parsed = updateUserSchema.safeParse({ [field]: newValue });
      if (!parsed.success) {
        throw new ValidationError(`Requested value for "${field}" is not valid: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      }
      await userService.update(user.id, parsed.data, ctx);
      return { username: targetUsername, message: `User "${targetUsername}" updated (${field}).` };
    }

    default:
      throw new ValidationError(`Unknown request type: ${request.requestType}`);
  }
}

interface ActionOutcome {
  username?: string;
  temporaryPassword?: string;
  message?: string;
  /**
   * False when the approval was a deliberate no-op — the account was already in
   * the requested state. The request is still APPROVED (the admin did decide),
   * but no user record changed and no account-action audit row was written.
   */
  actionTaken?: boolean;
}

/**
 * Resolve the target user for an account-state request and prove the approver is
 * allowed to manage them — BEFORE any state is read.
 *
 * Ordering matters: `assertCanManageTarget` normally runs inside
 * userService.unlock/enable/disable, but the no-op guards return before those
 * are called. Without this, an ADMIN approving a request against a SUPER_ADMIN
 * would be told "already enabled" — leaking an account state they have no
 * authority over.
 */
async function loadManageableTarget(data: Record<string, any>, ctx: RequestContext) {
  const targetUsername = String(data.username ?? '').trim();
  if (!targetUsername) throw new ValidationError('Request is missing username');
  const user = await userRepository.findByUsername(targetUsername);
  if (!user) throw new NotFoundError(`User "${targetUsername}" not found`);
  await assertCanManageTarget(ctx.userRole, (user as any).role);
  return { user: user as any as { id: string; status: string; role: string }, targetUsername };
}

async function generateUniqueUsername(email: string): Promise<string> {
  const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40) || 'user';
  let candidate = base;
  for (let i = 2; i < 200; i++) {
    const existing = await userRepository.findByUsername(candidate);
    if (!existing) return candidate;
    candidate = `${base}${i}`;
  }
  throw new ValidationError('Could not generate a unique username — please create user manually');
}

/**
 * Temporary password for an approved CREATE_USER / UNLOCK / FORGOT_PASSWORD
 * request: the shared generator, at the live policy's minimum length — the same
 * rule as every temporary password issued from the Users pages. This used to be
 * a fixed 14 characters that never read the policy (2026-10-07).
 */
async function generateTempPassword(): Promise<string> {
  const policy = await authRepository.getPasswordPolicyConfig();
  return generatePassword(policy as PasswordGeneratorPolicy);
}

function formatRequestType(type: string): string {
  switch (type) {
    case 'CREATE_USER': return 'Create User';
    case 'MODIFY_USER': return 'Modify User';
    case 'UNLOCK': return 'Unlock Account';
    case 'ENABLE_ACCOUNT': return 'Enable Account';
    case 'DISABLE_ACCOUNT': return 'Disable Account';
    case 'FORGOT_PASSWORD': return 'Forgot Password';
    default: return type;
  }
}
