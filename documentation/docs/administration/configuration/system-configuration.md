# System Configuration

23 config modules with auto-discovery at startup.

## Categories
- **Security:** Password Policy, Login Security, Session Management, Action Re-authentication
- **Display:** DateTime Format, Branding, Pagination, Field IDs, Alarm Columns, Audit Templates
- **Integrations:** Email (SMTP/OAuth2), SMS (AWS SNS/Twilio), Notification Rules, UNS
- **Advanced:** Data Retention, Backup & Restore, System Health, Help Articles, Debug Traces

## API
- GET /api/config/registry/manifest — list all modules
- GET /api/config/dynamic/:moduleKey — get config
- PUT /api/config/dynamic/:moduleKey — update config
