#!/bin/bash
# ═══════════════════════════════════════════════════════════
# DigiLog - Full Server Setup Script
# Tested on: Ubuntu 24.04 LTS (t3.large recommended)
# Usage: sudo bash deploy/setup.sh
# ═══════════════════════════════════════════════════════════

set -euo pipefail

log()  { echo "[OK] $1"; }
warn() { echo "[!] $1"; }
err()  { echo "[X] $1"; exit 1; }

[[ $EUID -ne 0 ]] && err "Run with sudo: sudo bash deploy/setup.sh"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_USER="${SUDO_USER:-ubuntu}"

echo "======================================================="
echo " DigiLog Server Setup"
echo " Project: $PROJECT_DIR"
echo " User: $APP_USER"
echo "======================================================="

SERVER_IP=$(curl -s http://checkip.amazonaws.com 2>/dev/null || hostname -I | awk '{print $1}')
log "Detected server IP: $SERVER_IP"

# ═══════════════════════════════════════════════════════════
# 1. SYSTEM PACKAGES
# ═══════════════════════════════════════════════════════════
log "Updating system packages..."
apt-get update -qq
apt-get install -y -qq curl gnupg lsb-release build-essential git

# Node.js 20.x
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* ]]; then
    log "Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
else
    log "Node.js $(node -v) already installed"
fi

# PM2
if ! command -v pm2 &>/dev/null; then
    log "Installing PM2..."
    npm install -g pm2
else
    log "PM2 $(pm2 --version) already installed"
fi

# Nginx
if ! command -v nginx &>/dev/null; then
    log "Installing Nginx..."
    apt-get install -y -qq nginx
else
    log "Nginx already installed"
fi

# Redis
if ! command -v redis-server &>/dev/null; then
    log "Installing Redis..."
    apt-get install -y -qq redis-server
    systemctl enable redis-server
    systemctl start redis-server
else
    log "Redis already installed"
fi

# PostgreSQL 16
if ! command -v psql &>/dev/null; then
    log "Installing PostgreSQL 16..."
    sh -c "echo 'deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main' > /etc/apt/sources.list.d/pgdg.list"
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
    apt-get update -qq
    apt-get install -y -qq postgresql-16
else
    log "PostgreSQL already installed"
fi

# TimescaleDB
if ! dpkg -l | grep -q timescaledb; then
    log "Installing TimescaleDB..."
    echo "deb https://packagecloud.io/timescale/timescaledb/ubuntu/ $(lsb_release -cs) main" > /etc/apt/sources.list.d/timescaledb.list
    curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey | gpg --dearmor -o /etc/apt/trusted.gpg.d/timescaledb.gpg
    apt-get update -qq
    apt-get install -y -qq timescaledb-2-postgresql-16
    timescaledb-tune --quiet --yes
    systemctl restart postgresql
else
    log "TimescaleDB already installed"
fi

# EMQX 5.x
if ! command -v emqx &>/dev/null; then
    log "Installing EMQX 5.x..."
    curl -s https://assets.emqx.com/scripts/install-emqx-deb.sh | bash
    apt-get install -y -qq emqx
    systemctl enable emqx
    systemctl start emqx
else
    log "EMQX already installed"
fi

# ═══════════════════════════════════════════════════════════
# 2. DATABASE SETUP
# ═══════════════════════════════════════════════════════════
log "Setting up PostgreSQL databases..."

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='digilog'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER digilog WITH PASSWORD 'digilog123';"

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='digilog_db'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE digilog_db OWNER digilog;"

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='digilog_tsdb'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE digilog_tsdb OWNER digilog;"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE digilog_db TO digilog;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE digilog_tsdb TO digilog;"
sudo -u postgres psql -d digilog_db -c "GRANT ALL ON SCHEMA public TO digilog;"
sudo -u postgres psql -d digilog_tsdb -c "GRANT ALL ON SCHEMA public TO digilog;"

log "Initializing TimescaleDB tables..."
sudo -u postgres psql -d digilog_tsdb -f "$PROJECT_DIR/init-tsdb.sql" 2>/dev/null || warn "TSDB tables may already exist (OK)"

log "Database setup complete"

# ═══════════════════════════════════════════════════════════
# 3. APPLICATION SETUP
# ═══════════════════════════════════════════════════════════
log "Installing application dependencies..."
cd "$PROJECT_DIR"

if [ ! -f .env ]; then
    cp .env.example .env
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('base64'))")
    VERIFY_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('base64'))")
    sed -i "s|JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" .env
    sed -i "s|VERIFICATION_TOKEN_SECRET=.*|VERIFICATION_TOKEN_SECRET=$VERIFY_SECRET|" .env
    sed -i "s|YOUR_SERVER_IP|$SERVER_IP|g" .env
    log "Created .env with generated secrets"
else
    warn ".env already exists, skipping"
fi

ln -sf "$PROJECT_DIR/.env" "$PROJECT_DIR/apps/api/.env"

sudo -u "$APP_USER" bash -c "cd $PROJECT_DIR && npm install"

log "Running Prisma migrations..."
sudo -u "$APP_USER" bash -c "cd $PROJECT_DIR/apps/api && npx prisma generate && npx prisma migrate deploy"

log "Seeding database..."
sudo -u "$APP_USER" bash -c "cd $PROJECT_DIR/apps/api && npx prisma db seed" || warn "Seed may have already been applied"

log "Building backend..."
sudo -u "$APP_USER" bash -c "cd $PROJECT_DIR/apps/api && npx tsc"

log "Building frontend..."
sudo -u "$APP_USER" bash -c "cd $PROJECT_DIR && npm run build --workspace=apps/web"

mkdir -p "$PROJECT_DIR/apps/api/uploads/binary" "$PROJECT_DIR/apps/api/uploads/photos"
chown -R "$APP_USER":"$APP_USER" "$PROJECT_DIR/apps/api/uploads"

# ═══════════════════════════════════════════════════════════
# 4. NGINX SETUP
# ═══════════════════════════════════════════════════════════
log "Configuring Nginx..."

mkdir -p /etc/nginx/ssl
if [ ! -f /etc/nginx/ssl/selfsigned.crt ]; then
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout /etc/nginx/ssl/selfsigned.key \
        -out /etc/nginx/ssl/selfsigned.crt \
        -subj "/CN=$SERVER_IP" 2>/dev/null
    chmod 600 /etc/nginx/ssl/selfsigned.key
    log "Generated self-signed SSL certificate"
fi

cp "$PROJECT_DIR/deploy/nginx-digilog.conf" /etc/nginx/sites-available/digilog
sed -i "s/YOUR_SERVER_IP/$SERVER_IP/g" /etc/nginx/sites-available/digilog
ln -sf /etc/nginx/sites-available/digilog /etc/nginx/sites-enabled/digilog
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx
log "Nginx configured"

# ═══════════════════════════════════════════════════════════
# 5. PM2 SETUP
# ═══════════════════════════════════════════════════════════
log "Setting up PM2..."

sudo -u "$APP_USER" bash -c "cd $PROJECT_DIR/apps/api && pm2 start dist/app.js --name digilog-api -i 1"
sudo -u "$APP_USER" bash -c "pm2 save"

env PATH=$PATH:/usr/bin pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER"
log "PM2 configured with startup"

echo ""
echo "======================================================="
echo " DigiLog setup complete!"
echo "======================================================="
echo ""
echo " App URL:    http://$SERVER_IP"
echo " API Docs:   http://$SERVER_IP/docs"
echo " EMQX:       http://$SERVER_IP:18083"
echo ""
echo " Login:      superadmin / Admin@123"
echo ""
echo " Next steps:"
echo "   1. Update SMTP settings in .env for email notifications"
echo "   2. Configure EMQX auth webhook (see DEPLOYMENT.md)"
echo "   3. Open ports 80, 443, 1883, 8883, 18083 in Security Group"
echo ""
