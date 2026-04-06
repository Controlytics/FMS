# SMS Integration

Multi-provider SMS delivery. One of 4 notification channels (Email, SMS, Telegram, Slack).

## Providers
- **AWS SNS** — Region, access key, secret key, sender ID
- **Twilio** — Account SID, auth token, from number
- **Vonage** — API key, API secret, from number

## Configuration
Managed via the `notification-sms` config definition. Access at Config > Notification SMS.

## Note
AWS SNS sandbox mode limits to verified numbers only. Exit sandbox for production.

## Additional Channels
- **Telegram** — Bot token and chat ID configuration via `notification-telegram` config
- **Slack** — Webhook URL configuration via `notification-slack` config
