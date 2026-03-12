# SMS Integration Guide

> DigiLog SMS notification delivery via AWS SNS, with support for Twilio, Vonage, and HTTP Gateway.

---

## Overview

DigiLog sends SMS notifications for 14 event types through configurable notification rules. The primary SMS provider is **AWS SNS**, using the AWS CLI for message delivery. Alternative providers (Twilio, Vonage, HTTP Gateway) are also supported.

---

## Supported Providers

| Provider | Method | Config Fields |
|----------|--------|---------------|
| **AWS SNS** | AWS CLI (`aws sns publish`) | awsAccessKeyId, awsSecretAccessKey, awsRegion |
| **Twilio** | REST API | twilioAccountSid, twilioAuthToken, twilioFromNumber |
| **Vonage** | REST API | vonageApiKey, vonageApiSecret, vonageFromNumber |
| **HTTP Gateway** | Custom HTTP | httpGatewayUrl, httpGatewayMethod, httpGatewayHeaders, httpGatewayBodyTemplate |

---

## AWS SNS Setup

### Prerequisites
1. AWS account with SNS access
2. IAM user with `sns:Publish` permission
3. AWS CLI installed on the server (`aws --version`)

### Step 1: Create IAM Access Keys
1. Go to **AWS Console** > **IAM** > **Users**
2. Select or create a user
3. **Security credentials** > **Create access key**
4. Save the Access Key ID and Secret Access Key

### Step 2: Configure in DigiLog
- **UI**: Notifications > SMS Settings
- **API**: `PUT /api/notification-settings/sms`

| Field | Value |
|-------|-------|
| `provider` | `aws-sns` |
| `enabled` | `true` |
| `awsAccessKeyId` | Your access key |
| `awsSecretAccessKey` | Your secret key |
| `awsRegion` | `ap-south-1` (or your region) |
| `senderId` | `DigiLog` |
| `defaultCountryCode` | `91` (for India) |

### Step 3: Sandbox Mode

New AWS accounts have SNS in **sandbox mode** with these restrictions:
- All recipient phone numbers must be **verified with OTP** first
- Monthly spend limit: **$1 USD** (~25 SMS to India)

#### Verify a Phone Number
```bash
# Start verification (sends OTP to the phone)
aws sns create-sms-sandbox-phone-number --phone-number '+917288820570' --region ap-south-1

# Complete verification with received OTP
aws sns verify-sms-sandbox-phone-number --phone-number '+917288820570' --one-time-password '123456' --region ap-south-1

# List verified numbers
aws sns list-sms-sandbox-phone-numbers --region ap-south-1
```

#### Exit Sandbox (Production Access)
1. Go to **AWS Console** > **Amazon SNS** > **Text messaging (SMS)**
2. Click **"Exit SMS sandbox"** or **"Request production access"**
3. Fill in:
   - Use case: "Sending notification alerts from IoT monitoring platform"
   - Message type: Transactional
   - Monthly volume estimate
   - Target countries
4. Submit — approval typically within **24 hours**

#### Increase Spend Limit
1. Go to **AWS Console** > **Service Quotas** > **Amazon SNS**
2. Search for "SMS spending limit"
3. Request quota increase (e.g., $10 or $50)

### Check Spend Status
```bash
# Check if in sandbox
aws sns get-sms-sandbox-account-status --region ap-south-1

# Check monthly spend
aws cloudwatch get-metric-statistics \
  --namespace AWS/SNS \
  --metric-name SMSMonthToDateSpentUSD \
  --start-time 2026-03-01T00:00:00Z \
  --end-time 2026-03-31T23:59:59Z \
  --period 2592000 \
  --statistics Sum \
  --region ap-south-1

# Check if a number is opted out
aws sns check-if-phone-number-is-opted-out --phone-number '+917288820570' --region ap-south-1
```

---

## Phone Number Configuration

### Per-User Phone Numbers

Phone numbers are stored in `system_config` with key pattern `user-phone-{userId}`:

```sql
INSERT INTO system_config (config_key, config_value, config_type, requires_reauth, updated_at)
VALUES ('user-phone-USER_UUID_HERE', '{"phone":"+917288820570"}', 'user', false, NOW());
```

### Phone Number Format
- **E.164 format**: `+{countryCode}{number}` (e.g., `+917288820570`)
- Auto-normalization adds `defaultCountryCode` if `+` prefix is missing
- Validation regex: `/^\+[1-9]\d{6,14}$/`
- Indian mobile numbers: 10 digits after country code

---

## Templates

### Database Templates

Templates are stored in `notification_templates` with `channel = 'SMS'`.

| Template | Variables | Description |
|----------|-----------|-------------|
| **All Events SMS (Combined)** | `eventLabel`, `summary`, `smsDetails` | Universal SMS template |

### Template Variables

- `${eventLabel}` — Human-readable event name
- `${summary}` — Brief summary
- `${smsDetails}` — Plain-text list of event-specific fields

### SMS Details Example

For a USER_LOGIN event:
```
Username: superadmin
Full Name: Super Admin
Role: SUPER_ADMIN
IP Address: 103.120.51.223
Time: 2026-03-12T07:35:29.026Z
```

For an ALARM_CREATED event:
```
Alarm Type: High Temperature
Severity: CRITICAL
Entity: Reactor-01
UNS Path: site/area/line/reactor-01
Alarm ID: abc-123
Time: 2026-03-12T08:00:00.000Z
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/notification-settings/sms` | GET | Get SMS configuration |
| `/api/notification-settings/sms` | PUT | Update SMS configuration |
| `/api/notification-settings/sms/test` | POST | Send a test SMS |

### Test SMS

```bash
curl -X POST http://your-server/api/notification-settings/sms/test \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"recipient":"+917288820570"}'
```

---

## Technical Details

### Code Path
- **SMS Channel**: `apps/api/src/modules/notification-delivery/channels/sms-channel.ts`
- **Dispatcher**: `apps/api/src/modules/notification-delivery/notification-dispatcher.ts`

### AWS SNS Implementation
The SMS channel uses `child_process.execSync` to call the AWS CLI:

```typescript
const cmd = `AWS_ACCESS_KEY_ID='${key}' AWS_SECRET_ACCESS_KEY='${secret}' aws sns publish --region '${region}' --phone-number '${to}' --message '${message}'`;
execSync(cmd, { timeout: 15000 });
```

This approach:
- Uses per-request credentials (from DB config, not server-wide AWS config)
- Has a 15-second timeout
- Returns the SNS MessageId on success

### Retry Logic
- Failed SMS are retried up to **3 times** with exponential backoff
- Each attempt logged in `notification_logs` table
- Final status: `SENT` or `FAILED`

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| SMS not received, status SENT | AWS SNS spend limit exceeded | Check CloudWatch `SMSMonthToDateSpentUSD` metric |
| SMS not received (sandbox) | Recipient not verified | Verify number with `aws sns create-sms-sandbox-phone-number` |
| "AWS SNS credentials not configured" | Missing config | Check `awsAccessKeyId` and `awsSecretAccessKey` in SMS config |
| "SMS notifications are not enabled" | Config disabled | Set `enabled: true` in notification-sms config |
| Test button not working | SMS not enabled | Enable SMS in both system config AND notification rule |
| "Invalid phone number" | Wrong format | Use E.164 format: `+917288820570` |

### Check Delivery Logs

```sql
SELECT status, error_message, recipient, created_at
FROM notification_logs
WHERE channel = 'SMS'
ORDER BY created_at DESC
LIMIT 10;
```

### Check SMS Config

```sql
SELECT config_value FROM system_config WHERE config_key = 'notification-sms';
```

### Check User Phone Numbers

```sql
SELECT config_key, config_value FROM system_config WHERE config_key LIKE 'user-phone-%';
```
