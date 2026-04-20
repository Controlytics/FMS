# Email Integration

Configure SMTP or OAuth2 email delivery for notifications and alerts.

## SMTP Setup
- **Host** -- SMTP server hostname (e.g., smtp.office365.com)
- **Port** -- SMTP port (587 for STARTTLS, 465 for TLS)
- **Username** -- SMTP authentication username
- **Password** -- SMTP authentication password
- **From Address** -- Sender email address
- **TLS/STARTTLS** -- Transport encryption mode
- **Family** -- Use `family: 4` for IPv4-only SMTP servers (e.g., smtp.office365.com)

## OAuth2
- **Client ID** -- OAuth2 application client ID
- **Client Secret** -- OAuth2 application client secret
- **Refresh Token** -- OAuth2 refresh token for Gmail/Outlook authentication
- Supports Gmail and Microsoft Outlook OAuth2 flows

## Templates
Customizable email templates with variable substitution for:
- Alarm notifications (severity, entity, value, threshold)
- User management events (account created, password reset)
- System alerts (backup completion, health warnings)
- Filter operation events (Phase 2) -- cycle start, checklist due, PM reminders

## Multi-Channel Notifications
Email is one of four notification channels supported by DigiLog:
- **Email** -- SMTP/OAuth2 (this page)
- **SMS** -- AWS SNS, Twilio, Vonage
- **Telegram** -- Bot API integration
- **Slack** -- Webhook integration

Notification delivery is managed by the notification dispatcher, which routes events to configured channels based on notification rules.
