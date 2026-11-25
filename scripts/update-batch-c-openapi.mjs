// Batch C (A-001): document the API operations that the OpenAPI spec was
// missing, from the implementation itself.
//
// Source of truth for each entry: the handler in apps/api/src (see the
// `source` field per operation, recorded as `x-source`). Auth, roles, rate
// limits, request-body fields, query parameters, response statuses and error
// codes were extracted from the handler code — see the A-001 fragment for the
// extraction method and the before/after coverage numbers.
//
// Usage:
//   node scripts/update-batch-c-openapi.mjs            # regenerate entries in place
//   node scripts/update-batch-c-openapi.mjs --check    # fail if the spec differs
//
// The script is idempotent: re-running it rewrites the same entries. It never
// removes operations it did not write (hand-written entries stay untouched),
// except that it marks the two internal-only scanner operations
// (POST /api/v1/internal/attachment-scans/claim|finish) with
// x-visibility "internal-only" — classification metadata, not a contract change.
//
// Coverage is enforced separately by scripts/check-openapi-coverage.mjs, which
// enumerates the live Express route table and fails CI when a supported route
// lacks a spec entry or a documented route is stale.
import fs from "node:fs";

const SPEC = "apps/api/openapi.json";

// --- generated route table (method, path, summary, auth, schemas) -----------
const ROUTES = [
  {
    "method": "get",
    "path": "/api/v1/admin/release",
    "summary": "Read detailed release metadata",
    "description": "Admin-only detailed release metadata for operators: the public release subset (version, packaged commit, build time, package id, process start, applied migration version) plus the full applied-migration list and the packaged web-asset manifest, so an operator can prove which bundle is running and whether the database matches it. No secrets, credentials, or environment values are ever included.",
    "tag": "Admin",
    "visibility": "authenticated",
    "source": "app.ts:928",
    "roles": ["admin"],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": ["403:ROLE_DENIED"],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },

  {
    "method": "delete",
    "path": "/api/v1/account/identifiers/{kind}",
    "summary": "Remove one of the caller's own sign-in identifiers",
    "description": "Deletes a mobile or email identifier the caller previously added. Requires the current password (accountActionLimiter, 10/min per user). A verified identifier that is the account's last sign-in method cannot be removed.",
    "tag": "Identifiers",
    "visibility": "authenticated",
    "source": "identifier-routes.ts:140",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [
      "accountActionLimiter"
    ],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "422:PASSWORD_MISMATCH"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "currentPassword",
        "optional": false,
        "nullable": false,
        "type": "ref:passwordInput",
        "raw": "passwordInput"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "delete",
    "path": "/api/v1/citizens/{id}/photo",
    "summary": "Remove a citizen's profile photo",
    "description": "Deletes the optional photo stored on the citizen record (migration 051). Staff, admin, or the citizen themself within their own office scope.",
    "tag": "Citizens",
    "visibility": "authenticated",
    "source": "app.ts:1139",
    "roles": [
      "staff",
      "admin",
      "citizen"
    ],
    "officeActor": false,
    "usesTenant": true,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/account/identifiers",
    "summary": "List the caller's sign-in identifiers",
    "description": "Returns the mobile/email identifiers attached to the caller's own account, with verification state. Any authenticated user; only their own identifiers are ever returned.",
    "tag": "Identifiers",
    "visibility": "authenticated",
    "source": "identifier-routes.ts:36",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/admin/account-types",
    "summary": "List office posts with the role each grants",
    "description": "Office admin view of the account types (posts) this office may assign, with the staff role each one grants. Admin only.",
    "tag": "Admin",
    "visibility": "authenticated",
    "source": "management.ts:1013",
    "roles": [
      "admin"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/admin/coupons",
    "summary": "List the office's coupons",
    "description": "Office admin/finance view of the coupon codes created for this office, with their terms and state.",
    "tag": "Coupons",
    "visibility": "authenticated",
    "source": "orders.ts:524",
    "roles": [
      "admin",
      "finance"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/admin/payment-merchants/bkash",
    "summary": "Read the office bKash merchant configuration",
    "description": "Returns the office's bKash merchant settings (environment, merchant account, enabled state). Secrets are never returned — only whether credentials are configured. Admin or finance.",
    "tag": "Payments",
    "visibility": "authenticated",
    "source": "gateways.ts:164",
    "roles": [
      "admin",
      "finance"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "403:ROLE_DENIED"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/admin/payment-merchants/sslcommerz",
    "summary": "Read the office SSLCommerz merchant configuration",
    "description": "Returns the office's SSLCommerz merchant settings (environment, store id, enabled state). Secrets are never returned — only whether credentials are configured. Admin or finance.",
    "tag": "Payments",
    "visibility": "authenticated",
    "source": "gateways.ts:106",
    "roles": [
      "admin",
      "finance"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "403:ROLE_DENIED"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/applications/counts",
    "summary": "Application counts by state for the caller's office",
    "description": "Returns the number of applications in each workflow state within the caller's tenant. Any authenticated tenant member.",
    "tag": "Applications",
    "visibility": "authenticated",
    "source": "app.ts:1402",
    "roles": [],
    "officeActor": false,
    "usesTenant": true,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/applications/{id}/refunds",
    "summary": "List refund requests for one application",
    "description": "Refund requests filed against the verified payment of one application, newest first. Citizen (own application), staff, admin, finance, reviewer, or approver within the office.",
    "tag": "Refunds",
    "visibility": "authenticated",
    "source": "refunds.ts:108",
    "roles": [
      "citizen",
      "staff",
      "admin",
      "finance",
      "reviewer",
      "approver"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/auth/email/status",
    "summary": "Check whether the caller's email is verified",
    "description": "Public probe of the email-verification state for the current session. Used by the client to decide whether to prompt for verification.",
    "tag": "Auth",
    "visibility": "public",
    "source": "email-verification.ts:63",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/auth/mfa",
    "summary": "Read the caller's authenticator (MFA) state",
    "description": "Returns whether the caller has authenticator protection enabled and whether recovery codes remain. Any authenticated user; own state only.",
    "tag": "MFA & Security",
    "visibility": "authenticated",
    "source": "mfa.ts:364",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/auth/otp/status",
    "summary": "Check the mobile-OTP verification state",
    "description": "Public probe of whether the caller's mobile number is verified for OTP sign-in.",
    "tag": "OTP",
    "visibility": "public",
    "source": "otp.ts:87",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/auth/security-events",
    "summary": "List the caller's recent account security events",
    "description": "Recent security-audit events for the caller's own account (sign-ins, MFA changes, recovery use). Any authenticated user; own events only.",
    "tag": "MFA & Security",
    "visibility": "authenticated",
    "source": "mfa.ts:384",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/billing/orders/{orderId}/gateway",
    "summary": "Read one billing order's gateway payment state",
    "description": "Gateway intents, attempts, and confirmations for one platform billing order (subscription or top-up). Admin or finance of the owning office.",
    "tag": "Billing & Orders",
    "visibility": "authenticated",
    "source": "order-payments.ts:621",
    "roles": [
      "admin",
      "finance"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:ORDER_NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/billing/orders/{orderId}/gateway-refunds",
    "summary": "List gateway refunds for one billing order",
    "description": "Gateway refund records (requested, sent, confirmed, failed) for one platform billing order. Admin or finance of the owning office.",
    "tag": "Billing & Orders",
    "visibility": "authenticated",
    "source": "order-payments.ts:933",
    "roles": [
      "admin",
      "finance"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/branding",
    "summary": "Read the platform branding",
    "description": "Public platform name and taglines (Bangla + English) with defaults applied. No authentication required.",
    "tag": "Public",
    "visibility": "public",
    "source": "billing.ts:538",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/support-contact",
    "summary": "Read the platform support contact",
    "description": "F-001: public support phone, email and office hours (Bangla + English) with empty defaults applied — an empty field is not published. No authentication required.",
    "tag": "Public",
    "visibility": "public",
    "source": "support-contact.ts:86",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/citizens/{id}/identity",
    "summary": "Read a citizen's identity numbers (audited)",
    "description": "Returns the citizen's stored identity numbers (NID / birth registration) in full. Citizen only, and only for their own record; every read is written to the audit log. See apps/api/src/models.ts.",
    "tag": "Citizens",
    "visibility": "authenticated",
    "source": "app.ts:1172",
    "roles": [
      "citizen"
    ],
    "officeActor": false,
    "usesTenant": true,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/citizens/{id}/photo/image",
    "summary": "Download a citizen's profile photo",
    "description": "Returns the stored citizen photo bytes (PNG or JPEG) for printing on certificates. Citizen only, own record.",
    "tag": "Citizens",
    "visibility": "authenticated",
    "source": "app.ts:1158",
    "roles": [
      "citizen"
    ],
    "officeActor": false,
    "usesTenant": true,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/global-notices",
    "summary": "List live platform notices",
    "description": "Public list of platform notices currently live (published and inside their window). No authentication required.",
    "tag": "Notices",
    "visibility": "public",
    "source": "notices.ts:233",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/office/certificate-assets",
    "summary": "Read the office's certificate assets overview",
    "description": "Overview of the office's uploaded certificate assets (seal, signatures) with their approval state. Any authenticated office staff member.",
    "tag": "Certificates",
    "visibility": "authenticated",
    "source": "certificate-assets.ts:178",
    "roles": [],
    "officeActor": true,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/office/certificate-assets/preview",
    "summary": "Render a sample certificate with the office's assets",
    "description": "Renders a sample certificate PDF using the office's current assets and clearly sample citizen data. Nothing is stored and no certificate is issued; the render follows the deployment's issuance mode exactly as a real issuance would, so what the chairman sees is what would print. Query serviceNo (1-47, default 12).",
    "tag": "Certificates",
    "visibility": "authenticated",
    "source": "certificate-assets.ts:292",
    "roles": [],
    "officeActor": true,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND"
    ],
    "queryParams": [
      "serviceNo"
    ],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/notification-health",
    "summary": "Notification provider health for the owner",
    "description": "W-010: read-only provider health for status notifications — per channel (email, SMS, OTP) the configured provider name, availability, and whether it is the log provider, plus readyForLive and bilingual warnings. Reports only provider names and booleans, never hosts, credentials, or message contents. A log provider records messages locally and sends nothing, so readyForLive is false while any channel is log-only or unconfigured. Owner only.",
    "tag": "Admin",
    "visibility": "authenticated",
    "source": "app.ts",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/applications/{id}/notification-deliveries",
    "summary": "Delivery outcomes for one application's status notifications",
    "description": "W-010: one row per attempted notification channel (email/sms) with an honest status — sent, logged (recorded locally, reached no handset/mailbox), failed, unavailable (no provider configured), or no_contact. Office staff and the owning citizen can read it; message contents are never exposed.",
    "tag": "Applications",
    "visibility": "authenticated",
    "source": "app.ts",
    "roles": [
      "staff",
      "admin",
      "reviewer",
      "approver",
      "citizen",
      "finance"
    ],
    "officeActor": false,
    "usesTenant": true,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/office/certificate-assets/{kind}/image",
    "summary": "Download one office certificate asset image",
    "description": "Returns the stored image bytes (PNG or JPEG) for one certificate asset kind (seal or signature). Any authenticated office staff member.",
    "tag": "Certificates",
    "visibility": "authenticated",
    "source": "certificate-assets.ts:270",
    "roles": [],
    "officeActor": true,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/office/name",
    "summary": "Read the office's display name",
    "description": "The office name as printed on certificates. Readable by admin and approver (chairman); the name-only edit exists so the chairman can fix it from his own profile.",
    "tag": "Admin",
    "visibility": "authenticated",
    "source": "management.ts:411",
    "roles": [
      "admin",
      "approver"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/account-requests",
    "summary": "List office account requests awaiting the owner",
    "description": "Office account (staff registration) requests filtered by status (PENDING, APPROVED, REJECTED; default PENDING), newest first. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "office-registration.ts:123",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [
      "status"
    ],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/billing-settings",
    "summary": "Read the platform billing settings",
    "description": "The platform billing settings — who pays the application fee (office or citizen). Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "billing.ts:262",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/fee-preview",
    "summary": "Preview the fee outcome of a submit for a service",
    "description": "W-006: the fee a first submit of this service would settle — platform fee method (subscription allowance, office-wallet credit, or free), credits, allowance used/remaining, office wallet balance, and whether the submit would be blocked (insufficient credit, or citizen-pays with no payment rail) — computed read-only so the citizen / responsible office sees the financial outcome before submitting. Advisory: balances move, and the submit stays authoritative. Citizen (own office), staff, admin, approver, finance.",
    "tag": "Billing & Orders",
    "visibility": "authenticated",
    "source": "billing.ts",
    "roles": [
      "citizen",
      "staff",
      "admin",
      "approver",
      "finance"
    ],
    "officeActor": false,
    "usesTenant": true,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [
      "serviceNo"
    ],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/branding",
    "summary": "Read the platform branding with defaults",
    "description": "The current platform branding (stored values with defaults applied). Platform owner only; the public read is GET /api/v1/branding.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "billing.ts:546",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/coupon-redemptions",
    "summary": "List coupon redemptions across offices",
    "description": "Recent coupon redemptions across all offices — the audit/revenue view of coupon use. Optional limit query parameter. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "coupons.ts:332",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [
      "limit"
    ],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/coupons",
    "summary": "List every platform coupon with redemption totals",
    "description": "Every platform coupon with its redemption totals. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "coupons.ts:223",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/coupons/{code}/changes",
    "summary": "Audit history of one coupon",
    "description": "The change history (create, update, active switches) of one platform coupon, newest first. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "coupons.ts:306",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/credit-prices",
    "summary": "List the current credit price of every service",
    "description": "The current published credit price of every service (default 1 credit where unpublished). Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "billing.ts:180",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/credit-prices/{no}/versions",
    "summary": "Price history of one service (credits)",
    "description": "The full published credit-price history of one service, newest first. Versions are never edited; each records who set it, when, and why. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "billing.ts:238",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/notices",
    "summary": "List every platform notice with derived status",
    "description": "Every platform notice with its derived status (live, scheduled, expired, unpublished). Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "notices.ts:127",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/notices/{id}/changes",
    "summary": "Audit history of one notice",
    "description": "The change history of one platform notice, newest first. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "notices.ts:205",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/office-inclusion-requests",
    "summary": "List office inclusion requests",
    "description": "Requests from offices asking to join the platform, optionally filtered by status (NEW, CONTACTED, ACCEPTED, DECLINED); without a filter, NEW and CONTACTED are returned. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "office-inclusion.ts:86",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "403:ROLE_DENIED"
    ],
    "queryParams": [
      "status"
    ],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/operations",
    "summary": "Platform operations summary and alerts",
    "description": "Owner operations summary (counts across tenants, subscription/credit health) plus derived alerts. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "operations.ts:32",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "403:ROLE_DENIED"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/statistics",
    "summary": "Global platform statistics",
    "description": "W-012: global citizens / applications / certificates totals, applications by current state, and a per-office breakdown (counts only, no personal data). Optional UTC date range (from/to, YYYY-MM-DD) and single-office scope (tenantId). Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "owner-statistics.ts",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "403:ROLE_DENIED",
      "404:NOT_FOUND"
    ],
    "queryParams": [
      "from",
      "to",
      "tenantId"
    ],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/statistics/export",
    "summary": "Export global platform statistics",
    "description": "W-012: the same aggregates as GET /owner/statistics as CSV (one row per office plus a TOTAL row) or JSON. Same range and office scope. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "owner-statistics.ts",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "403:ROLE_DENIED",
      "404:NOT_FOUND"
    ],
    "queryParams": [
      "from",
      "to",
      "tenantId",
      "format"
    ],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/platform-health",
    "summary": "Platform health indicators",
    "description": "W-020: read-only health indicators for the System Owner — database latency and migration status, scanner heartbeat and queue, SMS/email/OTP/payment provider status, backup and maintenance state (reported as absent where no mechanism exists), and system alerts. No configuration is changed. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "platform-health.ts",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "403:ROLE_DENIED"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/payment-orders",
    "summary": "List platform payment orders",
    "description": "Platform billing orders across offices, optionally filtered by status. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "app.ts:3055",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [
      "status"
    ],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/plans",
    "summary": "List the whole plan catalogue",
    "description": "The whole subscription plan catalogue, hidden plans included, in display order. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "billing.ts:389",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/plans/{id}/changes",
    "summary": "Audit history of one plan",
    "description": "The change history of one subscription plan, newest first. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "billing.ts:620",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:PLAN_NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/point-prices",
    "summary": "List the current point price of every service",
    "description": "The current published point price of every service. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "points.ts:66",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/recharges",
    "summary": "List recharge requests across offices",
    "description": "The cross-office recharge queue (metadata only; the deposit slip itself is opened per request after a clean scan). Optional status filter. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "recharge.ts:171",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [
      "status"
    ],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/recharges/{id}/proof",
    "summary": "Open a recharge deposit slip",
    "description": "Opens one recharge request's deposit-slip image, only after a clean ClamAV scan. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "recharge.ts:192",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "409:ATTACHMENT_NOT_READY"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/registration-demand",
    "summary": "List captured registration-demand attempts",
    "description": "Every captured registration-demand attempt, most recent first, plus the per-union totals. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "demand.ts:125",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/setting-changes",
    "summary": "Platform settings change history",
    "description": "The platform settings change history (application-fee payer + branding), newest first — the Audit section's data. Optional limit query parameter. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "billing.ts:596",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [
      "limit"
    ],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/tenants/{id}/certificate-assets",
    "summary": "Read-only view of one office's certificate assets",
    "description": "Owner read-only view of any office's certificate assets (seal, signatures) with approval state. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "certificate-assets.ts:374",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/tenants/{id}/certificate-assets/{kind}/image",
    "summary": "Download one office's certificate asset image",
    "description": "Returns the stored image bytes (PNG or JPEG) for one certificate asset kind of one office. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "certificate-assets.ts:391",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/tenants/{id}/points",
    "summary": "Read one office's points balance and movements",
    "description": "An office's points balance and ledger movements. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "points.ts:132",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/owner/witness-types",
    "summary": "List witness types",
    "description": "The platform's witness types (per religion/name) used by public witness attestation. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "witness.ts:110",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/payments/bkash/callback/order/{token}",
    "summary": "bKash return URL for a billing-order payment",
    "description": "bKash returns the payer's browser here after a billing-order checkout. Query paymentID, status (success, failure, cancel) and signature. The return is not proof of payment: the opaque token finds the attempt and only the session query plus order validation in the gateway check can mark it paid. Gateway-only; not a client API. Rate limit 60/min.",
    "tag": "Gateway Callbacks",
    "visibility": "gateway-callback",
    "source": "order-payments.ts:717",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [
      "callbackLimiter"
    ],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "403:CALLBACK_INVALID"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": [
      {
        "name": "paymentID",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().min(1).max(200)"
      },
      {
        "name": "status",
        "optional": false,
        "nullable": false,
        "type": "enum[\"success\", \"failure\", \"cancel\"]",
        "raw": "z.enum([\"success\", \"failure\", \"cancel\"])"
      },
      {
        "name": "signature",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().min(1).max(500)"
      }
    ],
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/public/coupons",
    "summary": "List public coupons",
    "description": "Publicly visible coupons (visibility public) that citizens may apply. No authentication required.",
    "tag": "Coupons",
    "visibility": "public",
    "source": "coupons.ts:363",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/public/offices/{id}/account-types",
    "summary": "List the account types one office offers",
    "description": "Public list of the account types (posts) a given office accepts registrations for. No authentication required.",
    "tag": "Public",
    "visibility": "public",
    "source": "office-registration.ts:28",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/public/witness/options",
    "summary": "List witness attestation options",
    "description": "Public witness attestation options (types, religions) for the witness form. No authentication required.",
    "tag": "Witness",
    "visibility": "public",
    "source": "witness.ts:63",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/recharge-banks",
    "summary": "List active deposit accounts",
    "description": "Active bank deposit accounts offices use when preparing a recharge request. Admin, finance, or owner.",
    "tag": "Recharges",
    "visibility": "authenticated",
    "source": "recharge.ts:52",
    "roles": [
      "admin",
      "finance",
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/recharges",
    "summary": "List the office's recharge requests",
    "description": "The office's recharge requests with each deposit slip's scan state. Admin or finance.",
    "tag": "Recharges",
    "visibility": "authenticated",
    "source": "recharge.ts:154",
    "roles": [
      "admin",
      "finance"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/refunds",
    "summary": "List the office's refund requests",
    "description": "The office's refund requests, optionally filtered by status. Admin or finance.",
    "tag": "Refunds",
    "visibility": "authenticated",
    "source": "refunds.ts:126",
    "roles": [
      "admin",
      "finance"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [
      "status"
    ],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/services/{no}/office-info",
    "summary": "Per-service fee policies across offices",
    "description": "Public per-service view across participating offices: for each ACTIVE office offering the service, its current published fee policy (fees, citizen-charter time, required documents). Offices without a published policy are returned with policyVersion null; no values are inferred.",
    "tag": "Public",
    "visibility": "public",
    "source": "management.ts:580",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/verify/by-number/{number}",
    "summary": "Verify a certificate by its printed number",
    "description": "Public verification lookup by the number printed on official-format documents (Template v7 verification line). Bangla digits are accepted and normalised; the response is the same limited public record as the QR-token lookup. Rate limit 120/min.",
    "tag": "Public",
    "visibility": "public",
    "source": "app.ts:608",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "get",
    "path": "/api/v1/wallet/points",
    "summary": "Read the office's points balance and movements",
    "description": "The office's points balance and recent ledger movements. Staff, admin, finance, or approver.",
    "tag": "Points",
    "visibility": "authenticated",
    "source": "points.ts:44",
    "roles": [
      "admin",
      "finance",
      "approver",
      "staff"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "patch",
    "path": "/api/v1/admin/coupons/{code}",
    "summary": "Switch an office coupon on or off",
    "description": "Office admin toggles one of the office's coupons active or inactive without touching its terms.",
    "tag": "Coupons",
    "visibility": "authenticated",
    "source": "orders.ts:577",
    "roles": [
      "admin"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "active",
        "optional": false,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "patch",
    "path": "/api/v1/citizens/{id}/details",
    "summary": "Update a citizen's extended details",
    "description": "Partial update of a citizen's extended details (gender, parents/spouse names, blood group, NID/birth-registration, mobile). Only keys present are changed. Staff, admin, or the citizen themself.",
    "tag": "Citizens",
    "visibility": "authenticated",
    "source": "app.ts:945",
    "roles": [
      "staff",
      "admin",
      "citizen"
    ],
    "officeActor": false,
    "usesTenant": true,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "gender",
        "optional": true,
        "nullable": true,
        "type": "string",
        "raw": "citizenDetailsInput (.partial(); see apps/api/src/citizen-data.ts:57)"
      },
      {
        "name": "fatherNameBn",
        "optional": true,
        "nullable": true,
        "type": "string",
        "raw": "citizenDetailsInput (.partial(); see apps/api/src/citizen-data.ts:57)"
      },
      {
        "name": "fatherNameEn",
        "optional": true,
        "nullable": true,
        "type": "string",
        "raw": "citizenDetailsInput (.partial(); see apps/api/src/citizen-data.ts:57)"
      },
      {
        "name": "motherNameBn",
        "optional": true,
        "nullable": true,
        "type": "string",
        "raw": "citizenDetailsInput (.partial(); see apps/api/src/citizen-data.ts:57)"
      },
      {
        "name": "motherNameEn",
        "optional": true,
        "nullable": true,
        "type": "string",
        "raw": "citizenDetailsInput (.partial(); see apps/api/src/citizen-data.ts:57)"
      },
      {
        "name": "spouseNameBn",
        "optional": true,
        "nullable": true,
        "type": "string",
        "raw": "citizenDetailsInput (.partial(); see apps/api/src/citizen-data.ts:57)"
      },
      {
        "name": "spouseNameEn",
        "optional": true,
        "nullable": true,
        "type": "string",
        "raw": "citizenDetailsInput (.partial(); see apps/api/src/citizen-data.ts:57)"
      },
      {
        "name": "bloodGroup",
        "optional": true,
        "nullable": true,
        "type": "string",
        "raw": "citizenDetailsInput (.partial(); see apps/api/src/citizen-data.ts:57)"
      },
      {
        "name": "nid",
        "optional": true,
        "nullable": true,
        "type": "string",
        "raw": "citizenDetailsInput (.partial(); see apps/api/src/citizen-data.ts:57)"
      },
      {
        "name": "birthReg",
        "optional": true,
        "nullable": true,
        "type": "string",
        "raw": "citizenDetailsInput (.partial(); see apps/api/src/citizen-data.ts:57)"
      },
      {
        "name": "mobile",
        "optional": true,
        "nullable": true,
        "type": "string",
        "raw": "citizenDetailsInput (.partial(); see apps/api/src/citizen-data.ts:57)"
      },
      {
        "name": "noMobile",
        "optional": true,
        "nullable": false,
        "type": "boolean",
        "raw": "citizenDetailsInput (.partial(); see apps/api/src/citizen-data.ts:57)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "patch",
    "path": "/api/v1/citizens/{id}/profile",
    "summary": "Update a citizen's profile",
    "description": "Updates a citizen's profile fields (names, date of birth, addresses, geography). Staff, admin, or the citizen themself.",
    "tag": "Citizens",
    "visibility": "authenticated",
    "source": "app.ts:988",
    "roles": [
      "staff",
      "admin",
      "citizen"
    ],
    "officeActor": false,
    "usesTenant": true,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "nameBn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2, \"নাম কমপক্ষে ২ অক্ষরের হতে হবে। / Name must be at least 2 characters.\").max(120)"
      },
      {
        "name": "nameEn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2, \"Name must be at least 2 characters. / নাম কমপক্ষে ২ অক্ষরের হতে হবে।\").max(120)"
      },
      {
        "name": "dateOfBirth",
        "optional": false,
        "nullable": false,
        "type": "ref:z ",
        "raw": "z .string() .regex(/^\\d{4}-\\d{2}-\\d{2}$/, \"জন্ম তারিখ দিন। / Enter a date of birth.\") .refine( (v) => Number.isFinite(Date.parse(v)) && new "
      },
      {
        "name": "addressBn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(4, \"ঠিকানা কমপক্ষে ৪ অক্ষরের হতে হবে। / Address must be at least 4 characters.\").max(500)"
      },
      {
        "name": "addressEn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(4, \"Address must be at least 4 characters. / ঠিকানা কমপক্ষে ৪ অক্ষরের হতে হবে।\").max(500)"
      },
      {
        "name": "geography",
        "optional": false,
        "nullable": false,
        "type": "ref:geographyInput",
        "raw": "geographyInput"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "patch",
    "path": "/api/v1/office/name",
    "summary": "Rename the office",
    "description": "Name-only office rename for the chairman (approver) and admin. The name is printed on certificates, so this is the narrow fix path; the full office editor stays admin-only. At least one of nameBn / nameEn is required.",
    "tag": "Admin",
    "visibility": "authenticated",
    "source": "management.ts:425",
    "roles": [
      "admin",
      "approver"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "nameBn",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2).max(150).optional()"
      },
      {
        "name": "nameEn",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2).max(150).optional()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "patch",
    "path": "/api/v1/owner/witness-types/{id}",
    "summary": "Switch a witness type on or off",
    "description": "Platform owner toggles one witness type active or inactive. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "witness.ts:146",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "active",
        "optional": false,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/admin/coupons",
    "summary": "Create an office coupon",
    "description": "Office admin creates a coupon code for this office (discount kind/value, applicable services, validity window, redemption caps, note).",
    "tag": "Coupons",
    "visibility": "authenticated",
    "source": "orders.ts:538",
    "roles": [
      "admin"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [
      201
    ],
    "errorCodes": [
      "409:COUPON_EXISTS"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "code",
        "optional": false,
        "nullable": false,
        "type": "ref:couponCode",
        "raw": "couponCode"
      },
      {
        "name": "discountKind",
        "optional": false,
        "nullable": false,
        "type": "enum[\"percent\", \"fixed\"]",
        "raw": "z.enum([\"percent\", \"fixed\"])"
      },
      {
        "name": "discountValue",
        "optional": false,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(1).max(100000000)"
      },
      {
        "name": "serviceNos",
        "optional": true,
        "nullable": true,
        "type": "array",
        "raw": "z.array(serviceNumber).min(1).max(47).nullable().optional()"
      },
      {
        "name": "validFrom",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().datetime({ offset: true }).optional()"
      },
      {
        "name": "validUntil",
        "optional": true,
        "nullable": true,
        "type": "string",
        "raw": "z.string().datetime({ offset: true }).nullable().optional()"
      },
      {
        "name": "maxRedemptions",
        "optional": true,
        "nullable": true,
        "type": "number",
        "raw": "z.number().int().min(1).max(1000000).nullable().optional()"
      },
      {
        "name": "note",
        "optional": true,
        "nullable": true,
        "type": "string",
        "raw": "z.string().trim().max(200).nullable().optional()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/applications/{id}/refunds",
    "summary": "Request a refund of a verified payment",
    "description": "Applicant or office staff asks for a refund of the verified online payment for one application, before any certificate is issued. A certificate already issued, or no verified payment, fails with 409. An optional partial amount may be given; it cannot exceed the amount paid.",
    "tag": "Refunds",
    "visibility": "authenticated",
    "source": "refunds.ts:66",
    "roles": [
      "citizen",
      "staff",
      "admin"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [
      201
    ],
    "errorCodes": [
      "409:REFUND_AFTER_ISSUANCE",
      "409:REFUND_NOT_PAID",
      "409:REFUND_ALREADY_OPEN",
      "422:REFUND_AMOUNT_INVALID"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(5).max(255)"
      },
      {
        "name": "amountMinor",
        "optional": true,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(1).optional()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/auth/email/resend",
    "summary": "Resend the email-verification message",
    "description": "Resends the verification email to the caller's own address. Authenticated; accountActionLimiter 10/min per user. Responds 202 (delivery is asynchronous).",
    "tag": "Auth",
    "visibility": "authenticated",
    "source": "email-verification.ts:98",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [
      "accountActionLimiter"
    ],
    "inlineLimit": null,
    "statuses": [
      202
    ],
    "errorCodes": [
      "401:LOGIN_REQUIRED",
      "503:EMAIL_UNAVAILABLE",
      "422:EMAIL_VERIFICATION_INVALID",
      "404:NOT_FOUND",
      "409:EMAIL_ALREADY_VERIFIED",
      "429:EMAIL_RATE_LIMIT"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "post",
    "path": "/api/v1/auth/email/verify",
    "summary": "Verify an email address with its token",
    "description": "Confirms an email address using the token from the verification message. Public; rate limit 20/min.",
    "tag": "Auth",
    "visibility": "public",
    "source": "email-verification.ts:66",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [
      "verifyLimiter"
    ],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "422:EMAIL_VERIFICATION_INVALID"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "token",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().regex(/^[a-f0-9]{64}$/)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/auth/mfa/activate",
    "summary": "Activate authenticator protection",
    "description": "Activates MFA for the caller's account by verifying a code from the enrolled authenticator. Authenticated; accountActionLimiter 10/min per user.",
    "tag": "MFA & Security",
    "visibility": "authenticated",
    "source": "mfa.ts:443",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "409:MFA_ALREADY_ENABLED",
      "422:MFA_ENROLLMENT_EXPIRED"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "code",
        "optional": false,
        "nullable": false,
        "type": "ref:codeInput",
        "raw": "codeInput"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/auth/mfa/disable",
    "summary": "Disable authenticator protection",
    "description": "Disables MFA for the caller's account. Requires the current password and a valid authenticator code. Authenticated; accountActionLimiter 10/min per user.",
    "tag": "MFA & Security",
    "visibility": "authenticated",
    "source": "mfa.ts:477",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": true,
    "usesAuth": true,
    "limiters": [
      "accountActionLimiter"
    ],
    "inlineLimit": null,
    "statuses": [
      200
    ],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "currentPassword",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "passwordInput"
      },
      {
        "name": "code",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "codeInput"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/auth/mfa/enrollment",
    "summary": "Start authenticator enrollment",
    "description": "Begins MFA enrollment for the caller's account (returns the enrollment secret/QR payload). Requires the current password. Authenticated; accountActionLimiter 10/min per user.",
    "tag": "MFA & Security",
    "visibility": "authenticated",
    "source": "mfa.ts:399",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [
      "accountActionLimiter"
    ],
    "inlineLimit": null,
    "statuses": [
      201
    ],
    "errorCodes": [
      "422:PASSWORD_MISMATCH",
      "409:MFA_ALREADY_ENABLED"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "currentPassword",
        "optional": false,
        "nullable": false,
        "type": "ref:passwordInput",
        "raw": "passwordInput"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/auth/mfa/recovery-codes",
    "summary": "Regenerate authenticator recovery codes",
    "description": "Issues a fresh set of MFA recovery codes for the caller's account, invalidating the previous set. Requires the current password and a valid authenticator code. Authenticated; accountActionLimiter 10/min per user.",
    "tag": "MFA & Security",
    "visibility": "authenticated",
    "source": "mfa.ts:477",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": true,
    "usesAuth": true,
    "limiters": [
      "accountActionLimiter"
    ],
    "inlineLimit": null,
    "statuses": [
      200
    ],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "currentPassword",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "passwordInput"
      },
      {
        "name": "code",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "codeInput"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/auth/mfa/verify",
    "summary": "Verify an MFA challenge during sign-in",
    "description": "Completes the second factor of sign-in: the challenge token from the login response plus a code from the enrolled authenticator (or a recovery code). Public (no session yet); rate limit 60/min.",
    "tag": "MFA & Security",
    "visibility": "public",
    "source": "mfa.ts:292",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [
      "createRateLimiter"
    ],
    "inlineLimit": {
      "limit": 60,
      "windowMs": "60_000"
    },
    "statuses": [],
    "errorCodes": [
      "422:MFA_CHALLENGE_INVALID"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "challengeToken",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().regex(/^[a-f0-9]{64}$/)"
      },
      {
        "name": "code",
        "optional": false,
        "nullable": false,
        "type": "ref:codeInput",
        "raw": "codeInput"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/auth/office-registration",
    "summary": "Request a staff account at an office",
    "description": "Public request for a staff account at an office: office, post, email, password (6-18 characters, common passwords blocked), display name, and — when a mobile is given — its verified OTP token. Creates an inactive account pending owner approval. Rate limit 10/min.",
    "tag": "Auth",
    "visibility": "public",
    "source": "office-registration.ts:45",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [
      "createRateLimiter"
    ],
    "inlineLimit": {
      "limit": 10,
      "windowMs": "60_000"
    },
    "statuses": [
      202
    ],
    "errorCodes": [
      "422:IDENTIFIER_INVALID",
      "404:NOT_FOUND",
      "422:ACCOUNT_TYPE_OFFICE_MISMATCH",
      "409:EMAIL_TAKEN",
      "409:IDENTIFIER_TAKEN"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "tenantId",
        "optional": false,
        "nullable": false,
        "type": "ref:uuid",
        "raw": "uuid"
      },
      {
        "name": "accountType",
        "optional": false,
        "nullable": false,
        "type": "ref:typeCode",
        "raw": "typeCode"
      },
      {
        "name": "email",
        "optional": false,
        "nullable": false,
        "type": "string(email)",
        "raw": "z.string().email().max(150)"
      },
      {
        "name": "password",
        "optional": false,
        "nullable": false,
        "type": "ref:z ",
        "raw": "z .string() .min(6, \"Password must be at least 6 characters.\") .max(18, \"Password must be at most 18 characters.\") // QAFIX-01: the one 6–18"
      },
      {
        "name": "displayName",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().min(2).max(120)"
      },
      {
        "name": "mobile",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().min(1).max(40).optional()"
      },
      {
        "name": "otpToken",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().regex(/^[a-f0-9]{64}$/).optional()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/auth/otp/signup",
    "summary": "Send a sign-up OTP to a mobile number",
    "description": "Sends a one-time code to a Bangladeshi mobile number to start OTP sign-up. Public; rate limit 20/min. Responds 202.",
    "tag": "OTP",
    "visibility": "public",
    "source": "otp.ts:90",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [
      "otpLimiter"
    ],
    "inlineLimit": null,
    "statuses": [
      202
    ],
    "errorCodes": [
      "503:OTP_UNAVAILABLE",
      "422:IDENTIFIER_INVALID",
      "429:OTP_RATE_LIMIT"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "mobile",
        "optional": false,
        "nullable": false,
        "type": "ref:mobileInput",
        "raw": "mobileInput"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/auth/otp/verify",
    "summary": "Verify a sign-up OTP challenge",
    "description": "Verifies the code for a sign-up OTP challenge (challenge token + code). Public; rate limit 20/min.",
    "tag": "OTP",
    "visibility": "public",
    "source": "otp.ts:134",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [
      "otpLimiter"
    ],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "410:OTP_EXPIRED",
      "422:OTP_INVALID"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "challengeToken",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().regex(/^[a-f0-9]{64}$/)"
      },
      {
        "name": "code",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().regex(/^\\d{6}$/)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/auth/otp/verify-mobile",
    "summary": "Verify a mobile number with an OTP code",
    "description": "Verifies a mobile number for an account whose sign-in was pending: the code delivered to the handset is the proof, and only the holder of the number can reach the success branch. A code verifies at most one identifier; a number with no pending identifier answers 404; an already-verified number answers 409. Public; rate limit 20/min.",
    "tag": "OTP",
    "visibility": "public",
    "source": "otp.ts:175",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [
      "otpLimiter"
    ],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "422:IDENTIFIER_INVALID",
      "410:OTP_EXPIRED",
      "422:OTP_INVALID",
      "404:IDENTIFIER_NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "challengeToken",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().regex(/^[a-f0-9]{64}$/)"
      },
      {
        "name": "code",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().regex(/^\\d{6}$/)"
      },
      {
        "name": "mobile",
        "optional": false,
        "nullable": false,
        "type": "ref:mobileInput",
        "raw": "mobileInput"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/billing/orders/{orderId}/gateway-refund",
    "summary": "Request a gateway refund for a billing order",
    "description": "Office admin/finance asks the gateway to refund a settled billing order (full or partial amount with a reason). The refund is tracked through the gateway; the owner decision endpoint settles disputes.",
    "tag": "Billing & Orders",
    "visibility": "authenticated",
    "source": "order-payments.ts:881",
    "roles": [
      "admin",
      "finance"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [
      201
    ],
    "errorCodes": [
      "409:ORDER_NOT_PAID",
      "422:REFUND_PARTIAL_UNSUPPORTED"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(5).max(255)"
      },
      {
        "name": "amountMinor",
        "optional": true,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(1).optional()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/billing/orders/{orderId}/gateway/check",
    "summary": "Re-check a billing order's gateway payment",
    "description": "Manual re-check of a billing order's gateway payment (also the recovery path when a callback was missed): queries the gateway session and validates the order before marking it paid. Admin or finance.",
    "tag": "Billing & Orders",
    "visibility": "authenticated",
    "source": "order-payments.ts:669",
    "roles": [
      "admin",
      "finance"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "requestKey",
        "optional": false,
        "nullable": false,
        "type": "ref:uuid",
        "raw": "uuid"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/billing/orders/{orderId}/gateway/checkout",
    "summary": "Start a gateway checkout for a billing order",
    "description": "Office admin/finance starts an online checkout (bKash or SSLCommerz) for a pending billing order. The order must be payable (not settled, amount above zero); an idempotency request key is required.",
    "tag": "Billing & Orders",
    "visibility": "authenticated",
    "source": "order-payments.ts:477",
    "roles": [
      "admin",
      "finance"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "409:ORDER_ALREADY_SETTLED",
      "409:ORDER_NOT_PAYABLE",
      "409:PAYMENT_NOT_REQUIRED",
      "409:IDEMPOTENCY_CONFLICT",
      "409:GATEWAY_CREATE_MISMATCH"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "provider",
        "optional": false,
        "nullable": false,
        "type": "enum[\"BKASH\", \"SSLCOMMERZ\"]",
        "raw": "z.enum([\"BKASH\", \"SSLCOMMERZ\"])"
      },
      {
        "name": "requestKey",
        "optional": false,
        "nullable": false,
        "type": "ref:uuid",
        "raw": "uuid"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/account-requests/{id}/decision",
    "summary": "Approve or reject an office account request",
    "description": "Platform owner decides an office account request (approve activates the account; reject requires a reason). Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "office-registration.ts:145",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND",
      "409:ALREADY_DECIDED"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "decision",
        "optional": false,
        "nullable": false,
        "type": "enum[\"approve\", \"reject\"]",
        "raw": "z.enum([\"approve\", \"reject\"])"
      },
      {
        "name": "reason",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(8).max(500).optional()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/coupons",
    "summary": "Create a platform coupon",
    "description": "Platform owner creates a coupon (code stored upper-case and matched case-insensitively; discount, scope, validity, caps, visibility, active state, and a reason). Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "coupons.ts:238",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [
      201
    ],
    "errorCodes": [
      "409:COUPON_EXISTS"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "code",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "platformCouponCode (upper-case, case-insensitive match)"
      },
      {
        "name": "discountKind",
        "optional": false,
        "nullable": false,
        "type": "enum[\"percent\", \"fixed\"]",
        "raw": "z.enum([\"percent\", \"fixed\"])"
      },
      {
        "name": "discountValue",
        "optional": false,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(1).max(100000000)"
      },
      {
        "name": "appliesTo",
        "optional": false,
        "nullable": false,
        "type": "enum[\"subscription\", \"topup\", \"both\"]",
        "raw": "z.enum([\"subscription\", \"topup\", \"both\"])"
      },
      {
        "name": "planId",
        "optional": false,
        "nullable": true,
        "type": "string",
        "raw": "z.string().min(1).max(50).nullable()"
      },
      {
        "name": "validFrom",
        "optional": false,
        "nullable": false,
        "type": "string(date-time)",
        "raw": "z.string().datetime({ offset: true })"
      },
      {
        "name": "validUntil",
        "optional": false,
        "nullable": true,
        "type": "string(date-time)",
        "raw": "z.string().datetime({ offset: true }).nullable()"
      },
      {
        "name": "maxUses",
        "optional": false,
        "nullable": true,
        "type": "number",
        "raw": "z.number().int().min(1).max(1000000).nullable()"
      },
      {
        "name": "perOfficeLimit",
        "optional": false,
        "nullable": true,
        "type": "number",
        "raw": "z.number().int().min(1).max(1000000).nullable()"
      },
      {
        "name": "visibility",
        "optional": false,
        "nullable": false,
        "type": "enum[\"public\", \"hidden\"]",
        "raw": "z.enum([\"public\", \"hidden\"])"
      },
      {
        "name": "active",
        "optional": false,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean()"
      },
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(8).max(500)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/coupons/{code}/active",
    "summary": "Switch a platform coupon on or off",
    "description": "Platform owner switches a coupon on or off without touching its terms; a reason is recorded. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "coupons.ts:285",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "active",
        "optional": false,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean()"
      },
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "ref:couponFields",
        "raw": "couponFields.reason"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/credit-prices/{no}",
    "summary": "Publish a new credit price for one service",
    "description": "Platform owner publishes a new credit-price version for one service. Versions are never edited; each records who set it, when, and why — the price table is its own audit trail. An expected version guards against concurrent edits.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "billing.ts:199",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [
      201
    ],
    "errorCodes": [
      "409:CREDIT_PRICE_STALE"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "expectedVersion",
        "optional": false,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(0).max(2147483646)"
      },
      {
        "name": "priceCredits",
        "optional": false,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(0).max(10000)"
      },
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(3).max(500)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/notices",
    "summary": "Publish a new platform notice",
    "description": "Platform owner publishes a new platform notice (Bangla + English title/body, optional link, live window, published flag, and a reason). Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "notices.ts:138",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [
      201
    ],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "titleBn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2).max(200)"
      },
      {
        "name": "titleEn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2).max(200)"
      },
      {
        "name": "bodyBn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(1).max(4000)"
      },
      {
        "name": "bodyEn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(1).max(4000)"
      },
      {
        "name": "linkUrl",
        "optional": false,
        "nullable": true,
        "type": "ref:z ",
        "raw": "z .string() .trim() .regex(/^https?:\\/\\//, \"The link must start with http:// or https://\") .max(500) .nullable()"
      },
      {
        "name": "startsAt",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().datetime({ offset: true })"
      },
      {
        "name": "endsAt",
        "optional": false,
        "nullable": true,
        "type": "string",
        "raw": "z.string().datetime({ offset: true }).nullable()"
      },
      {
        "name": "published",
        "optional": false,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean()"
      },
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(8).max(500)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/notices/{id}/publish",
    "summary": "Publish or unpublish a notice",
    "description": "Platform owner publishes or unpublishes a notice at any time without touching its content; a reason is recorded. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "notices.ts:181",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "published",
        "optional": false,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean()"
      },
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(8).max(500)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/office-inclusion-requests/{id}/status",
    "summary": "Set the status of an office inclusion request",
    "description": "Platform owner moves an office inclusion request to a new status (NEW, CONTACTED, ACCEPTED, DECLINED) with an optional note. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "office-inclusion.ts:100",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "403:ROLE_DENIED",
      "409:REQUEST_CLOSED"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "status",
        "optional": false,
        "nullable": false,
        "type": "enum[\"CONTACTED\", \"ACCEPTED\", \"DECLINED\"]",
        "raw": "z.enum([\"CONTACTED\", \"ACCEPTED\", \"DECLINED\"])"
      },
      {
        "name": "note",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(3).max(500).optional()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/payment-orders/{id}/cancel",
    "summary": "Cancel a platform payment order",
    "description": "Platform owner cancels a pending platform payment order with a reason. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "app.ts:3105",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:ORDER_NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(8).max(500)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/payment-orders/{id}/settle",
    "summary": "Settle a platform payment order manually",
    "description": "Platform owner settles a platform payment order by hand (offline payment) with a reason. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "app.ts:3094",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:ORDER_NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(8).max(500)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/payment-orders/{orderId}/gateway-refund/decision",
    "summary": "Decide a gateway refund for a payment order",
    "description": "Platform owner decides a gateway refund (approve/reject with a note) for one payment order. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "order-payments.ts:1119",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND",
      "409:REFUND_ALREADY_DECIDED"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "refundId",
        "optional": false,
        "nullable": false,
        "type": "ref:uuid",
        "raw": "uuid"
      },
      {
        "name": "decision",
        "optional": false,
        "nullable": false,
        "type": "enum[\"APPROVED\", \"REJECTED\"]",
        "raw": "z.enum([\"APPROVED\", \"REJECTED\"])"
      },
      {
        "name": "note",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(3).max(500).optional()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/payment-orders/{orderId}/gateway-refund/refresh",
    "summary": "Re-check a gateway refund's provider state",
    "description": "Platform owner re-checks a sent gateway refund with the provider (and retries a send whose outcome was unknown). Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "order-payments.ts:1185",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "refundId",
        "optional": false,
        "nullable": false,
        "type": "ref:uuid",
        "raw": "uuid"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/plans",
    "summary": "Create a subscription plan",
    "description": "Platform owner creates a subscription plan. The id is an optional slug; when omitted it is derived from the name. onSale defaults true, sortOrder 0, rollover true. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "billing.ts:400",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [
      201
    ],
    "errorCodes": [
      "409:PLAN_ID_TAKEN"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "id",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().regex(/^[a-z0-9][a-z0-9-]{1,49}$/) — optional slug"
      },
      {
        "name": "name",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(1).max(120)"
      },
      {
        "name": "durationDays",
        "optional": false,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(1).max(3650)"
      },
      {
        "name": "priceMinor",
        "optional": false,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(0).max(100000000)"
      },
      {
        "name": "grantCredits",
        "optional": false,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(1).max(100000)"
      },
      {
        "name": "monthlyAllowanceLimit",
        "optional": false,
        "nullable": true,
        "type": "number",
        "raw": "z.number().int().min(1).max(100000).nullable()"
      },
      {
        "name": "onSale",
        "optional": true,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean() (default true on create)"
      },
      {
        "name": "sortOrder",
        "optional": true,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(-10000).max(10000) (default 0 on create)"
      },
      {
        "name": "rollover",
        "optional": true,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean() (default true on create)"
      },
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(8).max(500)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/plans/{id}/on-sale",
    "summary": "Put a plan on sale or hide it",
    "description": "Platform owner puts a plan on sale or hides it. Hidden plans reject new orders; existing subscriptions are unaffected. A reason is recorded. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "billing.ts:473",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:PLAN_NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "onSale",
        "optional": false,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean()"
      },
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "ref:planFields",
        "raw": "planFields.reason"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/point-prices/{no}",
    "summary": "Publish a new point price for one service",
    "description": "Platform owner publishes a new point-price version for one service. Versions are never edited; each records who set it, when, and why, so the price table is its own audit trail. An expected version guards against concurrent edits.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "points.ts:93",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [
      201
    ],
    "errorCodes": [
      "409:POINT_PRICE_STALE"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "expectedVersion",
        "optional": false,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(0).max(2147483646)"
      },
      {
        "name": "priceMinor",
        "optional": false,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(0).max(10000000)"
      },
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(3).max(500)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/recharges/{id}/decision",
    "summary": "Decide a recharge request",
    "description": "Platform owner confirms (credits points once) or rejects (with a reason) a pending recharge request. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "recharge.ts:211",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "409:RECHARGE_ALREADY_DECIDED",
      "409:ATTACHMENT_NOT_READY"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "tenantId",
        "optional": false,
        "nullable": false,
        "type": "ref:uuid",
        "raw": "uuid"
      },
      {
        "name": "decision",
        "optional": false,
        "nullable": false,
        "type": "enum[\"CONFIRMED\", \"REJECTED\"]",
        "raw": "z.enum([\"CONFIRMED\", \"REJECTED\"])"
      },
      {
        "name": "note",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(3).max(500).optional()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/tenants/{id}/points/adjust",
    "summary": "Adjust an office's points through the ledger",
    "description": "Platform owner adjusts an office's points through the ledger (never by editing the balance). requestKey makes a retried request apply once. A reason is recorded. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "points.ts:152",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [
      201
    ],
    "errorCodes": [
      "404:NOT_FOUND",
      "422:NEGATIVE_BALANCE"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "deltaMinor",
        "optional": false,
        "nullable": false,
        "type": "ref:z ",
        "raw": "z .number() .int() .min(-100000000) .max(100000000) .refine((n) => n !== 0)"
      },
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(8).max(500)"
      },
      {
        "name": "requestKey",
        "optional": false,
        "nullable": false,
        "type": "ref:uuid",
        "raw": "uuid"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/tenants/{id}/subscription",
    "summary": "Change an office's subscription",
    "description": "Platform owner changes an office subscription (grant/extend/revoke plan, set validity, grant credits) with a reason. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "app.ts:3004",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [
      201
    ],
    "errorCodes": [
      "404:NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "action",
        "optional": false,
        "nullable": false,
        "type": "enum[ \"activate\", \"extend\", \"set_expiry\", \"suspend\", \"change_plan\", ]",
        "raw": "z.enum([ \"activate\", \"extend\", \"set_expiry\", \"suspend\", \"change_plan\", ])"
      },
      {
        "name": "planId",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().min(1).max(50).optional()"
      },
      {
        "name": "days",
        "optional": true,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(1).max(3650).optional()"
      },
      {
        "name": "validUntil",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().datetime({ offset: true }).optional()"
      },
      {
        "name": "status",
        "optional": true,
        "nullable": false,
        "type": "enum[\"ACTIVE\", \"EXPIRED\", \"SUSPENDED\"]",
        "raw": "z.enum([\"ACTIVE\", \"EXPIRED\", \"SUSPENDED\"]).optional()"
      },
      {
        "name": "grantCredits",
        "optional": true,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean().optional()"
      },
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(8).max(500)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/owner/witness-types",
    "summary": "Create a witness type",
    "description": "Platform owner creates a witness type (religion and name in Bangla + English, optional sort order). Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "witness.ts:118",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [
      201
    ],
    "errorCodes": [
      "409:WITNESS_TYPE_EXISTS"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "religionBn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2).max(60)"
      },
      {
        "name": "religionEn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2).max(60)"
      },
      {
        "name": "nameBn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2).max(160)"
      },
      {
        "name": "nameEn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2).max(160)"
      },
      {
        "name": "sortOrder",
        "optional": true,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(0).max(1000).default(0)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/payments/sslcommerz/callback/order/{token}",
    "summary": "SSLCommerz return/IPN for a billing-order payment",
    "description": "SSLCommerz returns the browser (success, fail or cancel) and sends its IPN as form POSTs to this one URL. Neither is proof: the opaque token finds the attempt, the returned tran_id must be its invoice, and only the session query plus order validation in the check can mark it paid. Gateway-only; not a client API. Rate limit 60/min.",
    "tag": "Gateway Callbacks",
    "visibility": "gateway-callback",
    "source": "order-payments.ts:813",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [
      "callbackLimiter"
    ],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "403:CALLBACK_INVALID"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "tran_id",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().min(1).max(100)"
      },
      {
        "name": "status",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().min(1).max(40).optional()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/payments/sslcommerz/callback/{token}",
    "summary": "SSLCommerz return/IPN for an application payment",
    "description": "SSLCommerz returns the browser (success, fail or cancel) and sends its IPN as form POSTs to this one URL. Neither is proof of payment: the opaque token finds the attempt, the returned tran_id must be its invoice, and only the session query plus order validation in the check can mark it paid. Gateway-only; not a client API. Rate limit 60/min.",
    "tag": "Gateway Callbacks",
    "visibility": "gateway-callback",
    "source": "payments.ts:775",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [
      "callbackLimiter"
    ],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND",
      "403:CALLBACK_INVALID"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "tran_id",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().min(1).max(100)"
      },
      {
        "name": "status",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().min(1).max(40).optional()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/public/office-inclusion-requests",
    "summary": "Ask for an office to join the platform",
    "description": "Public request for an office to be included on the platform (office name/type, geography, contact, optional message). No authentication required.",
    "tag": "Public",
    "visibility": "public",
    "source": "office-inclusion.ts:40",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [
      201
    ],
    "errorCodes": [
      "422:IDENTIFIER_INVALID"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "officeName",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(3).max(160)"
      },
      {
        "name": "officeType",
        "optional": false,
        "nullable": false,
        "type": "enum[\"UNION\", \"MUNICIPALITY\", \"CITY_CORPORATION\"]",
        "raw": "z.enum([\"UNION\", \"MUNICIPALITY\", \"CITY_CORPORATION\"])"
      },
      {
        "name": "divisionCode",
        "optional": false,
        "nullable": false,
        "type": "ref:code",
        "raw": "code(\"div\")"
      },
      {
        "name": "districtCode",
        "optional": false,
        "nullable": false,
        "type": "ref:code",
        "raw": "code(\"dis\")"
      },
      {
        "name": "upazilaCode",
        "optional": false,
        "nullable": false,
        "type": "ref:code",
        "raw": "code(\"upa\")"
      },
      {
        "name": "unionCode",
        "optional": false,
        "nullable": false,
        "type": "ref:code",
        "raw": "code(\"uni\")"
      },
      {
        "name": "contactName",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2).max(120)"
      },
      {
        "name": "contactRole",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2).max(120)"
      },
      {
        "name": "contactMobile",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().max(40)"
      },
      {
        "name": "contactEmail",
        "optional": true,
        "nullable": false,
        "type": "string(email)",
        "raw": "z.string().trim().email().max(200).optional().or(z.literal(\"\"))"
      },
      {
        "name": "message",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().max(1000).optional()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/public/witness",
    "summary": "Submit a public witness attestation",
    "description": "Public witness attestation for a deceased person's record (witness type, names, mobile, NID). No authentication required; rate limit 10/hour.",
    "tag": "Witness",
    "visibility": "public",
    "source": "witness.ts:73",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "422:IDENTIFIER_INVALID",
      "422:WITNESS_TYPE_UNAVAILABLE"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "typeId",
        "optional": false,
        "nullable": false,
        "type": "string(uuid)",
        "raw": "z.string().uuid()"
      },
      {
        "name": "deceasedNameBn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2).max(150)"
      },
      {
        "name": "attestorNameBn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2).max(150)"
      },
      {
        "name": "mobile",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().max(40)"
      },
      {
        "name": "nid",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().max(40)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/recharges",
    "summary": "Request a points recharge with a deposit slip",
    "description": "Office admin/finance requests a points recharge with the bank deposit slip (amount, bank, reference, date, proof image). The slip enters the scan pipeline before the owner can decide it.",
    "tag": "Recharges",
    "visibility": "authenticated",
    "source": "recharge.ts:96",
    "roles": [
      "admin",
      "finance"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [
      201
    ],
    "errorCodes": [
      "422:DEPOSIT_DATE_INVALID",
      "422:BANK_UNAVAILABLE",
      "409:DEPOSIT_ALREADY_USED"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "amountMinor",
        "optional": false,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(100).max(100000000)"
      },
      {
        "name": "bankCode",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().regex(/^[a-z0-9-]{2,40}$/)"
      },
      {
        "name": "depositReference",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(3).max(80)"
      },
      {
        "name": "depositDate",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/)"
      },
      {
        "name": "proof",
        "optional": false,
        "nullable": false,
        "type": "ref:z ",
        "raw": "z .object({ mimeType: z.enum([\"application/pdf\", \"image/png\", \"image/jpeg\"]), base64: z.string().max(2796204), }) .strict()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/refunds/{id}/decision",
    "summary": "Approve (and send) or reject a refund",
    "description": "Office admin/finance approves (and sends, via the gateway) or rejects a requested refund, with a note.",
    "tag": "Refunds",
    "visibility": "authenticated",
    "source": "refunds.ts:222",
    "roles": [
      "admin",
      "finance"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND",
      "409:REFUND_ALREADY_DECIDED",
      "409:REFUND_AFTER_ISSUANCE"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "decision",
        "optional": false,
        "nullable": false,
        "type": "enum[\"APPROVED\", \"REJECTED\"]",
        "raw": "z.enum([\"APPROVED\", \"REJECTED\"])"
      },
      {
        "name": "note",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(3).max(500).optional()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "post",
    "path": "/api/v1/refunds/{id}/refresh",
    "summary": "Re-check a sent refund's provider state",
    "description": "Office admin/finance checks a sent refund with the provider (and retries a send whose outcome was unknown). Takes no body.",
    "tag": "Refunds",
    "visibility": "authenticated",
    "source": "refunds.ts:255",
    "roles": [
      "admin",
      "finance"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "put",
    "path": "/api/v1/account/identifiers/{kind}",
    "summary": "Add or change one of the caller's sign-in identifiers",
    "description": "Adds (or replaces) a mobile or email identifier on the caller's own account. Requires the current password. Authenticated; accountActionLimiter 10/min per user.",
    "tag": "Identifiers",
    "visibility": "authenticated",
    "source": "identifier-routes.ts:67",
    "roles": [],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [
      "accountActionLimiter"
    ],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "422:IDENTIFIER_INVALID",
      "422:PASSWORD_MISMATCH",
      "422:OTP_REQUIRED",
      "409:IDENTIFIER_TAKEN"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "value",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().min(1).max(40)"
      },
      {
        "name": "currentPassword",
        "optional": false,
        "nullable": false,
        "type": "ref:passwordInput",
        "raw": "passwordInput"
      },
      {
        "name": "otpToken",
        "optional": true,
        "nullable": false,
        "type": "ref:z ",
        "raw": "z .string() .regex(/^[a-f0-9]{64}$/) .optional()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "put",
    "path": "/api/v1/admin/office/profile-completeness",
    "summary": "Toggle the citizen profile completeness gate",
    "description": "Office admin turns the citizen profile completeness gate on or off for certificate issuance.",
    "tag": "Admin",
    "visibility": "authenticated",
    "source": "management.ts:457",
    "roles": [
      "admin"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "requireCompleteProfile",
        "optional": false,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "put",
    "path": "/api/v1/admin/payment-merchants/bkash",
    "summary": "Configure the office bKash merchant credentials",
    "description": "Office admin configures the bKash merchant (environment, merchant account, app secret, username, password, enabled). Credentials are stored encrypted and are never returned by any read endpoint. Admin only.",
    "tag": "Payments",
    "visibility": "authenticated",
    "source": "gateways.ts:171",
    "roles": [
      "admin"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "403:ROLE_DENIED",
      "422:MERCHANT_CREDENTIALS_REQUIRED"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "environment",
        "optional": false,
        "nullable": false,
        "type": "enum[\"SANDBOX\", \"LIVE\"]",
        "raw": "z.enum([\"SANDBOX\", \"LIVE\"])"
      },
      {
        "name": "merchantAccount",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().regex(/^01[3-9][0-9]{8}$/)"
      },
      {
        "name": "appKey",
        "optional": true,
        "nullable": false,
        "type": "ref:secret",
        "raw": "secret.optional()"
      },
      {
        "name": "appSecret",
        "optional": true,
        "nullable": false,
        "type": "ref:secret",
        "raw": "secret.optional()"
      },
      {
        "name": "username",
        "optional": true,
        "nullable": false,
        "type": "ref:secret",
        "raw": "secret.optional()"
      },
      {
        "name": "password",
        "optional": true,
        "nullable": false,
        "type": "ref:secret",
        "raw": "secret.optional()"
      },
      {
        "name": "enabled",
        "optional": false,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "put",
    "path": "/api/v1/admin/payment-merchants/sslcommerz",
    "summary": "Configure the office SSLCommerz merchant credentials",
    "description": "Office admin configures the SSLCommerz merchant (environment, store id, enabled). Credentials are stored encrypted and are never returned by any read endpoint. Admin only.",
    "tag": "Payments",
    "visibility": "authenticated",
    "source": "gateways.ts:113",
    "roles": [
      "admin"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": true,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "403:ROLE_DENIED",
      "422:STORE_PASSWORD_REQUIRED"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "environment",
        "optional": false,
        "nullable": false,
        "type": "enum[\"SANDBOX\", \"LIVE\"]",
        "raw": "z.enum([\"SANDBOX\", \"LIVE\"])"
      },
      {
        "name": "storeId",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().regex(/^[A-Za-z0-9_.-]{3,100}$/)"
      },
      {
        "name": "storePassword",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().min(4).max(200).optional()"
      },
      {
        "name": "enabled",
        "optional": false,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "put",
    "path": "/api/v1/citizens/{id}/identity-document",
    "summary": "Link or unlink a citizen's identity document image",
    "description": "Links an uploaded private attachment of this citizen as their NID or birth-registration image, or unlinks it with null. The upload itself goes through POST /attachments and its quarantine scan. Staff, admin, or the citizen themself.",
    "tag": "Citizens",
    "visibility": "authenticated",
    "source": "app.ts:1061",
    "roles": [
      "staff",
      "admin",
      "citizen"
    ],
    "officeActor": false,
    "usesTenant": true,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:ATTACHMENT_NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "document",
        "optional": false,
        "nullable": true,
        "type": "object",
        "raw": "z.object({ attachmentId: uuid, kind: z.enum([\"nid\", \"birth_reg\"]) }).strict().nullable()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "put",
    "path": "/api/v1/citizens/{id}/photo",
    "summary": "Upload a citizen's profile photo",
    "description": "Stores the citizen's optional photo on the citizen record (migration 051), printed on certificates only when present. The upload is validated by the attachments pipeline's decoder (magic bytes + 2 MiB cap), restricted to PNG/JPEG like the office certificate assets. Staff, admin, or the citizen themself.",
    "tag": "Citizens",
    "visibility": "authenticated",
    "source": "app.ts:1109",
    "roles": [
      "staff",
      "admin",
      "citizen"
    ],
    "officeActor": false,
    "usesTenant": true,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "mimeType",
        "optional": false,
        "nullable": false,
        "type": "enum[\"image/png\", \"image/jpeg\"]",
        "raw": "z.enum([\"image/png\", \"image/jpeg\"])"
      },
      {
        "name": "base64",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().min(1).max(3_000_000)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "put",
    "path": "/api/v1/office/certificate-assets/{kind}",
    "summary": "Upload one office certificate asset",
    "description": "Uploads one certificate asset kind (seal or signature image, PNG/JPEG, 2 MiB cap) for the office, with an optional reason. Any authenticated office staff member; the asset enters the approval flow.",
    "tag": "Certificates",
    "visibility": "authenticated",
    "source": "certificate-assets.ts:190",
    "roles": [],
    "officeActor": true,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "422:REASON_REQUIRED"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "mimeType",
        "optional": false,
        "nullable": false,
        "type": "enum[\"image/png\", \"image/jpeg\"]",
        "raw": "z.enum([\"image/png\", \"image/jpeg\"])"
      },
      {
        "name": "base64",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().max(2796204)"
      },
      {
        "name": "reason",
        "optional": true,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(8).max(500).optional()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "put",
    "path": "/api/v1/owner/billing-settings",
    "summary": "Change who pays the application fee",
    "description": "Platform owner changes the application-fee payer (office or citizen) with a reason; the change is recorded in the settings history. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "billing.ts:276",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "applicationFeePayer",
        "optional": false,
        "nullable": false,
        "type": "enum[\"office\", \"citizen\"]",
        "raw": "z.enum([\"office\", \"citizen\"])"
      },
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(8).max(500)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "get",
    "path": "/api/v1/owner/support-contact",
    "summary": "Read the platform support contact with defaults",
    "description": "F-001: the current support contact (stored values with empty defaults applied). Platform owner only; the public read is GET /api/v1/support-contact.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "support-contact.ts:94",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": null,
    "queryKeys": null,
    "hasBodyParse": false
  },
  {
    "method": "put",
    "path": "/api/v1/owner/support-contact",
    "summary": "Replace the platform support contact",
    "description": "F-001: platform owner replaces the support contact. Only keys whose value actually changes are written, and each changed key gets its own history row. Clearing a field to empty hides it publicly. A reason is recorded. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "support-contact.ts:102",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "phone",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().max(40)"
      },
      {
        "name": "email",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().max(120)"
      },
      {
        "name": "hoursBn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().max(200)"
      },
      {
        "name": "hoursEn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().max(200)"
      },
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(8).max(500)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "put",
    "path": "/api/v1/owner/branding",
    "summary": "Replace the platform branding",
    "description": "Platform owner replaces the platform branding. Only keys whose value actually changes are written, and each changed key gets its own history row. A reason is recorded. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "billing.ts:554",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "name",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(1).max(80)"
      },
      {
        "name": "taglineBn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(1).max(200)"
      },
      {
        "name": "taglineEn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(1).max(200)"
      },
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(8).max(500)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "put",
    "path": "/api/v1/owner/coupons/{code}",
    "summary": "Edit a platform coupon's terms",
    "description": "Platform owner edits a coupon's terms. Past redemptions keep the discount they were given. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "coupons.ts:261",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "discountKind",
        "optional": false,
        "nullable": false,
        "type": "enum[\"percent\", \"fixed\"]",
        "raw": "z.enum([\"percent\", \"fixed\"])"
      },
      {
        "name": "discountValue",
        "optional": false,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(1).max(100000000)"
      },
      {
        "name": "appliesTo",
        "optional": false,
        "nullable": false,
        "type": "enum[\"subscription\", \"topup\", \"both\"]",
        "raw": "z.enum([\"subscription\", \"topup\", \"both\"])"
      },
      {
        "name": "planId",
        "optional": false,
        "nullable": true,
        "type": "string",
        "raw": "z.string().min(1).max(50).nullable()"
      },
      {
        "name": "validFrom",
        "optional": false,
        "nullable": false,
        "type": "string(date-time)",
        "raw": "z.string().datetime({ offset: true })"
      },
      {
        "name": "validUntil",
        "optional": false,
        "nullable": true,
        "type": "string(date-time)",
        "raw": "z.string().datetime({ offset: true }).nullable()"
      },
      {
        "name": "maxUses",
        "optional": false,
        "nullable": true,
        "type": "number",
        "raw": "z.number().int().min(1).max(1000000).nullable()"
      },
      {
        "name": "perOfficeLimit",
        "optional": false,
        "nullable": true,
        "type": "number",
        "raw": "z.number().int().min(1).max(1000000).nullable()"
      },
      {
        "name": "visibility",
        "optional": false,
        "nullable": false,
        "type": "enum[\"public\", \"hidden\"]",
        "raw": "z.enum([\"public\", \"hidden\"])"
      },
      {
        "name": "active",
        "optional": false,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean()"
      },
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(8).max(500)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "put",
    "path": "/api/v1/owner/notices/{id}",
    "summary": "Edit a platform notice",
    "description": "Platform owner edits a notice's content and live window. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "notices.ts:158",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "titleBn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2).max(200)"
      },
      {
        "name": "titleEn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2).max(200)"
      },
      {
        "name": "bodyBn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(1).max(4000)"
      },
      {
        "name": "bodyEn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(1).max(4000)"
      },
      {
        "name": "linkUrl",
        "optional": false,
        "nullable": true,
        "type": "ref:z ",
        "raw": "z .string() .trim() .regex(/^https?:\\/\\//, \"The link must start with http:// or https://\") .max(500) .nullable()"
      },
      {
        "name": "startsAt",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().datetime({ offset: true })"
      },
      {
        "name": "endsAt",
        "optional": false,
        "nullable": true,
        "type": "string",
        "raw": "z.string().datetime({ offset: true }).nullable()"
      },
      {
        "name": "published",
        "optional": false,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean()"
      },
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(8).max(500)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "put",
    "path": "/api/v1/owner/plans/{id}",
    "summary": "Edit a subscription plan's catalogue fields",
    "description": "Platform owner edits a plan's catalogue fields. Running subscriptions keep their snapshotted terms. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "billing.ts:450",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [
      "404:PLAN_NOT_FOUND"
    ],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "name",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(1).max(120)"
      },
      {
        "name": "durationDays",
        "optional": false,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(1).max(3650)"
      },
      {
        "name": "priceMinor",
        "optional": false,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(0).max(100000000)"
      },
      {
        "name": "grantCredits",
        "optional": false,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(1).max(100000)"
      },
      {
        "name": "monthlyAllowanceLimit",
        "optional": false,
        "nullable": true,
        "type": "number",
        "raw": "z.number().int().min(1).max(100000).nullable()"
      },
      {
        "name": "onSale",
        "optional": true,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean() (default true on create)"
      },
      {
        "name": "sortOrder",
        "optional": true,
        "nullable": false,
        "type": "number",
        "raw": "z.number().int().min(-10000).max(10000) (default 0 on create)"
      },
      {
        "name": "rollover",
        "optional": true,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean() (default true on create)"
      },
      {
        "name": "reason",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(8).max(500)"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  },
  {
    "method": "put",
    "path": "/api/v1/owner/recharge-banks/{code}",
    "summary": "Add or update a deposit account",
    "description": "Platform owner adds or updates a bank deposit account (names, account holder/number, branch, active). Accounts are switched off, never deleted. Platform owner only.",
    "tag": "Owner",
    "visibility": "authenticated",
    "source": "recharge.ts:67",
    "roles": [
      "owner"
    ],
    "officeActor": false,
    "usesTenant": false,
    "usesActor": false,
    "usesAuth": false,
    "limiters": [],
    "inlineLimit": null,
    "statuses": [],
    "errorCodes": [],
    "queryParams": [],
    "bodyKeys": [
      {
        "name": "nameBn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2).max(120)"
      },
      {
        "name": "nameEn",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2).max(120)"
      },
      {
        "name": "accountName",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().min(2).max(120)"
      },
      {
        "name": "accountNumber",
        "optional": false,
        "nullable": false,
        "type": "string",
        "raw": "z.string().trim().regex(/^[0-9A-Za-z -]{4,40}$/)"
      },
      {
        "name": "branch",
        "optional": true,
        "nullable": true,
        "type": "string",
        "raw": "z.string().trim().max(120).nullable().optional()"
      },
      {
        "name": "active",
        "optional": false,
        "nullable": false,
        "type": "boolean",
        "raw": "z.boolean()"
      }
    ],
    "queryKeys": null,
    "hasBodyParse": true
  }
];

// --- rate-limit catalogue (apps/api/src/http-hardening.ts, account-security.ts) ---
const LIMITERS = {
  accountActionLimiter: "10 requests/min per authenticated user",
  otpLimiter: "20 requests/min",
  verifyLimiter: "20 requests/min",
  callbackLimiter: "60 requests/min",
  scannerLimiter: "120 requests/min (internal scanner service)",
};
const GLOBAL_LIMITS = {
  "Public lookups /api/v1/verify/* and /api/v1/track/*": "120 requests/min (publicLimiter, http-hardening.ts)",
  "Mutations on /api/v1/auth/(login|signup|register|forgot-password|recover) and /api/v1/public/(feedback|subscribe)": "60 requests/min (mutationLimiter, http-hardening.ts)",
  "All other authenticated mutations": "session + CSRF required; no additional global limiter (per-route limiters are listed on the operation)",
};

const STANDARD_RESPONSES = {
  401: "Session missing or inactive.",
  403: "Role, CSRF or Origin denied.",
  404: "Record unavailable in this scope.",
  409: "Duplicate or workflow conflict.",
  422: "Validated request failed.",
  429: "Bounded retry or rate limit.",
};

function zodTypeToSchema(key) {
  const raw = key.raw || "";
  const base = { description: raw.slice(0, 200) || undefined };
  const t = key.type || "unknown";
  if (t === "string") return { type: "string", ...base };
  if (t === "string(uuid)") return { type: "string", format: "uuid", ...base };
  if (t === "string(email)") return { type: "string", format: "email", ...base };
  if (t === "string(date-time)") return { type: "string", format: "date-time", ...base };
  if (t === "number") return { type: raw.includes(".int(") ? "integer" : "number", ...base };
  if (t === "boolean") return { type: "boolean", ...base };
  if (t.startsWith("enum[")) {
    const vals = [...t.slice(5, -1).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    return { type: "string", enum: vals, ...base };
  }
  if (t === "array") return { type: "array", items: { type: "object" }, ...base };
  if (t === "object") return { type: "object", ...base };
  if (t.startsWith("ref:")) {
    const name = t.slice(4);
    if (name === "uuid") return { type: "string", format: "uuid", ...base };
    return { type: "string", description: `Validated by the shared zod schema ${name} (see ${key.raw || "source"}).` };
  }
  return { description: `See handler source; zod type could not be reduced mechanically: ${raw.slice(0, 200)}` };
}

function buildOperation(route) {
  const op = {
    summary: route.summary,
    description: route.description,
    tags: [route.tag],
    "x-visibility": route.visibility,
    "x-source": `apps/api/src/${route.source}`,
  };
  // --- security + roles ---
  if (route.visibility === "public" || route.visibility === "gateway-callback") {
    op.security = [];
  } else if (["POST", "PUT", "PATCH", "DELETE"].includes(route.method.toUpperCase())) {
    op.security = [{ session: [], csrf: [] }];
  } else {
    op.security = [{ session: [] }];
  }
  if (route.roles.length) op["x-roles"] = route.roles;
  else if (route.officeActor) op["x-auth-scope"] = "any authenticated office staff member";
  else if (route.usesTenant) op["x-auth-scope"] = "any authenticated tenant member";
  else if (route.visibility !== "public" && route.visibility !== "gateway-callback")
    op["x-auth-scope"] = "any authenticated user";
  // --- rate limits ---
  const limits = [];
  for (const name of route.limiters) {
    if (LIMITERS[name]) limits.push(`${name}: ${LIMITERS[name]}`);
    else if (name === "createRateLimiter") limits.push("inline createRateLimiter (see handler)");
    else limits.push(name);
  }
  if (route.inlineLimit) limits.push(`inline limiter: ${route.inlineLimit.limit} requests per ${route.inlineLimit.windowMs}`);
  if (/^\/api\/v1\/(verify|track)\//.test(route.path)) limits.push(GLOBAL_LIMITS["Public lookups /api/v1/verify/* and /api/v1/track/*"]);
  if (route.method.toUpperCase() === "POST" && /^\/api\/v1\/(auth\/(login|signup|register|forgot-password|recover)|public\/(feedback|subscribe))/.test(route.path))
    limits.push(GLOBAL_LIMITS["Mutations on /api/v1/auth/(login|signup|register|forgot-password|recover) and /api/v1/public/(feedback|subscribe)"]);
  if (route.visibility === "gateway-callback" && route.limiters.includes("callbackLimiter")) { /* already listed */ }
  if (limits.length) op["x-rate-limit"] = limits.join("; ");
  // --- parameters: path + query ---
  const params = [];
  for (const m of route.path.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
    params.push({ name: m[1], in: "path", required: true, schema: { type: "string" }, description: `Path identifier (see ${op["x-source"]}).` });
  }
  const queryKeys = [...(route.queryParams || [])];
  for (const qk of route.queryKeys || []) {
    if (!queryKeys.includes(qk.name)) queryKeys.push(qk.name);
  }
  for (const name of queryKeys) {
    const qk = (route.queryKeys || []).find((k) => k.name === name);
    const schema = { type: "string" };
    let description = "Query filter.";
    if (name === "limit") { schema.type = "integer"; description = "Maximum items to return."; }
    if (name === "serviceNo") { schema.type = "integer"; schema.minimum = 1; schema.maximum = 47; schema.default = 12; description = "Service number (1-47); default 12."; }
    if (name === "status") {
      description = "Filter by status.";
      if (route.path === "/api/v1/owner/account-requests") { schema.enum = ["PENDING", "APPROVED", "REJECTED"]; description = "Filter by request status (default PENDING)."; }
      if (route.path === "/api/v1/owner/office-inclusion-requests") { schema.enum = ["NEW", "CONTACTED", "ACCEPTED", "DECLINED"]; description = "Filter by request status; without it, NEW and CONTACTED are returned."; }
    }
    if (qk) {
      const s = zodTypeToSchema(qk);
      if (s.type) schema.type = s.type;
      if (s.enum) schema.enum = s.enum;
      if (s.format) schema.format = s.format;
    }
    params.push({ name, in: "query", required: false, schema, description });
  }
  if (params.length) op.parameters = params;
  // --- request body (mutations only) ---
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(route.method.toUpperCase());
  if (isMutation && route.bodyKeys && route.bodyKeys.length) {
    const properties = {};
    const required = [];
    for (const k of route.bodyKeys) {
      properties[k.name] = zodTypeToSchema(k);
      if (!k.optional) required.push(k.name);
    }
    const isForm = route.path.includes("/callback/");
    op.requestBody = {
      required: required.length > 0,
      content: {
        [isForm ? "application/x-www-form-urlencoded" : "application/json"]: {
          schema: { type: "object", additionalProperties: false, properties, ...(required.length ? { required } : {}) },
        },
      },
    };
  }
  // --- responses ---
  const success = route.statuses.includes(201) ? 201 : route.statuses.includes(202) ? 202 : 200;
  const responses = {};
  const binary =
    route.path.endsWith("/photo/image") || route.path.endsWith("/certificate-assets/{kind}/image");
  if (binary) {
    responses[String(success)] = {
      description: `Success; binary response (see ${op["x-source"]} for the response contract).`,
      content: { "image/png": { schema: { type: "string", format: "binary" } }, "image/jpeg": { schema: { type: "string", format: "binary" } } },
    };
  } else if (route.path === "/api/v1/office/certificate-assets/preview") {
    responses[String(success)] = {
      description: "Success; sample certificate PDF bytes (nothing is stored, no certificate is issued).",
      content: { "application/pdf": { schema: { type: "string", format: "binary" } } },
    };
  } else if (route.path === "/api/v1/owner/recharges/{id}/proof") {
    responses[String(success)] = {
      description: "Success; deposit-slip image bytes, only after a clean scan.",
      content: { "image/png": { schema: { type: "string", format: "binary" } }, "image/jpeg": { schema: { type: "string", format: "binary" } } },
    };
  } else {
    responses[String(success)] = {
      description:
        success === 201
          ? "Successful response; persistent mutation where applicable."
          : success === 202
            ? "Accepted; delivery/processing is asynchronous."
            : `Success; see ${op["x-source"]} for the response contract.`,
      content: { "application/json": { schema: { type: "object" } } },
    };
  }
  const observed = new Set(route.errorCodes.map((c) => Number(c.split(":")[0])));
  const include = new Set();
  if (route.visibility !== "public" && route.visibility !== "gateway-callback") {
    include.add(401); include.add(403);
  }
  include.add(404); include.add(409); include.add(422);
  if (route.limiters.length || route.inlineLimit || /verify|track/.test(route.path)) include.add(429);
  for (const s of observed) include.add(s);
  include.delete(success);
  for (const s of [...include].sort((a, b) => a - b)) {
    responses[String(s)] = { description: STANDARD_RESPONSES[s] || "Error." };
  }
  op.responses = responses;
  if (route.errorCodes.length) op["x-error-codes"] = route.errorCodes;
  return op;
}

function main() {
  const check = process.argv.includes("--check");
  const api = JSON.parse(fs.readFileSync(SPEC, "utf8"));
  const before = {
    paths: Object.keys(api.paths).length,
    ops: Object.values(api.paths).reduce((n, p) => n + Object.keys(p).filter((k) => !k.startsWith("x-")).length, 0),
  };
  for (const route of ROUTES) {
    api.paths[route.path] ??= {};
    api.paths[route.path][route.method] = buildOperation(route);
  }
  // Backfill x-visibility on pre-existing operations from their security
  // declaration (public = no security, authenticated = session, gateway
  // callback = webhook signature or the bKash browser-return route).
  for (const [p, ops] of Object.entries(api.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      if (method.startsWith("x-") || op["x-visibility"]) continue;
      const names = (op.security || []).flatMap((s) => Object.keys(s));
      if (names.includes("attachmentScanner")) op["x-visibility"] = "internal-only";
      else if (names.includes("webhookSignature") || p === "/api/v1/payments/bkash/callback/{token}") op["x-visibility"] = "gateway-callback";
      else if (names.includes("session")) op["x-visibility"] = "authenticated";
      else op["x-visibility"] = "public";
    }
  }
  // Classify the two internal-only scanner operations (already documented).
  for (const p of ["/api/v1/internal/attachment-scans/claim", "/api/v1/internal/attachment-scans/finish"]) {
    const op = api.paths[p]?.post;
    if (op) {
      op["x-visibility"] = "internal-only";
      op["x-internal"] = true;
      op.tags = ["Internal"];
    }
  }
  if (!api.tags) {
    api.tags = [
      { name: "Auth", description: "Sign-in, sign-up, recovery and session management." },
      { name: "OTP", description: "Mobile one-time codes for sign-up and mobile verification." },
      { name: "MFA & Security", description: "Authenticator (TOTP) protection, recovery codes and account security events." },
      { name: "Identifiers", description: "The caller's own mobile/email sign-in identifiers." },
      { name: "Citizens", description: "Citizen records, profiles, photos and identity documents." },
      { name: "Applications", description: "Service applications and their workflow." },
      { name: "Certificates", description: "Office certificate assets, sample renders and issuance artefacts." },
      { name: "Billing & Orders", description: "Platform billing orders (subscriptions, top-ups) and their gateway payments." },
      { name: "Payments", description: "Application payments, merchant configuration, receipts and reconciliation." },
      { name: "Refunds", description: "Refund requests for verified payments and their gateway handling." },
      { name: "Recharges", description: "Points recharges against bank deposit slips." },
      { name: "Points", description: "Office points balances, prices and ledger adjustments." },
      { name: "Coupons", description: "Office and platform coupon codes." },
      { name: "Notices", description: "Platform notices." },
      { name: "Witness", description: "Public witness attestation." },
      { name: "Admin", description: "Office administration (staff, services, office settings)." },
      { name: "Owner", description: "Platform-owner administration across offices." },
      { name: "Public", description: "Unauthenticated public reads and submissions." },
      { name: "Gateway Callbacks", description: "Payment-gateway return URLs and IPNs. Gateway-only; not client APIs." },
      { name: "Internal", description: "Internal-only operations. Not part of the public API; marked x-internal." },
    ];
  }
  api["x-rate-limits"] = GLOBAL_LIMITS;
  const after = {
    paths: Object.keys(api.paths).length,
    ops: Object.values(api.paths).reduce((n, p) => n + Object.keys(p).filter((k) => !k.startsWith("x-")).length, 0),
  };
  api["x-coverage"] = {
    documentedOperations: after.ops,
    documentedPaths: after.paths,
    generatedBy: "scripts/update-batch-c-openapi.mjs (Batch C / A-001)",
    note: "Counts are spec-side only; live coverage is enforced by scripts/check-openapi-coverage.mjs against the running Express route table.",
  };
  const text = JSON.stringify(api, null, 2) + "\n";
  if (check) {
    const current = fs.readFileSync(SPEC, "utf8");
    if (current !== text) {
      console.error("openapi.json is stale: run node scripts/update-batch-c-openapi.mjs to regenerate it.");
      process.exit(1);
    }
    console.log(`openapi.json is up to date: ${after.ops} operations / ${after.paths} paths.`);
    return;
  }
  fs.writeFileSync(SPEC, text);
  console.log(`openapi.json: ${before.ops} ops / ${before.paths} paths -> ${after.ops} ops / ${after.paths} paths (+${after.ops - before.ops} ops, +${after.paths - before.paths} paths).`);
}

main();
