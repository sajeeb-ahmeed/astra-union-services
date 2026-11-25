# Deployment checklist — notification providers (W-010)

Go-live gate for outbound notifications. Until every item below passes,
the deployment must NOT be presented as sending email or SMS: the code
is honest about it (see "What happens when unconfigured"), but citizens
cannot complete mobile signup and applicants receive no status messages.

## Required configuration

Set these as deployment secrets (never in source, chat, screenshots, or
public logs). The server reads them only from the environment at boot;
there is no admin UI for provider credentials.

| Channel | Setting | Value |
| --- | --- | --- |
| Email | `EMAIL_PROVIDER` | `smtp` |
| Email | `SMTP_HOST`, `SMTP_FROM` (or `SMTP_USER`) | Owner's SMTP host and sender address |
| Email | `SMTP_PORT` (default 587), `SMTP_SECURE` | As the SMTP service requires (465 implies secure) |
| Email | `SMTP_USER`, `SMTP_PASS` | Only when the SMTP service requires auth |
| SMS + mobile OTP | `OTP_PROVIDER` | `http` (one setting drives both OTP codes and status SMS) |
| SMS + mobile OTP | `SMS_HTTP_URL`, `SMS_HTTP_API_KEY` | The SMS gateway endpoint and key |
| SMS + mobile OTP | `SMS_HTTP_SENDER_ID` (optional), `SMS_HTTP_FORMAT` (`json` for JSON gateways) | As the gateway requires |

Do NOT set `EMAIL_PROVIDER=log` or `OTP_PROVIDER=log` in production:
the log provider records messages in the server log (and, outside
production, in `.runtime/email-outbox.log` / `.runtime/sms-outbox.log`)
and sends nothing to any mailbox or handset. The server warns at boot
when a log provider is live in production (see `apps/api/src/server.ts`).

## Verification (before go-live)

1. `GET /api/v1/health` — `features.emailDelivery` must be `true`.
   (Public; reports booleans only.)
2. Sign in as the System Owner and open Platform management → Overview →
   **Notification providers**, or call `GET /api/v1/owner/notification-health`
   (owner only). It must report:
   - email `provider: "smtp"`, `available: true`, `logOnly: false`;
   - sms `provider: "http"`, `available: true`, `logOnly: false`;
   - otp `provider: "http"`, `available: true`, `logOnly: false`;
   - `readyForLive: true` and an empty `warnings` list.
3. `GET /api/v1/auth/otp/status` — `available` must be `true`.
4. Send a real test: request a mobile OTP for a test number and confirm
   the code arrives; trigger a status notification (e.g. reject a test
   application) and confirm the email/SMS arrive.
5. Confirm the delivery records: `GET
   /api/v1/applications/:id/notification-deliveries` for the test
   application must show `sent` for both channels — never `logged`
   (recorded locally, reached nobody), `unavailable`, or `failed`.

## What happens when unconfigured (verified behaviour)

- Mobile OTP signup: `POST /auth/otp/signup` fails `503
  OTP_UNAVAILABLE` — "Mobile verification is not enabled on this
  server." The citizen is told, not left waiting for a code.
- Email verification: the status endpoint reports `available: false`
  and the send fails honestly; no verification email is pretended.
- Status notifications (issuance, rejection, correction, revocation):
  the chairman's decision still completes — delivery can never roll it
  back — but each channel leaves a row in `notification_deliveries`
  with status `unavailable` (no provider), `logged` (log provider),
  `failed` (provider call threw), or `no_contact` (no usable
  address/mobile on file). The in-app feed remains the record of the
  event itself. A `logged` row is NOT a delivery: it means the message
  was written to a local log and reached no handset or mailbox.
- The public health endpoint reports `emailDelivery: false` when email
  is unconfigured.

## Delivery statuses (notification_deliveries)

| Status | Meaning |
| --- | --- |
| `sent` | The real provider accepted the message. |
| `logged` | The log provider recorded it locally; it reached nobody. |
| `failed` | The provider call threw (see the server log). |
| `unavailable` | No provider was configured for that channel. |
| `no_contact` | The citizen has no usable email/mobile for that channel. |

Rows are append-only (immutable trigger) and tenant-scoped (FORCE RLS).
They record kind, channel, status and time only — never message
contents, which can carry certificate numbers and live sign-in links.

## External dependencies (not code)

- An approved SMTP account (owner's) and an approved SMS gateway
  account with `SMS_HTTP_URL`/`SMS_HTTP_API_KEY`. Provider approval,
  sender-ID registration and any per-message cost are the owner's
  responsibility; no sandbox credential is stored in this repo.
- Real-provider acceptance (step 4 above) must be repeated after any
  credential rotation: the health endpoint reports configuration, not
  live deliverability.
