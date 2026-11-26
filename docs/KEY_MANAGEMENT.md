# Key Management — rotation, re-entry, and custody (S-009)

- **Date:** 2026-11-26 (Phase 4 Stage 5 Batch B)
- **Enforcement:** `enforceRuntimeConfig` (`apps/api/src/http-hardening.ts`)
  fails production boot when any required key below is missing or
  ill-formed. Non-production behaviour is unchanged: dev/test auto-generate
  keys into `.runtime/*` (mode 0600, git-ignored).

## The keys

| Key | Format (enforced in prod) | Used by | What it protects |
|---|---|---|---|
| `IDENTIFIER_SECRET` | ≥ 32 chars | `identifiers.ts` | HMAC key for mobile / NID / birth-registration sign-in identifier digests |
| `CITIZEN_DATA_KEY` | 64 hex chars | `citizen-data.ts` | AES-256-GCM key for stored NID / birth-registration numbers (+ duplicate-check digest) |
| `MFA_ENCRYPTION_KEY` | 64 hex chars | `mfa-crypto.ts` | AES-256-GCM key for TOTP seeds in `account_mfa` |
| `MERCHANT_SECRET_KEY` | 64 hex chars | `sslcommerz.ts` | AES-256-GCM key for sealed gateway merchant secrets; also derives the bKash token-cache key |
| `DEMO_WEBHOOK_SECRET` | ≥ 32 chars | `app.ts` | HMAC key for demo webhook signatures (A-021) |
| `ATTACHMENT_SCANNER_SECRET` | 64 hex chars | `attachments.ts` | Bearer secret for the internal scanner API (fixture scanner / real worker) |

`ATTACHMENT_SCANNER_SECRET` is deliberately **not** required by
`enforceRuntimeConfig`: the internal scanner API already fails closed
(401) without a valid 64-hex secret, so its absence cannot silently
weaken anything. It is listed here because its custody matters exactly
as much as the others.

## Rotation — the honest picture

There is **no in-place rotation** for any of these keys. Each key is the
sole decryption / matching key for the data it protects, and rotating it
breaks every stored value at once:

- `IDENTIFIER_SECRET` — every stored identifier digest becomes
  unmatchable. Citizens can no longer sign in by mobile / NID / birth
  registration until they re-verify and the digest is re-created.
- `CITIZEN_DATA_KEY` — every stored NID / birth-registration number
  becomes undecryptable (and its duplicate-check digest unmatchable).
- `MFA_ENCRYPTION_KEY` — every enrolled TOTP seed becomes undecryptable;
  every MFA user must re-enroll (recovery codes are hashed with the same
  key material path — treat them as lost too).
- `MERCHANT_SECRET_KEY` — every sealed merchant secret becomes
  unopenable; each office must re-enter its gateway credentials, and the
  bKash token cache must be discarded.
- `DEMO_WEBHOOK_SECRET` — previously registered webhook signatures stop
  verifying until consumers re-register with the new secret.
- `ATTACHMENT_SCANNER_SECRET` — the worker and the API must be updated
  together; a mismatch 401s every scan claim/finish until both sides agree.

Rotation is therefore a **planned re-entry exercise, not a key swap**.
The procedure for any key:

1. Owner decision + maintenance window. Announce which feature degrades
   (see the table above) and for how long.
2. Generate the new key off-host (`openssl rand -hex 32` for the 64-hex
   keys; `openssl rand -hex 32` or longer for the ≥32-char secrets) and
   store it under the custody rules below **before** touching the server.
3. Set the new value in the production environment (never in the repo,
   never in `.runtime/*`).
4. Re-enter the affected data:
   - Identifiers: citizens re-verify mobile / NID / birth registration
     (OTP for mobile; authenticated re-entry for NID / birth reg).
   - Citizen numbers: re-enter from the source documents (there is no
     recovery path for ciphertext whose key is gone — this is why the
     custody rules below exist).
   - MFA: every user re-enrolls; issue fresh recovery codes.
   - Merchant secrets: each office re-enters gateway credentials.
   - Webhook: re-register signatures with every consumer.
   - Scanner: update the worker config to the same secret, then the API.
5. Verify each feature end-to-end (sign-in by mobile, NID print, MFA
   login, gateway checkout, webhook delivery, attachment scan) before
   closing the window.
6. Destroy the old key material everywhere it was stored (including the
   superseded custody copy, after the verification in step 5).

## Custody (independent of the database)

- Keys live **only** in the production environment (or the secret store
  that feeds it). Never in the repo, never in `.runtime/*` on a deployed
  host, never in a database backup, never in a chat/email thread.
- Keep **one sealed copy offsite, separate from database backups**, held
  by the system owner (or split between owner and a second custodian —
  split knowledge: no single person holds every key). A key stored next
  to the database it decrypts is not a backup, it is a second copy of
  the same risk.
- Record **which** keys exist and **where the sealed copy lives** in the
  owner's runbook; never record the values themselves there.
- The `.runtime/*` auto-generated files are dev/test conveniences only.
  On any host that ever held production data, treat a `.runtime/*` file
  as compromised if it was ever copied, backed up, or shipped — rotate
  the affected key (procedure above) instead of assuming it is safe.
- Loss of a key without a sealed copy is **data loss**, not an outage:
  identifiers, citizen numbers, MFA seeds, or merchant secrets protected
  by it cannot be recovered by any means. That is the reason for the
  offsite copy, and the reason production boot now fails fast instead of
  starting degraded (S-009).
