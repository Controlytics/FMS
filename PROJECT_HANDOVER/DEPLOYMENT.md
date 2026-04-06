# Deployment Guide

## Current Production Server
- **IP:** 34.232.224.0 (may change on restart)
- **Region:** us-east-1 (N. Virginia)
- **Instance:** AWS EC2 (Ubuntu)
- **SSH Key:** `21cfrbook.pem`
- **SSH:** `ssh -i ~/Downloads/21cfrbook.pem ubuntu@34.232.224.0`

## Services Running
| Service | Port | Manager |
|---------|------|---------|
| Nginx | 80/443 | systemd |
| Fastify API | 3000 | PM2 |
| PostgreSQL | 5432 | systemd |
| Redis | 6379 | systemd |
| EMQX MQTT | 1883/8083/18083 | systemd |

## Key URLs
| URL | Purpose |
|-----|---------|
| http://34.232.224.0 | Application (frontend) |
| http://34.232.224.0/docs | Swagger API docs |
| http://34.232.224.0:18083 | EMQX Management Console |

## Default Login
- **Username:** superadmin
- **Password:** Admin@123

## Build & Deploy Process
```bash
# SSH into server
ssh -i ~/Downloads/21cfrbook.pem ubuntu@34.232.224.0

# Navigate to project
cd /home/ubuntu/21cfrlogbook

# Pull latest code
git pull origin DigitalFMS

# Install dependencies (if package.json changed)
npm install

# Build backend (TypeScript compile)
npx tsc -p apps/api/tsconfig.json

# IMPORTANT: Always compile TypeScript BEFORE restarting PM2 (PM2 runs compiled JS)
pm2 restart digilog-api

# Build frontend
cd apps/web && npx vite build
# Output goes to apps/web/dist/ (served by Nginx)

# Rebuild shared packages (if shared types changed)
npx nx build shared && npx nx build db && npx nx build queue

# Verify
curl http://localhost:3000/api/health
```

## Environment Configuration

### Production .env
```bash
NODE_ENV=production
API_PORT=3000
DATABASE_URL=postgresql://digilog:digilog123@localhost:5432/digilog_tsdb?schema=public
TSDB_HOST=localhost
TSDB_PORT=5432
REDIS_HOST=localhost
MQTT_ENABLED=true
MQTT_BROKER_HOST=localhost
MQTT_BROKER_PORT=1883
```

**Note:** The database name is `digilog_tsdb`, NOT `digilog_db`.

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

## Database Management
```bash
# Backup
pg_dump -U digilog digilog_tsdb > backup_$(date +%Y%m%d).sql

# Restore
psql -U digilog digilog_tsdb < backup_20260323.sql

# Run Prisma migrations
cd apps/api
npx prisma migrate deploy
npx prisma generate

# Seed data (roles, super admin, default org)
npx prisma db seed
```

## Rollback
```bash
# View recent commits
git log --oneline -10

# Rollback to specific commit
git checkout <commit_hash> -- apps/
npx tsc -p apps/api/tsconfig.json
pm2 restart digilog-api
cd apps/web && npx vite build
```

## Health Checks
```bash
# API health
curl http://localhost:3000/api/health

# PM2 status
pm2 list

# PostgreSQL
psql -U digilog -d digilog_tsdb -c "SELECT 1;"

# Redis
redis-cli ping

# MQTT
mosquitto_pub -t test -m "hello" -h localhost
```

## Windows Local Development

### Prerequisites
- Redis 5 (Windows build)
- EMQX MQTT Broker
- PostgreSQL 18
- Node.js 20+

### Start/Stop Scripts
```bash
# Start all services and dev servers
start-digilog.bat

# Stop all services
stop-digilog.bat
```

### Manual Start
```bash
# API (with hot reload)
cd apps/api
npx tsx watch src/app.ts

# Frontend (with hot reload)
cd apps/web
npx vite

# Backend: http://localhost:3000
# Frontend: http://localhost:5173
# Swagger: http://localhost:3000/docs
```
