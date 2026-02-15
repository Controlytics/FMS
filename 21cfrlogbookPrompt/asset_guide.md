# DigiLog — Asset & Asset Template Requirements

> 21 CFR Part 11 Compliant Digital Logbook

---

## 1. Overview — What This Document Covers

This document describes how **Assets** and **Asset Templates** work in DigiLog. It covers the complete flow from template creation during onboarding, to asset instantiation, linking, hierarchy navigation, and CRUD operations.

**Two core concepts:**
- **Asset Template** — A reusable blueprint that defines what an asset looks like (its fields, telemetry, checklists, identifiers, icon). Created once, used many times.
- **Asset** — A real-world entity (building, block, room, device, sensor) created from a template. Lives in a tree structure. Can be linked to other assets.

---

## 2. Total Flow — End to End

```
STEP 1: ONBOARDING
│
│  Admin / QA Manager creates the ASSET TEMPLATE LIBRARY
│  Each template defines: Attributes, Telemetry, Ownership,
│  Identifiers, Checklists, Icon/Image
│
│  Templates are reusable blueprints stored in a library.
│  Examples: "Building Template", "Clean Room Template",
│            "Reactor Template", "pH Sensor Template"
│
STEP 2: ASSET CREATION
│
│  User selects a template from the library
│  System creates a new ASSET with all template structure pre-loaded
│  User fills in instance-specific values (name, serial #, location, tags)
│  User assigns the asset's POSITION in the hierarchy tree
│  User sets FROM and TO links to connect it to other assets
│
STEP 3: HIERARCHY BUILDING
│
│  Assets are linked into a TREE STRUCTURE
│  ├── ROOT asset (topmost node — e.g. a Factory or Building)
│  │   ├── Child asset (e.g. Block / Floor)
│  │   │   ├── Child asset (e.g. Room / Zone)
│  │   │   │   ├── Child asset (e.g. Equipment / Device)
│  │   │   │   │   └── TAIL asset (lowest node — e.g. Sensor)
│  │   │   │   └── ...
│  │   │   └── ...
│  │   └── ...
│  └── ...
│
│  At EACH level, new assets can be added from the template library.
│  The tree depth is flexible — no fixed number of levels.
│
STEP 4: NAVIGATION & OPERATION
│
│  User opens app → sees ROOT assets as image/icon cards
│  Clicks a card → sees its children as cards
│  Clicks deeper → drills down through the tree
│  At any node: View, Edit, Delete, Add Child, Run Checklist, View Telemetry
│
│  Scan a physical tag (QR/RFID/Barcode/NFC) → jumps directly to that asset
```

---

## 3. Asset Template — The Blueprint

An asset template is a **reusable definition** that describes what type of asset this is and what data it carries. Templates are created during onboarding and stored in a **Template Library**.

**Who creates templates:** Admin, QA Manager, Engineering Manager (configurable by role)

### 3.1 What a Template Contains

```
ASSET TEMPLATE
│
├── 1. ATTRIBUTES (slow-moving / settings data)
│      Static metadata fields specific to this asset type.
│      These values rarely change after initial setup.
│
├── 2. TELEMETRY POINTS (fast-moving / real-time data)
│      Time-series data streams — sensor readings, measurements,
│      live values that update frequently.
│
├── 3. HIERARCHICAL OWNERSHIP (who owns & controls this asset)
│      Linked to user management — defines which roles/users
│      have what level of access to assets created from this template.
│
├── 4. UNIQUE IDENTIFIER (software-generated)
│      System auto-generates a unique ID for every asset instance.
│      This is the internal reference — never duplicated, never reused.
│
├── 5. PHYSICAL IDENTIFIERS (hardware tags)
│      Template defines WHICH types of physical tags this asset should have.
│      Supported: RFID, Barcode, QR Code, NFC, Manual Entry.
│      Actual tag values are filled in when the asset instance is created.
│
├── 6. CHECKLISTS (inspection / verification forms)
│      Template can include one or more checklist templates.
│      Each checklist has questions of various types:
│      MCQ, Fill in Blank, Yes/No, Dropdown, Pass/Fail,
│      Numeric with Limits, Image Upload, Date/Time, Signature.
│
├── 7. ICON / IMAGE REPRESENTATION
│      Default icon or image that represents this asset type on the dashboard.
│      Can be overridden per instance with an actual photo.
│
└── 8. FROM-TO LINKING RULES (optional)
       Template can define what types of assets this can connect TO
       and what types can connect FROM it.
       Example: "Reactor" can have FROM: "Production Line", TO: "Agitator", "Jacket"
```

### 3.2 Template Library

```
┌─────────────────────────────────────────────────────────────┐
│                    ASSET TEMPLATE LIBRARY                     │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ [ICON]   │  │ [ICON]   │  │ [ICON]   │  │ [ICON]   │   │
│  │ Building │  │ Block /  │  │ Clean    │  │ Reactor  │   │
│  │ Template │  │ Floor    │  │ Room     │  │ Template │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ [ICON]   │  │ [ICON]   │  │ [ICON]   │  │ [ICON]   │   │
│  │ Tablet   │  │ HVAC     │  │ pH       │  │ Temp     │   │
│  │ Press    │  │ Unit     │  │ Sensor   │  │ Probe    │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                              │
│  [+ Create New Template]   [Search]   [Filter by Category]   │
│                                                              │
│  CRUD: Create | Read | Update | Delete templates             │
└─────────────────────────────────────────────────────────────┘
```

Templates can be:
- **Created** — define a new asset type with all its building blocks
- **Read** — view template definition and all instances created from it
- **Updated** — modify template (changes apply to future instances; existing instances can optionally be updated)
- **Deleted** — retire a template (existing instances remain, but no new assets can be created from it)

---

## 4. Asset — The Real-World Entity

An asset is a **real instance** of something physical — a building, a block, a room, a device, a sensor. It is created from a template and lives in a tree hierarchy.

### 4.1 What an Asset Is

An asset can be any of these (or anything else defined by a template):

| Asset Type | Examples |
|---|---|
| **Building** | Manufacturing plant, warehouse, QC lab, R&D center |
| **Block / Floor** | Production wing, utility block, first floor, basement |
| **Room / Zone** | Clean room, granulation suite, packaging hall, wash area |
| **Equipment** | Reactor, mixer, tablet press, FBD, autoclave, HPLC |
| **Device / Sensor** | Temperature probe, pH sensor, pressure transmitter, flow meter |

**The system does NOT force a fixed hierarchy.** The user decides what goes where. A "Building" template asset can contain a "Room" template asset, which can contain an "Equipment" template asset, which can contain a "Sensor" template asset — or any other combination that matches the real-world structure.

### 4.2 Asset Creation Flow

```
USER CLICKS [+ New Asset]
│
├── Step 1: SELECT TEMPLATE
│   │  User browses the Template Library
│   │  Selects a template (e.g. "Reactor Template")
│   │  All template structure auto-loads into the new asset form
│   │
├── Step 2: FILL IN INSTANCE VALUES
│   │
│   │  ┌── ATTRIBUTES TAB ─────────────────────────────────────┐
│   │  │  Template defines the fields. User fills in the values.│
│   │  │                                                        │
│   │  │  Asset Name:         [Reactor R-201              ]     │
│   │  │  Alias Name:         [R-201                      ]     │
│   │  │  Serial Number:      [GL-2020-0456               ]     │
│   │  │  Manufacturer:       [Glatt                      ]     │
│   │  │  Model:              [GPCG 60                    ]     │
│   │  │  Capacity:           [60 kg                      ]     │
│   │  │  Material:           [SS 316L                    ]     │
│   │  │  Installation Date:  [2021-03-15                 ]     │
│   │  │  Criticality:        [Critical ▼]                      │
│   │  │  Status:             [Active ▼]                        │
│   │  │                                                        │
│   │  │  (User can also ADD extra attributes beyond template)  │
│   │  └────────────────────────────────────────────────────────┘
│   │
│   │  ┌── TELEMETRY TAB ──────────────────────────────────────┐
│   │  │  Template defines which telemetry points exist.        │
│   │  │  User configures data source and thresholds.           │
│   │  │                                                        │
│   │  │  Point 1: Temperature   Source: [PLC ▼]   Freq: 1 min │
│   │  │  Point 2: Pressure      Source: [Sensor ▼] Freq: 30s  │
│   │  │  Point 3: pH            Source: [Manual ▼] Freq: hourly│
│   │  │                                                        │
│   │  │  (User can ADD extra telemetry points beyond template) │
│   │  └────────────────────────────────────────────────────────┘
│   │
│   │  ┌── OWNERSHIP TAB ──────────────────────────────────────┐
│   │  │  Defines who owns this asset and who can do what.      │
│   │  │  Linked to user management / RBAC system.              │
│   │  │                                                        │
│   │  │  Owner:           [select user or role ▼]              │
│   │  │  Can Edit:        [select roles ▼]                     │
│   │  │  Can View:        [select roles ▼]                     │
│   │  │  Can Run Checks:  [select roles ▼]                     │
│   │  │  Can Delete:      [select roles ▼]                     │
│   │  │                                                        │
│   │  │  Ownership is HIERARCHICAL — owner of a parent asset   │
│   │  │  has oversight of all child assets below it.           │
│   │  └────────────────────────────────────────────────────────┘
│   │
│   │  ┌── IDENTIFIERS TAB ────────────────────────────────────┐
│   │  │                                                        │
│   │  │  UNIQUE ID (auto-generated by system):                 │
│   │  │  UID: a3f7b2c1-4d8e-4f6a-9b3c-1e2d5f7a8b9c           │
│   │  │                                                        │
│   │  │  PHYSICAL IDENTIFIERS (template says which types):     │
│   │  │  ☑ QR Code:  [Generate] → prints label to attach      │
│   │  │  ☑ RFID:     [Tag ID: ____________]                   │
│   │  │  ☑ Barcode:  [Value: ____________]                    │
│   │  │  ☐ NFC:      (not required for this template)         │
│   │  │  ☐ Manual:   (not required for this template)         │
│   │  │                                                        │
│   │  │  Each physical ID maps to the same UID.                │
│   │  │  Scan any tag → system finds this asset.               │
│   │  └────────────────────────────────────────────────────────┘
│   │
│   │  ┌── CHECKLISTS TAB ─────────────────────────────────────┐
│   │  │  Template defines checklist(s). Auto-attached.         │
│   │  │                                                        │
│   │  │  ☑ Pre-Operation Check  (from template)                │
│   │  │  ☑ Cleaning Record      (from template)                │
│   │  │  ☐ [+ Add extra checklist]                             │
│   │  │                                                        │
│   │  │  Each checklist contains questions:                     │
│   │  │  • MCQ (select one answer)                             │
│   │  │  • Fill in Blank (free text / numeric)                 │
│   │  │  • Yes / No                                            │
│   │  │  • Dropdown (select from list)                         │
│   │  │  • Pass / Fail                                         │
│   │  │  • Numeric with Limits (auto-flags out of range)       │
│   │  │  • Image Upload (photo evidence)                       │
│   │  │  • Date / Time entry                                   │
│   │  │  • Signature (e-sign with re-authentication)           │
│   │  └────────────────────────────────────────────────────────┘
│   │
│   │  ┌── ICON / IMAGE TAB ───────────────────────────────────┐
│   │  │  Default icon loaded from template.                    │
│   │  │  User can override with actual photo of the asset.     │
│   │  │                                                        │
│   │  │  [Default Icon]  or  [Upload Photo]                    │
│   │  │                                                        │
│   │  │  This image is displayed on the dashboard card.        │
│   │  └────────────────────────────────────────────────────────┘
│   │
├── Step 3: POSITION IN HIERARCHY
│   │  User selects WHERE in the tree this asset lives.
│   │
│   │  Parent Asset: [select from tree ▼]
│   │  If no parent → this is a ROOT asset (topmost node)
│   │
├── Step 4: FROM-TO LINKING
│   │  User defines connections to other assets.
│   │
│   │  FROM (what feeds into this asset):
│   │  [+ Link to existing asset]  e.g. "Production Line PL-1"
│   │
│   │  TO (what this asset feeds into):
│   │  [+ Link to existing asset]  e.g. "Agitator AG-201", "Jacket JK-201"
│   │
│   │  These links form the tree structure.
│   │  An asset with no FROM link = ROOT
│   │  An asset with no TO link = TAIL (leaf node)
│   │
├── Step 5: SAVE / SUBMIT
│   │  [Save as Draft]  [Submit for Review]  [Cancel]
│   │
│   │  Depending on role & configuration:
│   │  - Saved immediately (if user has permission)
│   │  - Or routed for approval (QA review before going Active)
│   │
└── ASSET CREATED ✓
    Now visible as an IMAGE CARD on the dashboard at its tree position.
```

### 4.3 Asset Card on Dashboard

Once created, the asset appears as a clickable **image card**:

```
┌──────────────────┐
│     [PHOTO]      │  ← actual photo OR default icon from template
│                  │
│  Reactor R-201   │  ← Alias Name
│  Reactor         │  ← Asset Type (from template)
│  ● Active        │  ← Status indicator
│                  │
│  [Edit] [Delete] │  ← CRUD buttons (visible based on role)
└──────────────────┘
```

**Click on the card →** opens the full asset detail page (all tabs: Attributes, Telemetry, Ownership, Identifiers, Checklists, Icon, Linked Assets, Audit Trail)

**Click on a child card below →** drills down into the tree

---

## 5. Asset Hierarchy — The Tree Structure

Assets are organized in a **tree** (directed graph). Every asset has a position in the tree defined by its FROM-TO links.

### 5.1 Tree Concepts

| Term | What It Means |
|---|---|
| **Root** | The topmost asset in a branch. Has no parent (no FROM link). Example: a Factory or Building. |
| **Node** | Any asset in the tree. Has a parent above and/or children below. |
| **Tail (Leaf)** | The lowest asset in a branch. Has no children (no TO link). Example: a Sensor or Instrument. |
| **Depth** | How many levels deep an asset is from the root. Flexible — no fixed limit. |
| **Link** | A FROM-TO connection between two assets. Defines parent-child relationship. |

### 5.2 Example Tree

```
[ROOT] Hyderabad Manufacturing Plant          ← Building template
│
├── [NODE] OSD Production Wing                 ← Block template
│   │
│   ├── [NODE] Granulation Suite 1             ← Room template
│   │   │
│   │   ├── [NODE] Fluid Bed Dryer FBD-1      ← Equipment template
│   │   │   │
│   │   │   ├── [TAIL] Inlet Air Temp Probe   ← Sensor template
│   │   │   ├── [TAIL] Product Bed Temp Probe  ← Sensor template
│   │   │   └── [TAIL] Filter DP Sensor        ← Sensor template
│   │   │
│   │   ├── [NODE] Rapid Mixer Granulator      ← Equipment template
│   │   │   │
│   │   │   ├── [TAIL] Impeller Speed Sensor   ← Sensor template
│   │   │   └── [TAIL] Chopper Speed Sensor    ← Sensor template
│   │   │
│   │   └── [TAIL] Room Env Monitor            ← Device template
│   │
│   ├── [NODE] Compression Suite               ← Room template
│   │   │
│   │   ├── [NODE] Tablet Press TP-1           ← Equipment template
│   │   │   ├── [TAIL] Compression Force       ← Sensor template
│   │   │   ├── [TAIL] Turret Speed            ← Sensor template
│   │   │   └── [TAIL] Ejection Force          ← Sensor template
│   │   │
│   │   └── [TAIL] Room Env Monitor            ← Device template
│   │
│   └── [NODE] Packaging Hall                  ← Room template
│       └── ...
│
├── [NODE] QC Laboratory                       ← Block template
│   ├── [NODE] HPLC Lab                        ← Room template
│   │   ├── [TAIL] HPLC-01                     ← Instrument template
│   │   └── [TAIL] HPLC-02                     ← Instrument template
│   └── ...
│
└── [NODE] Utility Block                       ← Block template
    ├── [TAIL] Boiler                          ← Equipment template
    ├── [TAIL] Chiller                         ← Equipment template
    └── [TAIL] WFI Plant                       ← Equipment template
```

### 5.3 How the Tree Is Built

The tree is built **progressively** — not all at once. At each level, the user can:

```
1. Start at ROOT level → add a new asset from template library
2. Open that asset → click [+ Add Child Asset]
3. Select a template from library → fill in values → child is linked
4. Open the child → click [+ Add Child Asset] → repeat
5. At any point, new templates can be created and added to the library
6. At any point, existing assets can be linked to new children
```

**Key rules:**
- Any asset can have **zero or more children** (no limit)
- Any asset can have **zero or one parent** (a node belongs to one branch)
- **Cross-links** are allowed — an asset can reference other assets that are NOT its parent/child (e.g. a shared utility linked to multiple production lines)
- The tree depth is **unlimited** — the user decides how deep to go
- **New templates** can be created at any time and used immediately

### 5.4 Navigation Through the Tree

```
USER OPENS APP
│
│  Sees all ROOT assets as image cards on the dashboard
│  (Buildings, Factories, Sites — whatever the top-level assets are)
│
├── CLICKS on "Hyderabad Manufacturing Plant" card
│   │
│   │  Dashboard now shows CHILDREN of this asset as image cards:
│   │  [OSD Production Wing]  [QC Laboratory]  [Utility Block]
│   │
│   ├── CLICKS on "OSD Production Wing"
│   │   │
│   │   │  Dashboard shows CHILDREN:
│   │   │  [Granulation Suite 1]  [Compression Suite]  [Packaging Hall]
│   │   │
│   │   ├── CLICKS on "Granulation Suite 1"
│   │   │   │
│   │   │   │  Dashboard shows CHILDREN:
│   │   │   │  [FBD-1]  [Rapid Mixer]  [Room Env Monitor]
│   │   │   │
│   │   │   ├── CLICKS on "FBD-1"
│   │   │   │   │
│   │   │   │   │  Opens ASSET DETAIL PAGE (tabbed form)
│   │   │   │   │  Below the form → CHILDREN shown as cards:
│   │   │   │   │  [Inlet Air Temp]  [Bed Temp]  [Filter DP]
│   │   │   │   │
│   │   │   │   └── CLICKS on "Bed Temp Probe" → TAIL NODE
│   │   │   │       Opens detail page. No children. Leaf of tree.
│   │   │   │
│   │   │   └── ...
│   │   └── ...
│   └── ...
│
│  BREADCRUMB always visible at top:
│  Plant > OSD Wing > Gran Suite 1 > FBD-1 > Bed Temp Probe
│  (Click any breadcrumb segment to jump back up the tree)
│
│  SCAN shortcut: Scan QR/RFID/Barcode/NFC → jump directly to any asset
```

---

## 6. Each Building Block — Detailed

### 6.1 Attributes (Slow-Moving Data)

Attributes are **static metadata** — properties that describe the asset and rarely change after initial setup.

**Defined in template:** The template specifies WHICH attribute fields exist and their data types.
**Filled in on instance:** The user enters the actual values when creating the asset.

| What Template Defines | What Instance Fills In |
|---|---|
| Field: "Serial Number" (type: text) | `GL-2020-0456` |
| Field: "Manufacturer" (type: text) | `Glatt` |
| Field: "Capacity" (type: numeric, unit: kg) | `60` |
| Field: "Installation Date" (type: date) | `2021-03-15` |
| Field: "Criticality" (type: dropdown, options: Critical/Major/Minor) | `Critical` |
| Field: "Status" (type: dropdown, options: Active/Inactive/...) | `Active` |

**Extra attributes:** User can add fields beyond what the template defines for a specific instance.

**CRUD on attributes:**
- **Create:** Add a new attribute field to template or instance
- **Read:** View attribute values on the asset detail page
- **Update:** Edit values (logged in audit trail with before/after + reason)
- **Delete:** Remove an attribute field (soft delete, audit logged)

### 6.2 Telemetry (Fast-Moving Data)

Telemetry points are **time-series data streams** — values that update frequently from sensors, manual entry, or integrations.

**Defined in template:** Which telemetry points exist, their units, expected ranges.
**Configured on instance:** Data source, sampling frequency, alert/action thresholds.

| What Template Defines | What Instance Configures |
|---|---|
| Point: "Temperature" (unit: °C) | Source: PLC, Freq: 30 sec, Alert: >75°C, Action: >80°C |
| Point: "Pressure" (unit: mbar) | Source: Sensor, Freq: 1 min, Alert: >80 mbar, Action: >100 mbar |
| Point: "pH" (unit: pH) | Source: Manual entry, Freq: per batch |

**Telemetry data is stored as time-series** — every reading with its timestamp, forming a continuous history.

### 6.3 Hierarchical Ownership

Every asset has an **owner** and **access rules** linked to the user management system.

```
OWNERSHIP FLOWS DOWN THE TREE:
│
│  Building Owner (Site Head)
│  └── Has oversight of ALL assets under this building
│
│      Block Owner (Area In-Charge)
│      └── Has oversight of ALL assets under this block
│
│          Room Owner (Production Supervisor)
│          └── Has oversight of ALL devices under this room
│
│              Device Owner (Equipment Owner / Calibration Tech)
│              └── Has direct control of this device
```

**At each level, the template defines:**
- Which roles can **Create** child assets
- Which roles can **Read** this asset
- Which roles can **Update** this asset
- Which roles can **Delete** this asset
- Which roles can **Run Checklists** on this asset

### 6.4 Unique Identifier (Software-Generated)

Every asset instance gets a **system-generated unique ID** automatically. The user does NOT create this — the system assigns it at creation time.

| Field | Description |
|---|---|
| **UID** | UUID v4 — globally unique, never reused. Example: `a3f7b2c1-4d8e-4f6a-9b3c-1e2d5f7a8b9c` |
| **Asset Code** | Human-readable code following naming convention. Example: `EQ-OSD-FBD-001` |

This UID is what all physical identifiers (QR, RFID, Barcode, NFC) map to.

### 6.5 Physical Identifiers (Hardware Tags)

Physical tags are attached to the real-world equipment. They serve as shortcuts — scan a tag, system resolves it to the asset's UID, opens that asset's page.

**Template defines:** Which identifier types are required/optional for this asset type.
**Instance fills in:** Actual tag values or generates them.

| Identifier | How It Works |
|---|---|
| **QR Code** | System generates a QR code encoding the asset's UID. User prints and attaches to equipment. Scan with phone → opens asset page. |
| **Barcode** | 1D barcode (Code 128 / Code 39) linked to UID. Scan with handheld scanner → opens asset. |
| **RFID** | RFID tag's hardware ID is stored in system and mapped to asset UID. RFID reader scan → resolves to asset. |
| **NFC** | NFC tag linked to UID. Tap phone on tag → opens asset page. |
| **Manual Entry** | For assets with visual labels or serial numbers. User types the identifier to look up the asset. |

**Rules:**
- One asset can have **multiple physical identifiers** (QR + RFID + Barcode all pointing to same UID)
- Every identifier value is **unique across the tenant** — no two assets share the same tag
- Scanning any tag → same result: opens that asset's detail page

### 6.6 Checklists (Templatized)

Checklists are **forms** used for inspections, verifications, cleaning records, pre-use checks, etc.

**Defined in template:** Template includes one or more checklist templates. Each checklist has a set of questions.
**Inherited by instance:** When an asset is created from a template, all checklists are auto-attached.
**Extendable:** User can add extra checklists to a specific instance beyond what the template defines.

**Question types supported:**

| # | Type | What The User Sees |
|---|---|---|
| 1 | **MCQ** | "Is gasket intact? (a) Yes (b) No (c) Partially damaged" — select ONE |
| 2 | **Multi-Select** | "PPE worn? [ ] Gloves [ ] Goggles [ ] Lab Coat" — select ONE OR MORE |
| 3 | **Fill in Blank** | "Pressure reading: _____ PSI" — free text or numeric |
| 4 | **Yes / No** | "Equipment cleaned? Yes / No" — binary |
| 5 | **Dropdown** | "Cleaning agent: [IPA / NaOH / WFI / Other]" — select from list |
| 6 | **Pass / Fail** | "Leak test: Pass / Fail" — binary with compliance meaning |
| 7 | **Numeric with Limits** | "Temperature: _____ °C (Range: 20–25)" — auto-flags if out of range |
| 8 | **Image Upload** | "Take photo of equipment label" — camera capture or file upload |
| 9 | **Signature** | "I confirm this was done correctly" — e-signature with re-authentication |

**Completed checklists are immutable** — once submitted, they become permanent records in the audit trail. They cannot be modified or deleted.

### 6.7 Icon / Image Representation

Every asset has a visual representation displayed on its dashboard card.

| Level | What Shows |
|---|---|
| **Template default** | An icon (SVG/PNG) representing the asset type. E.g. a factory icon for "Building Template", a beaker for "Reactor Template". |
| **Instance override** | User can upload an actual photo of the specific asset. This replaces the default icon on the dashboard card. |

The image/icon is what the user **clicks** to navigate into the asset.

---

## 7. FROM-TO Linking — How Assets Connect

Every asset has a **FROM** side (what connects into it) and a **TO** side (what it connects into).

```
         FROM                    ASSET                     TO
    ┌──────────┐           ┌──────────────┐          ┌──────────┐
    │ Parent   │ ────────→ │  This Asset  │ ────────→ │ Child 1  │
    │ Asset    │           │              │          ├──────────┤
    └──────────┘           │              │ ────────→ │ Child 2  │
                           │              │          ├──────────┤
                           │              │ ────────→ │ Child 3  │
                           └──────────────┘          └──────────┘
```

| Scenario | FROM | TO | Role in Tree |
|---|---|---|---|
| Factory building | (none) | Wings, Blocks, Floors | **ROOT** — topmost node |
| Production room | Block / Floor | Equipment, Devices | **NODE** — middle of tree |
| Temperature sensor | Equipment | (none) | **TAIL** — leaf node |
| Shared utility (chiller) | (none) | **Cross-linked** to multiple lines | ROOT + cross-link |

**Cross-links:** An asset can be linked to other assets that are NOT in its direct parent-child chain. Example: A chiller is a standalone root asset, but it's cross-linked to 3 production lines that it serves. This is a reference link, not a parent-child relationship.

---

## 8. CRUD — What Can Be Done at Every Level

| Action | What Happens | Who Can Do It |
|---|---|---|
| **Create** | Select template from library → fill in values → position in tree → save. New image card appears on dashboard. | Roles with "Create" permission at that tree level |
| **Read** | Click image card → view asset detail page (all tabs). View telemetry, attributes, checklists, history. | Roles with "Read" permission |
| **Update** | Click [Edit] → modify attributes, telemetry config, ownership, identifiers. Every change logged with before/after + reason. | Roles with "Update" permission |
| **Delete** | Click [Delete] → confirm + provide reason → soft delete (asset marked "Retired"). Data stays in system for audit. | Roles with "Delete" permission (usually restricted to Admin/QA) |

**CRUD on templates (Template Library):**

| Action | What Happens |
|---|---|
| **Create Template** | Define new asset type with all building blocks |
| **Read Template** | View template definition + list of all instances created from it |
| **Update Template** | Modify fields, checklists, identifiers. Option to push changes to existing instances or apply only to future ones. |
| **Delete Template** | Retire template. Existing instances remain. No new assets can be created from it. |

---

## 9. Onboarding Flow — Setting Up the System

```
DAY 1: SYSTEM SETUP
│
├── Admin creates TENANT (organization)
├── Admin sets up USER ACCOUNTS and ROLES
│
├── QA/Engineering Manager builds the TEMPLATE LIBRARY:
│   ├── Creates "Building" template (attributes: name, address, license, GMP class...)
│   ├── Creates "Clean Room" template (attributes: ISO class, pressure, temp range...)
│   ├── Creates "Reactor" template (attributes: capacity, material, serial#...
│   │                               telemetry: temp, pressure, pH...
│   │                               checklists: pre-op check, cleaning record...
│   │                               identifiers: QR + RFID required...
│   │                               icon: reactor.svg)
│   ├── Creates "Temperature Sensor" template
│   ├── Creates "Tablet Press" template
│   └── ...as many templates as needed
│
DAY 2+: ASSET CREATION
│
├── Users start creating ASSETS from templates:
│   ├── Create ROOT asset: "Hyderabad Plant" (from Building template)
│   ├── Add child: "OSD Wing" (from Block template) → linked under Plant
│   ├── Add child: "Gran Suite 1" (from Room template) → linked under Wing
│   ├── Add child: "FBD-1" (from Equipment template) → linked under Suite
│   ├── Add child: "Temp Probe" (from Sensor template) → linked under FBD-1
│   └── ...build out the entire facility tree
│
ONGOING:
│
├── New templates can be added to the library at any time
├── New assets can be added at any level at any time
├── Existing assets can be edited, linked, or retired
└── The tree grows organically as the facility evolves
```

---

## 10. Summary

| # | Concept | Description |
|---|---|---|
| 1 | **Asset Template** | Reusable blueprint. Defines attributes, telemetry, ownership, identifiers, checklists, icon. Created during onboarding. Stored in Template Library. |
| 2 | **Asset** | Real-world entity created from a template. Can be building, block, room, device, sensor — anything. |
| 3 | **Tree Structure** | Assets linked via FROM-TO. Root = topmost, Tail = leaf. Unlimited depth. Cross-links allowed. |
| 4 | **Image Card Navigation** | Every asset = clickable image card on dashboard. Click → drill down or open detail page. |
| 5 | **Template Library** | Centralized library of all asset templates. Browsable, searchable. CRUD on templates. |
| 6 | **Attributes** | Slow-moving metadata. Defined by template, filled in per instance. Extendable. |
| 7 | **Telemetry** | Fast-moving time-series data. Defined by template, configured per instance. |
| 8 | **Hierarchical Ownership** | Who owns what. Flows down the tree. Linked to RBAC / user management. |
| 9 | **Unique Identifier** | Auto-generated UID per asset. Software-side reference. Never duplicated. |
| 10 | **Physical Identifiers** | QR, Barcode, RFID, NFC, Manual. All map to same UID. Scan → opens asset. |
| 11 | **Checklists** | Templatized forms. 9 question types. Immutable once completed. |
| 12 | **Icon / Image** | Template default icon, overridable with actual photo. Displayed on card. |
| 13 | **FROM-TO Linking** | Parent-child relationships + cross-links. Build the tree progressively. |
| 14 | **CRUD** | Create, Read, Update, Delete — on both templates and asset instances. Role-based. |
| 15 | **Progressive Building** | Tree built over time. New templates and assets added at any stage. |
