-- Filter create / bulk-upload -> review -> approve workflow (2026-09-04)
--
-- Purely additive. `approval_status` DEFAULTS TO 'APPROVED' so every existing
-- row keeps working: this table holds Blocks, Areas and AHUs as well as the 199
-- live filters, and none of those have an approval workflow. Only the two
-- FILTER creation paths ever write another value, and only while
-- system_config['filter-approval'].workflowEnabled is true (default false).
--
-- Reuses the existing pm_entry_approval_status enum rather than adding a
-- near-identical one; replacement_entries already reuses it the same way.
--
-- The `deviations.deviation_number SET DEFAULT` line that `migrate diff` also
-- emits is pre-existing baseline noise and is deliberately NOT included.

-- AlterTable
ALTER TABLE "asset_instances" ADD COLUMN     "approval_remarks" TEXT,
ADD COLUMN     "approval_status" "pm_entry_approval_status" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "approved_at" TIMESTAMPTZ,
ADD COLUMN     "approved_by" UUID,
ADD COLUMN     "approved_by_name" VARCHAR(255),
ADD COLUMN     "rejected_at" TIMESTAMPTZ,
ADD COLUMN     "rejected_by" UUID,
ADD COLUMN     "rejected_by_name" VARCHAR(255),
ADD COLUMN     "rejection_remarks" TEXT,
ADD COLUMN     "review_remarks" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMPTZ,
ADD COLUMN     "reviewed_by" UUID,
ADD COLUMN     "reviewed_by_name" VARCHAR(255),
ADD COLUMN     "submitted_at" TIMESTAMPTZ,
ADD COLUMN     "submitted_by" UUID,
ADD COLUMN     "submitted_by_name" VARCHAR(255);

-- CreateIndex
CREATE INDEX "asset_instances_approval_status_idx" ON "asset_instances"("approval_status");
