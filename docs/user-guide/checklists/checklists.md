# Checklists

Checklists are template-based inspection forms that allow operators to perform structured data collection on entities. DigiLog supports 14 question types with full submission history and QR code access for field operations.

---

## Checklist Concepts

### What is a Checklist?

A checklist is a structured form linked to an entity. It is defined by the entity's template and contains a series of questions that operators complete during inspections, maintenance rounds, or quality checks.

### Checklist Features

| Feature | Description |
|---------|-------------|
| **Template-defined** | Questions are defined in the Asset Template |
| **Entity-linked** | Each submission is associated with a specific entity |
| **Photo capture** | Questions can require photo evidence |
| **QR code access** | Operators scan a QR code to access the checklist form |
| **Submission history** | All past submissions are viewable with timestamps and answers |
| **21 CFR Part 11** | Submissions include operator identification and timestamps |

---

## Question Types (14 total)

| Type | Description | Example |
|------|-------------|---------|
| **TEXT** | Free-text answer | "Describe any visible damage" |
| **NUMBER** | Numeric value input | "Current reading (PSI)" |
| **YES_NO** | Boolean yes/no toggle | "Is the safety guard in place?" |
| **MULTIPLE_CHOICE** | Select from predefined options | "Condition: [Good, Fair, Poor, Failed]" |
| **PHOTO** | Camera capture or image upload | "Photo of equipment nameplate" |
| **MULTI_SELECT** | Select multiple options | "Issues found: [Leak, Noise, Vibration, Heat]" |
| **DATE** | Date picker | "Last calibration date" |
| **TIME** | Time picker | "Shift start time" |
| **DATETIME** | Date and time picker | "Maintenance scheduled at" |
| **RATING** | Numeric rating scale | "Equipment condition (1-5)" |
| **SIGNATURE** | Digital signature capture | "Operator sign-off" |
| **FILE_UPLOAD** | Attach a file | "Upload calibration certificate" |
| **RANGE** | Numeric range slider | "Temperature setting (20-80)" |
| **CALCULATED** | Auto-computed from other answers | "Total score" |

---

## Creating Checklist Templates

Checklist questions are defined in the Asset Template's checklist configuration:

1. Navigate to **Entity Explorer** → **Templates**.
2. Open or create a template.
3. In the **Checklist** section, add questions:
   - **Question text** — What to ask the operator
   - **Question type** — One of 14 types (TEXT, NUMBER, YES_NO, MULTIPLE_CHOICE, PHOTO, etc.)
   - **Required** — Whether the question must be answered
   - **Options** — For DROPDOWN type: the list of choices

### Example Checklist Template

```json
[
  {
    "id": "q_0",
    "text": "Is the equipment running normally?",
    "type": "YES_NO",
    "required": true
  },
  {
    "id": "q_1",
    "text": "Current temperature reading (°C)",
    "type": "NUMBER",
    "required": true
  },
  {
    "id": "q_2",
    "text": "Equipment condition",
    "type": "DROPDOWN",
    "required": true,
    "options": ["Good", "Fair", "Poor", "Needs Repair"]
  },
  {
    "id": "q_3",
    "text": "Photo of equipment status display",
    "type": "PHOTO",
    "required": false
  },
  {
    "id": "q_4",
    "text": "Additional notes",
    "type": "TEXT",
    "required": false
  }
]
```

---

## Filling Checklists

### From the Entity Detail Panel

1. Open the entity in the Entity Explorer.
2. Click the **Checklists** tab.
3. Fill in each question.
4. For PHOTO questions, click to capture from camera or upload an image.
5. Click **Submit**.

### From QR Code (Standalone Form)

1. Scan the entity's QR code with any mobile device.
2. The checklist form opens in the browser at `/checklist/<entityId>`.
3. Log in if required (the login page redirects back to the checklist after authentication).
4. Fill in and submit the checklist.

> **Note:** The standalone checklist form works on any device with a browser — no app installation required.

---

## Photo Capture

### Camera Integration

For PHOTO questions, the checklist form provides:
- **Camera capture** — Opens the device camera for live photo capture
- **File upload** — Select an existing image from the device

### Auto-Compression

Large photos are automatically compressed before submission:
- Photos exceeding 2 MB trigger a confirmation dialog
- Progressive quality reduction (90% → 70% → 50%) with optional resize
- Maximum request size: 10 MB (Fastify + Nginx limits)

### Photo Display

In submission history, photos are displayed as:
- Clickable thumbnail previews
- Full-size view on click
- Base64-encoded inline images (no external file storage required)

---

## Submission History

### Viewing History

1. Open the entity in the Entity Explorer.
2. Click the **Checklists** tab.
3. Scroll down to see **Submission History**.

Each submission shows:
- **Submitted by** — Operator's full name and username
- **Submitted at** — Timestamp of submission
- **Answers** — Question text with the operator's response
- **Photos** — Thumbnail images for PHOTO questions

### Data Storage

Checklist submissions are stored in the `ts_checklist_responses` time-series table with:
- Entity ID
- Timestamp
- Submitter user ID
- Full question/answer data as JSON
- Photo data (base64)

---

## QR Codes

### Generating QR Codes

1. Open the entity in the Entity Explorer.
2. Click the **QR Code** tab.
3. The QR code is automatically generated, encoding the URL: `http://your-server/checklist/<entityId>`
4. Click **Download** to save the QR code image.
5. Print and attach to the physical equipment.

### QR Code Workflow

```
Operator scans QR code on equipment
        │
        ▼
  Browser opens checklist URL
        │
        ▼
  Login (if not authenticated)
        │
        ▼
  Fill checklist form
        │
        ▼
  Submit → Stored in database
        │
        ▼
  Visible in entity's Checklists tab
```

---

## Next Steps

- [Asset Templates](../templates/asset-templates.md) — Define checklist questions in templates
- [Audit Trail](../../administration/audit/audit-trail.md) — Track checklist submissions
- [Entities & Hierarchy](../entities/entities-and-hierarchy.md) — Entity management
