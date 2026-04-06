# Email Integration

Configure SMTP or OAuth2 email delivery for notifications. One of 4 notification channels (Email, SMS, Telegram, Slack).

## SMTP Setup
Host, port, username, password, from address. Supports TLS/STARTTLS.
Note: Use family: 4 for IPv4-only SMTP servers (e.g., smtp.office365.com).

## OAuth2
Client ID, client secret, refresh token for Gmail/Outlook OAuth2 authentication.

## Templates
Customizable email templates with variable substitution.

## Configuration
Managed via the `notification-email` config definition. Access at Config > Notification Email.

## Phase 2 Usage
Email notifications can be triggered for filter operations:
- PM schedule reminders and overdue alerts
- Cleaning cycle completion notifications
- Bypass deviation alerts
- Filter retirement notices
