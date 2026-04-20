# SMS Integration

Multi-provider SMS delivery for alarm and event notifications.

## Providers

### AWS SNS
- **Region** -- AWS region (e.g., us-east-1)
- **Access Key** -- IAM access key ID
- **Secret Key** -- IAM secret access key
- **Sender ID** -- SMS sender name/number

### Twilio
- **Account SID** -- Twilio account identifier
- **Auth Token** -- Twilio authentication token
- **From Number** -- Twilio phone number for outbound SMS

### Vonage
- **API Key** -- Vonage API key
- **API Secret** -- Vonage API secret
- **From Number** -- Vonage sender phone number

## Configuration
SMS provider settings are managed through **System Configuration > SMS** in the admin interface. Only one provider can be active at a time.

## Multi-Channel Notifications
SMS is one of four notification channels supported by DigiLog:
- **Email** -- SMTP/OAuth2
- **SMS** -- AWS SNS, Twilio, Vonage (this page)
- **Telegram** -- Bot API integration
- **Slack** -- Webhook integration

## Note
AWS SNS sandbox mode limits to verified numbers only. Exit sandbox for production use. For Twilio, trial accounts also have recipient restrictions until upgraded.

## Phase 2 Usage
SMS notifications can be triggered by filter management events including PM schedule reminders, overdue checklist alerts, and cleaning cycle completion notifications via notification rules configuration.
