# DigiLog - Deployment Guide

## Exact Software Versions (Working Instance)

| Component      | Version                          | Install Method        |
|----------------|----------------------------------|-----------------------|
| **OS**         | Ubuntu 24.04.3 LTS (Noble)       | AWS AMI               |
| **Node.js**    | v20.20.0                         | NodeSource apt repo   |
| **npm**        | 10.8.2                           | Bundled with Node.js  |
| **PostgreSQL** | 16.13                            | PostgreSQL apt repo   |
| **TimescaleDB**| 2.25.1 (Community)               | TimescaleDB apt repo  |
| **Redis**      | 7.0.15                           | Ubuntu apt            |
| **Nginx**      | 1.24.0                           | Ubuntu apt            |
| **EMQX**       | 5.8.9                            | EMQX apt repo         |
| **PM2**        | 6.0.14                           | npm global            |
| **TypeScript** | 5.9.3                            | npm (project dev dep) |
| **Turborepo**  | 2.x                              | npm (project dev dep) |

## EC2 Instance Requirements

- **Type**: `t3.large` (2 vCPU, 8 GB RAM) minimum
- **Storage**: 30 GB EBS (gp3)
- **OS**: Ubuntu 24.04 LTS
- **Security Group Ports**:
  - `22` — SSH
  - `80` — HTTP (Nginx)
  - `443` — HTTPS (Nginx, self-signed)
  - `1883` — MQTT (EMQX)
  - `8883` — MQTT over TLS (EMQX)
  - `8083` — MQTT over WebSocket (EMQX)
  - `8084` — MQTT over Secure WebSocket (EMQX)
  - `18083` — EMQX Dashboard

## Quick Setup (Automated)

```bash
# 1. Clone the repo
git clone https://github.com/pankajexa/21cfrlogbook.git
cd 21cfrlogbook
git checkout DataIngestion

# 2. Run the setup script (installs everything)
sudo bash deploy/setup.sh

# 3. Done! App is running at http://YOUR_IP
```

The setup script automatically:
- Installs all system dependencies (Node.js, PostgreSQL, TimescaleDB, Redis, EMQX, Nginx, PM2)
- Creates databases and users
- Initializes TimescaleDB hypertables
- Creates `.env` from `.env.example` with auto-generated JWT secrets
- Runs `npm install`, Prisma migrations, seed, builds frontend and backend
- Configures Nginx with self-signed SSL
- Sets up PM2 with auto-start on boot

## Manual Setup (Step-by-Step)

### 1. Install System Dependencies

```bash
# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# PM2 (global)
sudo npm install -g pm2

# Nginx
sudo apt-get install -y nginx

# Redis
sudo apt-get install -y redis-server
sudo systemctl enable redis-server

# PostgreSQL 16
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
sudo apt-get update
sudo apt-get install -y postgresql-16

# TimescaleDB
echo "deb https://packagecloud.io/timescale/timescaledb/ubuntu/ $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/timescaledb.list
curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/timescaledb.gpg
sudo apt-get update
sudo apt-get install -y timescaledb-2-postgresql-16
sudo timescaledb-tune --quiet --yes
sudo systemctl restart postgresql

# EMQX 5.x
curl -s https://assets.emqx.com/scripts/install-emqx-deb.sh | sudo bash
sudo apt-get install -y emqx
sudo systemctl enable emqx
sudo systemctl start emqx
```

### 2. Database Setup

```bash
# Create PostgreSQL user and databases
sudo -u postgres psql -c "CREATE USER digilog WITH PASSWORD 'digilog123';"
sudo -u postgres psql -c "CREATE DATABASE digilog_db OWNER digilog;"
sudo -u postgres psql -c "CREATE DATABASE digilog_tsdb OWNER digilog;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE digilog_db TO digilog;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE digilog_tsdb TO digilog;"
sudo -u postgres psql -d digilog_db -c "GRANT ALL ON SCHEMA public TO digilog;"
sudo -u postgres psql -d digilog_tsdb -c "GRANT ALL ON SCHEMA public TO digilog;"

# Initialize TimescaleDB tables and hypertables
sudo -u postgres psql -d digilog_tsdb -f init-tsdb.sql
```

### 3. Application Setup

```bash
# Clone and checkout
git clone https://github.com/pankajexa/21cfrlogbook.git
cd 21cfrlogbook
git checkout DataIngestion

# Create .env
cp .env.example .env
# Edit .env — set YOUR_SERVER_IP and generate JWT secrets:
#   node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"

# Symlink .env to api
ln -sf $(pwd)/.env apps/api/.env

# Install dependencies
npm install

# Prisma: generate client, run migrations, seed
cd apps/api
npx prisma generate
npx prisma migrate deploy
npx prisma db seed

# Build backend
npx tsc

# Build frontend
cd ../..
npm run build --workspace=apps/web

# Create upload directories
mkdir -p apps/api/uploads/binary apps/api/uploads/photos
```

### 4. Nginx Configuration

```bash
# Generate self-signed SSL cert
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/selfsigned.key \
    -out /etc/nginx/ssl/selfsigned.crt \
    -subj "/CN=YOUR_SERVER_IP"
sudo chmod 600 /etc/nginx/ssl/selfsigned.key

# Copy and configure nginx
sudo cp deploy/nginx-digilog.conf /etc/nginx/sites-available/digilog
sudo sed -i "s/YOUR_SERVER_IP/YOUR_ACTUAL_IP/g" /etc/nginx/sites-available/digilog
sudo ln -sf /etc/nginx/sites-available/digilog /etc/nginx/sites-enabled/digilog
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 5. PM2 Setup

```bash
# Start the API
cd apps/api
pm2 start dist/app.js --name digilog-api -i 1
pm2 save

# Auto-start on boot
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

## Environment Variables (.env)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Prisma PostgreSQL connection string | `postgresql://digilog:digilog123@localhost:5432/digilog_db?schema=public` |
| `TSDB_HOST` | TimescaleDB host | `localhost` |
| `TSDB_PORT` | TimescaleDB port (same PG instance) | `5432` |
| `TSDB_DATABASE` | TimescaleDB database name | `digilog_tsdb` |
| `TSDB_USER` | TimescaleDB user | `digilog` |
| `TSDB_PASSWORD` | TimescaleDB password | `digilog123` |
| `MQTT_ENABLED` | Enable MQTT client | `true` |
| `MQTT_BROKER_HOST` | EMQX broker host | `localhost` |
| `MQTT_BROKER_PORT` | MQTT TCP port | `1883` |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `JWT_SECRET` | JWT signing secret (generate random) | Base64 string |
| `VERIFICATION_TOKEN_SECRET` | Token verification secret | Base64 string |
| `JWT_EXPIRES_IN` | JWT token lifetime | `8h` |
| `NODE_ENV` | Environment | `production` |
| `API_PORT` | API server port | `3000` |
| `CORS_ORIGIN` | Primary CORS origin | `http://YOUR_SERVER_IP` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | `http://YOUR_SERVER_IP` |
| `UPLOAD_DIR` | File upload directory | `./uploads` |

## Architecture

```
Browser --> Nginx (80/443)
              |
              ├── /api/*     --> Fastify (PM2, port 3000)
              ├── /ws        --> Fastify WebSocket
              ├── /uploads/* --> Fastify static files
              ├── /docs      --> Swagger UI
              ├── /emqx/*    --> EMQX Dashboard (18083)
              └── /*         --> SPA (apps/web/dist)

Fastify --> PostgreSQL 16 (digilog_db, Prisma ORM)
        --> TimescaleDB (digilog_tsdb, raw SQL via pg pool)
        --> Redis (BullMQ job queues, pub/sub)
        --> EMQX (MQTT broker, ports 1883/8883)
```

## Databases

### digilog_db (Prisma)
- All application models (users, roles, entities, templates, audit trail, etc.)
- Managed by Prisma migrations (`apps/api/prisma/migrations/`)
- 39 models, all using UUID primary keys

### digilog_tsdb (TimescaleDB)
- Time-series data: telemetry, attributes, device events, checklist responses, binary metadata, pipeline traces
- 6 hypertables with compression and continuous aggregates
- Initialized by `init-tsdb.sql` (not managed by Prisma)

## Post-Deployment Verification

```bash
# Check all services are running
sudo systemctl status nginx postgresql redis-server emqx
pm2 status

# Test API
curl http://localhost:3000/api/health

# Test login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123","force":true}'

# Check TSDB tables
sudo -u postgres psql -d digilog_tsdb -c "\dt"

# Check Prisma migration status
cd apps/api && npx prisma migrate status
```

## EMQX Auth Webhook Configuration

After EMQX is running, configure the HTTP auth webhook via the EMQX dashboard (`http://YOUR_IP:18083`, default admin/public):

1. Go to **Authentication** > **Create**
2. Select **HTTP Server**
3. Configure:
   - Method: `POST`
   - URL: `http://localhost:3000/api/internal/mqtt/auth`
   - Headers: `Content-Type: application/json`

## Updating the Application

```bash
cd /home/ubuntu/21cfrlogbook

# Pull latest code
git pull origin DataIngestion

# Install any new dependencies
npm install

# Run new migrations
cd apps/api
npx prisma generate
npx prisma migrate deploy

# Rebuild
npx tsc
cd ../..
npm run build --workspace=apps/web

# Restart API
pm2 restart digilog-api
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| API won't start | Check `.env` exists and has correct values. Check `pm2 logs digilog-api` |
| Database connection error | Verify PostgreSQL is running: `sudo systemctl status postgresql` |
| TSDB tables missing | Run `sudo -u postgres psql -d digilog_tsdb -f init-tsdb.sql` |
| Frontend blank page | Rebuild: `npm run build --workspace=apps/web` |
| Nginx 502 | Check API is running: `pm2 status`. Check port 3000: `ss -tlnp \| grep 3000` |
| MQTT not connecting | Check EMQX: `sudo systemctl status emqx`. Check port 1883 |
| Buttons/features not working | Usually missing `.env` vars or databases not initialized |
