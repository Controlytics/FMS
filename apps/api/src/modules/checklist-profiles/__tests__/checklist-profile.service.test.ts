import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Phase 8.4a — versioning regression coverage for ChecklistProfileService.
 *
 * Phase A.1 (2026-05-01) introduced snapshot-then-bump for every mutation of
 * a checklist profile or its questions. These tests pin that contract so a
 * future refactor cannot silently revert the live row to a non-versioned
 * update path.
 *
 * Mocking strategy mirrors filter-operations/__tests__/get-current-state.test.ts:
 * vi.hoisted prisma mock with vi.mock('../../../lib/prisma.js'). The service
 * uses prisma.$transaction directly, so the mock returns the same prisma
 * client as the tx callback argument — every tx.* call is the same vi.fn()
 * we assert on.
 */

const { mockPrisma, mockAuditLog } = vi.hoisted(() => {
  const checklistProfile = {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  };
  const checklistProfileVersion = {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  };
  const checklistQuestion = {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    aggregate: vi.fn(),
  };
  const filterPipelineStage = { count: vi.fn() };

  const prisma: any = {
    checklistProfile,
    checklistProfileVersion,
    checklistQuestion,
    filterPipelineStage,
    $queryRaw: vi.fn(),
    $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(prisma)),
  };
  return { mockPrisma: prisma, mockAuditLog: vi.fn() };
});

vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../lib/audit.js', () => ({ auditLog: mockAuditLog }));

import { ChecklistProfileService } from '../checklist-profile.service.js';

const ctx: any = {
  userId: 'admin-user-id',
  userSub: 'admin-sub',
  userRole: 'ADMIN',
  ipAddress: '127.0.0.1',
  userAgent: 'test',
  sessionId: 'sess-1',
};

const PROFILE_ID = '11111111-1111-1111-1111-111111111111';

describe('ChecklistProfileService versioning (Phase A.1 / 8.4a)', () => {
  let service: ChecklistProfileService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditLog.mockResolvedValue(undefined);
    // Re-bind $transaction since vi.clearAllMocks resets the implementation.
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma));
    service = new ChecklistProfileService();
  });

  describe('create', () => {
    it('creates profile at version=1 and writes NO sidecar row (lazy first-version)', async () => {
      mockPrisma.checklistProfile.create.mockResolvedValue({
        id: PROFILE_ID,
        name: 'Wash-In Checklist',
        description: 'Operator pre-checks',
        version: 1,
        isActive: true,
      });

      const result = await service.create(ctx, { name: 'Wash-In Checklist', description: 'Operator pre-checks' });

      expect(result.version).toBe(1);
      // The Phase A.1 service comment (lines 159-160) is explicit: first version
      // is the live row itself — no sidecar archive on create. If a future
      // refactor flips this to eager-archive, our offline replay assumptions
      // (live row IS v1) silently break, so guard it here.
      expect(mockPrisma.checklistProfileVersion.create).not.toHaveBeenCalled();
      expect(mockPrisma.checklistProfile.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Wash-In Checklist',
            description: 'Operator pre-checks',
            createdBy: ctx.userSub,
          }),
        }),
      );
      expect(mockAuditLog).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('snapshots OUTGOING state into ChecklistProfileVersion, then bumps live version', async () => {
      // The pre-update live row that snapshotProfile() reads inside the tx.
      mockPrisma.checklistProfile.findUnique.mockResolvedValue({
        id: PROFILE_ID,
        name: 'Old Name',
        description: 'Old description',
        isActive: true,
        version: 3,
        questions: [
          {
            id: 'q1',
            question: 'Is the filter installed correctly?',
            questionType: 'YES_NO',
            required: true,
            section: 'Pre-checks',
            description: null,
            options: [],
            validation: {},
            sortOrder: 0,
          },
        ],
      });

      mockPrisma.checklistProfileVersion.create.mockResolvedValue({});
      mockPrisma.checklistProfile.update
        .mockResolvedValueOnce({ id: PROFILE_ID, version: 4 }) // bump call inside snapshotAndBump
        .mockResolvedValueOnce({                                 // actual update call
          id: PROFILE_ID,
          name: 'New Name',
          description: 'Old description',
          isActive: true,
          version: 4,
        });

      const result = await service.update(ctx, PROFILE_ID, { name: 'New Name' });

      // 1) Sidecar archived the OUTGOING (version=3) snapshot, not v4.
      expect(mockPrisma.checklistProfileVersion.create).toHaveBeenCalledTimes(1);
      const archivedCall = mockPrisma.checklistProfileVersion.create.mock.calls[0][0];
      expect(archivedCall.data.profileId).toBe(PROFILE_ID);
      expect(archivedCall.data.versionNumber).toBe(3);
      expect(archivedCall.data.snapshot).toMatchObject({
        name: 'Old Name',
        description: 'Old description',
        isActive: true,
        questions: [
          expect.objectContaining({ id: 'q1', question: 'Is the filter installed correctly?' }),
        ],
      });
      expect(archivedCall.data.createdBy).toBe(ctx.userSub);

      // 2) Live row's version was incremented inside the same transaction.
      expect(mockPrisma.checklistProfile.update).toHaveBeenCalledTimes(2);
      const bumpCall = mockPrisma.checklistProfile.update.mock.calls[0][0];
      expect(bumpCall).toEqual({
        where: { id: PROFILE_ID },
        data: { version: { increment: 1 } },
      });

      // 3) The actual content update happened second, with only the changed field.
      const updateCall = mockPrisma.checklistProfile.update.mock.calls[1][0];
      expect(updateCall.where).toEqual({ id: PROFILE_ID });
      expect(updateCall.data).toEqual({ name: 'New Name' });

      // 4) Returned the updated row.
      expect(result.version).toBe(4);
      expect(result.name).toBe('New Name');
    });

    it('addQuestion bumps version and snapshots prior state — locks down the question-mutation path that drives offline replay', async () => {
      // Pre-add live row.
      mockPrisma.checklistProfile.findUnique.mockResolvedValue({
        id: PROFILE_ID,
        name: 'Profile A',
        description: null,
        isActive: true,
        version: 7,
        questions: [], // adding the first question
      });
      mockPrisma.checklistQuestion.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
      mockPrisma.checklistProfileVersion.create.mockResolvedValue({});
      mockPrisma.checklistProfile.update.mockResolvedValue({ id: PROFILE_ID, version: 8 });
      mockPrisma.checklistQuestion.create.mockResolvedValue({
        id: 'q-new', profileId: PROFILE_ID, question: 'New Q?', sortOrder: 0,
      });

      const result = await service.addQuestion(ctx, PROFILE_ID, { question: 'New Q?' });

      // Snapshot of v7 archived BEFORE bumping or inserting the question.
      expect(mockPrisma.checklistProfileVersion.create).toHaveBeenCalledTimes(1);
      const archivedCall = mockPrisma.checklistProfileVersion.create.mock.calls[0][0];
      expect(archivedCall.data.versionNumber).toBe(7);
      expect(archivedCall.data.changeNotes).toMatch(/question added: New Q\?/);

      // Version bump happened.
      expect(mockPrisma.checklistProfile.update).toHaveBeenCalledWith({
        where: { id: PROFILE_ID },
        data: { version: { increment: 1 } },
      });

      // Question created with sortOrder=0 (max was null).
      expect(mockPrisma.checklistQuestion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ profileId: PROFILE_ID, question: 'New Q?', sortOrder: 0 }),
        }),
      );

      expect(result.id).toBe('q-new');
    });
  });
});
