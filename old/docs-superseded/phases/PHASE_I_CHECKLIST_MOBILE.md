# Phase I: Checklist & Mobile (3-4 days)

> **STATUS: COMPLETE** -- Deployed to production on 2026-03-07. Phase 2 Digital FMS completed 2026-03-27.
> Mobile checklist page, 14 field types, signature pad, photo capture, step sequencing, 3-tier approval workflow, electronic signature dialog, checklist response viewer all operational. Phase 2 adds pipeline checklist profiles (10 question types) integrated into cleaning workflows.

## Prompt for Claude Code

```
You are implementing Phase I (Checklist & Mobile) of DigiLog's Data Ingestion & Integration Layer.

Phases A-H are complete. Now you build the mobile-optimized checklist experience — the primary interface for manufacturing operators. Operators scan a QR code on equipment, fill out a checklist, add signatures, take photos, and submit for approval. This is the most compliance-critical UI in DigiLog.

IMPORTANT RULES:
- Master spec: DATA_INGESTION_REQUIREMENTS_v3.md
- 21 CFR Part 11 compliance is mandatory for this entire phase
- Steps MUST be completed in order (no skipping ahead)
- Electronic signatures: password re-entry + meaning of signature + cryptographic binding
- All 14 checklist field types must be supported
- Three-tier approval: Performed By → Checked By → Verified By
- Offline capable: save locally, sync when online (progressive enhancement)
- Mobile-first responsive design (operators use tablets on factory floor)

WHAT TO BUILD:

1. MOBILE CHECKLIST PAGE (apps/web/src/routes/checklist/[entityId].tsx):
   - Entry via QR scan → /m/{entityId}?action=checklist
   - If not logged in → redirect to login → redirect back after auth
   - Load entity's template → get active checklist definition
   - Render steps in order with progress indicator

2. CHECKLIST FORM (apps/web/src/components/checklist/checklist-form.tsx):
   Support ALL 14 field types:
   - TEXT: Single-line text input
   - TEXTAREA: Multi-line text area
   - NUMBER: Numeric input with min/max/resolution validation
     (Integer vs Float from template, decimal places match resolution)
   - BOOLEAN: Toggle switch (Yes/No)
   - SELECT: Dropdown from predefined options
   - MULTI_SELECT: Multi-checkbox from predefined options
   - DATE: Date picker
   - DATETIME: Date + time picker
   - TIME: Time picker
   - SIGNATURE: Signature pad (see #3)
   - PHOTO: Camera capture (see #4)
   - CALCULATED: Auto-computed from other fields (formula evaluation)
   - BARCODE_SCAN: Camera-based barcode/QR scanner
   - RANGE_SLIDER: Slider with min/max/step

   Each field:
   - Label, help text, required indicator
   - Validation on blur (immediate feedback)
   - Red border + error message on validation failure
   - Numeric fields enforce template constraints (min, max, resolution, integer vs float)
   - Conditional visibility (show field B only if field A = certain value)

3. SIGNATURE PAD (apps/web/src/components/checklist/signature-pad.tsx):
   - Use signature_pad@^5.0.0 library
   - Canvas-based handwritten signature capture
   - Clear / Redo buttons
   - Save as PNG data URL
   - Must be non-empty to proceed (validation)
   - Used for step-level signatures AND approval signatures

4. PHOTO CAPTURE (apps/web/src/components/checklist/photo-capture.tsx):
   - Camera access via navigator.mediaDevices.getUserMedia
   - Live preview, capture button
   - Photo review: retake or accept
   - Compress to JPEG (max 2MB, configurable)
   - Upload to /api/data/binary with entityId + checklist context
   - Display thumbnail in form after capture
   - Support multiple photos per field (configurable max)

5. STEP SEQUENCING:
   - Steps rendered as vertical stepper
   - Current step highlighted, future steps grayed out
   - Cannot proceed to next step until current step is valid
   - Can go back to review previous steps (read-only once submitted)
   - Each step may have its own signature requirement
   - Progress saved locally (localStorage) for crash recovery

6. APPROVAL WORKFLOW STEPPER (apps/web/src/components/checklist/approval-stepper.tsx):
   Three-tier approval flow:

   Step 1 — PERFORMED BY (operator):
   - Fill all checklist fields
   - Sign (signature pad + electronic signature)
   - Submit → creates ChecklistReview with performedBy, performedAt, performedSignatureId

   Step 2 — CHECKED BY (reviewer):
   - Review all submitted values (read-only view)
   - Can add comments per field
   - APPROVE → signs + electronic signature → checkedBy, checkedAt, checkedSignatureId
   - REJECT → must provide reason → status back to PERFORMED (operator must redo)

   Step 3 — VERIFIED BY (verifier):
   - Review values + reviewer comments
   - APPROVE → signs + electronic signature → verifiedBy, verifiedAt, verifiedSignatureId → COMPLETE
   - REJECT → must provide reason → configurable reset (back to CHECKED or PERFORMED)

   Status flow: DRAFT → PERFORMED → CHECKED → VERIFIED → COMPLETE (or REJECTED at any review stage)

7. ELECTRONIC SIGNATURE DIALOG (apps/web/src/components/ui/electronic-signature-dialog.tsx):
   - Modal dialog for 21 CFR Part 11 §11.50 compliance
   - Fields:
     a. Full legal name (pre-filled from user profile, read-only)
     b. Current date/time (auto-filled, read-only)
     c. Meaning of signature (dropdown: "I performed this task", "I reviewed and verified",
        "I approved this record", or custom text)
     d. Password re-entry (reauth)
     e. Handwritten signature (signature pad)
   - On submit: reauth API call → if success → create ElectronicSignature record
   - ElectronicSignature contains: userId, fullName, meaning, timestamp, signatureImage,
     contentHash (SHA-256 of signed data), bound to parent record

8. CHECKLIST RESPONSE VIEWER (apps/web/src/components/checklist/checklist-response-viewer.tsx):
   - Read-only view of completed checklists
   - Shows all field values with labels
   - Shows all three signatures (Performed, Checked, Verified) with timestamps
   - Shows rejection history with reasons
   - Print-friendly layout
   - Available on entity detail page → Checklist History tab

VERIFICATION:
- Scan QR → login → checklist loads with correct fields from template
- Fill NUMBER field with value outside range → validation error shown
- Complete all steps → signature pad → electronic signature dialog → submit
- Reviewer opens → sees submitted values → adds comment → approves with e-sig
- Verifier opens → approves → status = COMPLETE, three e-sig records created
- Reject at review → operator gets notification → can resubmit
- Photo capture → camera opens → capture → thumbnail in form → uploaded to binary store
- Close browser mid-checklist → reopen → progress restored from localStorage
```

## Relevant Spec Sections

- **Section 2**: Checklist submission flow (3-tier approval, field types)
- **Section 2.3**: Electronic signature requirements (§11.50, §11.70)
- **Section 3.3**: ElectronicSignature Prisma model (all fields)
- **Section 12.2**: ChecklistReview Prisma model
- **Section 13.5**: Mobile checklist UI spec (field types, stepper, validation)
- **Section 13.6**: Approval workflow UI spec (3-tier stepper)
- **Section 13.7**: Electronic signature dialog spec (§11.50 fields)
- **Section 14.2**: Frontend file structure (checklist components)
- Asset Module Requirements v1.2: Checklist field type definitions and validation rules


> **Update (2026-03-27):** Phase 2 Digital FMS completed. Checklist Profiles module adds reusable question templates (10 types: YES_NO, YES_NO_NA, PASS_FAIL, TEXT, NUMERIC, DROPDOWN, MULTI_SELECT, DATE_TIME, PHOTO, SIGNATURE) for pipeline CHECKLIST nodes. Server enforces checklist completion before stage advance.


---

## Phase 3 Update (2026-04-07)

**RFID & Offline Operations:**
- RFID Scanner Android app (`rfid_scan_app/`) for KC-series UHF readers
- RFID keyboard guard prevents UKB tag input leaking into random fields
- Offline cleaning operations via IndexedDB queue + sync engine
- Cached identifier→filter map for offline RFID lookup
- "Data Synced" indicator in mobile header
- One identifier per entity (backend-enforced)
- Responsive layout with collapsible sidebar
- Error popups replace inline banners
- User creation auto-assigns org for admins
- `/api/roles/active` public endpoint for contact-admin page

See `CHANGELOG.md` for full details.
