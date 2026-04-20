# System Configuration

23 config modules with auto-discovery at startup via the config registry system.

## Categories

### Security
- **Password Policy** -- Min/max length, complexity, expiry, history count
- **Login Security** -- Max failed attempts, lockout type and duration
- **Session Management** -- Duration, idle timeout, warning threshold, absolute 24h timeout
- **Action Re-authentication** -- Per-role, per-action matrix (42+ configurable actions, 13 categories)

### Display
- **DateTime Format** -- Date/time format, timezone (Asia/Kolkata)
- **Branding** -- App name, logo text, primary/secondary colors
- **Pagination** -- 3 configurable page size options (default: 10, 25, 50)
- **Field IDs** -- 78+ customizable field labels across all modules
- **Alarm Columns** -- Role-based column visibility for alarm dashboard
- **Audit Templates** -- Customizable audit text templates with variable substitution (7 categories)

### Integrations
- **Email** -- SMTP or OAuth2 (Gmail/Outlook) with TLS/STARTTLS
- **SMS** -- AWS SNS, Twilio, or Vonage providers
- **Notification Rules** -- Configurable delivery rules per event type
- **UNS** -- Unified Namespace ISA-95 configuration
- **Telegram** -- Bot token and chat ID for Telegram notifications
- **Slack** -- Webhook URL for Slack channel notifications

### Advanced
- **Data Retention** -- Per-data-type retention policies with archive support
- **Backup & Restore** -- 4 formats (JSON, BAK, SQL, CSV)
- **System Health** -- Health check and diagnostic endpoints
- **Help Articles** -- 28 articles with version history
- **Debug Traces** -- Rule chain debug recording and inspection

## API
- `GET /api/config/registry/manifest` -- List all config modules and their metadata
- `GET /api/config/dynamic/:moduleKey` -- Get config for a specific module
- `PUT /api/config/dynamic/:moduleKey` -- Update config for a specific module

## Config Registry Architecture
The config registry uses auto-discovery at startup to scan all 23 config definitions, register their schemas, and expose them through a unified API. Each module declares its key, schema, defaults, and validation rules.

## Phase 2 Config Additions
The Digital Filter Management System adds configuration for:
- Filter cleaning reasons and justification requirements
- PM schedule tolerance windows
- Equipment group naming conventions
- Checklist profile defaults
