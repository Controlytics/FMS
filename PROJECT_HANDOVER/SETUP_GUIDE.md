# Setup & Installation Guide

## Prerequisites
- Node.js 20+ with npm 11+
- PostgreSQL 15+
- TimescaleDB (PostgreSQL extension on port 5433)
- Redis 7+
- EMQX MQTT Broker 5.x
- Nginx (for production)
- PM2 (for production process management)

## Installation Steps

### 1. Clone Repository
```bash
git clone https://github.com/pankajexa/21cfrlogbook.git
cd 21cfrlogbook
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Variables
```bash
cp .env.example .env
# Edit .env with your database credentials, JWT secrets, etc.
```

### 4. Database Setup
```bash
# Create PostgreSQL database
psql -U postgres -c "CREATE DATABASE digilog_db;"
psql -U postgres -c "CREATE USER digilog WITH PASSWORD 'digilog123';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE digilog_db TO digilog;"

# Run Prisma migrations
cd apps/api
npx prisma migrate deploy
npx prisma generate

# Seed initial data (roles, super admin, default organization)
npx prisma db seed
```

### 5. TimescaleDB Setup
```bash
# Create TimescaleDB database (port 5433)
psql -U postgres -p 5433 -c "CREATE DATABASE digilog_tsdb;"
# Hypertables are auto-created by the ingestion service on first run
```

### 6. Run Development
```bash
npm run dev
# Backend: http://localhost:3000
# Frontend: http://localhost:5173
# Swagger: http://localhost:3000/docs
```

### 7. Build for Production
```bash
npm run build
pm2 start ecosystem.config.cjs
```

## Common Issues

| Issue | Fix |
|-------|-----|
| Prisma client not found | Run `npx prisma generate` in apps/api |
| MQTT connection refused | Ensure EMQX is running: `systemctl start emqx` |
| Redis connection refused | Ensure Redis is running: `systemctl start redis` |
| TimescaleDB INSERT error | Check column count matches - may need migration |
| Build fails (TS errors) | Run `npx tsc --noEmit` in apps/api to see errors |
| Frontend build fails | Run `npx tsc -b` in apps/web to see errors |


## Phase 2: Digital Filter Management System (2026-03-27)

### Overview
Complete digital filter cleaning lifecycle management for pharmaceutical cleanrooms. Supports configurable cleaning pipelines with checklist gates, 8 cleaning stages, dual filter sets, PM scheduling, and full traceability.

### Key Components
- **5 backend modules**: cleaning-profiles, filter-profiles, filter-operations, pm-schedules, checklist-profiles
- **12+ frontend pages**: operations, profiles, cycles, checklists, PM, AHU dashboard, traceability, config
- **9 database tables**: filter_cleaning_profiles, filter_pipeline_stages, filter_pipeline_connections, filter_profiles, cleaning_cycles, filter_events, pm_schedules, pm_schedule_entries, pm_executions
- **Quality audit**: 43 issues found and 35 fixed (security, compliance, logic, UI)

