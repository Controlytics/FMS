# API Reference: Notifications

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/notifications | List notifications for current user |
| PUT | /api/notifications/:id/read | Mark notification as read |
| PUT | /api/notifications/read-all | Mark all as read |
| GET | /api/notification-rules | List notification rules |
| POST | /api/notification-rules | Create notification rule |
| PUT | /api/notification-rules/:id | Update notification rule |
| DELETE | /api/notification-rules/:id | Delete notification rule |

## Notification Channels (4)
| Channel | Config Key | Description |
|---------|-----------|-------------|
| Email | notification-email | SMTP/OAuth2 email delivery |
| SMS | notification-sms | AWS SNS, Twilio, or Vonage |
| Telegram | notification-telegram | Telegram bot integration |
| Slack | notification-slack | Slack webhook integration |

## Notification Dispatcher
Multi-channel dispatch via BullMQ "notification" queue. Rules define triggers (alarm created, checklist submitted, etc.) and target channels/recipients.

---

## Phase 3 Update (2026-04-07)

**RFID & Offline Operations:**
- RFID Scanner Android app (`rfid_scan_app/`) for KC-series UHF readers
- RFID keyboard guard prevents UKB tag input leaking into random fields
- Offline cleaning operations via IndexedDB queue + sync engine
- Cached identifier→filter map for offline RFID lookup
- "Data Synced" indicator in mobile header
- One identifier per entity (backend-enforced)
- Responsive layout with collapsible sidebar
- Error popups replace inline banners
- User creation auto-assigns org for admins
- `/api/roles/active` public endpoint for contact-admin page

See `CHANGELOG.md` for full details.
