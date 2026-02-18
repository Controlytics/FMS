# DigiLog EC2 Hosting - Complete Step-by-Step Guide

---

## STEP 1: CREATE EC2 INSTANCE IN AWS

1. Login to AWS Console: https://console.aws.amazon.com
2. Go to **EC2** → Click **Launch Instance**
3. Fill details:
   ```
   Name: digilog-server
   AMI: Ubuntu Server 22.04 LTS
   Instance type: t2.medium (or t2.micro for free tier)
   Key pair: Create new → Download .pem file → Save it safely
   Storage: 20 GB
   ```
4. Click **Launch Instance**

---

## STEP 2: CREATE ELASTIC IP (PERMANENT IP)

1. Go to **EC2** → **Elastic IPs** (left sidebar)
2. Click **Allocate Elastic IP address** → **Allocate**
3. Select the new IP → **Actions** → **Associate Elastic IP address**
4. Choose your instance → **Associate**
5. **Write down this IP address** - this is your permanent server IP

---

## STEP 3: CONFIGURE SECURITY GROUP (FIREWALL)

1. Go to **EC2** → **Security Groups** (left sidebar)
2. Select your instance's security group
3. Click **Edit inbound rules**
4. Add these rules:

```
Type: SSH          Port: 22    Source: My IP
Type: HTTP         Port: 80    Source: Anywhere (0.0.0.0/0)
Type: HTTPS        Port: 443   Source: Anywhere (0.0.0.0/0)
```

5. Click **Save rules**

---

## STEP 4: CONNECT TO EC2 VIA SSH

**Windows (PowerShell):**
```powershell
ssh -i "C:\path\to\your-key.pem" ubuntu@YOUR_ELASTIC_IP
```

**Example:**
```powershell
ssh -i "C:\Users\User\Downloads\digilog-key.pem" ubuntu@13.234.56.78
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

## STEP 7: INSTALL DOCKER

```bash
sudo apt-get install -y docker.io docker-compose-plugin
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker ubuntu
```

**IMPORTANT - Logout and login again:**
```bash
exit
```

**SSH back in:**
```powershell
ssh -i "C:\path\to\your-key.pem" ubuntu@YOUR_ELASTIC_IP
```

**Verify docker works:**
```bash
docker ps
```

---

## STEP 8: INSTALL NGINX

```bash
sudo apt-get install -y nginx
sudo systemctl enable nginx
```

---

## STEP 9: INSTALL PM2

```bash
sudo npm install -g pm2
```

---

## STEP 10: INSTALL GIT

```bash
sudo apt-get install -y git
```

---

## STEP 11: CLONE YOUR CODE FROM GITHUB

```bash
cd /home/ubuntu
git clone -b feature/user-id-config https://github.com/caiCommon/21cfrlogbook.git ec2complete
cd ec2complete
```

---

## STEP 12: CREATE DIRECTORIES

```bash
mkdir -p /home/ubuntu/logs
mkdir -p /home/ubuntu/ec2complete/uploads
```

---

## STEP 13: CREATE ENVIRONMENT FILE

```bash
nano .env
```

**Copy and paste this (CHANGE THE VALUES MARKED WITH <<<):**

```
DATABASE_URL="postgresql://digilog_user:DigiLog2024Secure@localhost:5432/digilog_db?schema=public"
JWT_SECRET="MySecretKey123456789012345678901234567890123456789012345678901234"
JWT_EXPIRES_IN="8h"
NODE_ENV="production"
API_PORT=3000
API_HOST="0.0.0.0"
CORS_ORIGIN="http://YOUR_ELASTIC_IP_HERE"
UPLOAD_DIR="/home/ubuntu/ec2complete/uploads"
MAX_FILE_SIZE="5242880"
```

**<<< CHANGE:**
- `YOUR_ELASTIC_IP_HERE` → Your actual Elastic IP (e.g., `http://13.234.56.78`)

**Save file:** Press `Ctrl+X`, then `Y`, then `Enter`

---

## STEP 14: CREATE DOCKER COMPOSE FILE FOR DATABASE

```bash
nano docker-compose.prod.yml
```

**Copy and paste:**

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16
    container_name: digilog_postgres
    restart: always
    environment:
      POSTGRES_USER: digilog_user
      POSTGRES_PASSWORD: DigiLog2024Secure
      POSTGRES_DB: digilog_db
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"

volumes:
  postgres_data:
    driver: local
```

**Save file:** Press `Ctrl+X`, then `Y`, then `Enter`

---

## STEP 15: CREATE DATABASE INIT FILE

```bash
nano init-db.sql
```

**Copy and paste:**

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "ltree";
```

**Save file:** Press `Ctrl+X`, then `Y`, then `Enter`

---

## STEP 16: START DATABASE

```bash
docker compose -f docker-compose.prod.yml up -d
```

**Wait 15 seconds:**
```bash
sleep 15
```

**Verify database is running:**
```bash
docker ps
```

You should see `digilog_postgres` running.

---

## STEP 17: INSTALL NPM DEPENDENCIES

```bash
npm install
```

This takes 2-3 minutes.

---

## STEP 18: SETUP DATABASE TABLES

```bash
cd apps/api
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
cd ../..
```

---

## STEP 19: BUILD APPLICATION

```bash
npm run build
```

This takes 1-2 minutes.

---

## STEP 20: CREATE PM2 CONFIG FILE

```bash
nano ecosystem.config.cjs
```

**Copy and paste:**

```javascript
module.exports = {
  apps: [
    {
      name: 'digilog-api',
      cwd: './apps/api',
      script: 'dist/app.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: '/home/ubuntu/logs/api-error.log',
      out_file: '/home/ubuntu/logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
```

**Save file:** Press `Ctrl+X`, then `Y`, then `Enter`

---

## STEP 21: START API SERVER

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

**Setup auto-start on reboot:**
```bash
pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

**Copy the command it shows (starts with `sudo env PATH=...`) and run it.**

**Verify API is running:**
```bash
pm2 status
```

Should show `digilog-api` with status `online`.

**Test API:**
```bash
curl http://localhost:3000/api/health
```

---

## STEP 22: CONFIGURE NGINX

```bash
sudo nano /etc/nginx/sites-available/digilog
```

**Copy and paste (CHANGE YOUR_ELASTIC_IP):**

```nginx
server {
    listen 80;
    server_name YOUR_ELASTIC_IP;

    root /home/ubuntu/ec2complete/apps/web/dist;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    location /uploads {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    client_max_body_size 10M;
}
```

**<<< CHANGE:** `YOUR_ELASTIC_IP` → Your actual IP (e.g., `13.234.56.78`)

**Save file:** Press `Ctrl+X`, then `Y`, then `Enter`

---

## STEP 23: ENABLE NGINX SITE

```bash
sudo ln -sf /etc/nginx/sites-available/digilog /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

---

## STEP 24: OPEN YOUR APPLICATION

Open browser and go to:
```
http://YOUR_ELASTIC_IP
```

**Login:**
```
Username: admin
Password: Admin@123
```

---

# DONE! YOUR APPLICATION IS NOW LIVE!

---

---

# HOW TO UPDATE CODE IN FUTURE

## On your Windows PC - Push changes to GitHub:
```powershell
cd "C:\Users\User\OneDrive - CONTROLYTICS AI PRIVATE LIMITED\SIVA_M_WORK\21cfrlogbook"
git add .
git commit -m "your changes"
git push origin feature/user-id-config
```

## On EC2 - Pull and deploy:
```bash
cd /home/ubuntu/ec2complete
git pull origin feature/user-id-config
npm install
cd apps/api
npx prisma generate
npx prisma migrate deploy
cd ../..
npm run build
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
| Check database | `docker ps` |
| Restart database | `docker restart digilog_postgres` |
| Restart nginx | `sudo systemctl restart nginx` |

---

# TROUBLESHOOTING

**API not working?**
```bash
pm2 logs digilog-api --lines 50
```

**Database not working?**
```bash
docker logs digilog_postgres
```

**Nginx not working?**
```bash
sudo nginx -t
sudo tail -f /var/log/nginx/error.log
```

**Permission error?**
```bash
sudo chown -R ubuntu:ubuntu /home/ubuntu/ec2complete
```
