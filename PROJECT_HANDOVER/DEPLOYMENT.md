# Deployment Guide

## Current Production Server
- **IP:** 44.213.157.198
- **Region:** us-east-1 (N. Virginia)
- **Instance:** AWS EC2 (Ubuntu)
- **SSH Key:** `multi-tenant-ldapp-key.pem`
- **SSH:** `ssh -i multi-tenant-ldapp-key.pem ubuntu@44.213.157.198`

## Services Running
| Service | Port | Manager |
|---------|------|---------|
| Nginx | 80/443 | systemd |
| Fastify API | 3000 | PM2 |
| PostgreSQL | 5432 | systemd |
| TimescaleDB | 5433 | systemd |
| Redis | 6379 | systemd |
| EMQX MQTT | 1883/8083/18083 | systemd |

## Build Process
```bash
# SSH into server
ssh -i multi-tenant-ldapp-key.pem ubuntu@44.213.157.198

# Navigate to project
cd /home/ubuntu/21cfrlogbook

# Pull latest code (if using git remote)
git pull origin main

# Install dependencies (if package.json changed)
npm install

# Build everything (Turborepo)
npm run build
# This runs:
#   1. packages/shared → TypeScript compile
#   2. packages/db → Prisma generate
#   3. apps/api → TypeScript compile (output: dist/)
#   4. apps/web → Vite build (output: dist/)

# Restart API
pm2 restart digilog-api

# Verify
curl http://localhost:3000/api/health
```

## Environment Configuration

### Production .env
```bash
NODE_ENV=production
API_PORT=3000
DATABASE_URL=postgresql://digilog:digilog123@localhost:5432/digilog_db?schema=public
TSDB_HOST=localhost
TSDB_PORT=5433
REDIS_HOST=localhost
MQTT_ENABLED=true
MQTT_BROKER_HOST=localhost
MQTT_BROKER_PORT=1883
```

### Nginx Configuration
Nginx serves:
- Static frontend files from `apps/web/dist/`
- Reverse proxies `/api/*` to `localhost:3000`
- Reverse proxies `/ws` to `localhost:3000` (WebSocket upgrade)

## PM2 Commands
```bash
pm2 list                    # Show running processes
pm2 restart digilog-api     # Restart API
pm2 logs digilog-api        # View logs
pm2 logs digilog-api --lines 100  # Last 100 lines
pm2 monit                   # Real-time monitoring
pm2 save                    # Save current process list
pm2 startup                 # Auto-start on server reboot
```

## Database Backup
```bash
# Backup
pg_dump -U digilog digilog_db > backup_$(date +%Y%m%d).sql

# Restore
psql -U digilog digilog_db < backup_20260323.sql
```

## Rollback
```bash
# View recent commits
git log --oneline -10

# Rollback to specific commit
git checkout <commit_hash> -- apps/
npm run build
pm2 restart digilog-api
```

## Health Checks
```bash
# API health
curl http://localhost:3000/api/health

# PM2 status
pm2 list

# PostgreSQL
psql -U digilog -d digilog_db -c "SELECT 1;"

# Redis
redis-cli ping

# MQTT
mosquitto_pub -t test -m "hello" -h localhost
```


## Phase 2: Digital Filter Management System (2026-03-27)

### Overview
Complete digital filter cleaning lifecycle management for pharmaceutical cleanrooms. Supports configurable cleaning pipelines with checklist gates, 8 cleaning stages, dual filter sets, PM scheduling, and full traceability.

### Key Components
- **5 backend modules**: cleaning-profiles, filter-profiles, filter-operations, pm-schedules, checklist-profiles
- **12+ frontend pages**: operations, profiles, cycles, checklists, PM, AHU dashboard, traceability, config
- **9 database tables**: filter_cleaning_profiles, filter_pipeline_stages, filter_pipeline_connections, filter_profiles, cleaning_cycles, filter_events, pm_schedules, pm_schedule_entries, pm_executions
- **Quality audit**: 43 issues found and 35 fixed (security, compliance, logic, UI)

