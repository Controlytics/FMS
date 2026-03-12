# DigiLog Test Cases

**Last verified:** 2026-03-07
**Status:** All 43 test cases PASS. All features complete and deployed.

## Configuration — Action Re-authentication

| # | Test Case | Expected | Status |
|---|-----------|----------|--------|
| 1 | Navigate to /config/action-reauth as SUPER_ADMIN | Page loads with role-action matrix | PASS |
| 2 | All active roles appear as column headers | Dynamic roles from /api/roles/active shown | PASS |
| 3 | Check a checkbox for DELETE_USER + ADMIN role | Checkbox toggles, "Unsaved Changes" badge appears | PASS |
| 4 | Click "Select All" on a category row | All checkboxes in that category for all roles checked | PASS |
| 5 | Click "Clear" on a category row | All checkboxes in that category cleared | PASS |
| 6 | Click "All" under a role column header | All actions checked for that role | PASS |
| 7 | Click "Clear" under a role column header | All actions unchecked for that role | PASS |
| 8 | Click "Save Configuration" | Config saved, success message shown, cache invalidated | PASS |
| 9 | Click "Discard Changes" | Local changes reverted to saved config | PASS |
| 10 | Non-SUPER_ADMIN cannot access /config/action-reauth | 403 Forbidden on API call | PASS |
| 11 | GET /api/config/action-reauth/check?action=DELETE_USER | Returns { action, required: true/false } | PASS |
| 12 | GET /api/config/action-reauth/my-actions | Returns array of actions requiring reauth for current role | PASS |

## Configuration — Audit Text Templates

| # | Test Case | Expected | Status |
|---|-----------|----------|--------|
| 13 | Navigate to /config/audit-templates as SUPER_ADMIN | Page loads with all 7 categories | PASS |
| 14 | All template categories rendered | User Mgmt, Auth, Config, Asset Mgmt, Role Mgmt, Backup, Data & Approvals | PASS |
| 15 | Edit a template text | Input value changes, "Unsaved Changes" bar appears | PASS |
| 16 | Live preview updates as you type | Preview below input reflects changes with sample values | PASS |
| 17 | Click "Reset" on a modified template | Reverts to default template text | PASS |
| 18 | Click "Reset All to Defaults" | All templates reset to defaults | PASS |
| 19 | Click "Save Changes" | Templates saved, success message | PASS |
| 20 | Click "Discard" in sticky bar | Local changes reverted | PASS |
| 21 | Placeholder legend shows all 5 placeholders | {actor}, {targetUser}, {targetName}, {configKey}, {targetType} | PASS |
| 22 | GET /api/config/audit-templates/current | Returns merged defaults + saved overrides | PASS |
| 23 | Non-SUPER_ADMIN cannot PUT /api/config/audit-templates | 403 Forbidden | PASS |

## Configuration — Pagination Settings

| # | Test Case | Expected | Status |
|---|-----------|----------|--------|
| 24 | Navigate to /config/pagination as SUPER_ADMIN | Page loads with 3 number inputs | PASS |
| 25 | Change Option 1 to 15 | Input updates, preview shows sorted values | PASS |
| 26 | Save with values [15, 25, 50] | Saved, success message, values auto-sorted | PASS |
| 27 | Save with duplicate values [10, 10, 50] | Error: "All three values must be different" | PASS |
| 28 | Save with value < 5 | Error: "All values must be between 5 and 100" | PASS |
| 29 | Save with value > 100 | Error: "All values must be between 5 and 100" | PASS |
| 30 | Click "Reset to Default" | Values reset to [10, 25, 50] | PASS |
| 31 | GET /api/config/pagination/current (any auth user) | Returns { options: [10, 25, 50] } | PASS |

## Configuration — Role Privileges (Dynamic Roles)

| # | Test Case | Expected | Status |
|---|-----------|----------|--------|
| 32 | Navigate to /config/role-privileges | All active roles except SUPER_ADMIN shown as buttons | PASS |
| 33 | Create new custom role (e.g., "QA") on /config/roles | Role created successfully | PASS |
| 34 | Navigate to /config/role-privileges | "QA" role appears in role selection buttons | PASS |
| 35 | Select "QA" role | Permissions grid loads for QA role | PASS |
| 36 | Toggle permissions for QA role and save | Permissions saved successfully | PASS |
| 37 | Role display name and color from DB shown | Custom role shows DB displayName and color | PASS |
| 38 | Delete custom role, revisit role-privileges | Deleted role no longer appears | PASS |

## User Management — Dynamic Roles

| # | Test Case | Expected | Status |
|---|-----------|----------|--------|
| 39 | Create user with custom role (e.g., "QA") | User created successfully (no enum error) | PASS |
| 40 | Update user role to custom role | Role updated successfully | PASS |
| 41 | Role dropdown in create/edit shows custom roles | All active roles from /api/roles/active displayed | PASS |
| 42 | User list filter dropdown shows custom roles | All active roles in filter dropdown | PASS |
| 43 | Create role then immediately check create-user dropdown | New role appears (SWR cache invalidated) | PASS |

## Existing Feature Tests

All existing test cases for Authentication, User Management, Configuration, Asset Hierarchy, Templates, Audit Trail, and Notifications remain passing. See previous test runs for detailed results.
