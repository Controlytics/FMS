# Setup & Installation Guide

## Prerequisites
- Node.js 20+ with npm 11+
- PostgreSQL 18
- Redis 5+
- EMQX MQTT Broker 5.x
- Nginx (for production)
- PM2 (for production process management)

## Installation Steps

### 1. Clone Repository
```bash
git clone https://github.com/pankajexa/21cfrlogbook.git
cd 21cfrlogbook
git checkout DigitalFMS
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

Key environment variables:
```bash
NODE_ENV=development
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

### 4. Database Setup
```bash
# Create PostgreSQL database
psql -U postgres -c "CREATE DATABASE digilog_tsdb;"
psql -U postgres -c "CREATE USER digilog WITH PASSWORD 'digilog123';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE digilog_tsdb TO digilog;"

# Run Prisma migrations
cd apps/api
npx prisma migrate deploy
npx prisma generate

# Seed initial data (roles, super admin, default organization)
npx prisma db seed
```

### 5. TimescaleDB Setup
TimescaleDB hypertables are auto-created by the ingestion service on first run. Ensure the TimescaleDB extension is enabled in your PostgreSQL instance.

### 6. Build Shared Packages
```bash
npx nx build shared && npx nx build db && npx nx build queue
```

### 7. Run Development
```bash
# Backend (with hot reload via tsx)
cd apps/api
npx tsx watch src/app.ts

# Frontend (with hot reload via Vite) -- in a separate terminal
cd apps/web
npx vite

# Backend: http://localhost:3000
# Frontend: http://localhost:5173
# Swagger: http://localhost:3000/docs
```

### 8. Build for Production
```bash
# Compile TypeScript (MUST do before PM2 restart)
npx tsc -p apps/api/tsconfig.json

# Start with PM2
pm2 start ecosystem.config.cjs

# Build frontend
cd apps/web && npx vite build
# Output: apps/web/dist/ (served by Nginx)
```

## Windows Local Development

### Prerequisites
- Redis 5 (Windows build)
- EMQX MQTT Broker
- PostgreSQL 18
- Node.js 20+

### Quick Start
```bash
# Start all services and dev servers
start-digilog.bat

# Stop all services
stop-digilog.bat
```

### Manual Start on Windows
```bash
# Start Redis (if not running as service)
redis-server

# Start EMQX
emqx start

# Start API with hot reload
cd apps/api
npx tsx watch src/app.ts

# Start frontend with hot reload
cd apps/web
npx vite
```

## Android / Mobile Build
```bash
# Prerequisites: JDK21 + Android SDK at C:\Users\hello\
cd apps/android

# Sync web build to Capacitor
npx cap sync

# Open in Android Studio
npx cap open android

# Build APK
# Use Android Studio Build > Build Bundle / APK
```

**Note:** Android build uses HTTP (not HTTPS) for tablet deployment.

## Default Login
- **Username:** superadmin
- **Password:** Admin@123

## Common Issues

| Issue | Fix |
|-------|-----|
| Prisma client not found | Run `npx prisma generate` in apps/api |
| MQTT connection refused | Ensure EMQX is running: `emqx start` or `systemctl start emqx` |
| Redis connection refused | Ensure Redis is running: `redis-server` or `systemctl start redis` |
| Build fails (TS errors) | Run `npx tsc --noEmit` in apps/api to see errors |
| Frontend build fails | Run `npx tsc -b` in apps/web to see errors |
| Shared types out of date | Rebuild: `npx nx build shared` |
| Database connection error | Check DATABASE_URL points to `digilog_tsdb` not `digilog_db` |
| API compiles but crashes | Always curl endpoints after changes -- compile clean != works |
| PM2 runs old code | Must run `npx tsc` before `pm2 restart` -- PM2 runs compiled JS |

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
