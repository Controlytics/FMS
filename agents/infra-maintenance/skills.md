# Infrastructure Maintenance Agent — Skills & Context

## Identity
**Role:** DevOps and documentation guardian. Maintains unit test scripts, markdown documentation, git hygiene, EC2 instance health, build pipeline, and project file consistency.
**Trigger:** Runs after code changes, test runs, bug fixes, and periodically for health checks.

---

## 1. Responsibilities

### 1.1 Documentation Maintenance (.md files)
### 1.2 Test Script Maintenance
### 1.3 Git Repository Hygiene
### 1.4 EC2 Instance Health
### 1.5 Build Pipeline Integrity

---

## 2. Documentation Files Inventory (35 .md files)

### 2.1 Root-Level Documentation
| File | Purpose | Update When |
|------|---------|-------------|
| `CLAUDE.md` | Master project context for AI agents | Architecture changes, new modules, new patterns |
| `README.md` | Quick start guide | Setup steps change |
| `CHANGELOG.md` | Version history | Every release |
| `API_GUIDE.md` | Full API endpoint documentation | Routes added/modified |
| `BUSINESS_CONTEXT.md` | Business domain context | Business requirements change |
| `CODEBASE_CONTEXT.md` | Technical codebase context | Architecture changes |
| `PLAN.md` | Development plan | Phase completion, new phases |
| `SESSION_RESUME.md` | Session resumption context | After each development session |
| `CREDENTIALS.md` | Credential information | Passwords/keys change |
| `EC2_SETUP.md` | EC2 deployment guide | Infrastructure changes |
| `task_status.md` | Development progress tracker | Task completion, new tasks |
| `2_DigiLog_Asset_Module_Requirements.md` | Asset module requirements | Requirements change |
| `DATA_INGESTION_REQUIREMENTS_v3.md` | Data ingestion specs | Ingestion requirements change |

### 2.2 App-Level Documentation
| File | Purpose | Update When |
|------|---------|-------------|
| `apps/api/CLAUDE.md` | Backend-specific context | API architecture changes |
| `apps/api/DECISIONS.md` | Backend architecture decisions | New architectural decisions |
| `apps/web/CLAUDE.md` | Frontend-specific context | Frontend architecture changes |
| `apps/web/DECISIONS.md` | Frontend architecture decisions | New frontend decisions |
| `packages/shared/CLAUDE.md` | Shared package context | Schema/type changes |
| `claude/backend.md` | Backend development guide | Backend patterns change |
| `claude/frontend.md` | Frontend development guide | Frontend patterns change |

### 2.3 Phase Documentation (11 files)
| File | Purpose |
|------|---------|
| `docs/phases/README.md` | Phase overview |
| `docs/phases/phase-a.md` through `phase-k.md` | Individual phase plans |

### 2.4 Testing Documentation
| File | Purpose | Update When |
|------|---------|-------------|
| `documentation/Bug_Resolution_Log.md` | Bug tracking (13 entries) | Bug found/resolved |
| `documentation/Project_Summary.md` | Project overview | Major milestones |
| `documentation/testing/manual/TEST.md` | Manual test procedures | Test procedures change |
| `documentation/testing/manual/TEST_CASES.md` | Test case definitions | New test cases |
| `documentation/testing/manual/TEST_SUMMARY.md` | Test result summary | After test runs |
| `documentation/testing/reports/TEST_REPORT.md` | Detailed test reports | After test runs |
| `documentation/testing/reports/TREE_DIAGRAM_TEST_REPORT.md` | Tree diagram tests | Entity tree changes |
| `documentation/testing/reports/RBAC_TEST_RESULTS.md` | RBAC test results | RBAC changes |
| `documentation/testing/validation/21CFR_PART11_VERIFICATION.md` | Compliance verification | Compliance checks |

### 2.5 Maintenance Tasks
After any code change:
```bash
# 1. Check all .md files are current
find /home/ubuntu/21cfrlogbook -name '*.md' -not -path '*/node_modules/*' -newer /home/ubuntu/21cfrlogbook/apps/api/dist/app.js | sort

# 2. Verify CLAUDE.md reflects current architecture
# - Module count matches actual modules
# - Route count matches actual routes
# - Model count matches prisma schema
# - Permission list matches permissions.ts

# 3. Verify task_status.md reflects current state
# - Completed tasks marked as done
# - Open bugs listed
# - Current phase accurate

# 4. Verify Bug_Resolution_Log.md
# - All fixed bugs documented
# - Open bugs listed
# - Bug numbers sequential (BUG-001 through BUG-NNN)
```

---

## 3. Test Script Maintenance

### 3.1 Test File Inventory (69 files, 425+ tests)

**E2E Tests** (`apps/api/src/e2e/`) — 14 files:
```
auth.test.ts, users.test.ts, roles.test.ts, config.test.ts,
audit.test.ts, notifications.test.ts, health.test.ts,
checklist-templates.test.ts, entities.test.ts, connectivity.test.ts,
help-articles.test.ts, qr-codes.test.ts, rule-chains.test.ts,
system-health.test.ts
```

**Lib Unit Tests** (`apps/api/src/lib/`) — 9 files:
```
audit.test.ts, build-context.test.ts, error-schemas.test.ts,
errors.test.ts, hash-chain.test.ts, jwt.test.ts,
password.test.ts, reauth-check.test.ts, user-id-validator.test.ts
```

**Module Unit Tests** (`apps/api/src/modules/`) — 36+ files:
```
assets/: template.routes.test.ts, template.service.test.ts, template.repository.test.ts,
         instance.routes.test.ts, instance.service.test.ts, instance.repository.test.ts,
         relationship.routes.test.ts, relationship.service.test.ts, relationship.repository.test.ts,
         identifier.routes.test.ts, identifier.service.test.ts, identifier.repository.test.ts
auth/: auth.service.test.ts, routes.test.ts
backup/: backup.service.test.ts, backup.helpers.test.ts, routes.test.ts
config/: config.service.test.ts, routes.test.ts
data-ingestion/: ingestion.service.test.ts, ingestion.repository.test.ts, routes.test.ts,
                 connectivity-tracker.test.ts, dlq-manager.test.ts, entity-resolver.test.ts,
                 message-normalizer.test.ts, pipeline-tracer.test.ts, rpc-handler.test.ts
notifications/: notification.service.test.ts, routes.test.ts
roles/: role.service.test.ts, routes.test.ts
rule-chain/: rule-engine.test.ts, node-registry.test.ts, debug-recorder.test.ts, routes.test.ts
uns/: uns.service.test.ts, routes.test.ts
users/: user.service.test.ts, routes.test.ts
```

**Plugin Tests** — 3 files:
```
audit-logger.plugin.test.ts, auth.plugin.test.ts, rbac.plugin.test.ts
```

**Transport Tests** — 4 files:
```
mqtt-auth-routes.test.ts, mqtt-client.test.ts, mqtt-handler.test.ts, ws-handler.test.ts
```

**Worker Tests** — 2 files:
```
ingestion.worker.test.ts, maintenance.worker.test.ts
```

**Shared Package Tests** — 5 files:
```
assets.test.ts, auth.test.ts, config.test.ts, users.test.ts, audit-templates.test.ts
```

**DB Package Tests** — 1 file:
```
telemetry-batcher.test.ts
```

### 3.2 Test Health Checks
```bash
ssh -i /f/claude/21cfrlogbook/21cfrbook.pem ubuntu@3.108.185.106

cd /home/ubuntu/21cfrlogbook

# Run all tests and capture results
npx vitest run 2>&1 | tee /tmp/test-results.txt

# Count pass/fail
grep -c 'PASS' /tmp/test-results.txt
grep -c 'FAIL' /tmp/test-results.txt

# Check for orphaned test files (test files without corresponding source)
find apps/api/src -name '*.test.ts' | while read f; do
  src=$(echo "$f" | sed 's/.test.ts/.ts/')
  [ ! -f "$src" ] && echo "ORPHAN: $f (no source: $src)"
done

# Check for untested source files (source files without tests)
find apps/api/src/modules -name '*.ts' ! -name '*.test.ts' ! -name 'index.ts' | while read f; do
  test=$(echo "$f" | sed 's/.ts/.test.ts/')
  [ ! -f "$test" ] && echo "UNTESTED: $f"
done
```

### 3.3 Vitest Configuration
```bash
# Check vitest config files
cat /home/ubuntu/21cfrlogbook/vitest.config.ts
cat /home/ubuntu/21cfrlogbook/apps/api/vitest.config.ts
cat /home/ubuntu/21cfrlogbook/packages/shared/vitest.config.ts
cat /home/ubuntu/21cfrlogbook/packages/db/vitest.config.ts
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

# Check for large files that shouldn't be in git
find . -name '*.pem' -o -name '*.env' -o -name '*.log' -o -name '*.sqlite' | grep -v node_modules
```

### 4.2 Branch Management
```bash
# List branches
git branch -a

# Check current branch
git branch --show-current

# Check if there are stale branches
git branch --merged | grep -v main
```

### 4.3 Commit Hygiene
```bash
# Recent commit history
git log --oneline -20

# Check for commits without meaningful messages
git log --oneline -50 | grep -iE 'fix|temp|wip|todo|hack'

# Check for large commits
git log --stat -10 | grep -E '^\s+\d+ files changed'
```

### 4.4 Sensitive File Protection
```bash
# Verify no secrets in git history
git log --all --full-history -- '*.env' '*.pem' '*.key' 'credentials*'

# Check current tracked files for secrets
git ls-files | grep -iE '\.env|\.pem|\.key|credentials|secret'
```

---

## 5. EC2 Instance Health

### 5.1 System Health
```bash
ssh -i /f/claude/21cfrlogbook/21cfrbook.pem ubuntu@3.108.185.106

# Disk space
df -h /

# Memory usage
free -h

# CPU load
uptime

# Running processes
ps aux --sort=-rss | head -15

# System updates pending
apt list --upgradable 2>/dev/null | wc -l
```

### 5.2 Service Health
```bash
# PM2 (API)
pm2 status
pm2 logs digilog-api --lines 10 --nostream

# PostgreSQL
systemctl status postgresql
PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db -c "SELECT 1;"

# Nginx (Frontend)
systemctl status nginx
curl -s -o /dev/null -w "%{http_code}" http://localhost/

# EMQX (MQTT)
systemctl status emqx 2>/dev/null || echo "EMQX status unknown"

# Redis (BullMQ)
redis-cli ping 2>/dev/null || echo "Redis not responding"
```

### 5.3 Log Management
```bash
# Check log sizes
du -sh /home/ubuntu/.pm2/logs/
ls -lh /home/ubuntu/.pm2/logs/

# Check for log rotation
ls /etc/logrotate.d/ | grep -i 'pm2\|nginx\|postgresql'

# Check disk usage by directory
du -sh /home/ubuntu/21cfrlogbook/node_modules/
du -sh /home/ubuntu/21cfrlogbook/apps/api/dist/
du -sh /home/ubuntu/21cfrlogbook/apps/web/dist/
```

### 5.4 Security
```bash
# Check SSH config
grep -E 'PasswordAuthentication|PermitRootLogin' /etc/ssh/sshd_config

# Check firewall
sudo ufw status 2>/dev/null || sudo iptables -L -n | head -20

# Check listening ports
ss -tlnp | grep LISTEN

# Check for failed login attempts
journalctl -u ssh --since "24 hours ago" | grep -c "Failed"
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
ls apps/web/dist/assets/ | wc -l

# Check for TypeScript errors
npx tsc --project apps/api/tsconfig.json --noEmit 2>&1 | tail -20
```

### 6.2 Dependency Health
```bash
# Check for outdated packages
npm outdated

# Check for security vulnerabilities
npm audit

# Verify lockfile integrity
npm ci --dry-run 2>&1 | tail -5
```

### 6.3 Turborepo Cache
```bash
# Check Turborepo cache
ls -la /home/ubuntu/21cfrlogbook/node_modules/.cache/turbo/

# Clear cache if issues
# rm -rf node_modules/.cache/turbo/
```

---

## 7. Periodic Maintenance Schedule

| Task | Frequency | Command |
|------|-----------|---------|
| Disk space check | Daily | `df -h /` |
| PM2 status | Daily | `pm2 status` |
| Log rotation | Weekly | Check log sizes, rotate if > 100MB |
| Git status | Before each session | `git status` |
| npm audit | Weekly | `npm audit` |
| Test suite run | After each change | `npx vitest run` |
| Documentation review | After each bug fix | Verify .md files updated |
| Backup verification | Weekly | Check backup system |
| System updates | Monthly | `sudo apt update && sudo apt upgrade` |

---

## 8. Incident Response

### 8.1 API Down
```bash
pm2 status                    # Check process status
pm2 logs digilog-api --lines 50  # Check error logs
pm2 restart digilog-api       # Restart
sleep 3
curl -s http://localhost:3000/api/system-health  # Verify
```

### 8.2 Frontend Down
```bash
systemctl status nginx        # Check nginx
sudo systemctl restart nginx  # Restart
curl -s -o /dev/null -w "%{http_code}" http://localhost/  # Verify
```

### 8.3 Database Down
```bash
systemctl status postgresql
sudo systemctl restart postgresql
PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db -c "SELECT 1;"
```

### 8.4 Disk Full
```bash
# Find large files
du -ah /home/ubuntu/ | sort -rh | head -20

# Clear PM2 logs
pm2 flush

# Clear old builds
rm -rf /home/ubuntu/21cfrlogbook/apps/api/dist
rm -rf /home/ubuntu/21cfrlogbook/apps/web/dist

# Clear npm cache
npm cache clean --force
```

---

## 9. Connection Details

| Resource | Details |
|----------|---------|
| EC2 | `ssh -i /f/claude/21cfrlogbook/21cfrbook.pem ubuntu@3.108.185.106` |
| Instance ID | `i-0df88b77a8ac636df` |
| DB | `PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db` |
| API | `http://localhost:3000/api` |
| Web | `http://3.108.185.106` (nginx port 80) |
| PM2 | `pm2 status`, `pm2 logs`, `pm2 restart` |
| Build | `cd /home/ubuntu/21cfrlogbook && npm run build` |
| Tests | `npx vitest run` |
| Git | `cd /home/ubuntu/21cfrlogbook && git status` |
