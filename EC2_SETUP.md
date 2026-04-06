# DigiLog EC2 Hosting - Complete Step-by-Step Guide

---

## STEP 1: CREATE EC2 INSTANCE IN AWS

1. Login to AWS Console: https://console.aws.amazon.com
2. Go to **EC2** -> Click **Launch Instance**
3. Fill details:
   ```
   Name: digilog-server
   AMI: Ubuntu Server 24.04 LTS
   Instance type: t3.large (2 vCPU, 8 GB RAM)
   Key pair: Create new -> Download .pem file -> Save it safely
   Storage: 30 GB (gp3)
   ```
4. Click **Launch Instance**

---

## STEP 2: CREATE ELASTIC IP (PERMANENT IP)

1. Go to **EC2** -> **Elastic IPs** (left sidebar)
2. Click **Allocate Elastic IP address** -> **Allocate**
3. Select the new IP -> **Actions** -> **Associate Elastic IP address**
4. Choose your instance -> **Associate**
5. **Write down this IP address** - this is your permanent server IP

**Current instance:** 34.232.224.0

---

## STEP 3: CONFIGURE SECURITY GROUP (FIREWALL)

1. Go to **EC2** -> **Security Groups** (left sidebar)
2. Select your instance's security group
3. Click **Edit inbound rules**
4. Add these rules:

```
Type: SSH          Port: 22    Source: My IP
Type: HTTP         Port: 80    Source: Anywhere (0.0.0.0/0)
Type: HTTPS        Port: 443   Source: Anywhere (0.0.0.0/0)
Type: Custom TCP   Port: 1883  Source: Anywhere (MQTT)
Type: Custom TCP   Port: 18083 Source: My IP (EMQX Dashboard)
```

5. Click **Save rules**

---

## STEP 4: CONNECT TO EC2 VIA SSH

**Windows (PowerShell):**
```powershell
ssh -i "C:\Users\hello\Downloads\21cfrbook.pem" ubuntu@34.232.224.0
```

Type `yes` when asked about fingerprint.

---

## STEP 5: UPDATE UBUNTU SYSTEM

```bash
sudo apt update
sudo apt upgrade -y
```

---

## STEP 6: INSTALL NODE.JS 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Verify:**
```bash
node --version
npm --version
```

---

## STEP 7: INSTALL POSTGRESQL 18

```bash
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
sudo apt-get update
sudo apt-get install -y postgresql-18
```

---

## STEP 8: INSTALL TIMESCALEDB

```bash
echo "deb https://packagecloud.io/timescale/timescaledb/ubuntu/ $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/timescaledb.list
curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/timescaledb.gpg
sudo apt-get update
sudo apt-get install -y timescaledb-2-postgresql-18
sudo timescaledb-tune --quiet --yes
sudo systemctl restart postgresql
```

---

## STEP 9: INSTALL REDIS

```bash
sudo apt-get install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

---

## STEP 10: INSTALL EMQX

```bash
curl -s https://assets.emqx.com/scripts/install-emqx-deb.sh | sudo bash
sudo apt-get install -y emqx
sudo systemctl enable emqx
sudo systemctl start emqx
```

---

## STEP 11: INSTALL NGINX AND PM2

```bash
sudo apt-get install -y nginx
sudo systemctl enable nginx
sudo npm install -g pm2
```

---

## STEP 12: CLONE YOUR CODE FROM GITHUB

```bash
cd /home/ubuntu
git clone https://github.com/pankajexa/21cfrlogbook.git
cd 21cfrlogbook
git checkout DigitalFMS
```

---

## STEP 13: CREATE DATABASES

```bash
sudo -u postgres psql -c "CREATE USER digilog WITH PASSWORD 'digilog123';"
sudo -u postgres psql -c "CREATE DATABASE digilog_db OWNER digilog;"
sudo -u postgres psql -c "CREATE DATABASE digilog_tsdb OWNER digilog;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE digilog_db TO digilog;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE digilog_tsdb TO digilog;"
sudo -u postgres psql -d digilog_db -c "GRANT ALL ON SCHEMA public TO digilog;"
sudo -u postgres psql -d digilog_tsdb -c "GRANT ALL ON SCHEMA public TO digilog;"
sudo -u postgres psql -d digilog_tsdb -f init-tsdb.sql
```

---

## STEP 14: CREATE ENVIRONMENT FILE

```bash
cp .env.example .env
nano .env
```

Update the following values:
- `CORS_ORIGIN=http://YOUR_ELASTIC_IP`
- `ALLOWED_ORIGINS=http://YOUR_ELASTIC_IP`
- Generate JWT secrets: `node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"`

```bash
ln -sf $(pwd)/.env apps/api/.env
```

---

## STEP 15: INSTALL AND BUILD

```bash
npm install

cd apps/api
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
npx tsc
cd ../..

npm run build --workspace=apps/web

mkdir -p apps/api/uploads/binary apps/api/uploads/photos
```

---

## STEP 16: START API SERVER

```bash
cd apps/api
pm2 start dist/app.js --name digilog-api -i 1
pm2 save
```

**Setup auto-start on reboot:**
```bash
pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

**Copy the command it shows (starts with `sudo env PATH=...`) and run it.**

**Test API:**
```bash
curl http://localhost:3000/api/health
```

---

## STEP 17: CONFIGURE NGINX

```bash
sudo cp deploy/nginx-digilog.conf /etc/nginx/sites-available/digilog
sudo sed -i "s/YOUR_SERVER_IP/YOUR_ACTUAL_IP/g" /etc/nginx/sites-available/digilog
sudo ln -sf /etc/nginx/sites-available/digilog /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
```

---

## STEP 18: OPEN YOUR APPLICATION

Open browser and go to:
```
http://YOUR_ELASTIC_IP
```

**Login:**
```
Username: superadmin
Password: Admin@123
```

---

# DONE! YOUR APPLICATION IS NOW LIVE!

---

# HOW TO UPDATE CODE IN FUTURE

## On EC2 - Pull and deploy:
```bash
cd /home/ubuntu/21cfrlogbook
git pull origin DigitalFMS
npm install
cd apps/api
npx prisma generate
npx prisma migrate deploy
npx tsc
cd ../..
npm run build --workspace=apps/web
pm2 restart digilog-api
```

**Your database data is SAFE - it won't be deleted!**

---

# USEFUL COMMANDS

| What | Command |
|------|---------|
| Check API status | `pm2 status` |
| View API logs | `pm2 logs digilog-api` |
| Restart API | `pm2 restart digilog-api` |
| Check all services | `sudo systemctl status nginx postgresql redis-server emqx` |
| Restart nginx | `sudo systemctl restart nginx` |
| Check Prisma status | `cd apps/api && npx prisma migrate status` |
| Open Swagger | `http://YOUR_IP/docs` |
| Open EMQX Dashboard | `http://YOUR_IP:18083` (admin/public) |

---

# TROUBLESHOOTING

**API not working?**
```bash
pm2 logs digilog-api --lines 50
```

**Database not working?**
```bash
sudo systemctl status postgresql
sudo -u postgres psql -c "\l"
```

**Nginx not working?**
```bash
sudo nginx -t
sudo tail -f /var/log/nginx/error.log
```

**EMQX not working?**
```bash
sudo systemctl status emqx
```

**Permission error?**
```bash
sudo chown -R ubuntu:ubuntu /home/ubuntu/21cfrlogbook
```

---

> **Phase 2 Update (2026-03-27):** Digital Filter Management System added. Includes filter cleaning lifecycle management with 8 stages, visual pipeline editor, checklist gates, PM scheduling, equipment groups, and full 21 CFR Part 11 compliance.
> **Phase 3 Update (2026-04-02):** Bulk upload, filter retirement/replacement, mobile PWA, Android APK, unified light theme.
