# Infrastructure Maintenance Agent — Skills & Context

## Identity
**Role:** DevOps and documentation guardian. Maintains unit test scripts, markdown documentation, git hygiene, EC2 instance health, build pipeline, and project file consistency.
**Trigger:** Runs after code changes, test runs, bug fixes, and periodically for health checks.
**Tech Stack:** Fastify 5 + React 19 + PostgreSQL 18 + Prisma + TimescaleDB + BullMQ + Redis 5 + EMQX

---

## 1. Responsibilities

### 1.1 Documentation Maintenance (.md files)
### 1.2 Test Script Maintenance
### 1.3 Git Repository Hygiene
### 1.4 EC2 Instance Health
### 1.5 Build Pipeline Integrity

---

## 2. Documentation Files Inventory

### 2.1 Root-Level Documentation
| File | Purpose | Update When |
|------|---------|-------------|
| `CLAUDE.md` | Master project context for AI agents | Architecture changes, new modules, new patterns |
| `README.md` | Quick start guide | Setup steps change |
| `CHANGELOG.md` | Version history | Every release |

### 2.2 App-Level Documentation
| File | Purpose | Update When |
|------|---------|-------------|
| `apps/api/CLAUDE.md` | Backend-specific context (34 modules) | API architecture changes |
| `apps/api/DECISIONS.md` | Backend architecture decisions (41+) | New architectural decisions |
| `apps/web/CLAUDE.md` | Frontend-specific context (34+ pages) | Frontend architecture changes |
| `apps/web/DECISIONS.md` | Frontend architecture decisions (30+) | New frontend decisions |
| `apps/web/generate-apk.md` | Android APK generation guide | Mobile build process changes |
| `packages/shared/CLAUDE.md` | Shared package context | Schema/type changes |
| `claude/backend.md` | Backend development guide | Backend patterns change |
| `claude/frontend.md` | Frontend development guide | Frontend patterns change |

### 2.3 Agent Documentation (16 files)
| File | Purpose |
|------|---------|
| `agents/AGENTS_INDEX.md` | Agent roster and coordination protocol |
| `agents/*/skills.md` | Per-agent skills and context |
| `agents/*/work.md` | Per-agent work logs |

### 2.4 Maintenance Tasks
After any code change:
```bash
# 1. Check all .md files are current
# - Module count matches actual modules (34 API modules)
# - Model count matches prisma schema (57 models, 17 enums)
# - Permission count matches permissions.ts (52+)
# - Route count matches frontend routes (34+ pages)

# 2. Verify Phase 2 content is present in all docs
# - Filter operations, cleaning profiles, checklist profiles
# - PM schedules, equipment groups, entity assignments
# - Retirement/replacement, bulk upload, traceability
```

---

## 3. Test Script Maintenance

### 3.1 Test Health Checks
```bash
cd /home/ubuntu/21cfrlogbook

# Run all tests and capture results
npx vitest run 2>&1 | tee /tmp/test-results.txt

# Count pass/fail
grep -c 'PASS' /tmp/test-results.txt
grep -c 'FAIL' /tmp/test-results.txt
```

### 3.2 Vitest Configuration
```bash
# Check vitest config files
cat vitest.config.ts
cat apps/api/vitest.config.ts
cat packages/shared/vitest.config.ts
cat packages/db/vitest.config.ts
```

---

## 4. Git Repository Hygiene

### 4.1 Git Status Checks
```bash
cd /home/ubuntu/21cfrlogbook

# Check for uncommitted changes
git status

# Check for untracked files that should be committed
git status --short | grep '??' | grep -v 'node_modules\|dist\|.env'

# Check .gitignore is complete
cat .gitignore
```

### 4.2 Branch Management
- **Active branch:** `DigitalFMS` (Phase 2 development)
- **Main branch:** `main`

### 4.3 Sensitive File Protection
```bash
# Verify no secrets in git
git ls-files | grep -iE '\.env|\.pem|\.key|credentials|secret'
```

---

## 5. EC2 Instance Health

### 5.1 Service Health
```bash
ssh -i ~/Downloads/21cfrbook.pem ubuntu@34.232.224.0

# PM2 (API)
pm2 status
pm2 logs digilog-api --lines 10 --nostream

# PostgreSQL
systemctl status postgresql

# Nginx (Frontend)
systemctl status nginx
curl -s -o /dev/null -w "%{http_code}" http://localhost/

# EMQX (MQTT)
systemctl status emqx 2>/dev/null

# Redis (BullMQ)
redis-cli ping 2>/dev/null
```

### 5.2 Incident Response

**API Down:**
```bash
pm2 status
pm2 logs digilog-api --lines 50
pm2 restart digilog-api
sleep 3
curl -s http://localhost:3000/api/system-health
```

**Frontend Down:**
```bash
systemctl status nginx
sudo systemctl restart nginx
```

**Database Down:**
```bash
systemctl status postgresql
sudo systemctl restart postgresql
```

---

## 6. Build Pipeline Integrity

### 6.1 Build Process
```bash
cd /home/ubuntu/21cfrlogbook

# Full clean build
rm -rf apps/api/dist apps/web/dist
npm run build

# Verify build artifacts
ls -la apps/api/dist/app.js
ls -la apps/web/dist/index.html

# Check for TypeScript errors
npx tsc --project apps/api/tsconfig.json --noEmit 2>&1 | tail -20
```

### 6.2 Build Order (Turborepo)
```
shared -> db -> queue -> api -> web
```

---

## 7. Connection Details

| Resource | Details |
|----------|---------|
| EC2 | `ssh -i ~/Downloads/21cfrbook.pem ubuntu@34.232.224.0` |
| DB | `PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db` |
| API | `http://localhost:3000/api` |
| Web | `http://34.232.224.0` (nginx port 80) |
| PM2 | `pm2 status`, `pm2 logs`, `pm2 restart` |
| Build | `cd /home/ubuntu/21cfrlogbook && npm run build` |
| Tests | `npx vitest run` |
| Git | `cd /home/ubuntu/21cfrlogbook && git status` |

## Phase 2 Coverage
- Filter management module documentation and testing
- PM scheduling module documentation
- Quality audit: 43 issues found, 35 fixed (commit 429538f)
- Equipment groups, entity assignments, retirement/replacement, bulk upload
- 57 Prisma models, 17 enums documented across all .md files
