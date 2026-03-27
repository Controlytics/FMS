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


---

> **Phase 2 Update (2026-03-27):** Digital Filter Management System added to DigiLog. Includes filter cleaning lifecycle management with 8 stages, visual pipeline editor, checklist gates, PM scheduling, and full 21 CFR Part 11 compliance. See CHANGELOG.md and README.md for details.
