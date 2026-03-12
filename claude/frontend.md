# 21 CFR Part 11 Compliant Logbook - Frontend Documentation

## System Architecture Overview

The system follows a three-tier architecture with Frontend (React), Backend (Node.js), and Database (PostgreSQL) layers. An Audit Trail Service captures all user actions (except Super Admin). Authentication and Authorization includes Session Management, Password Policy enforcement, and Role-based access control.

---

## 1. User Role Hierarchy & Privileges

### 1.1 Role Hierarchy

**SUPER ADMIN** (Highest Level - No Audit Log - All Privileges)
  ↓
**ADMIN** (Audit Logged)
  ↓
**SUPERVISOR** (Audit Logged - Approvals) | **MAINTENANCE** (Audit Logged - Assets) | **OPERATOR** (Audit Logged - View Only)
  ↓
**VIEWER** (Audit Logged - View Only)

### 1.2 Role Privileges Matrix

| Feature/Action | Super Admin | Admin | Supervisor | Maintenance | Operator | Viewer |
|----------------|-------------|-------|------------|-------------|----------|--------|
| **User Management** |
| Create Users | ✅ (No Log) | ✅ (Logged) | ❌ | ❌ | ❌ | ❌ |
| Update Users | ✅ (No Log) | ✅ (Logged) | ❌ | ❌ | ❌ | ❌ |
| Enable/Disable Users | ✅ (No Log) | ✅ (Logged) | ❌ | ❌ | ❌ | ❌ |
| Delete Users | ✅ (No Log) | ✅ (Logged) | ❌ | ❌ | ❌ | ❌ |
| Assign Roles | ✅ (No Log) | ✅ (Logged) | ❌ | ❌ | ❌ | ❌ |
| Reset Passwords (Temporary Only) | ✅ (No Log) | ✅ (Logged) | ❌ | ❌ | ❌ | ❌ |
| **System Configuration** |
| Password Policies | ✅ (No Log) | ✅ (Logged) | ❌ | ❌ | ❌ | ❌ |
| Login Attempt Config | ✅ (No Log) | ✅ (Logged) | ❌ | ❌ | ❌ | ❌ |
| Auto Logout Config | ✅ (No Log) | ✅ (Logged) | ❌ | ❌ | ❌ | ❌ |
| Date/Time Format | ✅ (No Log) | ✅ (Logged) | ❌ | ❌ | ❌ | ❌ |
| Field ID Name Configuration | ✅ (No Log) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Backup Management** |
| Manual Backup | ✅ (No Log) | ✅ (Logged) | ❌ | ❌ | ❌ | ❌ |
| Restore Backup | ✅ (No Log) | ✅ (Logged) | ❌ | ❌ | ❌ | ❌ |
| **Asset Management** |
| Create/Modify/Delete Assets | ✅ (No Log) | ❌ | ❌ | ✅ (After Approval) | ❌ | ❌ |
| Approve Asset Actions | ✅ (No Log) | ❌ | ✅ (Logged) | ❌ | ❌ | ❌ |
| **Data Access** |
| View Data | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Copy/Paste/Cut/Rename | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Audit Trail** |
| Actions Recorded | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View Audit Trail | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### 1.3 Role Descriptions

| Role | Description | Key Permissions |
|------|-------------|-----------------|
| **Super Admin** | Highest level system owner | Full unrestricted access to ALL features, actions NOT recorded, can configure Field ID Names, all privileges accessible |
| **Admin** | System administrator | User management, configurations, manual backup, actions RECORDED |
| **Supervisor** | Approval authority | Approve/reject maintenance requests, view audit trail, actions RECORDED |
| **Maintenance** | Asset manager | Create/modify/delete assets (after Supervisor approval), actions RECORDED |
| **Operator** | Data viewer | View data and audit trail only, actions RECORDED |
| **Viewer** | Read-only user | View data and audit trail only, actions RECORDED |

---

## 2. Field Identification Number System

### 2.1 Field ID Configuration (Super Admin Only)

Each field in the system has a unique identification number. Super Admin can configure the display name for these field IDs, and the change propagates throughout the entire application.

**Field ID Structure:** FLD_[MODULE]_[SEQUENCE]

**Configurable Fields:**

| Field ID | Default Name | Module | Description |
|----------|--------------|--------|-------------|
| FLD_USER_001 | User ID | User Management | User identification field |
| FLD_USER_002 | Full Name | User Management | User's full name |
| FLD_USER_003 | Email | User Management | User email address |
| FLD_USER_004 | Department | User Management | User department |
| FLD_USER_005 | Role | User Management | User role assignment |
| FLD_USER_006 | Status | User Management | Account status |
| FLD_ASSET_001 | Building Name | Asset Management | Building identifier |
| FLD_ASSET_002 | Block Name | Asset Management | Block identifier |
| FLD_ASSET_003 | Area Name | Asset Management | Area identifier |
| FLD_ASSET_004 | Device Name | Asset Management | Device identifier |
| FLD_ASSET_005 | Serial Number | Asset Management | Device serial number |
| FLD_ATTR_001 | Attribute Name | Attributes | Attribute identifier |
| FLD_TELE_001 | Telemetry Name | Telemetry | Telemetry identifier |

### 2.2 Field ID Name Update Behavior

When Super Admin updates a field name (e.g., changes "User ID" to "Employee Code"):
- All UI labels updated throughout application
- All form fields updated
- All reports updated
- All exports updated
- Historical data display updated
- NOT recorded in audit trail (Super Admin action)

---

## 3. User Management

### 3.1 User Creation (Temporary Password Flow)

**Form Fields:**
- User ID (Must be unique, 6-50 characters)
- Full Name
- Email
- Department (Dropdown)
- Role (Based on creator's role: Super Admin can create all roles, Admin can create Admin and below)
- Temporary Password (Must meet policy requirements)
- Confirm Password
- Account Status (Enabled/Disabled)
- Force password change on first login (MANDATORY - Always checked, cannot be unchecked)

**Password Field Behavior:**
- Password is MASKED by default (shown as dots/asterisks)
- Eye icon (👁) to toggle visibility (unmask/mask)
- Password remains masked until user clicks unmask icon
- Copy operation DISABLED in password fields (Ctrl+C blocked)
- Paste operation DISABLED in password fields (Ctrl+V blocked)
- Cut operation DISABLED in password fields (Ctrl+X blocked)
- Right-click context menu DISABLED in password fields
- Drag-and-drop DISABLED in password fields

**Password Requirements Display:**
- Minimum configurable characters
- At least configurable uppercase letters
- At least configurable lowercase letters
- At least configurable numbers
- At least configurable special characters
- Cannot be same as User ID

**Important Rules:**
- Admin provides TEMPORARY password only
- User MUST change password on first login
- Temporary password cannot be used as new password
- New password cannot match last N passwords (configurable count)

**Audit Logging:**
- Super Admin: NOT recorded
- Admin: RECORDED with all details

### 3.2 User List View

Displays table with: User ID, Name, Role, Status, Actions
Status indicators: Active, Locked, Disabled, Expired
Actions: Settings, Edit, Delete, Unlock (for locked accounts)
Filtering by Role and Status
Search functionality
Pagination

### 3.3 User Edit/Update Form

Editable fields: Full Name, Email, Department, Role, Account Status
Read-only: User ID (Cannot be changed), Created date, Created By, Last Modified, Last Login
Password Actions: Reset Password (Temporary), Force Password Change

### 3.4 Enable/Disable User

Warning dialog showing:
- User details being affected
- Impact: Session termination, login prevention, data preservation
- Optional reason field

---

## 4. Login & Authentication

### 4.1 Login Page

**Fields:**
- User ID
- Password

**Password Field Behavior:**
- Password is MASKED by default (shown as dots/asterisks)
- Eye icon (👁) to toggle visibility (unmask/mask)
- Password remains masked until user clicks unmask icon
- Copy operation DISABLED (Ctrl+C blocked)
- Paste operation DISABLED (Ctrl+V blocked)
- Cut operation DISABLED (Ctrl+X blocked)
- Right-click context menu DISABLED
- Drag-and-drop DISABLED

**Options:** Login button, Forgot Password link
**Warning message:** About unauthorized access and monitoring

### 4.2 Login Error States

| Error Condition | Message |
|-----------------|---------|
| User ID does not exist | "Invalid user ID or password." |
| Wrong password | "Invalid user ID or password. Attempts remaining: X" |
| Account Locked | "Account locked due to multiple failed login attempts. Contact administrator." |
| Account Disabled | "Your account has been disabled. Contact administrator." |
| Password Expired | "Your password has expired. Please change password to continue." |
| Temporary Password | "You are using a temporary password. You must change your password before continuing." |

**Security Note:** For non-existent User IDs, the same "Invalid user ID or password" message is shown WITHOUT attempts remaining count. This prevents attackers from identifying valid User IDs.

### 4.3 Forgot Password Flow

**Step 1:** User enters User ID and submits request
**Step 2:** Confirmation with Request ID displayed

**Request Routing:**
- Regular Users → Request goes to Admin AND Super Admin
- Admin Users → Request goes to Super Admin ONLY

**Important Notes:**
- Admin will provide a TEMPORARY password
- User MUST change password on first login
- Temporary password cannot be the new password

### 4.4 Mandatory Password Change (After Temporary Password Login)

**Form Fields:**
- Current Password (Temporary)
- New Password
- Confirm New Password

**Password Field Behavior (All Fields):**
- Password is MASKED by default (shown as dots/asterisks)
- Eye icon (👁) to toggle visibility (unmask/mask)
- Password remains masked until user clicks unmask icon
- Copy operation DISABLED (Ctrl+C blocked)
- Paste operation DISABLED (Ctrl+V blocked)
- Cut operation DISABLED (Ctrl+X blocked)
- Right-click context menu DISABLED
- Drag-and-drop DISABLED

**Validation Requirements:**
- Minimum configurable characters
- Uppercase letter requirement
- Lowercase letter requirement
- Number requirement
- Special character requirement
- Cannot be same as User ID
- Cannot be same as temporary password
- Cannot match last N passwords (configurable)

Password strength meter displayed
User cannot skip this step

---

## 5. Session Management

### 5.1 Auto-Logout Warning Dialog

Displays countdown timer (configurable warning time before timeout)
Options: Logout Now, Continue Session
Behavior: Continue resets idle timer, no response triggers auto-logout

### 5.2 Session Expired Message

Message: "Your session has expired due to inactivity. Please log in again."
Login button provided

---

## 6. Configuration (Admin/Super Admin)

### 6.1 Configuration Dashboard Cards

| Configuration | Description | Re-Auth Required |
|---------------|-------------|------------------|
| Password Policy | Configure password complexity rules | Yes |
| Password Expiry | Set password expiration period | Yes |
| Login Security | Failed attempts & lockout settings | Yes |
| Session Timeout | Auto-logout configuration | Yes |
| Date/Time Format | Set application date/time format | No |
| Manual Backup | Create and restore system backups | No (Admin/Super Admin) |
| Field ID Names | Configure field display names | No (Super Admin Only) |

### 6.2 Re-Authentication Dialog

Required for security-sensitive configurations
User must enter current password to proceed

**Password Field Behavior:**
- Password is MASKED by default (shown as dots/asterisks)
- Eye icon (👁) to toggle visibility (unmask/mask)
- Copy/Paste/Cut operations DISABLED
- Right-click context menu DISABLED

### 6.3 Password Policy Configuration

**Password Length:**
- Minimum Length (Range: 8-32)
- Maximum Length (Range: 32-128)

**Character Requirements:**
- Require Uppercase Letters (Configurable minimum)
- Require Lowercase Letters (Configurable minimum)
- Require Numbers (Configurable minimum)
- Require Special Characters (Configurable minimum)
- Require Alphanumeric

**Password Restrictions:**
- Password cannot be same as User ID
- Password cannot contain User ID
- Temporary password cannot be new password
- Password History Count (Range: 1-24) - Last N passwords cannot be reused

### 6.4 Login Security Configuration

**Failed Login Attempts:**
- Maximum Failed Attempts (Range: 3-10)
- Lockout Type: Temporary or Permanent
- Lockout Duration for Temporary (Range: 15-1440 minutes)

**Notifications:**
- Notify Admin when account is locked
- Notify Super Admin when account is locked

### 6.5 Session/Auto-Logout Configuration

- Enable/Disable Auto-Logout on Idle
- Idle Timeout (Range: 5-60 minutes)
- Warning Before Logout (Range: 1-5 minutes)
- Activity Detection: Mouse Movement, Mouse Click, Keyboard Input, Touch Events, Scroll Events

### 6.6 Date/Time Format Configuration

**Date Formats:**
- DD/MM/YYYY (25/12/2024)
- MM/DD/YYYY (12/25/2024)
- YYYY-MM-DD (2024-12-25) - ISO Standard
- DD-MMM-YYYY (25-Dec-2024)
- MMM DD, YYYY (Dec 25, 2024)

**Time Formats:**
- 12-Hour Format (02:30 PM)
- 24-Hour Format (14:30)

**Timezone:** Selectable from all timezones

Note: Format applies to ALL users and ALL pages in application

### 6.7 Manual Backup Management (Admin & Super Admin)

**Create Backup:**
- Backup Name field
- Include options: User Data, Configuration Settings, Asset Data, Audit Trail, Telemetry Data

**Existing Backups:**
- List showing: Name, Created Date, Size, Restore action

**Audit Logging:**
- Super Admin: NOT recorded
- Admin: RECORDED with backup details

---

## 7. Password Reset Management (Admin View)

### 7.1 Password Reset Requests List

Table columns: Request ID, User ID, Role, Requested Date, Action
Icons indicate: Admin can handle, or Super Admin Only (for Admin password resets)

### 7.2 Process Password Reset (Temporary Password Only)

**Request Details Display:**
- Request ID, User ID, User Name, Role, Requested Date

**Reset Options:**
- Generate temporary password (Recommended)
- Set manual temporary password

**Password Field Behavior (Manual Entry):**
- Password is MASKED by default (shown as dots/asterisks)
- Eye icon (👁) to toggle visibility (unmask/mask)
- Copy/Paste/Cut operations DISABLED
- Right-click context menu DISABLED

**Mandatory Setting:**
- Force password change on next login (ALWAYS enabled, cannot be unchecked)

**Important Notes:**
- User receives TEMPORARY password only
- User MUST change password on first login
- Temporary password cannot be used as new password

---

## 8. Asset Management (Maintenance & Supervisor)

### 8.1 Asset Request Form (Maintenance Role)

**Action Types:** Create, Modify, Delete
**Asset Types:** Building, Block, Area, Device, Attribute, Telemetry
**Asset Details:** Based on selected type (Name, Location, Floors, Area, etc.)
**Justification:** Required field explaining the request
**Note:** Request requires Supervisor approval before execution

### 8.2 Pending Approvals (Supervisor View)

Table showing: ID, Action, Type, Requested By, Date, View action

### 8.3 Approval Review Dialog (Supervisor)

Displays: Request details, Asset details, Justification
Review Notes field
Actions: Cancel, Reject, Approve

---

## 9. Audit Trail (Viewable by ALL Users)

### 9.1 Audit Trail View

**Filters:**
- Date Range
- User
- Action
- Module

**Export Option:** Available for data export

**Audit Records Table:**
- Timestamp, User, Role, Action, Detail (View link)

**Note:** Super Admin actions are NOT recorded in audit trail

### 9.2 Audit Detail View

**Display Fields:**
- Record ID, Timestamp, User ID, User Role, Action, IP Address
- Target Type, Target ID
- Previous Value, New Value

---

## 10. Restricted Actions

### 10.1 Unauthorized Action Message

Displayed when unauthorized user attempts restricted action
Shows: Action attempted, Required Role, User's Role
Note: Action has been logged

**Blocked Actions for Unauthorized Users:**
- Copy (Ctrl+C)
- Paste (Ctrl+V)
- Cut (Ctrl+X)
- Delete (Delete key)
- Rename (F2)
- Context menu operations

### 10.2 UI Restrictions by Role

**Super Admin / Admin:**
- Full context menu available
- All keyboard shortcuts enabled
- Drag-and-drop enabled
- All action buttons visible

**Supervisor / Maintenance / Operator / Viewer:**
- Context menu: Copy, Paste, Cut, Delete HIDDEN
- Keyboard shortcuts: Ctrl+C, V, X, Del DISABLED
- Drag-and-drop DISABLED
- Delete/Rename buttons HIDDEN
- Right-click may show "View only" options

---

## 11. Navigation Menu by Role

**SUPER ADMIN:**
- Dashboard
- User Management (Users, Roles, Password Resets)
- Configuration (Password Policy, Security Settings, Session Settings, Date/Time Format, Field ID Names, Manual Backup)
- Assets (Full Access)
- Data
- Audit Trail

**ADMIN:**
- Dashboard
- User Management (Users, Roles, Password Resets)
- Configuration (Password Policy, Security Settings, Session Settings, Date/Time Format, Manual Backup)
- Data (View Only)
- Audit Trail

**SUPERVISOR:**
- Dashboard
- Pending Approvals
- Approval History
- Data (View Only)
- Audit Trail

**MAINTENANCE:**
- Dashboard
- Asset Management (Buildings, Blocks, Areas, Devices, Attributes, Telemetry)
- My Requests
- Data (View Only)
- Audit Trail

**OPERATOR:**
- Dashboard
- Data (View Only)
- Audit Trail

**VIEWER:**
- Dashboard
- Data (View Only)
- Audit Trail

---

## 12. Password Field Security Standards

All password input fields in the application follow these security standards:

| Feature | Implementation |
|---------|----------------|
| Default State | Masked (dots/asterisks) |
| Visibility Toggle | Eye icon to unmask/mask |
| Copy (Ctrl+C) | DISABLED |
| Paste (Ctrl+V) | DISABLED |
| Cut (Ctrl+X) | DISABLED |
| Right-click Menu | DISABLED |
| Drag-and-drop | DISABLED |
| Select All (Ctrl+A) | Allowed (for manual deletion) |

**Applicable Fields:**
- Login page password
- User creation password and confirm password
- Password change (current, new, confirm)
- Re-authentication dialog password
- Password reset manual entry

---

## 13. Compliance Summary

| Requirement | Implementation | Status |
|-------------|----------------|--------|
| Unique user identification | Unique User IDs enforced | ✅ |
| Password complexity | Real-time validation UI | ✅ |
| Password history notification | Shows last N passwords blocked | ✅ |
| Temporary password flow | Mandatory change after login | ✅ |
| Temporary password restriction | Cannot be used as new password | ✅ |
| Account lockout display | Clear error messages | ✅ |
| Session timeout warning | Countdown dialog | ✅ |
| Audit trail visibility | All users can view | ✅ |
| Super Admin exclusion | Actions not recorded | ✅ |
| Role-based UI | Components show/hide by role | ✅ |
| Field ID configurability | Super Admin can rename fields globally | ✅ |
| Manual backup | Admin/Super Admin access | ✅ |
| Restricted operations | Copy/Paste/Delete blocked for unauthorized | ✅ |
| Password masking | Masked by default with unmask toggle | ✅ |
| Password field copy/paste | Copy/Paste/Cut disabled in all password fields | ✅ |
| Login security | Same error message for non-existent users | ✅ |

---

*Document Version: 2.0*
*Last Updated: 2026-03-07*
*Compliance Standard: 21 CFR Part 11*
*Status: All features COMPLETE — 34+ pages, 9 custom hooks, 16 UI components, React 19 + Vite 6 + Tailwind CSS 4*
