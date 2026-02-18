# DigiLog (21CFR) — Credentials & Database Details

## EC2 Instance
- **Public IP:** 43.205.32.23
- **App URL:** http://43.205.32.23 (port 80 via nginx)
- **Swagger UI:** http://43.205.32.23/docs
- **OS User:** ubuntu

## PostgreSQL Database
| Field        | Value            |
|--------------|------------------|
| Host         | localhost        |
| Port         | 5432             |
| Database     | digilog_db       |
| Username     | digilog_user     |
| Password     | digilog_secret   |
| Connection   | `postgresql://digilog_user:digilog_secret@localhost:5432/digilog_db?schema=public` |

Container name: `digilog_postgres` (Docker)

## Application Users

| Username | Full Name            | Email               | Role        | Password     | Status  |
|----------|----------------------|---------------------|-------------|--------------|---------|
| admin    | System Administrator | admin@digilog.local | SUPER_ADMIN | Welocome@123 | ENABLED |

## API Configuration
| Field           | Value                                                          |
|-----------------|----------------------------------------------------------------|
| API Port        | 3000                                                           |
| API Host        | 0.0.0.0                                                        |
| PM2 Process     | digilog-api                                                    |
| JWT Secret      | K7xPq2mN9vRtYw3zF5hJ8sLdG4cB6nM1aE0iU2oWqXrTyZpAkDfHjClVbNm |
| JWT Expiry      | 8h                                                             |
| CORS Origin     | http://43.205.32.23                                            |
| Upload Dir      | /home/ubuntu/21cfrlogbook/uploads                              |
| Max File Size   | 5MB (5242880 bytes)                                            |

## Services
| Service       | Manager  | Port | Command                        |
|---------------|----------|------|--------------------------------|
| API (Fastify) | PM2      | 3000 | `pm2 restart digilog-api`      |
| Web (React)   | nginx    | 80   | `sudo systemctl restart nginx` |
| PostgreSQL    | Docker   | 5432 | `docker compose up -d`         |
| Swagger UI    | Fastify  | 3000 | Available at `/docs`           |

PM2 ecosystem config: `/home/ubuntu/ecosystem.config.cjs`
nginx config: `/etc/nginx/sites-available/digilog`

## Useful Commands
```bash
pm2 status                  # Check API status
pm2 logs digilog-api        # View API logs
pm2 restart digilog-api     # Restart API
sudo systemctl restart nginx # Restart nginx
docker compose up -d        # Start PostgreSQL
docker compose down         # Stop PostgreSQL
```
