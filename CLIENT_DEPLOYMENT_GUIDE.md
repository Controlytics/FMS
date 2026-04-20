# DigiLog — Application Flow & Deployment Guide

**Version:** 2.1 | **Last Updated:** 2026-04-20 | **Target:** Windows Server + IIS

---

## Table of Contents

1. [What is DigiLog](#1-what-is-digilog)
2. [System Architecture](#2-system-architecture)
3. [Application Flow](#3-application-flow)
4. [Deployment Requirements](#4-deployment-requirements)
5. [Deployment Process](#5-deployment-process)
6. [IIS Configuration](#6-iis-configuration)
7. [Post-Deployment Verification](#7-post-deployment-verification)
8. [Maintenance & Updates](#8-maintenance--updates)
9. [Security & Compliance](#9-security--compliance)
10. [Support](#10-support)

---

## 1. What is DigiLog

DigiLog is a **21 CFR Part 11 compliant digital logbook** for pharmaceutical facilities, covering:

- Digital Filter Management System (cleaning cycles, PM schedules)
- RFID-based asset tracking
- Electronic signatures + audit trails
- Real-time IoT telemetry (MQTT, HTTP ingestion)
- Multi-tenant user management
- Offline-capable mobile operations (Android APK)

**Platform:** Web application (browser) + Android app (tablets)
**Compliance:** 21 CFR Part 11, audit trails, electronic records, role-based access

---

## 2. System Architecture

### High-Level Diagram

```
              ┌─────────────────────────────────────────────────┐
              │            ON-PREMISE DEPLOYMENT                 │
              └─────────────────────────────────────────────────┘

  CLIENT DEVICES                              CLIENT'S NETWORK
  ═══════════════════                         ═════════════════════════════════

  ┌───────────────┐  HTTPS (443)     ┌─────────────────────────────────────┐
  │ Web Browser   │═════════════════▶│      WINDOWS SERVER                 │
  │ Chrome / Edge │                  │      (e.g., 192.168.1.100)          │
  └───────────────┘                  │                                     │
                                     │   ┌─────────────────────────────┐  │
  ┌───────────────┐                  │   │  IIS (:443 HTTPS)           │  │
  │ Android       │  HTTPS (443)     │   │  - SSL certificate          │  │
  │ Tablet (APK)  │═════════════════▶│   │  - URL Rewrite + ARR        │  │
  └───────────────┘                  │   │  - Serves React static files│  │
                                     │   │  - Reverse proxy to backend │  │
  ┌───────────────┐                  │   └────────────┬────────────────┘  │
  │ RFID Scanner  │                  │                │                    │
  │ (UKB USB)     │──plugs into──┐   │                ▼ localhost:3000     │
  └───────────────┘  tablet      │   │   ┌─────────────────────────────┐  │
                                 │   │   │  Fastify API (Node.js)      │  │
  ┌───────────────┐              │   │   │  - Managed by PM2 (Service) │  │
  │ IoT Devices   │  MQTT (1883) │   │   │  - Auto-restart on crash    │  │
  │ (sensors)     │══════════════┼══▶│   └──────┬───────────┬──────────┘  │
  └───────────────┘  LAN only    │   │          │           │              │
                                 │   │          ▼ localhost ▼ localhost    │
                                 │   │   ┌──────────┐  ┌──────────────┐   │
                                 │   │   │PostgreSQL│  │ EMQX MQTT    │   │
                                 └───┼──▶│  :5432   │  │ :1883        │   │
                                     │   │          │  │ (IoT broker) │   │
                                     │   │ - Main DB│  └──────────────┘   │
                                     │   │ - TSDB   │                     │
                                     │   │ - pg-boss│                     │
                                     │   └──────────┘                     │
                                     │                                     │
                                     └─────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Why |
|---|---|---|
| Web Server | **IIS** (Windows) | Built-in to Windows Server, reverse proxy |
| Frontend | **React + Vite** | Modern SPA, offline-capable PWA |
| Backend | **Fastify (Node.js 20 LTS)** | High-performance REST API |
| Process Manager | **PM2** | Auto-restart, Windows Service, zero-downtime |
| Database (main) | **PostgreSQL 18 + Prisma** | ACID compliance, reliable |
| Database (telemetry) | **TimescaleDB** | Time-series data |
| Job Queue | **pg-boss** | Uses PostgreSQL, no extra service needed |
| MQTT Broker | **EMQX** | IoT data ingestion |
| Mobile App | **Capacitor (Android)** | Shares React codebase |
| SSL | **Let's Encrypt / Commercial** | Free auto-renewing HTTPS |

---

## 3. Application Flow

### 3.1 User Request Flow

```
  USER ACTION                       BACKEND PROCESSING

  Operator opens URL
  https://digilog.pharma.local
              │
              ▼
  ┌──────────────────────────┐
  │  Browser reaches IIS :443 │
  │  Sends HTTPS request      │
  └──────────────┬───────────┘
                 │
                 ▼
        ┌────────────────┐
        │ Is it /api/*?  │
        └──┬──────────┬──┘
           YES        NO
           │           │
           ▼           ▼
   ┌───────────┐  ┌──────────────────┐
   │ IIS proxy │  │ IIS serves       │
   │ to        │  │ React index.html │
   │ localhost │  │ from disk        │
   │ :3000     │  │ (C:\DigiLog\web) │
   └─────┬─────┘  └────────┬─────────┘
         │                 │
         ▼                 ▼
   ┌───────────┐  Browser downloads React
   │ Fastify   │  Loads single-page app
   │ processes │  React Router handles routes
   │ request   │  All subsequent nav is client-side
   └─────┬─────┘
         │
         ▼
   ┌───────────────────┐
   │ Prisma queries    │
   │ PostgreSQL        │
   └─────┬─────────────┘
         │
         ▼
   Response: JSON data
   Flows back through IIS to browser
```

### 3.2 RFID Scan Flow (Mobile + Offline)

```
ON PHARMA FLOOR (may be offline)             BACK ONLINE

┌────────────────────────┐              ┌─────────────────────────┐
│ Operator scans RFID    │              │ WiFi reconnects          │
│ tag on tablet          │              └──────────┬──────────────┘
└────────────┬───────────┘                         │
             │                                     ▼
             ▼                          ┌─────────────────────────┐
┌────────────────────────┐              │ Auto-sync triggers      │
│ App detects tag ID     │              │ (online event + retry)  │
│ E280-1160-6000-0204... │              └──────────┬──────────────┘
└────────────┬───────────┘                         │
             │                                     ▼
             ▼                          ┌─────────────────────────┐
┌────────────────────────┐              │ IndexedDB queue replays │
│ Check offline cache    │              │ all operations FIFO     │
│ identifier-map lookup  │              └──────────┬──────────────┘
└────────────┬───────────┘                         │
             │                                     ▼
             ▼                          ┌─────────────────────────┐
┌────────────────────────┐              │ Server records actions  │
│ Find filter: FILTER-07 │              │ at ORIGINAL offline     │
└────────────┬───────────┘              │ timestamps              │
             │                          └──────────┬──────────────┘
             ▼                                     │
┌────────────────────────┐                         ▼
│ Operator starts cycle  │              ┌─────────────────────────┐
│ Advances stages        │              │ 21CFR audit trail       │
│ Submits checklists     │              │ preserves true action   │
└────────────┬───────────┘              │ times (not sync times)  │
             │                          └─────────────────────────┘
             ▼
┌────────────────────────┐
│ Actions queued in      │
│ IndexedDB with         │
│ offlinePerformedAt     │
└────────────────────────┘
```

### 3.3 Data Flow (End-to-End)

```
   Operator ────▶ Tablet ────▶ HTTPS ────▶ IIS ────▶ Fastify ────▶ PostgreSQL
                                                         │
                                                         ├───▶ TimescaleDB (telemetry)
                                                         │
                                                         ├───▶ pg-boss (async jobs)
                                                         │
                                                         └───▶ EMQX (MQTT publish)
```

---

## 4. Deployment Requirements

### 4.1 Server Hardware

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 4 cores | 8 cores |
| RAM | 8 GB | 16 GB |
| Disk | 500 GB SSD | 1 TB SSD |
| Network | 100 Mbps | 1 Gbps |

### 4.2 Software Stack (to install on server)

```
□ Windows Server 2019 or 2022
□ Node.js v20 LTS (https://nodejs.org/)
□ PostgreSQL 18 + TimescaleDB extension
□ EMQX MQTT Broker (https://www.emqx.io/)
□ IIS (Windows feature)
□ IIS URL Rewrite module (Microsoft download)
□ IIS Application Request Routing (ARR)
□ PM2 (via npm: npm install -g pm2 pm2-windows-service)
□ win-acme for Let's Encrypt SSL (optional, https://www.win-acme.com/)
```

### 4.3 Network Requirements

```
INBOUND FIREWALL RULES:
  ✅ Port 443 (HTTPS)          — OPEN to LAN/Internet
  ✅ Port 80  (HTTP redirect)  — OPEN
  ✅ Port 1883 (MQTT)           — OPEN to LAN only (for IoT devices)

INTERNAL ONLY (BLOCK from external):
  ❌ Port 3000 (Fastify)        — localhost only
  ❌ Port 5432 (PostgreSQL)     — localhost only
  ❌ Port 8883 (MQTT over TLS)  — if used, LAN only
```

### 4.4 Domain & SSL

```
□ Domain name for the server (e.g., digilog.pharma.com)
□ DNS A record pointing to server's IP
□ Valid SSL certificate
  Option 1: Let's Encrypt (free, via win-acme, auto-renews)
  Option 2: Commercial SSL (paid, 1-2 year validity)
  Option 3: Internal CA (for LAN-only deployment)
```

---

## 5. Deployment Process

### Phase 1: Server Preparation

```powershell
# 1.1 Enable IIS on Windows Server
Install-WindowsFeature -Name Web-Server -IncludeManagementTools

# 1.2 Install Node.js v20 LTS
# Download from https://nodejs.org/ and run installer

# 1.3 Verify installation
node --version   # should show v20.x.x
npm --version

# 1.4 Install PostgreSQL 18
# Download from https://www.postgresql.org/download/windows/
# Run installer, set postgres password, enable port 5432

# 1.5 Install TimescaleDB extension
# Download from https://docs.timescale.com/install/latest/self-hosted/installation-windows/

# 1.6 Install EMQX
# Download from https://www.emqx.io/downloads
# Run as Windows Service

# 1.7 Install IIS URL Rewrite + ARR modules
# URL Rewrite: https://www.iis.net/downloads/microsoft/url-rewrite
# ARR:         https://www.iis.net/downloads/microsoft/application-request-routing

# 1.8 Install PM2
npm install -g pm2 pm2-windows-service
```

### Phase 2: Database Setup

```sql
-- Connect to PostgreSQL as superuser
-- Create databases and user

CREATE USER digilog WITH PASSWORD 'STRONG_PASSWORD_HERE';
CREATE DATABASE digilog_db OWNER digilog;
CREATE DATABASE digilog_tsdb OWNER digilog;

-- Enable TimescaleDB on telemetry database
\c digilog_tsdb
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

### Phase 3: Application Deployment

```powershell
# 3.1 Create application directory
New-Item -Path "C:\DigiLog" -ItemType Directory -Force

# 3.2 Copy delivered files
#     You will receive a ZIP from the development team containing:
#     - apps/api/        (backend compiled code)
#     - apps/web/dist/   (frontend static files)
#     - packages/        (shared packages)
#     - ecosystem.config.cjs
#     - package.json
#
#     Extract to C:\DigiLog\

# 3.3 Install production dependencies
cd C:\DigiLog
npm ci --production

# 3.4 Create .env file at C:\DigiLog\apps\api\.env
#     (Copy from .env.example and fill in real values)
```

### Phase 4: Environment Configuration

Create `C:\DigiLog\apps\api\.env`:

```env
NODE_ENV=production
PORT=3000
API_HTTPS=false

# Primary database (Prisma)
DATABASE_URL=postgresql://digilog:STRONG_PASSWORD_HERE@localhost:5432/digilog_db?schema=public

# TimescaleDB (telemetry)
TSDB_HOST=localhost
TSDB_PORT=5432
TSDB_DATABASE=digilog_tsdb
TSDB_USER=digilog
TSDB_PASSWORD=STRONG_PASSWORD_HERE
TSDB_POOL_MAX=20

# MQTT
MQTT_URL=mqtt://localhost:1883
MQTT_USERNAME=digilog
MQTT_PASSWORD=STRONG_MQTT_PASSWORD

# Security
JWT_SECRET=GENERATE_32_CHAR_RANDOM_STRING
SESSION_SECRET=GENERATE_ANOTHER_32_CHAR_STRING

# Optional: SMTP for email notifications
SMTP_HOST=smtp.client-domain.com
SMTP_PORT=587
SMTP_USER=digilog@client-domain.com
SMTP_PASSWORD=SMTP_PASSWORD
```

### Phase 5: Database Migrations

```powershell
cd C:\DigiLog\apps\api

# Run migrations to create all 57 tables
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate
```

### Phase 6: Start Backend with PM2

```powershell
cd C:\DigiLog

# Start backend
pm2 start ecosystem.config.cjs

# Verify it's running
pm2 status

# Save current process list for auto-restart
pm2 save

# Install PM2 as Windows Service (auto-starts on boot)
pm2-windows-service install

# Verify service is running
Get-Service PM2
```

---

## 6. IIS Configuration

### 6.1 Enable ARR Proxy Globally

```
1. Open IIS Manager
2. Click server name (root node)
3. Double-click "Application Request Routing Cache"
4. Click "Server Proxy Settings" (right panel)
5. Check "Enable proxy"
6. Click Apply
```

### 6.2 Create IIS Website

```
1. IIS Manager → Sites → Right-click → Add Website
2. Site name: DigiLog
3. Physical path: C:\DigiLog\apps\web\dist
4. Binding:
   - Type: https
   - Port: 443
   - Hostname: digilog.pharma.com (your domain)
   - SSL certificate: select your installed certificate
5. Click OK
```

### 6.3 Deploy web.config

Create `C:\DigiLog\apps\web\dist\web.config`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>

        <!-- Force HTTPS -->
        <rule name="Force HTTPS" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTPS}" pattern="off" />
          </conditions>
          <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" />
        </rule>

        <!-- API requests → Fastify -->
        <rule name="API Proxy" stopProcessing="true">
          <match url="^api/(.*)" />
          <action type="Rewrite" url="http://localhost:3000/api/{R:1}" />
        </rule>

        <!-- WebSocket for real-time -->
        <rule name="WebSocket Proxy" stopProcessing="true">
          <match url="^ws/(.*)" />
          <action type="Rewrite" url="http://localhost:3000/ws/{R:1}" />
        </rule>

        <!-- Swagger docs -->
        <rule name="Swagger" stopProcessing="true">
          <match url="^docs/(.*)" />
          <action type="Rewrite" url="http://localhost:3000/docs/{R:1}" />
        </rule>

        <!-- React SPA fallback -->
        <rule name="React Routes" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>

      </rules>
    </rewrite>

    <staticContent>
      <clientCache cacheControlMode="UseMaxAge" cacheControlMaxAge="30.00:00:00" />
    </staticContent>

  </system.webServer>
</configuration>
```

### 6.4 Configure SSL Certificate

**Option A: Let's Encrypt (Free, Recommended)**
```powershell
# Install win-acme
# Download from https://www.win-acme.com/

# Run wacs.exe, select:
# - Create renewal (simple for IIS site)
# - Pick DigiLog site
# - Accept defaults
# Cert auto-renews every 60 days
```

**Option B: Commercial SSL**
```
1. Buy cert from DigiCert, Sectigo, etc.
2. Import .pfx in IIS Manager → Server Certificates
3. Bind to DigiLog site → Bindings → HTTPS → SSL cert
```

---

## 7. Post-Deployment Verification

### 7.1 Smoke Tests

```
□ Navigate to https://digilog.pharma.com
  → React app loads
  → SSL certificate valid

□ Login with superadmin / Admin@123
  → Should work, then change password

□ Create a test organization
  → Check data persists in PostgreSQL

□ Create a test filter, start cleaning cycle
  → Verify workflow works end-to-end

□ RFID scan from tablet
  → Assign tag to filter
  → Scan again → looks up correctly

□ Swagger documentation accessible
  → https://digilog.pharma.com/docs

□ MQTT device publishes → appears in dashboard
```

### 7.2 Performance Checks

```
□ Open DevTools (F12) → Network tab
  → First load < 3 seconds
  → API calls < 200ms

□ PM2 status
  → pm2 status shows "online"
  → pm2 logs digilog-api (no errors)

□ PostgreSQL
  → pgAdmin connects successfully
  → All 57 tables visible in digilog_db
  → Hypertables visible in digilog_tsdb
```

### 7.3 Security Checks

```
□ Port scan from external IP
  → Only 443 and 80 should be open
  → 3000, 5432, 1883 should be blocked

□ SSL test
  → https://www.ssllabs.com/ssltest/ → should score A or A+

□ Change ALL default passwords
  □ superadmin (DigiLog user)
  □ postgres (PostgreSQL)
  □ EMQX admin
```

---

## 8. Maintenance & Updates

### 8.1 Updating DigiLog

```powershell
# You'll receive updated ZIP from development team

# 1. Backup current install
Copy-Item -Recurse C:\DigiLog C:\DigiLog-backup-$(Get-Date -Format yyyyMMdd)

# 2. Stop backend
pm2 stop digilog-api

# 3. Extract new files over old (keep .env!)
# Backup .env first
Copy-Item C:\DigiLog\apps\api\.env C:\temp\digilog.env

# Extract new zip to C:\DigiLog
# Restore .env
Copy-Item C:\temp\digilog.env C:\DigiLog\apps\api\.env

# 4. Install new dependencies
cd C:\DigiLog
npm ci --production

# 5. Run new migrations (if any)
cd apps\api
npx prisma migrate deploy

# 6. Restart backend
cd C:\DigiLog
pm2 restart digilog-api

# 7. Verify
pm2 logs digilog-api --lines 50
```

### 8.2 Backups

**Database backup (run daily via Task Scheduler):**

```powershell
$date = Get-Date -Format "yyyyMMdd_HHmmss"
$backupPath = "D:\Backups\digilog_db_$date.sql"

& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" `
  -U digilog `
  -h localhost `
  -d digilog_db `
  -F c `
  -f $backupPath

# Delete backups older than 30 days
Get-ChildItem D:\Backups\*.sql | Where-Object {$_.LastWriteTime -lt (Get-Date).AddDays(-30)} | Remove-Item
```

### 8.3 Log Rotation

```powershell
# PM2 auto-rotates logs via pm2-logrotate module
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 30
```

---

## 9. Security & Compliance

### 21 CFR Part 11 Compliance

| Requirement | Implementation |
|---|---|
| Electronic Signatures | Built-in signature capture + validation |
| Audit Trail | SHA-256 chained audit records, immutable |
| Access Control | Role-based (95 permissions, 82 features) |
| Data Integrity | PostgreSQL ACID + audit-logged writes |
| User Authentication | Password policy, complexity, history |
| Session Management | JWT tokens, configurable timeout |
| Time Stamping | All records have server-side timestamps |
| Validation | IQ/OQ/PQ docs delivered separately |

### Client Responsibilities

```
□ Validation documents (IQ/OQ/PQ) signed by QA
□ User training and SOPs
□ Change control procedures
□ Periodic access reviews
□ Backup verification (restore tests)
□ Disaster recovery plan
```

### Security Checklist

```
□ ALL default passwords changed
□ .env file has restrictive permissions (Admin-only read)
□ PostgreSQL allows only local connections (pg_hba.conf)
□ Firewall blocks 3000, 5432 from external access
□ SSL certificate auto-renewal verified
□ PM2 logs monitored for suspicious activity
□ Regular Windows security updates applied
□ Antivirus exclusions for DigiLog directory (performance)
```

---

## 10. Support

### Common Issues

| Problem | Solution |
|---|---|
| "502 Bad Gateway" | Fastify not running — check `pm2 status` |
| Login fails | Check PostgreSQL running, .env has correct DATABASE_URL |
| SSL warning | Certificate expired — renew via win-acme or commercial |
| Slow performance | Check server resources, PM2 memory, SSD free space |
| RFID scan doesn't work | Check tablet WiFi, offline cache populated |
| MQTT devices disconnect | Check EMQX service, firewall for port 1883 |

### Log Locations

```
PM2 logs:         C:\DigiLog\logs\digilog-api-*.log
IIS logs:         C:\inetpub\logs\LogFiles\
PostgreSQL logs:  C:\Program Files\PostgreSQL\18\data\log\
EMQX logs:        <EMQX install>\log\
Windows events:   Event Viewer → Applications
```

### Contact

```
Development Team:   [YOUR_EMAIL]
Support Hours:      [YOUR_HOURS]
Emergency Contact:  [YOUR_PHONE]
Issue Tracker:      [YOUR_URL]
```

---

## Appendix A: File Structure After Deployment

```
C:\DigiLog\
├── ecosystem.config.cjs          ← PM2 config
├── package.json
├── package-lock.json
├── node_modules\                 ← Shared deps
├── logs\                         ← PM2 logs
├── apps\
│   ├── api\                      ← Backend
│   │   ├── dist\                 ← Compiled JS
│   │   ├── prisma\
│   │   │   ├── schema.prisma
│   │   │   └── migrations\
│   │   ├── node_modules\
│   │   └── .env                  ← Production config
│   └── web\
│       └── dist\                 ← Frontend static files
│           ├── index.html
│           ├── web.config        ← IIS rules
│           ├── assets\
│           └── sw.js
└── packages\
    ├── shared\
    ├── db\
    └── queue\
```

---

## Appendix B: Quick Reference Commands

```powershell
# Check backend status
pm2 status

# View backend logs (last 100 lines)
pm2 logs digilog-api --lines 100

# Restart backend
pm2 restart digilog-api

# Stop backend
pm2 stop digilog-api

# Check IIS site
Get-Website DigiLog

# Test database connection
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U digilog -d digilog_db -c "SELECT COUNT(*) FROM \"User\";"

# Check services
Get-Service postgresql-x64-18
Get-Service emqx
Get-Service PM2

# Tail IIS access logs
Get-Content "C:\inetpub\logs\LogFiles\W3SVC1\u_ex*.log" -Tail 50 -Wait
```

---

**Document Version:** 2.1
**Tested on:** Windows Server 2022, Node.js 20 LTS, PostgreSQL 18
