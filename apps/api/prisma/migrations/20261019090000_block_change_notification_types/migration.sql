-- QA-D005 (2026-10-19): block-change notification types.
-- block-change.service.ts has sent BLOCK_CHANGE_REQUESTED (to approvers) and
-- BLOCK_CHANGE_APPROVED / _REJECTED (to the requester) since 2026-05-25, but the
-- values were never added to the enum, so every one of those notifications failed
-- Prisma's enum validation and was swallowed by the non-fatal try/catch.
-- Additive only; same pattern as 20260708050513_add_password_expiry_notification_types.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BLOCK_CHANGE_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BLOCK_CHANGE_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BLOCK_CHANGE_REJECTED';
