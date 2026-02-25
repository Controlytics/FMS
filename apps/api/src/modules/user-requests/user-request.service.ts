import crypto from 'node:crypto';
import type { RequestContext } from '../../types/context.js';
import { auditLog } from '../../lib/audit.js';
import { hashPassword } from '../../lib/password.js';
import { validateUserId } from '../../lib/user-id-validator.js';
import { userIdConfigSchema } from '@digilog/shared';
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from '../../lib/errors.js';
import { userRequestRepository } from './user-request.repository.js';
import { userRepository } from '../users/user.repository.js';
import { createNotification } from '../notifications/notification.service.js';

/**
 * Generates a cryptographically random temporary password.
 * 16 chars with guaranteed uppercase, lowercase, digits, and special characters.
 */
function generateTempPassword(): string {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const special = '!@#$%^&*()_+-=';
  const all = upper + lower + digits + special;

  const pick = (chars: string) => chars[crypto.randomInt(chars.length)];

  // Guarantee at least 2 of each category
  const mandatory = [
    pick(upper), pick(upper),
    pick(lower), pick(lower),
    pick(digits), pick(digits),
    pick(special), pick(special),
  ];

  // Fill remaining with random chars
  while (mandatory.length < 16) {
    mandatory.push(pick(all));
  }

  // Shuffle using Fisher-Yates
  for (let i = mandatory.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [mandatory[i], mandatory[j]] = [mandatory[j], mandatory[i]];
  }

  return mandatory.join('');
}

export const userRequestService = {
  /** Public: get active roles for the request form */
  async getActiveRoles() {
    return userRequestRepository.findActiveRoles();
  },

  /** Public: get user-id format rules for client-side validation hints */
  async getUserIdRules() {
    const raw = await userRequestRepository.getUserIdConfig();
    const cfg = userIdConfigSchema.safeParse(raw);
    const config = cfg.success ? cfg.data : userIdConfigSchema.parse({});

    return {
      length: config.length,
      format: config.format,
      prefix: config.prefix,
      prefixSeparator: config.prefixSeparator,
      letterCase: config.letterCase,
      customPatternDescription: config.customPatternDescription,
      customPatternExample: config.customPatternExample,
    };
  },

  /** Public: check if userId or email is already taken */
  async checkAvailability(data: { userId?: string; email?: string }) {
    const result: { userIdAvailable?: boolean; userIdError?: string; emailAvailable?: boolean; emailError?: string } = {};

    if (data.userId) {
      // Validate format first
      const validation = await validateUserId(data.userId);
      if (!validation.valid) {
        result.userIdAvailable = false;
        result.userIdError = validation.errors.join('. ');
      } else {
        // Check existing user
        const existingUser = await userRepository.findByUsername(data.userId);
        if (existingUser) {
          result.userIdAvailable = false;
          result.userIdError = 'User ID is already in use';
        } else {
          // Check pending request
          const pending = await userRequestRepository.findPendingByUserIdOrEmail(data.userId, '');
          if (pending) {
            result.userIdAvailable = false;
            result.userIdError = 'A pending request already exists for this User ID';
          } else {
            result.userIdAvailable = true;
          }
        }
      }
    }

    if (data.email) {
      const existingUser = await userRepository.findByEmail(data.email);
      if (existingUser) {
        result.emailAvailable = false;
        result.emailError = 'Email is already in use';
      } else {
        const pending = await userRequestRepository.findPendingByUserIdOrEmail('', data.email);
        if (pending) {
          result.emailAvailable = false;
          result.emailError = 'A pending request already exists for this email';
        } else {
          result.emailAvailable = true;
        }
      }
    }

    return result;
  },

  /** Public: submit a new user creation request */
  async submit(data: {
    requestedUserId: string;
    fullName: string;
    department?: string;
    email: string;
    roleName: string;
  }, ipAddress: string) {
    // Validate user ID against system config
    const validation = await validateUserId(data.requestedUserId);
    if (!validation.valid) {
      throw new ValidationError(validation.errors.join('. '));
    }

    // Verify requested role exists and is active
    const role = await userRequestRepository.findActiveRole(data.roleName);
    if (!role) {
      throw new ValidationError(`Role "${data.roleName}" does not exist or is inactive`);
    }

    // Check for duplicate user ID or email in existing users
    const existingUser = await userRepository.findByUsernameOrEmail(
      data.requestedUserId, data.email
    );
    if (existingUser) {
      const field = existingUser.username === data.requestedUserId ? 'User ID' : 'Email';
      throw new ConflictError(`${field} is already in use`);
    }

    // Check for duplicate pending request
    const pendingRequest = await userRequestRepository.findPendingByUserIdOrEmail(
      data.requestedUserId, data.email
    );
    if (pendingRequest) {
      throw new ConflictError('A pending request already exists for this User ID or email');
    }

    const request = await userRequestRepository.create({ ...data, ipAddress });

    // Audit log (no userId — this is a public action)
    await auditLog({
      action: 'USER_CREATION_REQUEST_SUBMITTED',
      targetType: 'user_creation_request',
      targetId: request.id,
      afterValue: {
        requestedUserId: data.requestedUserId,
        fullName: data.fullName,
        email: data.email,
        roleName: data.roleName,
      },
      ipAddress,
      signatureMeaning: 'Public user creation request submitted',
    });

    // Notify admins
    await createNotification({
      type: 'USER_CREATION_REQUEST_SUBMITTED',
      title: 'New User Creation Request',
      message: `New account request from ${data.fullName} (${data.requestedUserId}) for role ${data.roleName}.`,
      forRole: 'ADMIN',
      metadata: { requestId: request.id, requestedUserId: data.requestedUserId },
    });

    return {
      id: request.id,
      message: 'Your account creation request has been submitted. An administrator will review it.',
    };
  },

  /** Admin: list requests (paginated, filterable) */
  async list(query: { page: number; limit: number; status?: string; search?: string }) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { requestedUserId: { contains: query.search, mode: 'insensitive' } },
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const { requests, total } = await userRequestRepository.findMany(
      where, query.page, query.limit
    );

    return {
      data: requests.map(r => ({
        id: r.id,
        requestedUserId: r.requestedUserId,
        fullName: r.fullName,
        department: r.department,
        email: r.email,
        roleName: r.roleName,
        status: r.status,
        requestedAt: r.requestedAt,
        reviewedAt: r.reviewedAt,
        reviewedBy: r.reviewer?.username ?? null,
        reviewerFullName: r.reviewer?.fullName ?? null,
        rejectionReason: r.rejectionReason,
        isPasswordViewed: r.isPasswordViewed,
        ipAddress: r.ipAddress,
      })),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  },

  /** Admin: get pending count */
  async getPendingCount() {
    return { count: await userRequestRepository.countPending() };
  },

  /** Admin: get single request detail */
  async getById(id: string) {
    const request = await userRequestRepository.findById(id);
    if (!request) throw new NotFoundError('User creation request not found');
    return {
      id: request.id,
      requestedUserId: request.requestedUserId,
      fullName: request.fullName,
      department: request.department,
      email: request.email,
      roleName: request.roleName,
      status: request.status,
      requestedAt: request.requestedAt,
      reviewedAt: request.reviewedAt,
      reviewedBy: request.reviewer?.username ?? null,
      reviewerFullName: request.reviewer?.fullName ?? null,
      rejectionReason: request.rejectionReason,
      isPasswordViewed: request.isPasswordViewed,
      ipAddress: request.ipAddress,
    };
  },

  /** Admin: approve request — creates user with temp password */
  async approve(id: string, ctx: RequestContext) {
    const request = await userRequestRepository.findById(id);
    if (!request) throw new NotFoundError('User creation request not found');
    if (request.status !== 'PENDING') {
      throw new ValidationError('Only pending requests can be approved');
    }

    // Role hierarchy check
    const approverRole = await userRepository.findRole(ctx.userRole);
    const requestedRole = await userRepository.findRole(request.roleName);
    if (!approverRole || !requestedRole) {
      throw new ForbiddenError('Role hierarchy check failed');
    }
    if (requestedRole.hierarchyLevel > approverRole.hierarchyLevel) {
      throw new ForbiddenError(`Cannot approve creation of users with role "${request.roleName}"`);
    }

    // Re-check uniqueness at approval time (prevent stale approvals)
    const existingUser = await userRepository.findByUsernameOrEmail(
      request.requestedUserId, request.email
    );
    if (existingUser) {
      const field = existingUser.username === request.requestedUserId ? 'User ID' : 'Email';
      throw new ConflictError(`${field} is already in use. The request may be outdated.`);
    }

    // Generate temp password and create user
    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    const passwordExpiresAt = await userRepository.getPasswordExpiresAt();

    const user = await userRepository.create({
      username: request.requestedUserId,
      fullName: request.fullName,
      email: request.email,
      department: request.department ?? undefined,
      role: request.roleName,
      passwordHash,
      status: 'ENABLED',
      forcePasswordChange: true,
      isTemporaryPassword: true,
      passwordExpiresAt,
      createdBy: ctx.userId,
    });

    await userRepository.addPasswordHistory(user.id, passwordHash);

    // Mark request as approved with hashed temp password
    const tempHash = await hashPassword(tempPassword);
    await userRequestRepository.approve(id, ctx.userSub, tempHash);

    // Audit: request approved
    await auditLog({
      userId: ctx.userId,
      userRole: ctx.userRole,
      action: 'USER_CREATION_REQUEST_APPROVED',
      targetType: 'user_creation_request',
      targetId: id,
      afterValue: {
        requestedUserId: request.requestedUserId,
        fullName: request.fullName,
        roleName: request.roleName,
      },
      signatureMeaning: 'User creation request approved by administrator',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      sessionId: ctx.sessionId,
    });

    // Audit: user created
    await auditLog({
      userId: ctx.userId,
      userRole: ctx.userRole,
      action: 'USER_CREATED',
      targetType: 'user',
      targetId: request.requestedUserId,
      afterValue: {
        username: request.requestedUserId,
        fullName: request.fullName,
        email: request.email,
        role: request.roleName,
        status: 'ENABLED',
        source: 'user_creation_request',
      },
      signatureMeaning: 'New user account created from approved creation request',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      sessionId: ctx.sessionId,
    });

    // Notify admins
    await createNotification({
      type: 'USER_CREATION_REQUEST_APPROVED',
      title: 'User Creation Request Approved',
      message: `User ${request.fullName} (${request.requestedUserId}) created from approved request.`,
      targetUserId: request.requestedUserId,
      forRole: 'ADMIN',
      metadata: { requestId: id, userId: user.id, role: request.roleName },
      createdBy: ctx.userId,
    });

    return {
      success: true,
      message: 'Request approved and user account created.',
      tempPassword, // Plaintext returned ONCE only
      userId: user.id,
      username: user.username,
    };
  },

  /** Admin: reject request */
  async reject(id: string, rejectionReason: string, ctx: RequestContext) {
    const request = await userRequestRepository.findById(id);
    if (!request) throw new NotFoundError('User creation request not found');
    if (request.status !== 'PENDING') {
      throw new ValidationError('Only pending requests can be rejected');
    }

    await userRequestRepository.reject(id, ctx.userSub, rejectionReason);

    await auditLog({
      userId: ctx.userId,
      userRole: ctx.userRole,
      action: 'USER_CREATION_REQUEST_REJECTED',
      targetType: 'user_creation_request',
      targetId: id,
      afterValue: {
        requestedUserId: request.requestedUserId,
        fullName: request.fullName,
        rejectionReason,
      },
      signatureMeaning: 'User creation request rejected by administrator',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      sessionId: ctx.sessionId,
    });

    await createNotification({
      type: 'USER_CREATION_REQUEST_REJECTED',
      title: 'User Creation Request Rejected',
      message: `Account request from ${request.fullName} (${request.requestedUserId}) rejected.`,
      forRole: 'ADMIN',
      metadata: { requestId: id, rejectionReason },
      createdBy: ctx.userId,
    });

    return { success: true, message: 'Request rejected.' };
  },

  /** Admin: mark temp password as viewed */
  async markPasswordViewed(id: string) {
    const request = await userRequestRepository.findById(id);
    if (!request) throw new NotFoundError('User creation request not found');
    if (request.status !== 'APPROVED') {
      throw new ValidationError('Only approved requests have temporary passwords');
    }
    await userRequestRepository.markPasswordViewed(id);
    return { success: true };
  },
};
