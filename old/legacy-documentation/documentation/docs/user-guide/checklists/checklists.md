# Checklists

Mobile-friendly digital inspection forms with 21 CFR Part 11 compliance.

## Entity Checklists

### Field Types (14)
PASS_FAIL, YES_NO, YES_NO_NA, MCQ, MULTI_SELECT, TEXT, NUMERIC, DROPDOWN, PHOTO, DATE_TIME, SIGNATURE, YES_NO_COMMENT, CALCULATED, CONDITIONAL

### 3-Step Approval
1. **Performed By** -- Operator fills and signs
2. **Checked By** -- Reviewer checks and signs
3. **Verified By** -- Final approval with signature

### Access
- Entity detail > Checklist tab
- QR code scan (opens /checklist/{entityId})
- Mobile-optimized UI with camera and signature pad

### Electronic Signatures
Each step requires re-authentication. Signatures include SHA-256 hash of the record data. Satisfies 21 CFR Part 11 sections 11.50, 11.70, 11.100, 11.200.

---

## Checklist Profiles (Phase 2)

Checklist Profiles are reusable question templates that can be attached to cleaning pipeline CHECKLIST nodes in the Digital Filter Management System.

### Question Types (10)
| Type | Description |
|------|-------------|
| YES_NO | Yes/No toggle buttons |
| YES_NO_NA | Yes/No/N/A toggle buttons |
| PASS_FAIL | Pass/Fail with color-coded buttons |
| TEXT | Free-text textarea |
| NUMERIC | Number input with optional min/max validation |
| DROPDOWN | Single-select dropdown with predefined options |
| MULTI_SELECT | Multi-select checkbox buttons |
| DATE_TIME | Date/time picker |
| PHOTO | Photo capture via camera or file upload |
| SIGNATURE | Electronic signature pad |

### Pipeline Integration
When a CHECKLIST node is placed between two STAGE nodes in a cleaning profile pipeline:
1. After completing the preceding stage, the checklist dialog appears automatically
2. User must answer all required questions
3. Checklist cannot be skipped (no dismiss/skip button)
4. Server enforces completion -- `advance()` blocks if checklist pending
5. Answers are stored as CHECKLIST_COMPLETED events in the filter event log with SHA-256 checksums

### API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/checklist-profiles` | List checklist profiles |
| POST | `/api/checklist-profiles` | Create checklist profile |
| PUT | `/api/checklist-profiles/:id` | Update checklist profile |
| DELETE | `/api/checklist-profiles/:id` | Delete checklist profile |
| POST | `/api/filters/:id/submit-checklist` | Submit checklist answers for active cycle |

### Checklist Enforcement
- Attempting to advance without completing a pending checklist returns `CHECKLIST_PENDING` error
- Duplicate submissions are blocked with `409 ALREADY_SUBMITTED`
- All submissions are immutable and linked to the cleaning cycle event chain
