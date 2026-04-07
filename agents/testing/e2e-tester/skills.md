# E2E Tester Agent — Skills & Context

## Identity
**Role:** End-to-end integration testing specialist. Validates complete user workflows that span multiple modules, from frontend actions through API calls to database state changes.
**Scope:** Cross-module user journeys, regression testing, workflow validation.

---

## 1. Core Responsibility

Test **complete user workflows** that cross module boundaries.

```
User Action -> Frontend -> API -> Service -> Repository -> Database
                                  |               |
                            RBAC/Reauth      Audit Trail
                                  |
                          Notification/MQTT
```

---

## 2. Critical Workflows to Test

### Phase 1 Workflows
1. **User Lifecycle** — Create -> temp password -> login -> forced change -> role-based actions -> disable -> enable
2. **Entity Template -> Instance -> Data Flow** — Create template -> create instance -> device credentials -> MQTT/HTTP telemetry -> rule engine -> alarms -> notifications
3. **RBAC Full Cycle** — Create custom role -> assign to user -> test allowed/denied ops
4. **Configuration Change Propagation** — Change password policy -> enforce on next creation
5. **Template Versioning** — Create v1 -> create entities -> update to v2 -> old entities still reference v1
6. **Entity Relationship Tree** — Create hierarchy -> relationships -> tree diagram verification
7. **Audit Trail Integrity** — 10 sequential actions -> verify hash chain -> no gaps -> export
8. **Password Policy Enforcement** — Policy rules -> weak password rejected -> strong accepted -> history check

### Phase 2 Workflows
9. **Filter Cleaning Cycle** — Start cycle with reason -> advance through stages -> submit checklists -> auto-complete
10. **Cleaning Profile Pipeline** — Create profile -> add stages/checklists in visual editor -> validate graph -> version
11. **Checklist Gate Enforcement** — Advance to checklist node -> submit required -> advance past gate
12. **Bypass with Deviation** — Bypass a stage -> deviation recorded -> events logged with checksums
13. **PM Schedule Execution** — Create annual schedule -> monthly entries -> execute with tolerance
14. **Filter Traceability** — View filter event history -> full lifecycle timeline
15. **Retirement/Replacement** — Retire filter with reason -> replace with new filter -> traceability preserved
16. **Bulk Upload** — CSV import -> validation -> filters created -> profiles assigned

---

## 3. Test Execution

### 3.1 Existing E2E Tests
```bash
cd /home/ubuntu/21cfrlogbook

# Run all E2E tests
npx vitest run --project api -- e2e
```

**Existing E2E test files (14):**
auth, users, roles, config, audit, notifications, entities, connectivity, checklist-templates, help-articles, qr-codes, rule-chains, system-health, health

### 3.2 Test Users
| Username | Role | Password |
|----------|------|----------|
| superadmin | SUPER_ADMIN | Admin@123 |

---

## 4. Connection Details

| Resource | Details |
|----------|---------|
| SSH | `ssh -i ~/Downloads/21cfrbook.pem ubuntu@34.232.224.0` |
| API | `http://localhost:3000/api` |
| Web | `http://34.232.224.0` |
| Default Login | username: `superadmin`, password: `Admin@123` |

## Phase 2 Coverage
- Filter management E2E workflows (cycle lifecycle, checklist gates, bypass/deviation)
- PM scheduling E2E workflows
- Retirement/replacement E2E workflows
- Bulk upload E2E workflows
- Quality audit: 43 issues found, 35 fixed (commit 429538f)

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
