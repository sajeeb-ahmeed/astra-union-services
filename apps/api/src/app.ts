import express from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import {
  serviceCatalog,
  getServiceSchema,
  getCatalogPreviewSchema,
  validateForm,
  citizenProfileCompleteness,
  applicationProfileGaps,
  completenessLabels,
} from "@astra/shared-schemas";
import { pool, transaction, audit, type DB } from "./db.js";
import {
  digest,
  randomToken,
  checkPassword,
  signature,
  signatureMatches,
} from "./security.js";
import {
  camelRow,
  citizenRow,
  certificateRow,
  ApiError,
  fail,
} from "./models.js";
import { generatePdf, DEMO_TEMPLATE_VERSION } from "./pdf.js";
import { publicManagementRouter, managementRouter } from "./management.js";
import { publicToolsRouter, protectedToolsRouter } from "./portal-tools.js";
import { httpHardening } from "./http-hardening.js";
import { paymentsRouter, publicPaymentsRouter } from "./payments.js";
import {
  attachmentsRouter,
  attachmentScannerRouter,
  decodeUpload,
  validateAttachmentReferences,
} from "./attachments.js";
import { mfaRouter, publicMfaRouter, passwordLogin, sendLogin } from "./mfa.js";
import { identifierDigest, identifiersAvailable, normalizeIdentifier } from "./identifiers.js";
import { identifierRouter } from "./identifier-routes.js";
import {
  citizenDataAvailable,
  citizenDetailColumns,
  citizenDetailsInput,
  decryptNumber,
  duplicateNumberError,
  type CitizenDetails,
} from "./citizen-data.js";
import {
  applicationReferenceExists,
  citizenReferenceExists,
  mintReference,
  parseReferenceInput,
  referenceDigits,
} from "./references.js";
import { dhakaDayMonthStamp } from "./dhaka.js";
import { randomTenDigits } from "./references.js";
import { pointsRouter } from "./points.js";
import { billingRouter, brandingRouter, settleApplicationFee } from "./billing.js";
import {
  couponsRouter,
  publicCouponsRouter,
  platformCouponCode,
  platformCouponDiscount,
  recordCouponRedemption,
} from "./coupons.js";
import { noticesRouter, publicNoticesRouter } from "./notices.js";
import { demandRouter } from "./demand.js";
import {
  certificateAssetsRouter,
  resolveCertificateAssets,
} from "./certificate-assets.js";
import { assertCertificateGates } from "./cert-gates.js";
import { applySubscriptionAction } from "./subscriptions.js";
import { rechargeRouter } from "./recharge.js";
import { merchantRouter } from "./gateways.js";
import { applyOrderSettlement } from "./order-settlement.js";
import {
  orderPaymentsRouter,
  publicOrderPaymentsRouter,
  orderRefundsRouter,
  ownerOrderRefundsRouter,
  orderPaymentsEnabled,
} from "./order-payments.js";
import { merchantSecretsAvailable } from "./sslcommerz.js";
import { refundsRouter } from "./refunds.js";
import { ownerInclusionRouter, publicInclusionRouter } from "./office-inclusion.js";
import { ownerWitnessRouter, publicWitnessRouter } from "./witness.js";
import { operationsRouter } from "./operations.js";
import { otpRouter } from "./otp.js";
import { emailAvailable } from "./mailer.js";
import { publicEmailRouter, emailRouter } from "./email-verification.js";
import {
  notifyCertificateIssued,
  notifyApplicationRejected,
  notifyCertificateRevoked,
  notifyCorrectionRequired,
} from "./status-notifications.js";
import {
  ownerOfficeRegistrationRouter,
  publicOfficeRegistrationRouter,
} from "./office-registration.js";
import {
  ordersRouter,
  applicationOrderInput,
  prepareApplicationOrder,
  saveApplicationOrder,
  getApplicationOrder,
  validateApplicationOrder,
} from "./orders.js";
import {
  geographyRouter,
  geographyInput,
  geographyValues,
  validateGeography,
  validateOfficeJurisdiction,
  validatePayloadGeography,
  payloadGeographyNames,
  citizenAddressParts,
  officeAddressParts,
  presentAddressInput,
  presentAddressValues,
  upgradeLegacyLocation,
  type LocationUpgrade,
} from "./geography.js";
export type Auth = {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  tenantId: string | null;
  csrfToken: string;
  // Phase X: when the account's email address was confirmed (null = unverified).
  emailVerifiedAt: string | null;
};
type Req = express.Request & { auth?: Auth; auditResource?: string };
const uuid = z.string().uuid();
const publicOrigin = process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:5173";
const secretFile = ".runtime/webhook-secret";
if (!process.env.DEMO_WEBHOOK_SECRET && !fs.existsSync(secretFile)) {
  fs.mkdirSync(".runtime", { recursive: true });
  fs.writeFileSync(secretFile, randomToken(), { mode: 0o600 });
}
const webhookSecret =
  process.env.DEMO_WEBHOOK_SECRET ?? fs.readFileSync(secretFile, "utf8").trim();
export const app = express();
app.disable("x-powered-by");
app.use(httpHardening);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});
const wrap =
  (fn: (req: Req, res: express.Response) => Promise<unknown>) =>
  (req: Req, res: express.Response, next: express.NextFunction) => {
    if (req.params.id) req.auditResource = String(req.params.id);
    Promise.resolve(fn(req, res)).catch(next);
  };
const actor = (req: Req) =>
  req.auth ?? fail(401, "LOGIN_REQUIRED", "Sign in required.");
const tenant = (req: Req) =>
  actor(req).tenantId ??
  fail(403, "TENANT_REQUIRED", "An active tenant membership is required.");
function roles(req: Req, allowed: string[]) {
  const a = actor(req);
  if (!allowed.includes(a.role))
    fail(
      403,
      "ROLE_DENIED",
      "This role is not permitted to perform this action.",
    );
  return a;
}
const staffRead = ["staff", "admin", "reviewer", "approver"];
/**
 * Phase 5 (5B): free-text search input is normalized before it reaches ILIKE — Bengali digits fold
 * to ASCII, surrounding whitespace is trimmed and internal runs collapse to one space. Without
 * this, a pasted name with stray or doubled spaces silently matched nothing.
 * Security Audit 01, F8: LIKE metacharacters (\, %, _) are escaped last, so a typed
 * "%" or "_" matches literally instead of widening the pattern. PostgreSQL's LIKE
 * uses the backslash as its default escape character, and the escaped value is
 * always sent as a bound parameter. The result is used only as an ILIKE pattern
 * (and as referenceDigits input, which ignores non-digits).
 */
const normalizeSearchQuery = (raw: string): string =>
  raw
    .replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6))
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\\%_]/g, (c) => `\\${c}`);
async function authorization(db: DB, a: Auth, no: number) {
  const current = await db.query(
    "SELECT 1 FROM approval_authorizations aa JOIN staff_memberships m ON m.tenant_id=aa.tenant_id AND m.user_id=aa.user_id JOIN platform_users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id WHERE aa.tenant_id=$1 AND aa.user_id=$2 AND aa.service_no=$3 AND aa.active AND m.active AND m.role='approver' AND u.active AND t.status='ACTIVE' FOR SHARE OF aa,m,u,t",
    [a.tenantId, a.userId, no],
  );
  if (a.role !== "approver" || !current.rowCount)
    fail(
      403,
      "APPROVAL_AUTHORITY_REQUIRED",
      "An active service-specific approval authorization is required.",
    );
}
async function loadApplication(db: DB, id: string, a: Auth, lock = false) {
  uuid.parse(id);
  const r = (
    await db.query(
      `SELECT a.* FROM applications a JOIN citizens c ON c.id=a.citizen_id AND c.tenant_id=a.tenant_id WHERE a.id=$1 AND a.tenant_id=$2 ${a.role === "citizen" ? "AND c.user_id=$3" : ""} ${lock ? "FOR UPDATE OF a" : ""}`,
      a.role === "citizen" ? [id, a.tenantId, a.userId] : [id, a.tenantId],
    )
  ).rows[0];
  if (!r) fail(404, "NOT_FOUND", "Application not found.");
  return r;
}
async function validateRenewalSource(db: DB, id: string) {
  const source = (
    await db.query(
      "SELECT c.status,l.active FROM renewal_links l JOIN certificates c ON c.id=l.source_certificate_id AND c.tenant_id=l.tenant_id WHERE l.application_id=$1 FOR SHARE OF c",
      [id],
    )
  ).rows[0];
  if (source && (source.status !== "ISSUED" || !source.active))
    fail(
      409,
      "RENEWAL_SOURCE_INVALID",
      "The source certificate is no longer eligible for renewal.",
    );
}
async function validatePayload(
  db: DB,
  no: number,
  payload: any,
  version = 1,
  citizenId?: string,
) {
  if (no < 1 || no > 47)
    fail(422, "SERVICE_UNAVAILABLE", "Select a supported service number.");
  const stored = (
    await db.query(
      "SELECT schema_json FROM service_versions WHERE service_no=$1 AND version=$2",
      [no, version],
    )
  ).rows[0];
  if (!stored || stored.schema_json.stage !== "operational_demo")
    fail(
      422,
      "SCHEMA_UNAVAILABLE",
      "Operational schema version is unavailable.",
    );
  // F-7: the order step records the citizen's certificate-language choice on
  // the payload for every service (ServiceFlow onLanguageChange), but only
  // some form schemas define a delivery_language field. The rest carry the
  // choice on the order snapshot instead (orders.validateLanguage only
  // requires agreement when the payload has the key, and issuance falls back
  // to the snapshot). Drop the key for schema-less services before strict
  // validation so the UI's own submission is not rejected as unknown_field.
  if (
    payload &&
    typeof payload === "object" &&
    Object.hasOwn(payload, "delivery_language") &&
    !stored.schema_json.sections?.some((section: any) =>
      section.fields?.some((field: any) => field.id === "delivery_language"),
    )
  )
    delete payload.delivery_language;
  const validation = validateForm(stored.schema_json, payload);
  if (!validation.valid)
    throw new ApiError(
      422,
      "FORM_INVALID",
      "Please correct the form fields.",
      validation.issues,
    );
  const geographyIssues = await validatePayloadGeography(
    db,
    stored.schema_json,
    payload,
  );
  if (geographyIssues.length)
    throw new ApiError(
      422,
      "FORM_INVALID",
      "Please correct the form fields.",
      geographyIssues,
    );
  await validateAttachmentReferences(db, payload, citizenId ?? "");
  return validation;
}
async function event(
  db: DB,
  r: any,
  a: Auth,
  action: string,
  to: string,
  reason?: string,
) {
  await db.query(
    "INSERT INTO application_events(tenant_id,application_id,actor_id,action,from_state,to_state,reason) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [a.tenantId, r.id, a.userId, action, r.state, to, reason ?? null],
  );
  await audit(
    db,
    a.tenantId!,
    a.userId,
    `APPLICATION_${action.toUpperCase()}`,
    r.id,
    { from: r.state, to },
  );
}
async function settle(body: any, bodyHash: string) {
  const data = z
    .object({
      eventId: z.string().min(8).max(100),
      orderId: uuid,
      tenantId: uuid,
      amountMinor: z.number().int().nonnegative(),
      currency: z.literal("BDT"),
      status: z.literal("SETTLED"),
    })
    .strict()
    .parse(body);
  return transaction(
    data.tenantId,
    async (db) => {
      const order = (
        await db.query(
          "SELECT * FROM payment_orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
          [data.orderId, data.tenantId],
        )
      ).rows[0];
      if (!order) fail(404, "ORDER_NOT_FOUND", "Payment order not found.");
      if (
        order.amount_minor !== data.amountMinor ||
        order.currency !== data.currency
      )
        fail(
          422,
          "SETTLEMENT_MISMATCH",
          "Settlement amount or currency differs from the server order.",
        );
      const prior = (
        await db.query("SELECT * FROM payment_events WHERE event_id=$1", [
          data.eventId,
        ])
      ).rows[0];
      if (prior) {
        if (prior.body_hash !== bodyHash || prior.order_id !== order.id)
          fail(
            409,
            "EVENT_REUSE",
            "Payment event was already used with different content.",
          );
        return { settled: true, replayed: true, orderId: order.id };
      }
      await db.query(
        "INSERT INTO payment_events(event_id,tenant_id,order_id,body_hash) VALUES($1,$2,$3,$4)",
        [data.eventId, data.tenantId, order.id, bodyHash],
      );
      if (order.status === "CANCELLED")
        fail(
          409,
          "ORDER_CANCELLED",
          "This payment order was cancelled by the platform owner.",
        );
      if (order.status === "SETTLED")
        return { settled: true, replayed: true, orderId: order.id };
      await applyOrderSettlement(db, order, order.created_by, "SANDBOX_PAYMENT_SETTLED", {
        credits: order.credits,
      });
      return { settled: true, replayed: false, orderId: order.id };
    },
    true,
  );
}
/**
 * Phase 3A: owner manual settlement. Mirrors the webhook's idempotency
 * discipline — a deterministic `manual:<order>` payment event whose hash binds
 * the settling owner — then runs the exact same applyOrderSettlement effects,
 * so a manual settle grants credits and activates the subscription exactly
 * once, and a repeat call replays without touching state.
 */
async function settleOrderManually(
  orderId: string,
  tenantId: string,
  owner: Auth,
  reason: string,
) {
  return transaction(
    tenantId,
    async (db) => {
      const order = (
        await db.query(
          "SELECT * FROM payment_orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
          [orderId, tenantId],
        )
      ).rows[0];
      if (!order) fail(404, "ORDER_NOT_FOUND", "Payment order not found.");
      if (order.status === "CANCELLED")
        fail(
          409,
          "ORDER_CANCELLED",
          "This payment order was cancelled and can no longer be settled.",
        );
      const eventId = `manual:${order.id}`,
        bodyHash = digest(
          JSON.stringify({
            manual: true,
            orderId: order.id,
            tenantId,
            actorId: owner.userId,
          }),
        );
      const prior = (
        await db.query("SELECT * FROM payment_events WHERE event_id=$1", [
          eventId,
        ])
      ).rows[0];
      if (prior) {
        if (prior.body_hash !== bodyHash || prior.order_id !== order.id)
          fail(
            409,
            "EVENT_REUSE",
            "Payment event was already used with different content.",
          );
        return { settled: true, replayed: true, orderId: order.id };
      }
      await db.query(
        "INSERT INTO payment_events(event_id,tenant_id,order_id,body_hash) VALUES($1,$2,$3,$4)",
        [eventId, tenantId, order.id, bodyHash],
      );
      if (order.status === "SETTLED")
        return { settled: true, replayed: true, orderId: order.id };
      await applyOrderSettlement(
        db,
        order,
        owner.userId,
        "PAYMENT_ORDER_MANUALLY_SETTLED",
        { credits: order.credits, reason, manual: true },
      );
      return { settled: true, replayed: false, orderId: order.id };
    },
    true,
  );
}
async function cancelOrderManually(
  orderId: string,
  tenantId: string,
  owner: Auth,
  reason: string,
) {
  return transaction(
    tenantId,
    async (db) => {
      const order = (
        await db.query(
          "SELECT * FROM payment_orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
          [orderId, tenantId],
        )
      ).rows[0];
      if (!order) fail(404, "ORDER_NOT_FOUND", "Payment order not found.");
      if (order.status === "SETTLED")
        fail(
          409,
          "ORDER_ALREADY_SETTLED",
          "A settled payment order cannot be cancelled.",
        );
      if (order.status === "CANCELLED")
        return { cancelled: true, replayed: true, orderId: order.id };
      await db.query("UPDATE payment_orders SET status='CANCELLED' WHERE id=$1", [
        order.id,
      ]);
      await audit(db, tenantId, owner.userId, "PAYMENT_ORDER_CANCELLED", order.id, {
        reason,
      });
      return { cancelled: true, replayed: false, orderId: order.id };
    },
    true,
  );
}
/**
 * Owner endpoints act across offices while payment_orders sits behind
 * per-tenant RLS, so locate an order's office the same way GET
 * /owner/tenants enumerates offices: one tenant transaction at a time.
 */
async function locateOrderTenant(orderId: string): Promise<string | null> {
  const tenants = (await pool.query("SELECT id FROM tenants ORDER BY slug"))
    .rows;
  for (const t of tenants) {
    const found = await transaction(t.id, async (db) =>
      (
        await db.query("SELECT tenant_id FROM payment_orders WHERE id=$1", [
          orderId,
        ])
      ).rows[0],
    );
    if (found) return t.id;
  }
  return null;
}
app.post(
  "/api/v1/billing/webhook",
  express.raw({ type: "application/json", limit: "16kb" }),
  wrap(async (req, res) => {
    if (
      !Buffer.isBuffer(req.body) ||
      !signatureMatches(
        req.header("X-Demo-Signature"),
        signature(req.body, webhookSecret),
      )
    )
      fail(401, "INVALID_SIGNATURE", "Invalid sandbox webhook signature.");
    const result = await settle(
      JSON.parse(req.body.toString("utf8")),
      digest(req.body),
    );
    res.json(result);
  }),
);
app.use(express.json({ limit: "3mb" }));
app.use("/api/v1", attachmentScannerRouter);
app.use("/api/v1", otpRouter);
app.use("/api/v1", publicEmailRouter);
app.use("/api/v1", brandingRouter);
app.use("/api/v1", publicCouponsRouter);
app.use("/api/v1", publicNoticesRouter);
app.use("/api/v1", publicOfficeRegistrationRouter);
app.use("/api/v1", publicManagementRouter);
app.use("/api/v1", geographyRouter);
app.use("/api/v1", publicToolsRouter);
app.use("/api/v1", publicPaymentsRouter);
app.use("/api/v1", publicOrderPaymentsRouter);
app.use("/api/v1", publicInclusionRouter);
app.use("/api/v1", publicWitnessRouter);
app.get(
  "/api/v1/health",
  wrap(async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      database: "PostgreSQL",
      mode: issuanceMode() === "official" ? "OFFICIAL" : "DEMO_ONLY",
      // Whether each optional server key is in place (true/false only, never a value), so an operator can
      // confirm a deployment without signing in.
      features: {
        signInIdentifiers: identifiersAvailable(),
        citizenIdentityNumbers: citizenDataAvailable(),
        officeMerchantCredentials: merchantSecretsAvailable(),
        // Phase X: whether outbound email (verification + status notifications) is configured.
        emailDelivery: emailAvailable(),
        // Phase 7: whether online subscription/credit order payment is configured.
        orderPayments: await orderPaymentsEnabled(),
      },
      // REG-UX Phase 1 (K3): the office the signup screen preselects, as a default
      // the citizen can change — configured, never hard-coded. A public slug only.
      signup: { defaultOffice: process.env.DEFAULT_SIGNUP_OFFICE_SLUG?.trim() || null },
    });
  }),
);
app.get("/api/v1/services", (_req, res) =>
  res.json({
    items: serviceCatalog.map((s) => ({
      ...s,
      stage: "operational_demo",
    })),
  }),
);
app.get(
  "/api/v1/services/:no/schema",
  wrap(async (req, res) => {
    const no = z.coerce.number().int().min(1).max(47).parse(req.params.no);
    const version = req.query.version
      ? z.coerce.number().int().positive().parse(req.query.version)
      : undefined;
    try {
      res.json(
        req.query.view === "reference"
          ? getCatalogPreviewSchema(no)
          : getServiceSchema(no, version),
      );
    } catch (e) {
      if (e instanceof RangeError)
        fail(
          404,
          "SCHEMA_UNAVAILABLE",
          "Requested schema version is unavailable.",
        );
      throw e;
    }
  }),
);
app.get(
  "/api/v1/verify/:token",
  wrap(async (req, res) => {
    const token = req.params.token;
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
      fail(404, "NOT_FOUND", "Verification record not found.");
    const record = (
      await pool.query("SELECT * FROM public_verify($1)", [digest(token)])
    ).rows[0];
    if (!record) fail(404, "NOT_FOUND", "Verification record not found.");
    res.json(camelRow(record));
  }),
);
app.get(
  "/api/v1/verify/by-number/:number",
  wrap(async (req, res) => {
    // Phase Y: the number printed on official-format documents (Template v7's
    // যাচাইকরণ line). Bangla digits are accepted and normalised; the response
    // is the same limited public record as the QR-token lookup.
    const raw = typeof req.params.number === "string" ? req.params.number : "";
    const number = raw
      .trim()
      .replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)))
      .toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9 -]{3,79}$/.test(number))
      fail(404, "NOT_FOUND", "Verification record not found.");
    // The printed number may be typed plain, grouped with spaces/hyphens,
    // or in Bengali digits (folded above). Try the exact form first
    // (legacy numbers keep their hyphens), then the plain-digit form.
    // CERTNO-DDMM numbers are 14 digits; already-issued CERTNO-01
    // numbers are 16 digits and must keep resolving (nothing renumbers).
    const candidates = [number];
    const digitsOnly = number.replace(/\D/g, "");
    if (digitsOnly.length === 14 || digitsOnly.length === 16) {
      candidates.push(digitsOnly, `DEMO-${digitsOnly}`);
    }
    let record: any;
    let matched = "";
    for (const candidate of candidates) {
      record = (
        await pool.query("SELECT * FROM public_verify_by_number($1)", [candidate])
      ).rows[0];
      if (record) {
        matched = candidate;
        break;
      }
    }
    if (!record) fail(404, "NOT_FOUND", "Verification record not found.");
    // QA-06: a demo-mode number must never verify as a real document, and the
    // verifier gets a masked holder name to compare against the paper.
    const holder = (
      await pool.query("SELECT * FROM public_verify_holder_by_number($1)", [
        matched,
      ])
    ).rows[0];
    res.json({
      ...camelRow(record),
      demo: Boolean(record.demo) || matched.startsWith("DEMO-"),
      holderMaskedBn: holder ? maskName(holder.name_bn) : null,
      holderMaskedEn: holder ? maskName(holder.name_en) : null,
    });
  }),
);
/** QA-06: "রহিম উদ্দিন" -> "র**ম উ***ন": first and last grapheme of each word,
 * so a verifier can match the paper without the full name being published. */
function maskName(name: unknown): string | null {
  if (typeof name !== "string" || !name.trim()) return null;
  const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return name
    .trim()
    .split(/\s+/)
    .map((word) => {
      const g = [...seg.segment(word)].map((s) => s.segment);
      if (g.length <= 2) return g[0] + "*".repeat(g.length - 1);
      return g[0] + "*".repeat(g.length - 2) + g[g.length - 1];
    })
    .join(" ");
}
const loginAttempts = new Map<string, { count: number; expires: number }>();
const identifierAttempts = new Map<string, { count: number; expires: number }>();
app.post(
  "/api/v1/auth/login",
  wrap(async (req, res) => {
    const key = req.ip ?? "local";
    let bucket = loginAttempts.get(key);
    if (!bucket || bucket.expires < Date.now()) {
      bucket = { count: 0, expires: Date.now() + 60000 };
      loginAttempts.set(key, bucket);
    }
    if (++bucket.count > 60)
      fail(
        429,
        "RATE_LIMIT",
        "Too many sign-in attempts. Try again in one minute.",
      );
    // Phase 2b: email (as before) or { identifierType, identifier } for mobile, NID or birth registration.
    const data = z
      .union([
        z
          .object({
            email: z.string().email().max(150),
            password: z.string().min(1).max(200),
          })
          .strict(),
        z
          .object({
            identifierType: z.enum(["email", "mobile", "nid", "birth_reg"]),
            identifier: z.string().min(1).max(150),
            password: z.string().min(1).max(200),
          })
          .strict(),
      ])
      .parse(req.body);
    const kind = "email" in data ? "email" : data.identifierType;
    const normalized = normalizeIdentifier(
      kind,
      "email" in data ? data.email : data.identifier,
    );
    let email = "";
    if (kind === "email") email = normalized ?? "";
    else if (normalized) {
      if (!identifiersAvailable())
        fail(
          503,
          "IDENTIFIERS_UNAVAILABLE",
          "Sign-in with mobile, NID or birth registration is not configured on this server. Use your email.",
        );
      email =
        (
          await pool.query(
            "SELECT u.email FROM account_identifiers i JOIN platform_users u ON u.id=i.user_id WHERE i.kind=$1 AND i.digest=$2",
            [kind, identifierDigest(kind, normalized)],
          )
        ).rows[0]?.email ?? "";
    }
    // Same limit for every identifier kind, keyed by the identifier itself (not only by address).
    const identifierKey = `${kind}:${normalized ?? "invalid"}`;
    let perIdentifier = identifierAttempts.get(identifierKey);
    if (!perIdentifier || perIdentifier.expires < Date.now()) {
      perIdentifier = { count: 0, expires: Date.now() + 300000 };
      identifierAttempts.set(identifierKey, perIdentifier);
      if (identifierAttempts.size > 10000)
        for (const [k, v] of identifierAttempts)
          if (v.expires < Date.now()) identifierAttempts.delete(k);
    }
    // Failed attempts only: ten failures for one identifier pause it for five minutes, whatever its kind.
    if (perIdentifier.count >= 10)
      fail(
        429,
        "RATE_LIMIT",
        "Too many sign-in attempts. Try again in five minutes.",
      );
    let result: Awaited<ReturnType<typeof passwordLogin>>;
    try {
      // An unknown or malformed identifier takes the same path as a wrong password.
      result = await passwordLogin(email || "unknown@invalid.invalid", data.password);
    } catch (error) {
      if (error instanceof ApiError && error.code === "INVALID_LOGIN") perIdentifier.count++;
      throw error;
    }
    identifierAttempts.delete(identifierKey);
    if (result.challenge) res.json(result.challenge);
    else sendLogin(res, result.session!);
  }),
);
app.use("/api/v1", publicMfaRouter);
// QAFIX-09 (B3): /auth/me for a request carrying NO session cookie
// is answered anonymously (200, user: null) instead of 401. Public
// pages probe it on every load to attempt session restore, and a
// logged-out visitor is not an error — the 401 was console noise
// on every public page view. BUNDLE06-R5 D3 keeps the probe
// itself (a browser can hold a valid cookie with no client-side
// trace, so restore must ask), but it need not fail. A request
// WITH a cookie falls through to the auth middleware and the
// handler below: an invalid or inactive session still 401s,
// which the client's session-drop logic depends on.
app.get("/api/v1/auth/me", (req, res, next) => {
  const hasSessionCookie = (req.headers.cookie ?? "")
    .split(";")
    .map((x) => x.trim())
    .some((x) => x.startsWith("astra_session=") && x.length > 14);
  if (hasSessionCookie) return next();
  res.json({ user: null, tenant: null, csrfToken: null, anonymous: true });
});
app.use(
  "/api/v1",
  (req: Req, res: express.Response, next: express.NextFunction) => {
    (async () => {
      const token = req.headers.cookie
        ?.split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("astra_session="))
        ?.slice(14);
      if (!token) fail(401, "LOGIN_REQUIRED", "Sign in required.");
      const result = (
        await pool.query(
          "SELECT s.*,u.email,u.display_name,u.active,u.platform_role,u.email_verified_at,m.role,m.active membership_active,t.status tenant_status FROM sessions s JOIN platform_users u ON u.id=s.user_id LEFT JOIN staff_memberships m ON m.user_id=s.user_id AND m.tenant_id=s.tenant_id LEFT JOIN tenants t ON t.id=s.tenant_id WHERE s.token_hash=$1 AND s.expires_at>now()",
          [digest(token)],
        )
      ).rows[0];
      if (
        !result ||
        !result.active ||
        (result.tenant_id &&
          (!result.membership_active || result.tenant_status !== "ACTIVE"))
      )
        fail(
          401,
          "SESSION_INACTIVE",
          "This session or tenant membership is inactive.",
        );
      req.auth = {
        userId: result.user_id,
        email: result.email,
        displayName: result.display_name,
        role: result.role ?? result.platform_role,
        tenantId: result.tenant_id,
        csrfToken: result.csrf_token,
        emailVerifiedAt: result.email_verified_at
          ? new Date(result.email_verified_at).toISOString()
          : null,
      };
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        if (req.header("X-CSRF-Token") !== result.csrf_token)
          fail(403, "CSRF_REQUIRED", "A valid session CSRF token is required.");
        if (req.header("Origin") && req.header("Origin") !== publicOrigin)
          fail(403, "ORIGIN_DENIED", "Request origin is not allowed.");
      }
    })().then(() => next(), next);
  },
);
app.use("/api/v1", managementRouter);
app.use("/api/v1", emailRouter);
app.use("/api/v1", mfaRouter);
app.use("/api/v1", identifierRouter);
app.use("/api/v1", ownerOfficeRegistrationRouter);
app.use("/api/v1", protectedToolsRouter);
app.use("/api/v1", ordersRouter);
app.use("/api/v1", pointsRouter);
app.use("/api/v1", billingRouter);
app.use("/api/v1", couponsRouter);
app.use("/api/v1", noticesRouter);
app.use("/api/v1", demandRouter);
app.use("/api/v1", certificateAssetsRouter);
app.use("/api/v1", rechargeRouter);
app.use("/api/v1", merchantRouter);
app.use("/api/v1", refundsRouter);
app.use("/api/v1", ownerInclusionRouter);
app.use("/api/v1", ownerWitnessRouter);
app.use("/api/v1", operationsRouter);
app.use("/api/v1", paymentsRouter);
app.use("/api/v1", orderPaymentsRouter);
app.use("/api/v1", orderRefundsRouter);
app.use("/api/v1", ownerOrderRefundsRouter);
app.use("/api/v1", attachmentsRouter);
app.get(
  "/api/v1/auth/me",
  wrap(async (req, res) => {
    const a = actor(req);
    res.json({
      user: {
        id: a.userId,
        email: a.email,
        displayName: a.displayName,
        role: a.role,
        tenantId: a.tenantId,
        // Phase X: whether the account's email address has been verified (never a sign-in gate).
        emailVerified: a.emailVerifiedAt !== null,
        emailVerifiedAt: a.emailVerifiedAt,
      },
      tenant: a.tenantId
        ? camelRow(
            (
              await pool.query("SELECT * FROM tenants WHERE id=$1", [
                a.tenantId,
              ])
            ).rows[0],
          )
        : null,
      csrfToken: a.csrfToken,
    });
  }),
);
app.post(
  "/api/v1/auth/logout",
  wrap(async (req, res) => {
    const a = actor(req);
    await pool.query(
      "UPDATE sessions SET expires_at=now() WHERE user_id=$1 AND csrf_token=$2",
      [a.userId, a.csrfToken],
    );
    res.setHeader(
      "Set-Cookie",
      "astra_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    );
    res.json({ ok: true });
  }),
);
/** Phase 3b: the citizen with profile completeness under this office's rules. */
async function completenessFor(db: DB, citizenId: string) {
  const citizen = citizenRow((await db.query("SELECT * FROM citizens WHERE id=$1", [citizenId])).rows[0]);
  const office = (
    await db.query("SELECT division_code,require_complete_profile FROM tenants WHERE id=nullif(current_setting('astra.tenant_id',true),'')::uuid")
  ).rows[0];
  return {
    citizen,
    profileCompleteness: {
      ...citizenProfileCompleteness(citizen, { geographyRequired: !!office?.division_code }),
      enforced: !!office?.require_complete_profile,
    },
  };
}
/** Phase 3a: apply personal/identity details to one citizen of this office; numbers are encrypted. */
async function updateCitizenDetails(db: DB, tenantId: string, citizenId: string, details: CitizenDetails) {
  const columns = citizenDetailColumns(details, tenantId);
  const names = Object.keys(columns);
  if (!names.length) return (await db.query("SELECT * FROM citizens WHERE id=$1", [citizenId])).rows[0];
  const assignments = names.map((column, index) => column + "=$" + (index + 3)).join(",");
  await db.query("SAVEPOINT citizen_details");
  try {
    const row = (
      await db.query(
        "UPDATE citizens SET " + assignments + " WHERE tenant_id=$1 AND id=$2 RETURNING *",
        [tenantId, citizenId, ...names.map((column) => columns[column])],
      )
    ).rows[0];
    await db.query("RELEASE SAVEPOINT citizen_details");
    return row;
  } catch (error) {
    await db.query("ROLLBACK TO SAVEPOINT citizen_details");
    duplicateNumberError(error);
  }
}
/** The citizen of this office the caller may act on: any for office staff, only their own for a citizen. */
async function reachableCitizen(db: DB, a: Auth, id: string, columns: string) {
  const own = a.role === "citizen";
  const row = (
    await db.query(
      "SELECT " + columns + " FROM citizens WHERE tenant_id=$1 AND id=$2" + (own ? " AND user_id=$3" : ""),
      own ? [a.tenantId, id, a.userId] : [a.tenantId, id],
    )
  ).rows[0];
  if (!row) fail(404, "NOT_FOUND", "Citizen not found.");
  return row;
}
app.patch(
  "/api/v1/citizens/:id/details",
  wrap(async (req, res) => {
    const a = roles(req, ["staff", "admin", "citizen"]);
    const id = uuid.parse(req.params.id);
    const details = citizenDetailsInput.parse(req.body);
    const item = await transaction(tenant(req), async (db) => {
      await reachableCitizen(db, a, id, "id");
      const row = await updateCitizenDetails(db, a.tenantId!, id, details);
      await audit(db, a.tenantId!, a.userId, "CITIZEN_DETAILS_UPDATED", id, { fields: Object.keys(details) });
      return citizenRow(row);
    });
    res.json(item);
  }),
);
/**
 * REG-UX Phase 1 (§2.3): profile completion for a short-signup account. Fills the
 * deferred items — second-script name, date of birth, permanent address and the
 * citizen's own ward — and only where the value is still empty (fill-only): a value
 * already on record is never rewritten here, so data a certificate may already carry
 * cannot be changed through this path.
 */
const profileCompletionInput = z
  .object({
    nameBn: z.string().trim().min(2, "নাম কমপক্ষে ২ অক্ষরের হতে হবে। / Name must be at least 2 characters.").max(120),
    nameEn: z.string().trim().min(2, "Name must be at least 2 characters. / নাম কমপক্ষে ২ অক্ষরের হতে হবে।").max(120),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "জন্ম তারিখ দিন। / Enter a date of birth.")
      .refine(
        (v) =>
          Number.isFinite(Date.parse(v)) &&
          new Date(v).toISOString().slice(0, 10) === v &&
          v <= new Date().toISOString().slice(0, 10) &&
          v >= "1900-01-01",
        "জন্ম তারিখ আজকের বা তার আগের হতে হবে। / Date of birth must be today or earlier.",
      ),
    addressBn: z.string().trim().min(4, "ঠিকানা কমপক্ষে ৪ অক্ষরের হতে হবে। / Address must be at least 4 characters.").max(500),
    addressEn: z.string().trim().min(4, "Address must be at least 4 characters. / ঠিকানা কমপক্ষে ৪ অক্ষরের হতে হবে।").max(500),
    geography: geographyInput,
  })
  .partial()
  .strict();
app.patch(
  "/api/v1/citizens/:id/profile",
  wrap(async (req, res) => {
    const a = roles(req, ["staff", "admin", "citizen"]);
    const id = uuid.parse(req.params.id);
    const input = profileCompletionInput.parse(req.body);
    const item = await transaction(tenant(req), async (db) => {
      const current = await reachableCitizen(db, a, id, "*");
      const office = (
        await db.query("SELECT * FROM tenants WHERE id=$1", [a.tenantId])
      ).rows[0];
      const sets: string[] = [];
      const values: unknown[] = [];
      const fill = (column: string, value: unknown) => {
        if (value === undefined) return;
        if (current[column] !== null && current[column] !== undefined && current[column] !== "")
          throw new ApiError(
            409,
            "PROFILE_VALUE_PRESENT",
            "এই তথ্যটি আগে থেকেই আছে; পরিবর্তনের জন্য অফিসে যোগাযোগ করুন। / This value is already on record; contact the office to change it.",
            undefined,
            column,
          );
        values.push(value);
        sets.push(column + "=$" + (values.length + 2));
      };
      fill("full_name_bn", input.nameBn);
      fill("full_name_en", input.nameEn);
      fill("date_of_birth", input.dateOfBirth);
      fill("address_bn", input.addressBn);
      fill("address_en", input.addressEn);
      if (input.geography) {
        if (current.ward_code)
          throw new ApiError(
            409,
            "PROFILE_VALUE_PRESENT",
            "ওয়ার্ড আগে থেকেই দেওয়া আছে। / The ward is already on record.",
            undefined,
            "geography",
          );
        await validateGeography(db, input.geography, "citizen");
        validateOfficeJurisdiction(office, input.geography);
        const [division, district, upazila, union, ward] = geographyValues(input.geography);
        for (const [column, value] of [
          ["division_code", division],
          ["district_code", district],
          ["upazila_code", upazila],
          ["union_code", union],
          ["ward_code", ward],
        ] as const) {
          values.push(value);
          sets.push(column + "=$" + (values.length + 2));
        }
      }
      if (!sets.length) return citizenRow(current);
      const row = (
        await db.query(
          "UPDATE citizens SET " + sets.join(",") + " WHERE tenant_id=$1 AND id=$2 RETURNING *",
          [a.tenantId, id, ...values],
        )
      ).rows[0];
      await audit(db, a.tenantId!, a.userId, "CITIZEN_PROFILE_COMPLETED", id, {
        fields: Object.keys(input),
      });
      return citizenRow(row);
    });
    res.json(item);
  }),
);
/**
 * Phase 3c: link an uploaded private attachment of this citizen as their NID or birth-registration image, or
 * unlink it with null. The upload itself goes through POST /attachments and its quarantine scan.
 */
app.put(
  "/api/v1/citizens/:id/identity-document",
  wrap(async (req, res) => {
    const a = roles(req, ["staff", "admin", "citizen"]);
    const id = uuid.parse(req.params.id);
    const input = z
      .object({
        document: z.object({ attachmentId: uuid, kind: z.enum(["nid", "birth_reg"]) }).strict().nullable(),
      })
      .strict()
      .parse(req.body).document;
    const item = await transaction(tenant(req), async (db) => {
      await reachableCitizen(db, a, id, "id");
      if (input) {
        const owned = (
          await db.query("SELECT 1 FROM attachments WHERE tenant_id=$1 AND citizen_id=$2 AND id=$3", [
            a.tenantId,
            id,
            input.attachmentId,
          ])
        ).rowCount;
        if (!owned) fail(404, "ATTACHMENT_NOT_FOUND", "Upload the document for this citizen first.");
      }
      const row = (
        await db.query(
          "UPDATE citizens SET identity_document_id=$3,identity_document_kind=$4 WHERE tenant_id=$1 AND id=$2 RETURNING *",
          [a.tenantId, id, input?.attachmentId ?? null, input?.kind ?? null],
        )
      ).rows[0];
      await audit(
        db,
        a.tenantId!,
        a.userId,
        input ? "CITIZEN_IDENTITY_DOCUMENT_LINKED" : "CITIZEN_IDENTITY_DOCUMENT_REMOVED",
        id,
        input ?? {},
      );
      return citizenRow(row);
    });
    res.json(item);
  }),
);
/**
 * CERTNO-01: the citizen's optional photo, stored on the citizen record
 * (migration 051) and printed on certificates only when present. The upload is
 * validated by the attachments pipeline's decoder (magic bytes + 2 MiB cap),
 * restricted to PNG/JPEG like the office certificate assets.
 */
app.put(
  "/api/v1/citizens/:id/photo",
  wrap(async (req, res) => {
    const a = roles(req, ["staff", "admin", "citizen"]);
    const id = uuid.parse(req.params.id);
    const input = z
      .object({
        mimeType: z.enum(["image/png", "image/jpeg"]),
        base64: z.string().min(1).max(3_000_000),
      })
      .strict()
      .parse(req.body);
    const bytes = decodeUpload(input);
    const item = await transaction(tenant(req), async (db) => {
      await reachableCitizen(db, a, id, "id");
      const row = (
        await db.query(
          "UPDATE citizens SET photo=$3,photo_mime=$4,photo_updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
          [a.tenantId, id, bytes, input.mimeType],
        )
      ).rows[0];
      await audit(db, a.tenantId!, a.userId, "CITIZEN_PHOTO_UPDATED", id, {
        mimeType: input.mimeType,
        bytes: bytes.length,
      });
      return citizenRow(row);
    });
    res.json(item);
  }),
);
app.delete(
  "/api/v1/citizens/:id/photo",
  wrap(async (req, res) => {
    const a = roles(req, ["staff", "admin", "citizen"]);
    const id = uuid.parse(req.params.id);
    const item = await transaction(tenant(req), async (db) => {
      await reachableCitizen(db, a, id, "id");
      const row = (
        await db.query(
          "UPDATE citizens SET photo=NULL,photo_mime=NULL,photo_updated_at=NULL WHERE tenant_id=$1 AND id=$2 RETURNING *",
          [a.tenantId, id],
        )
      ).rows[0];
      await audit(db, a.tenantId!, a.userId, "CITIZEN_PHOTO_REMOVED", id, {});
      return citizenRow(row);
    });
    res.json(item);
  }),
);
app.get(
  "/api/v1/citizens/:id/photo/image",
  wrap(async (req, res) => {
    const a = roles(req, [...staffRead, "citizen"]);
    const id = uuid.parse(req.params.id);
    const photo = await transaction(tenant(req), async (db) => {
      const r = await reachableCitizen(db, a, id, "photo,photo_mime");
      if (!r.photo) fail(404, "NOT_FOUND", "This citizen has no photo.");
      return r;
    });
    res.setHeader("Cache-Control", "no-store");
    res.type(photo.photo_mime).send(Buffer.from(photo.photo));
  }),
);
app.get(
  "/api/v1/citizens/:id/identity",
  wrap(async (req, res) => {
    const a = roles(req, [...staffRead, "citizen"]);
    const id = uuid.parse(req.params.id);
    const numbers = await transaction(tenant(req), async (db) => {
      const r = await reachableCitizen(db, a, id, "nid_cipher,birth_reg_cipher");
      // Reading the full numbers is recorded, like other access to personal data.
      await audit(db, a.tenantId!, a.userId, "CITIZEN_IDENTITY_VIEWED", id);
      return {
        nid: r.nid_cipher ? decryptNumber(r.nid_cipher, a.tenantId!, "nid") : null,
        birthReg: r.birth_reg_cipher ? decryptNumber(r.birth_reg_cipher, a.tenantId!, "birth_reg") : null,
      };
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...numbers, available: citizenDataAvailable() });
  }),
);
app.get(
  "/api/v1/citizens",
  wrap(async (req, res) => {
    const a = roles(req, [...staffRead, "citizen"]);
    // Phase 5 (5B): the query is normalized (whitespace/Bengali digits) and matches the Bangla
    // name, the English name, the reference and the contact mobile. The reference also matches in
    // digits-only form, so the grouped Phase 5 reference can be pasted with or without hyphens.
    const q = normalizeSearchQuery(String(req.query.q ?? "").slice(0, 100));
    const digits = referenceDigits(q);
    // WS-D3: real pagination for the citizens register. No page/pageSize in
    // the query keeps the previous behaviour (first 100 rows); a page
    // request honours pageSize (1–100) so the register can be browsed past
    // the first page instead of stopping at an unexplained cap.
    const page = z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
    const pageSize = z.coerce.number().int().min(1).max(100).default(100).parse(req.query.pageSize);
    const { items, total } = await transaction(tenant(req), async (db) => {
      const nameParam = a.role === "citizen" ? "$3" : "$2";
      const digitsParam = a.role === "citizen" ? "$4" : "$3";
      const filter = `WHERE tenant_id=$1 ${a.role === "citizen" ? "AND user_id=$2" : ""} AND (full_name_bn ILIKE ${nameParam} OR full_name_en ILIKE ${nameParam} OR synthetic_reference ILIKE ${nameParam} OR contact_mobile ILIKE ${nameParam} OR (${digitsParam}::text IS NOT NULL AND replace(synthetic_reference,'-','') ILIKE ${digitsParam}))`;
      const params =
        a.role === "citizen"
          ? [a.tenantId, a.userId, `%${q}%`, digits ? `%${digits}%` : null]
          : [a.tenantId, `%${q}%`, digits ? `%${digits}%` : null];
      const limitParam = `$${params.length + 1}`;
      const offsetParam = `$${params.length + 2}`;
      return {
        items: (
          await db.query(
            `SELECT * FROM citizens ${filter} ORDER BY created_at DESC LIMIT ${limitParam} OFFSET ${offsetParam}`,
            [...params, pageSize, (page - 1) * pageSize],
          )
        ).rows.map(citizenRow),
        // Phase 1: the dashboard shows the real count, not the length of this 100-row page.
        total: (
          await db.query(`SELECT count(*)::int n FROM citizens ${filter}`, params)
        ).rows[0].n as number,
      };
    });
    res.json({ items, total, page, pageSize });
  }),
);
app.post(
  "/api/v1/citizens",
  wrap(async (req, res) => {
    const a = roles(req, ["staff", "admin", "citizen"]);
    const data = z
      .object({
        nameBn: z.string().min(2).max(120),
        nameEn: z.string().min(2).max(120),
        dateOfBirth: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine(
            (value) =>
              Number.isFinite(Date.parse(value)) &&
              new Date(value).toISOString().slice(0, 10) === value,
            "A valid ISO calendar date is required.",
          )
          // QA-16: no future or implausible birth dates.
          .refine(
            (value) =>
              value <= new Date().toISOString().slice(0, 10) &&
              value >= "1900-01-01",
            "জন্ম তারিখ আজকের বা তার আগের হতে হবে। / Date of birth must be today or earlier.",
          ),
        addressBn: z.string().min(4).max(500),
        addressEn: z.string().min(4).max(500),
        syntheticReference: z
          .string()
          .regex(/^REF-[A-Za-z0-9-]{3,50}$/)
          .optional(),
        geography: geographyInput.optional(),
        presentAddress: presentAddressInput.optional(),
        details: citizenDetailsInput.optional(),
      })
      .strict()
      .parse(req.body);
    const item = await transaction(tenant(req), async (db) => {
      const office = (
        await db.query("SELECT * FROM tenants WHERE id=$1", [a.tenantId])
      ).rows[0];
      if (office.division_code && !data.geography)
        fail(
          400,
          "GEOGRAPHY_REQUIRED",
          "Select an address hierarchy for this participating office.",
        );
      if (data.geography) {
        await validateGeography(db, data.geography, "citizen");
        validateOfficeJurisdiction(office, data.geography);
      }
      if (
        a.role === "citizen" &&
        (await db.query("SELECT 1 FROM citizens WHERE user_id=$1", [a.userId]))
          .rowCount
      )
        fail(409, "PROFILE_EXISTS", "This account already has a profile.");
      // CERTNO-01: a citizen created without an explicit reference gets the new 16-digit
      // public reference (Asia/Dhaka registration date + 8 random digits, uniqueness-checked).
      // Caller-supplied REF-… references and all previously issued references are unchanged.
      const citizenId = randomUUID();
      const syntheticReference =
        data.syntheticReference ??
        (await mintReference(citizenReferenceExists(db, a.tenantId!)));
      const r = (
        await db.query(
          "INSERT INTO citizens(id,tenant_id,user_id,full_name_bn,full_name_en,date_of_birth,address_bn,address_en,synthetic_reference,division_code,district_code,upazila_code,union_code,ward_code,present_same_as_permanent,present_address_bn,present_address_en,present_division_code,present_district_code,present_upazila_code,present_union_code,present_ward_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *",
          [
            citizenId,
            a.tenantId,
            a.role === "citizen" ? a.userId : null,
            data.nameBn,
            data.nameEn,
            data.dateOfBirth,
            data.addressBn,
            data.addressEn,
            syntheticReference,
            ...geographyValues(data.geography),
            ...(await presentAddressValues(db, data.presentAddress)),
          ],
        )
      ).rows[0];
      await audit(db, a.tenantId!, a.userId, "DEMO_CITIZEN_REGISTERED", r.id, {
        verification: "SYNTHETIC_DEMO",
      });
      if (data.details)
        return citizenRow(await updateCitizenDetails(db, a.tenantId!, r.id, data.details));
      return citizenRow(r);
    });
    res.status(201).json(item);
  }),
);
/** Phase 6c: inclusive YYYY-MM-DD bounds for list filters; validated before they reach SQL. */
export const dateRange = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v).optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "The start date must not be after the end date." });
app.get(
  "/api/v1/applications",
  wrap(async (req, res) => {
    const a = roles(req, [...staffRead, "citizen"]);
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(100000)
      .default(1)
      .parse(req.query.page);
    const pageSize = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(100)
      .parse(req.query.pageSize);
    // Phase 5 (5B/5C): same query normalization as the citizen search, and the Phase 5
    // application reference matches in grouped or digits-only form.
    const search = normalizeSearchQuery(
      z.string().max(100).default("").parse(req.query.q),
    );
    const searchDigits = referenceDigits(search);
    const state = req.query.state
      ? z
          .enum([
            "DRAFT",
            "SUBMITTED",
            "UNDER_REVIEW",
            "CORRECTION_REQUIRED",
            "RESUBMITTED",
            "APPROVED",
            "ISSUED",
            "REJECTED",
            "CANCELLED",
            "REVOKED",
          ])
          .parse(req.query.state)
      : null;
    const no = req.query.serviceNo
      ? z.coerce.number().int().min(1).max(47).parse(req.query.serviceNo)
      : null;
    // WS-D1 (r10-live fix phase): the list's default order is the submission
    // date, newest first — the old `updated_at DESC` order moved a row every
    // time its state changed, so the order changed between visits (live QA
    // finding 20). `sort` re-queries in the requested order; every order
    // ends in the id so ties are deterministic and stable across visits.
    const sort = z
      .enum(["newest", "oldest", "status", "service", "reference"])
      .default("newest")
      .parse(req.query.sort ?? undefined);
    const orderBy =
      sort === "oldest"
        ? "a.created_at ASC,a.id ASC"
        : sort === "status"
          ? "a.state ASC,a.created_at DESC,a.id DESC"
          : sort === "service"
            ? "a.service_no ASC,a.created_at DESC,a.id DESC"
            : sort === "reference"
              ? "a.reference ASC NULLS LAST,a.created_at DESC,a.id DESC"
              : "a.created_at DESC,a.id DESC";
    // Phase 6c: an optional date range (Asia/Dhaka calendar days, inclusive) and a renewals-only filter.
    const range = dateRange.parse({ from: req.query.from, to: req.query.to });
    const renewalOnly = req.query.renewal === "true";
    const result = await transaction(tenant(req), async (db) => {
      const values: unknown[] = [
        a.tenantId,
        state,
        no,
        a.role === "citizen" ? a.userId : null,
        `%${search}%`,
        searchDigits ? `%${searchDigits}%` : null,
      ];
      // Security Audit 01, F7: the (already Zod-validated) range bounds are bound
      // as parameters like every other value, never interpolated into the SQL text.
      let rangeFilter = "";
      if (range.from) {
        values.push(range.from);
        rangeFilter += ` AND (a.created_at AT TIME ZONE 'Asia/Dhaka')::date >= $${values.length}::date`;
      }
      if (range.to) {
        values.push(range.to);
        rangeFilter += ` AND (a.created_at AT TIME ZONE 'Asia/Dhaka')::date <= $${values.length}::date`;
      }
      const from = `FROM applications a JOIN citizens c ON c.id=a.citizen_id AND c.tenant_id=a.tenant_id LEFT JOIN certificates cert ON cert.tenant_id=a.tenant_id AND cert.application_id=a.id WHERE a.tenant_id=$1 AND ($2::text IS NULL OR a.state=$2) AND ($3::int IS NULL OR a.service_no=$3) AND ($4::uuid IS NULL OR c.user_id=$4) AND (a.id::text ILIKE $5 OR a.reference ILIKE $5 OR ($6::text IS NOT NULL AND replace(a.reference,'-','') ILIKE $6) OR c.full_name_bn ILIKE $5 OR c.full_name_en ILIKE $5 OR c.synthetic_reference ILIKE $5 OR ($6::text IS NOT NULL AND replace(c.synthetic_reference,'-','') ILIKE $6) OR c.contact_mobile ILIKE $5)${rangeFilter}${renewalOnly ? " AND EXISTS(SELECT 1 FROM renewal_links l WHERE l.tenant_id=a.tenant_id AND l.application_id=a.id)" : ""}`;
      const items = (
        await db.query(
          // WS-D1: certificate_issued_at feeds the issued rows' chip (the
          // waiting chip must never render on an issued row); the join is
          // 1:0/1 (UNIQUE tenant_id,application_id), so the count below
          // is unaffected.
          `SELECT a.*,cert.issued_at AS certificate_issued_at,EXISTS(SELECT 1 FROM renewal_links l WHERE l.tenant_id=a.tenant_id AND l.application_id=a.id) AS is_renewal ${from} ORDER BY ${orderBy} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, pageSize, (page - 1) * pageSize],
        )
      ).rows.map(camelRow);
      const total = (
        await db.query(`SELECT count(*)::int total ${from}`, values)
      ).rows[0].total;
      return { items, total, page, pageSize };
    });
    res.json(result);
  }),
);
app.get(
  "/api/v1/applications/counts",
  wrap(async (req, res) => {
    // CHAIRMAN-DASH-01: per-state application counts for the caller's own office,
    // feeding the Pending applications queue. Office roles only — a citizen never
    // sees office-wide figures. The tenant transaction applies forced RLS, and the
    // explicit tenant predicate keeps the count scoped even if policies change.
    // CORRECTION_REQUIRED is deliberately NOT part of either pending group: after a
    // correction request the next move is the citizen's, not the office's.
    const a = roles(req, staffRead);
    const { byState: counts, oldestPendingAt } = await transaction(tenant(req), async (db) => {
      const rows = (
        await db.query(
          "SELECT state, count(*)::int AS count FROM applications WHERE tenant_id=$1 GROUP BY state",
          [a.tenantId],
        )
      ).rows as { state: string; count: number }[];
      const byState: Record<string, number> = {
        DRAFT: 0,
        SUBMITTED: 0,
        UNDER_REVIEW: 0,
        CORRECTION_REQUIRED: 0,
        RESUBMITTED: 0,
        APPROVED: 0,
        ISSUED: 0,
        REJECTED: 0,
        CANCELLED: 0,
        REVOKED: 0,
      };
      for (const row of rows) byState[row.state] = row.count;
      // WS-D3: the dashboard's ageing figure — the oldest still-pending
      // application's submission time, from this same counts read so the
      // number agrees with the pending queue and the sidebar badge.
      const oldest = (
        await db.query(
          "SELECT min(created_at) AS oldest FROM applications WHERE tenant_id=$1 AND state IN ('SUBMITTED','RESUBMITTED','UNDER_REVIEW','APPROVED')",
          [a.tenantId],
        )
      ).rows[0]?.oldest as Date | null;
      return { byState, oldestPendingAt: oldest ? oldest.toISOString() : null };
    });
    res.json({
      counts,
      awaitingReview:
        counts.SUBMITTED + counts.RESUBMITTED + counts.UNDER_REVIEW,
      // ISSUANCE_PENDING is not a state in the current state machine (migration
      // 001 CHECK); it is counted defensively should it ever be introduced.
      awaitingIssuance:
        counts.APPROVED + (counts.ISSUANCE_PENDING ?? 0),
      oldestPendingAt,
    });
  }),
);
app.post(
  "/api/v1/applications",
  wrap(async (req, res) => {
    const a = roles(req, ["staff", "admin", "citizen"]);
    const data = z
      .object({
        citizenId: uuid,
        serviceNo: z.number().int(),
        payload: z.record(z.string(), z.unknown()),
        order: applicationOrderInput.optional(),
      })
      .strict()
      .parse(req.body);
    const result = await transaction(tenant(req), async (db) => {
      const citizen = (
        await db.query(
          `SELECT * FROM citizens WHERE id=$1 AND tenant_id=$2 ${a.role === "citizen" ? "AND user_id=$3" : ""}`,
          a.role === "citizen"
            ? [data.citizenId, a.tenantId, a.userId]
            : [data.citizenId, a.tenantId],
        )
      ).rows[0];
      if (!citizen) fail(404, "NOT_FOUND", "Citizen not found.");
      // REG-UX Phase 1 (§2.3): a short-signup profile is completed at the first
      // application, not at signup. Only the deferred items are required here; the
      // full-profile issuance gate (require_complete_profile) is unchanged.
      const officeGeo = (
        await db.query("SELECT division_code FROM tenants WHERE id=$1", [a.tenantId])
      ).rows[0];
      const gaps = applicationProfileGaps(citizenRow(citizen), {
        geographyRequired: !!officeGeo?.division_code,
      });
      if (gaps.length)
        throw new ApiError(
          409,
          "PROFILE_INCOMPLETE",
          "আবেদনের আগে প্রোফাইলের বাকি তথ্য দিন: " +
            gaps.map((item) => completenessLabels[item].bn).join(", ") +
            " / Complete your profile before applying: " +
            gaps.map((item) => completenessLabels[item].en).join(", ") +
            ".",
          { missing: gaps },
        );
      const schemaVersion = getServiceSchema(
        z.number().int().min(1).max(47).parse(data.serviceNo),
      ).version;
      await validatePayload(
        db,
        data.serviceNo,
        data.payload,
        schemaVersion,
        data.citizenId,
      );
      const sv = (
        await db.query(
          "SELECT * FROM service_versions WHERE service_no=$1 AND version=$2",
          [data.serviceNo, schemaVersion],
        )
      ).rows[0];
      if (
        !(
          await db.query(
            "SELECT 1 FROM tenant_service_configuration WHERE tenant_id=$1 AND service_no=$2 AND enabled",
            [a.tenantId, data.serviceNo],
          )
        ).rowCount
      )
        fail(
          422,
          "SERVICE_DISABLED",
          "Service is not enabled for this tenant.",
        );
      const order = await prepareApplicationOrder(
        db,
        a.tenantId!,
        data.serviceNo,
        data.order,
        data.payload,
      );
      // CERTNO-01: every new application carries the public 16-digit reference
      // (Asia/Dhaka submission date + 8 random digits, uniqueness-checked). The UUID id
      // remains the internal key; previously created applications keep their reference
      // (or NULL) and stay reachable by UUID.
      const reference = await mintReference(applicationReferenceExists(db));
      const r = (
        await db.query(
          "INSERT INTO applications(tenant_id,citizen_id,service_no,schema_version,schema_hash,created_by,order_mode,reference) VALUES($1,$2,$3,$6,$4,$5,$7,$8) RETURNING *",
          [
            a.tenantId,
            data.citizenId,
            data.serviceNo,
            sv.schema_hash,
            a.userId,
            schemaVersion,
            order ? "POLICY" : "LEGACY",
            reference,
          ],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO application_payload_versions(tenant_id,application_id,version,payload,payload_hash,actor_id) VALUES($1,$2,1,$3,$4,$5)",
        [
          a.tenantId,
          r.id,
          JSON.stringify(data.payload),
          digest(stablePayload(data.payload)),
          a.userId,
        ],
      );
      await saveApplicationOrder(db, a.tenantId!, r.id, data.serviceNo, order);
      await event(db, { ...r, state: null }, a, "create", "DRAFT");
      return camelRow(r);
    });
    res.status(201).json(result);
  }),
);
app.get(
  "/api/v1/applications/lookup",
  wrap(async (req, res) => {
    const a = roles(req, [...staffRead, "citizen"]);
    const input = z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[^\u0000-\u001f\u007f]+$/)
      .safeParse(req.query.reference);
    if (!input.success)
      fail(
        400,
        "INPUT_INVALID",
        "Provide an exact application or certificate reference.",
      );
    const result = await transaction(tenant(req), async (db) => {
      // Phase 5 (5C): the Phase 5 public reference resolves here too, typed grouped or as
      // plain digits; UUID ids and certificate numbers keep working unchanged.
      const publicReference = parseReferenceInput(input.data);
      const row = (
        await db.query(
          `SELECT a.id,a.service_no,a.state,cert.id certificate_id,cert.number certificate_number,cert.status certificate_status
           FROM applications a
           JOIN citizens c ON c.id=a.citizen_id AND c.tenant_id=a.tenant_id
           LEFT JOIN certificates cert ON cert.application_id=a.id AND cert.tenant_id=a.tenant_id
           WHERE a.tenant_id=$1 AND (a.id::text=lower($2) OR upper(cert.number)=upper($2) OR ($4::text IS NOT NULL AND a.reference=$4))
             AND ($3::uuid IS NULL OR c.user_id=$3)`,
          [
            a.tenantId,
            input.data,
            a.role === "citizen" ? a.userId : null,
            publicReference,
          ],
        )
      ).rows[0];
      if (!row) fail(404, "NOT_FOUND", "Application not found.");
      return {
        application: {
          id: row.id,
          serviceNo: row.service_no,
          state: row.state,
        },
        certificate: row.certificate_id
          ? {
              id: row.certificate_id,
              number: row.certificate_number,
              status: row.certificate_status,
            }
          : null,
      };
    });
    res.json(result);
  }),
);
app.get(
  "/api/v1/applications/:id",
  wrap(async (req, res) => {
    const a = roles(req, [...staffRead, "citizen"]);
    const result = await transaction(tenant(req), async (db) => {
      const r = await loadApplication(db, String(req.params.id), a);
      const versions = (
        await db.query(
          "SELECT version,payload,payload_hash,created_at FROM application_payload_versions WHERE application_id=$1 ORDER BY version",
          [r.id],
        )
      ).rows.map(camelRow);
      return {
        application: camelRow(r),
        order: await getApplicationOrder(db, r.id),
        serviceConfiguration: camelRow(
          (
            await db.query(
              "SELECT enabled,credit_cost FROM tenant_service_configuration WHERE service_no=$1",
              [r.service_no],
            )
          ).rows[0],
        ),
        payload: versions.at(-1)?.payload,
        versions,
        events: (
          await db.query(
            "SELECT action,from_state,to_state,reason,created_at FROM application_events WHERE application_id=$1 ORDER BY created_at",
            [r.id],
          )
        ).rows.map(camelRow),
        ...(await completenessFor(db, r.citizen_id)),
        certificate: certificateRow(
          (
            await db.query(
              "SELECT * FROM certificates WHERE application_id=$1",
              [r.id],
            )
          ).rows[0],
        ),
        renewal: camelRow(
          (
            await db.query(
              "SELECT l.source_certificate_id,c.number source_number,c.application_id source_application_id,l.active FROM renewal_links l JOIN certificates c ON c.id=l.source_certificate_id AND c.tenant_id=l.tenant_id WHERE l.application_id=$1",
              [r.id],
            )
          ).rows[0],
        ),
        // QA-14: tell the approver UI whether this user may decide this
        // service, so it can hide decision buttons instead of letting the
        // click fail with APPROVAL_AUTHORITY_REQUIRED.
        canApprove:
          a.role === "approver" &&
          (
            await db.query(
              "SELECT 1 FROM approval_authorizations WHERE tenant_id=$1 AND user_id=$2 AND service_no=$3 AND active",
              [a.tenantId, a.userId, r.service_no],
            )
          ).rowCount! > 0,
      };
    });
    res.json(result);
  }),
);
app.post(
  "/api/v1/applications/:id/renew",
  wrap(async (req, res) => {
    const a = roles(req, ["citizen", "staff", "admin"]),
      id = uuid.parse(req.params.id),
      d = z
        .object({
          payload: z.record(z.string(), z.unknown()).optional(),
          order: applicationOrderInput.optional(),
        })
        .strict()
        .parse(req.body ?? {});
    const result = await transaction(
      tenant(req),
      async (db) => {
        const parent = await loadApplication(db, id, a, true);
        const cert = (
          await db.query(
            "SELECT * FROM certificates WHERE application_id=$1 AND status='ISSUED' FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (parent.state !== "ISSUED" || !cert)
          fail(
            409,
            "RENEWAL_SOURCE_INVALID",
            "Renewal requires an issued, unrevoked certificate belonging to this applicant and office.",
          );
        if (
          (
            await db.query(
              "SELECT 1 FROM renewal_links WHERE source_certificate_id=$1 AND active",
              [cert.id],
            )
          ).rowCount
        )
          fail(
            409,
            "RENEWAL_EXISTS",
            "This certificate already has an active renewal; continue that application.",
          );
        if (
          !(
            await db.query(
              "SELECT 1 FROM tenant_service_configuration WHERE service_no=$1 AND enabled",
              [parent.service_no],
            )
          ).rowCount
        )
          fail(422, "SERVICE_DISABLED", "Service is disabled.");
        const original = (
          await db.query(
            "SELECT payload FROM application_payload_versions WHERE application_id=$1 AND version=$2",
            [id, parent.approved_version],
          )
        ).rows[0].payload;
        const carried = { ...(d.payload ?? original) };
        if (parent.service_no === 42) {
          carried.has_previous_license = true;
          carried.previous_license_number = cert.number;
        }
        // B5: a parent pinned to an older schema renews on the latest version when its payload can be
        // carried over (old location text mapped to org_location only on exact dataset matches);
        // otherwise it renews on its own, still-published version with the payload unchanged.
        const latestVersion = getServiceSchema(parent.service_no).version;
        let payload = carried,
          schemaVersion = latestVersion,
          locationUpgrade: LocationUpgrade = "NONE";
        if (parent.schema_version < latestVersion) {
          const upgrade = await upgradeLegacyLocation(
            db,
            parent.service_no,
            carried,
          );
          locationUpgrade = upgrade.status;
          let latestError: unknown = null;
          if (upgrade.status !== "UNRESOLVED")
            try {
              // QAFIX-01: the purpose pair (purpose_bn/purpose_en) became a
              // single `purpose` + `purpose_language`. Carry the citizen's
              // own words over — Bangla first, the product is Bangla-first —
              // so a pre-QAFIX application can still renew onto the current
              // form instead of staying pinned to the old one forever.
              const migrated = { ...upgrade.payload };
              if (
                migrated.purpose === undefined &&
                (typeof migrated.purpose_bn === "string" ||
                  typeof migrated.purpose_en === "string")
              ) {
                const bnText =
                  typeof migrated.purpose_bn === "string" &&
                  migrated.purpose_bn.trim()
                    ? migrated.purpose_bn
                    : undefined;
                migrated.purpose = bnText ?? migrated.purpose_en;
                migrated.purpose_language = bnText ? "bn" : "en";
                delete migrated.purpose_bn;
                delete migrated.purpose_en;
              }
              // QAFIX-10 (service 27): v5 removed the free-text purpose
              // pair — the fixed passport_purpose select is the only
              // purpose asked now. A v4 payload carried over with the
              // pair would fail v5 validation as unknown_field and pin
              // the renewal to v4 forever; drop the removed pair so the
              // renewal can land on v5 (the select value carries over;
              // the new identity fields must still be supplied — the
              // pinned fallback below keeps it on v4 when they are
              // missing, nothing is invented).
              if (parent.service_no === 27) {
                delete migrated.purpose;
                delete migrated.purpose_language;
              }
              await validatePayload(
                db,
                parent.service_no,
                migrated,
                latestVersion,
                parent.citizen_id,
              );
              payload = migrated;
            } catch (error) {
              if (!(error instanceof ApiError && error.code === "FORM_INVALID"))
                throw error;
              latestError = error;
            }
          if (upgrade.status === "UNRESOLVED" || latestError) {
            try {
              await validatePayload(
                db,
                parent.service_no,
                carried,
                parent.schema_version,
                parent.citizen_id,
              );
            } catch (pinnedError) {
              throw latestError ?? pinnedError;
            }
            payload = carried;
            schemaVersion = parent.schema_version;
          }
        } else
          await validatePayload(
            db,
            parent.service_no,
            payload,
            schemaVersion,
            parent.citizen_id,
          );
        const order = await prepareApplicationOrder(
          db,
          a.tenantId!,
          parent.service_no,
          d.order,
          payload,
        );
        const schema = (
          await db.query(
            "SELECT schema_hash FROM service_versions WHERE service_no=$1 AND version=$2",
            [parent.service_no, schemaVersion],
          )
        ).rows[0];
        // CERTNO-01: a renewal is a new application and gets its own fresh 16-digit
        // public reference (Asia/Dhaka submission date + 8 random digits).
        const renewalReference = await mintReference(applicationReferenceExists(db));
        const child = (
          await db.query(
            "INSERT INTO applications(tenant_id,citizen_id,service_no,schema_version,schema_hash,created_by,order_mode,reference) VALUES($1,$2,$3,$6,$4,$5,$7,$8) RETURNING *",
            [
              a.tenantId,
              parent.citizen_id,
              parent.service_no,
              schema.schema_hash,
              a.userId,
              schemaVersion,
              order ? "POLICY" : "LEGACY",
              renewalReference,
            ],
          )
        ).rows[0];
        await db.query(
          "INSERT INTO application_payload_versions(tenant_id,application_id,version,payload,payload_hash,actor_id) VALUES($1,$2,1,$3,$4,$5)",
          [
            a.tenantId,
            child.id,
            JSON.stringify(payload),
            digest(stablePayload(payload)),
            a.userId,
          ],
        );
        await saveApplicationOrder(
          db,
          a.tenantId!,
          child.id,
          parent.service_no,
          order,
        );
        await db.query(
          "INSERT INTO renewal_links(tenant_id,application_id,source_certificate_id) VALUES($1,$2,$3)",
          [a.tenantId, child.id, cert.id],
        );
        await event(
          db,
          { ...child, state: null },
          a,
          "renew",
          "DRAFT",
          `Renews ${cert.number}`,
        );
        return {
          ...camelRow(child),
          sourceCertificateId: cert.id,
          locationUpgrade,
        };
      },
      true,
    );
    res.status(201).json(result);
  }),
);
app.patch(
  "/api/v1/applications/:id",
  wrap(async (req, res) => {
    const a = roles(req, ["staff", "admin", "citizen"]);
    const data = z
      .object({ payload: z.record(z.string(), z.unknown()) })
      .strict()
      .parse(req.body);
    const result = await transaction(tenant(req), async (db) => {
      const r = await loadApplication(db, String(req.params.id), a, true);
      if (!["DRAFT", "CORRECTION_REQUIRED"].includes(r.state))
        fail(
          409,
          "STATE_CONFLICT",
          "This application cannot be edited in its current state.",
        );
      await validatePayload(
        db,
        r.service_no,
        data.payload,
        r.schema_version,
        r.citizen_id,
      );
      await validateApplicationOrder(db, r, data.payload);
      const version = r.latest_version + 1;
      await db.query(
        "INSERT INTO application_payload_versions(tenant_id,application_id,version,payload,payload_hash,actor_id) VALUES($1,$2,$3,$4,$5,$6)",
        [
          a.tenantId,
          r.id,
          version,
          JSON.stringify(data.payload),
          digest(stablePayload(data.payload)),
          a.userId,
        ],
      );
      const next = (
        await db.query(
          "UPDATE applications SET latest_version=$2,updated_at=now() WHERE id=$1 RETURNING *",
          [r.id, version],
        )
      ).rows[0];
      await event(db, r, a, "edit", r.state);
      return camelRow(next);
    });
    res.json(result);
  }),
);
/**
 * Phase W (owner decision, 16 Nov 2026): there is no secretary step. The citizen applies, and the
 * Chairman (approver) verifies the submitted application himself: his approval IS the issuance —
 * one action that approves and issues atomically. The separate POST /issue endpoint remains only
 * as the completion path for applications whose approval was recorded while an issuance gate was
 * closed (order payment outstanding, incomplete profile, disabled service, revoked renewal
 * source). Those gates keep the exact failure semantics the old two-step flow had: the decision
 * stands, nothing is issued.
 *
 * Phase 3B (billing model, 18 Nov 2026): issuance no longer touches money at all. The platform
 * fee is settled once at the application's first submit (see billing.ts), so the old issuance
 * gates SUBSCRIPTION_INACTIVE / INSUFFICIENT_CREDITS / POINTS_INSUFFICIENT are gone: an active
 * subscription is not required to issue, and neither wallet is debited here.
 */
const DECISION_STATES = ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"];
const APPROVE_STATES = [...DECISION_STATES, "APPROVED"];
const ISSUANCE_GATE_CODES = new Set([
  "ORDER_PAYMENT_REQUIRED",
  "PROFILE_INCOMPLETE",
  "RENEWAL_SOURCE_INVALID",
  "SERVICE_DISABLED",
  // CERT-REFINE-01 gates (cert-gates.ts): the approval is recorded and the
  // issuance completes later via /issue once the blocker is resolved.
  "SIGNATURE_MISSING",
  "AMOUNTS_REQUIRED",
  "LANGUAGE_VALUE_MISSING",
]);
async function prepareIssuance(
  a: Auth,
  id: string,
  states: string[],
  stateMessage: string,
) {
  return transaction(a.tenantId!, async (db) => {
    const r = await loadApplication(db, id, a);
    await authorization(db, a, r.service_no);
    const existing = (
      await db.query("SELECT * FROM certificates WHERE application_id=$1", [
        id,
      ])
    ).rows[0];
    if (existing) return { existing };
    if (
      !states.includes(r.state) ||
      (r.state === "APPROVED" && r.approved_version !== r.latest_version)
    )
      fail(409, "APPROVAL_REQUIRED", stateMessage);
    await validateApplicationOrder(db, r, undefined, true);
    await validateRenewalSource(db, r.id);
    const payload = (
      await db.query(
        "SELECT payload FROM application_payload_versions WHERE application_id=$1 AND version=$2",
        [id, r.latest_version],
      )
    ).rows[0].payload;
    await validateAttachmentReferences(db, payload, r.citizen_id, true);
    const schema = (
      await db.query(
        "SELECT schema_json FROM service_versions WHERE service_no=$1 AND version=$2",
        [r.service_no, r.schema_version],
      )
    ).rows[0].schema_json;
    const tenant = (
      await db.query("SELECT * FROM tenants WHERE id=$1", [a.tenantId])
    ).rows[0];
    const citizen = (
      await db.query("SELECT * FROM citizens WHERE id=$1", [r.citizen_id])
    ).rows[0];
    const renewal = (
      await db.query(
        "SELECT c.number FROM renewal_links l JOIN certificates c ON c.id=l.source_certificate_id AND c.tenant_id=l.tenant_id WHERE l.application_id=$1",
        [r.id],
      )
    ).rows[0]?.number;
    // Phase Y (template 7): everything the official-format document prints
    // beyond the v6 field set — the issuing Chairman, the order total, the
    // citizen's printable identity number and resolved address geography.
    const issuerRow = (
      await db.query(
        "SELECT u.display_name,u.name_bn,m.account_type FROM platform_users u LEFT JOIN staff_memberships m ON m.user_id=u.id AND m.tenant_id=$2 WHERE u.id=$1",
        [a.userId, a.tenantId],
      )
    ).rows[0];
    // CERT-REFINE-02 (R2-03): Bangla certificates print the approver's
    // Bangla name; when it is missing the document falls back to the Latin
    // name. In official mode that is a data defect — warn loudly at
    // issuance/render time so the office completes the profile.
    if (
      process.env.ISSUANCE_MODE === "official" &&
      issuerRow &&
      !String(issuerRow.name_bn ?? "").trim()
    ) {
      console.warn(
        `[CERT-REFINE-02 R2-03] approver ${a.userId} (tenant ${a.tenantId}) has no Bangla name (name_bn) — Bangla certificates will fall back to the Latin name "${issuerRow.display_name}".`,
      );
    }
    const orderRow = (
      await db.query(
        "SELECT total_minor,certificate_language FROM application_order_snapshots WHERE application_id=$1",
        [id],
      )
    ).rows[0];
    // Integration fix (Phase Y limitation 3): certificate language is read from
    // payload.delivery_language, but services whose form schema has no
    // delivery_language field (e.g. #42 trade licence) can never carry the
    // citizen's choice there — orders only require the two to agree when the
    // payload has one. Fall back to the order snapshot's certificate_language
    // so an EN order renders an EN document.
    const issuancePayload =
      payload &&
      typeof payload === "object" &&
      !Object.hasOwn(payload, "delivery_language") &&
      orderRow?.certificate_language
        ? { ...payload, delivery_language: orderRow.certificate_language }
        : payload;
    let identity: { nid?: string | null; birthReg?: string | null } = {};
    if (citizenDataAvailable() && (citizen.nid_cipher || citizen.birth_reg_cipher)) {
      try {
        identity = {
          nid: citizen.nid_cipher
            ? decryptNumber(citizen.nid_cipher, a.tenantId!, "nid")
            : null,
          birthReg: citizen.birth_reg_cipher
            ? decryptNumber(citizen.birth_reg_cipher, a.tenantId!, "birth_reg")
            : null,
        };
      } catch {
        identity = {};
      }
    }
    const pdfExtras = {
      issuedAt: new Date().toISOString(),
      issuer: {
        nameBn: issuerRow?.name_bn ?? null,
        nameEn: issuerRow?.display_name ?? null,
        accountType: issuerRow?.account_type ?? null,
      },
      order: orderRow
        ? { totalMinor: Number(orderRow.total_minor), renewal: !!renewal }
        : null,
      identity,
      citizenGeography: await citizenAddressParts(db, citizen, tenant),
      officeGeography: await officeAddressParts(db, tenant),
      // CERTASSETS-01: the office's uploaded profile artwork (logo, seal,
      // signature) resolved inside this tenant transaction; Template v7
      // prefers it over the legacy filesystem drop-ins.
      assets: await resolveCertificateAssets(db, a.tenantId!),
      // CERTNO-01: the citizen's optional photo (migration 051), as a data URL
      // for the templates. NULL photo → null here → the templates print
      // nothing at all in the photo position.
      citizenPhoto:
        citizen.photo && citizen.photo_mime
          ? `data:${citizen.photo_mime};base64,${Buffer.from(citizen.photo).toString("base64")}`
          : null,
    };
    return {
      r,
      tenant,
      service: (
        await db.query("SELECT * FROM service_catalog WHERE service_no=$1", [
          r.service_no,
        ])
      ).rows[0],
      citizen,
      payload: issuancePayload,
      schema,
      geographyNames: await payloadGeographyNames(db, schema, issuancePayload),
      renewal,
      pdfExtras,
    };
  });
}
/** Offices that enforce it issue only for a complete citizen profile (Phase 3b check, unchanged). */
function assertProfileComplete(prepared: any) {
  if (!prepared.tenant.require_complete_profile) return;
  const completeness = citizenProfileCompleteness(citizenRow(prepared.citizen), {
    geographyRequired: !!prepared.tenant.division_code,
  });
  if (!completeness.complete) {
    throw new ApiError(
      409,
      "PROFILE_INCOMPLETE",
      "The citizen profile is incomplete: " +
        completeness.missing.map((item) => completenessLabels[item].en).join(", ") +
        ". Complete it before issuing.",
      { missing: completeness.missing, percent: completeness.percent },
    );
  }
}
async function finalizeIssuance(
  a: Auth,
  id: string,
  meta: {
    certId: string;
    token: string;
    number: string;
    verificationUrl: string;
    pdf: Buffer;
    pdfEn: Buffer;
  },
  opts: {
    states: string[];
    stateMessage: string;
    recordApproval: boolean;
    testFailure?: string | null;
  },
) {
  return transaction(
    a.tenantId!,
    async (db) => {
      const r = await loadApplication(db, id, a, true);
      await authorization(db, a, r.service_no);
      const existing = (
        await db.query("SELECT * FROM certificates WHERE application_id=$1", [
          id,
        ])
      ).rows[0];
      if (existing) return certificateRow(existing);
      if (
        !opts.states.includes(r.state) ||
        (r.state === "APPROVED" && r.approved_version !== r.latest_version)
      )
        fail(409, "APPROVAL_REQUIRED", opts.stateMessage);
      await validateApplicationOrder(db, r, undefined, true);
      await validateRenewalSource(db, r.id);
      const currentPayload = (
        await db.query(
          "SELECT payload FROM application_payload_versions WHERE application_id=$1 AND version=$2",
          [id, r.latest_version],
        )
      ).rows[0].payload;
      await validateAttachmentReferences(db, currentPayload, r.citizen_id, true);
      // Phase 3B: no money moves at issuance — the fee was settled at submit (billing.ts) and
      // no subscription is required here. The only money-adjacent gate left is that the office
      // still offers the service at all.
      const config = (
        await db.query(
          "SELECT credit_cost FROM tenant_service_configuration WHERE tenant_id=$1 AND service_no=$2 AND enabled",
          [a.tenantId, r.service_no],
        )
      ).rows[0];
      if (!config) fail(422, "SERVICE_DISABLED", "Service is disabled.");
      const c = (
        await db.query(
          "INSERT INTO certificates(id,tenant_id,application_id,number,service_no,token_hash,pdf,pdf_en,issued_by,template_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
          [
            meta.certId,
            a.tenantId,
            id,
            meta.number,
            r.service_no,
            digest(meta.token),
            meta.pdf,
            meta.pdfEn,
            a.userId,
            DEMO_TEMPLATE_VERSION,
          ],
        )
      ).rows[0];
      // Phase 3B: the issuance-time credit debit and point deduction are retired — the
      // application's fee was settled once at submit. The injected failure point keeps its
      // historical name; it still proves the whole issuance transaction rolls back.
      if (
        process.env.NODE_ENV === "test" &&
        opts.testFailure === "after-debit"
      )
        throw new Error("Injected issuance transaction failure");
      const recordApproval = opts.recordApproval && r.state !== "APPROVED";
      await db.query(
        "UPDATE applications SET state='ISSUED',updated_at=now(),approved_by=CASE WHEN $3 THEN $2 ELSE approved_by END,approved_version=CASE WHEN $3 THEN latest_version ELSE approved_version END WHERE id=$1",
        [id, a.userId, recordApproval],
      );
      if (recordApproval) await event(db, r, a, "approve", "APPROVED");
      await event(
        db,
        recordApproval ? { ...r, state: "APPROVED" } : r,
        a,
        "issue",
        "ISSUED",
      );
      await db.query(
        "INSERT INTO outbox_events(tenant_id,kind,resource_id) VALUES($1,'DEMO_CERTIFICATE_ISSUED',$2)",
        [a.tenantId, c.id],
      );
      // The only time the plaintext verification URL leaves the server outside the PDF.
      return certificateRow(c, meta.verificationUrl);
    },
    true,
  );
}
/**
 * When an issuance gate blocks the Chairman's approval, the decision itself is still recorded
 * (state APPROVED with the approve event), exactly as the old approve-then-issue flow behaved;
 * only the issuance waits. Non-gate failures (validation, authorization, crashes) record nothing.
 */
async function recordApprovalOnGate(a: Auth, id: string) {
  await transaction(a.tenantId!, async (db) => {
    const r = await loadApplication(db, id, a, true);
    if (!DECISION_STATES.includes(r.state)) return;
    await db.query(
      "UPDATE applications SET state='APPROVED',approved_by=$2,approved_version=latest_version,updated_at=now() WHERE id=$1",
      [r.id, a.userId],
    );
    await event(db, r, a, "approve", "APPROVED");
  });
}
/** The Chairman's single decision action: approve and issue in one atomic step. */
/**
 * Certificate numbers: the DEMO- prefix belongs to the demonstration system
 * only. In official mode (owner instruction, 16 Nov 2026: production output
 * carries no demo wording of any kind) the number is the plain year + the
 * unguessable certificate fragment, as printed on Template v7 documents.
 */
/**
 * CERTNO-DDMM (owner order, 25 Nov 2026 — supersedes CERTNO-01's format):
 * the certificate number is 14 digits — the Asia/Dhaka issue day+month
 * (DDMM) followed by 10 cryptographically random digits — stored as 14
 * consecutive digits. Certificate numbers must NEVER be duplicated:
 * uniqueness is enforced by certificates_number_key (migration 001,
 * re-asserted by migration 063) and issuance retries with a fresh number
 * when the insert reports a collision (see issueWithFreshNumber).
 * Test/demo mode keeps the DEMO- marker so a sandbox document can never be
 * mistaken for an official one. Existing records keep their numbers
 * (16-digit CERTNO-01 numbers still verify) — nothing renumbers.
 * Exported for the CERTNO-DDMM format test.
 */
export function newCertificateNumber(): string {
  const digits = `${dhakaDayMonthStamp()}${randomTenDigits()}`;
  return process.env.ISSUANCE_MODE === "official" ? digits : `DEMO-${digits}`;
}

/**
 * CERTNO-01 bilingual issuance: ONE issuance, ONE number, ONE QR — the Bangla
 * render is stored in certificates.pdf and the English render in
 * certificates.pdf_en. The payload's own delivery_language is overridden per
 * render so both languages are always produced.
 */
async function renderCertificatePair(
  prepared: any,
  number: string,
  verificationUrl: string,
) {
  const base = {
    number,
    verificationUrl,
    tenant: prepared.tenant,
    service: prepared.service,
    citizen: prepared.citizen,
    schema: prepared.schema,
    geographyNames: prepared.geographyNames,
    renewalNumber: prepared.renewal,
    ...prepared.pdfExtras,
  };
  const pdf = await generatePdf({
    ...base,
    payload: { ...prepared.payload, delivery_language: "bn" },
  });
  const pdfEn = await generatePdf({
    ...base,
    payload: { ...prepared.payload, delivery_language: "en" },
  });
  return { pdf, pdfEn };
}

/**
 * Run `fn` until it succeeds, retrying ONLY a certificate-number collision
 * (PostgreSQL 23505 on certificates_number_key). Bounded: after
 * `maxAttempts` collisions it gives up with the clear error
 * CERTIFICATE_NUMBER_GENERATION_FAILED (CERTNO-DDMM: numbers are never
 * duplicated — a collision regenerates, never reuses). Any other failure
 * propagates immediately. Exported for the collision test, which drives
 * it with synthetic 23505 failures.
 */
export async function retryOnCertificateNumberCollision<T>(
  fn: (attempt: number) => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error: any) {
      const isNumberCollision =
        error?.code === "23505" &&
        error?.constraint === "certificates_number_key";
      if (isNumberCollision && attempt < maxAttempts - 1) continue;
      if (isNumberCollision)
        throw new Error("CERTIFICATE_NUMBER_GENERATION_FAILED");
      throw error;
    }
  }
}

/**
 * Mint a number, render both languages and finalise; on a number collision
 * regenerate the number and re-render — the number is printed on the
 * document, so a retry must render again. Any other failure propagates.
 */
async function issueWithFreshNumber(
  a: Auth,
  id: string,
  prepared: any,
  opts: {
    states: string[];
    stateMessage: string;
    recordApproval: boolean;
    testFailure?: string | null;
  },
) {
  const certId = randomUUID(),
    token = randomToken();
  const verificationUrl = `${publicOrigin}/verify/${token}`;
  return retryOnCertificateNumberCollision(async () => {
    const number = newCertificateNumber();
    const { pdf, pdfEn } = await renderCertificatePair(
      prepared,
      number,
      verificationUrl,
    );
    const certificate = await finalizeIssuance(
      a,
      id,
      { certId, token, number, verificationUrl, pdf, pdfEn },
      opts,
    );
    return { certificate, number };
  });
}
async function approveAndIssue(req: Req, a: Auth, id: string) {
  try {
    const prepared = await prepareIssuance(
      a,
      id,
      APPROVE_STATES,
      "Approval requires a submitted application.",
    );
    if (prepared.existing) {
      const application = await transaction(a.tenantId!, async (db) =>
        camelRow(await loadApplication(db, id, a)),
      );
      return { ...application, certificate: certificateRow(prepared.existing) };
    }
    assertProfileComplete(prepared);
    assertCertificateGates(prepared);
    const { certificate, number } = await issueWithFreshNumber(a, id, prepared, {
      states: APPROVE_STATES,
      stateMessage: "Approval requires a submitted application.",
      recordApproval: true,
      testFailure: req.header("X-Test-Failure"),
    });
    const application = await transaction(a.tenantId!, async (db) =>
      camelRow(await loadApplication(db, id, a)),
    );
    // Phase X: the issuance has committed — tell the citizen by email and status SMS too
    // (the in-app issuance notification was written inside finalizeIssuance).
    await notifyCertificateIssued({
      tenantId: a.tenantId!,
      applicationId: id,
      certificateNumber: number,
    });
    return { ...application, certificate };
  } catch (error) {
    if (error instanceof ApiError && ISSUANCE_GATE_CODES.has(error.code))
      await recordApprovalOnGate(a, id).catch(() => undefined);
    throw error;
  }
}
app.post(
  "/api/v1/applications/:id/transition",
  wrap(async (req, res) => {
    const a = actor(req);
    roles(req, [...staffRead, "citizen"]);
    const data = z
      .object({
        action: z.enum([
          "submit",
          "request_correction",
          "resubmit",
          "approve",
          "reject",
          "cancel",
          "summon",
        ]),
        reason: z.string().trim().min(3).max(500).optional(),
      })
      .strict()
      .parse(req.body);
    // Phase W: the Chairman's approval performs issuance atomically (see approveAndIssue).
    if (data.action === "approve") {
      res.json(await approveAndIssue(req, a, String(req.params.id)));
      return;
    }
    const result = await transaction(tenant(req), async (db) => {
      const r = await loadApplication(db, String(req.params.id), a, true);
      let next: string;
      if (["submit", "resubmit"].includes(data.action)) {
        const payload = (
          await db.query(
            "SELECT payload FROM application_payload_versions WHERE application_id=$1 AND version=$2",
            [r.id, r.latest_version],
          )
        ).rows[0].payload;
        await validateApplicationOrder(db, r, payload);
      }
      switch (data.action) {
        case "submit":
          roles(req, ["citizen", "staff", "admin"]);
          if (r.state !== "DRAFT")
            fail(409, "STATE_CONFLICT", "Submit requires a draft.");
          next = "SUBMITTED";
          break;
        case "resubmit":
          roles(req, ["citizen", "staff", "admin"]);
          if (r.state !== "CORRECTION_REQUIRED")
            fail(
              409,
              "STATE_CONFLICT",
              "Resubmit requires a correction request.",
            );
          next = "RESUBMITTED";
          break;
        case "request_correction":
          // Phase W: the Chairman asks for corrections himself; there is no reviewer step.
          roles(req, ["approver"]);
          if (!DECISION_STATES.includes(r.state))
            fail(
              409,
              "STATE_CONFLICT",
              "Correction requires a submitted application.",
            );
          if (!data.reason)
            fail(422, "REASON_REQUIRED", "A correction reason is required.");
          next = "CORRECTION_REQUIRED";
          break;
        case "summon":
          // Phase 6a/W: the Chairman may ask the applicant to appear before deciding. The
          // application stays in its submitted state; the note (when and where to come) is
          // shown to the applicant.
          await authorization(db, a, r.service_no);
          if (!DECISION_STATES.includes(r.state))
            fail(
              409,
              "STATE_CONFLICT",
              "Summoning the applicant requires a submitted application.",
            );
          if (!data.reason)
            fail(422, "REASON_REQUIRED", "Say when and where the applicant should come.");
          next = r.state;
          break;
        case "reject":
          // Phase W: only the Chairman rejects (the reviewer/secretary no longer decides).
          roles(req, ["approver"]);
          if (!DECISION_STATES.includes(r.state))
            fail(
              409,
              "STATE_CONFLICT",
              "Rejection requires a submitted application.",
            );
          if (!data.reason)
            fail(422, "REASON_REQUIRED", "A rejection reason is required.");
          next = "REJECTED";
          break;
        case "cancel":
          roles(req, ["citizen", "staff", "admin"]);
          if (!["DRAFT", "SUBMITTED", "CORRECTION_REQUIRED"].includes(r.state))
            fail(409, "STATE_CONFLICT", "Application cannot be cancelled now.");
          if (!data.reason)
            fail(422, "REASON_REQUIRED", "A cancellation reason is required.");
          next = "CANCELLED";
          break;
        default:
          // "approve" is intercepted before this transaction (it issues atomically).
          fail(409, "STATE_CONFLICT", "Unsupported application action.");
      }
      if (["submit", "resubmit"].includes(data.action)) {
        const payload = (
          await db.query(
            "SELECT payload FROM application_payload_versions WHERE application_id=$1 AND version=$2",
            [r.id, r.latest_version],
          )
        ).rows[0].payload;
        await validateAttachmentReferences(db, payload, r.citizen_id, true);
      }
      // Phase 3B: the application's fee is settled inside this same transaction, at its
      // first successful submit only. If the fee cannot be taken (insufficient office
      // credit, or citizen-pays with no payment rail yet) settleApplicationFee throws and
      // the whole submit rolls back — the application stays a draft, nothing is charged.
      // Resubmits never reach this: the fee is settled once per application (billing.ts).
      if (data.action === "submit")
        await settleApplicationFee(db, r.tenant_id, r, a.userId);
      const updated = (
        await db.query(
          "UPDATE applications SET state=$2,updated_at=now(),approved_by=CASE WHEN $2='APPROVED' THEN $3 ELSE approved_by END,approved_version=CASE WHEN $2='APPROVED' THEN latest_version ELSE approved_version END WHERE id=$1 RETURNING *",
          [r.id, next, a.userId],
        )
      ).rows[0];
      await event(db, r, a, data.action, next, data.reason);
      // Phase W notifications: the office's chairman/approver users hear about new work, and
      // the citizen hears about a rejection (with the Chairman's reason) in the in-app feed.
      if (data.action === "submit")
        await db.query(
          "INSERT INTO outbox_events(tenant_id,kind,resource_id) VALUES($1,'APPLICATION_SUBMITTED',$2)",
          [a.tenantId, r.id],
        );
      else if (data.action === "resubmit")
        await db.query(
          "INSERT INTO outbox_events(tenant_id,kind,resource_id) VALUES($1,'APPLICATION_RESUBMITTED',$2)",
          [a.tenantId, r.id],
        );
      else if (data.action === "reject")
        await db.query(
          "INSERT INTO outbox_events(tenant_id,kind,resource_id,detail) VALUES($1,'APPLICATION_REJECTED',$2,$3)",
          [a.tenantId, r.id, data.reason],
        );
      // QA-08: the citizen also hears about a correction request, with the reason.
      else if (data.action === "request_correction")
        await db.query(
          "INSERT INTO outbox_events(tenant_id,kind,resource_id,detail) VALUES($1,'APPLICATION_CORRECTION_REQUIRED',$2,$3)",
          [a.tenantId, r.id, data.reason],
        );
      return camelRow(updated);
    });
    // Phase X: a rejection also reaches the citizen by email and status SMS (the in-app
    // notification with the reason was written inside the transaction above).
    if (data.action === "reject")
      await notifyApplicationRejected({
        tenantId: a.tenantId!,
        applicationId: String(req.params.id),
        reason: data.reason!,
      });
    else if (data.action === "request_correction")
      await notifyCorrectionRequired({
        tenantId: a.tenantId!,
        applicationId: String(req.params.id),
        reason: data.reason!,
      });
    res.json(result);
  }),
);
app.post(
  "/api/v1/applications/:id/issue",
  wrap(async (req, res) => {
    const a = roles(req, ["approver"]);
    const id = uuid.parse(req.params.id);
    z.object({})
      .strict()
      .parse(req.body ?? {});
    // Phase W: /issue is now only the completion path for an application whose approval was
    // recorded while an issuance gate was closed; the normal flow approves and issues in the
    // transition above. Both paths share prepareIssuance/finalizeIssuance.
    const prepared = await prepareIssuance(
      a,
      id,
      ["APPROVED"],
      "This application requires final approval of its current payload.",
    );
    if (prepared.existing) {
      res.json(certificateRow(prepared.existing));
      return;
    }
    assertProfileComplete(prepared);
    assertCertificateGates(prepared);
    const { certificate: result, number } = await issueWithFreshNumber(
      a,
      id,
      prepared,
      {
        states: ["APPROVED"],
        stateMessage: "Current payload requires final approval.",
        recordApproval: false,
        testFailure: req.header("X-Test-Failure"),
      },
    );
    // Phase X: email + status SMS to the citizen now that the completion issuance committed.
    await notifyCertificateIssued({
      tenantId: a.tenantId!,
      applicationId: id,
      certificateNumber: number,
    });
    res.status(201).json(result);
  }),
);
app.get(
  "/api/v1/certificates/:id/pdf",
  wrap(async (req, res) => {
    const a = roles(req, [...staffRead, "citizen"]);
    const cert = await transaction(tenant(req), async (db) => {
      const c = (
        await db.query(
          "SELECT * FROM certificates WHERE id=$1 AND tenant_id=$2",
          [uuid.parse(req.params.id), a.tenantId],
        )
      ).rows[0];
      if (!c) fail(404, "NOT_FOUND", "Certificate not found.");
      await loadApplication(db, c.application_id, a);
      // QA-12: a revoked certificate must not keep circulating as a clean PDF.
      // The holder can no longer download it; office staff keep access for records.
      if (c.status === "REVOKED" && a.role === "citizen")
        fail(
          410,
          "CERTIFICATE_REVOKED",
          "এই সনদটি প্রত্যাহার করা হয়েছে এবং আর ডাউনলোড করা যাবে না। / This certificate has been revoked and can no longer be downloaded.",
        );
      // CERTNO-01: the default download keeps the established behaviour —
      // the language the citizen ordered (the order snapshot's
      // certificate_language), Bangla when there is no snapshot.
      const snapshot = (
        await db.query(
          "SELECT certificate_language FROM application_order_snapshots WHERE application_id=$1",
          [c.application_id],
        )
      ).rows[0];
      return { ...c, orderedLanguage: snapshot?.certificate_language ?? null };
    });
    // CERTNO-01: both language versions are stored at issuance (pdf = Bangla,
    // pdf_en = English, one number). ?lang=bn / ?lang=en picks a version
    // explicitly; without it, the ordered language is served. Certificates
    // issued before bilingual storage have no second render — an explicit
    // request for it answers LANGUAGE_VERSION_UNAVAILABLE instead of
    // fabricating one, and the default keeps serving the stored document.
    const lang = String(req.query.lang ?? "").toLowerCase();
    if (lang && lang !== "bn" && lang !== "en")
      fail(400, "INPUT_INVALID", "Language must be bn or en.");
    if (lang === "en" && !cert.pdf_en)
      fail(
        404,
        "LANGUAGE_VERSION_UNAVAILABLE",
        "This certificate was issued before bilingual storage; no English version exists.",
      );
    const english = lang ? lang === "en" : cert.orderedLanguage === "en" && !!cert.pdf_en;
    res
      .type("application/pdf")
      .setHeader(
        "Content-Disposition",
        `inline; filename="${cert.number}${english ? "-en" : ""}.pdf"`,
      );
    res.send(english ? cert.pdf_en : cert.pdf);
  }),
);
app.post(
  "/api/v1/certificates/:id/revoke",
  wrap(async (req, res) => {
    const a = roles(req, ["approver"]);
    const data = z
      .object({ reason: z.string().trim().min(3).max(500) })
      .strict()
      .parse(req.body);
    let revokedNow: { applicationId: string; number: string } | undefined;
    const result = await transaction(tenant(req), async (db) => {
      const c = (
        await db.query(
          "SELECT * FROM certificates WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
          [uuid.parse(req.params.id), a.tenantId],
        )
      ).rows[0];
      if (!c) fail(404, "NOT_FOUND", "Certificate not found.");
      await authorization(db, a, c.service_no);
      if (c.status === "REVOKED") return certificateRow(c);
      const r = await loadApplication(db, c.application_id, a, true);
      const revised = (
        await db.query(
          "UPDATE certificates SET status='REVOKED',revoked_at=now(),revocation_reason=$2 WHERE id=$1 RETURNING *",
          [c.id, data.reason],
        )
      ).rows[0];
      await db.query(
        "UPDATE applications SET state='REVOKED',updated_at=now() WHERE id=$1",
        [r.id],
      );
      await event(db, r, a, "revoke", "REVOKED", data.reason);
      // QA-08: the holder sees the revocation (with the reason) in the in-app feed.
      await db.query(
        "INSERT INTO outbox_events(tenant_id,kind,resource_id,detail) VALUES($1,'CERTIFICATE_REVOKED',$2,$3)",
        [a.tenantId, c.id, data.reason],
      );
      revokedNow = { applicationId: r.id, number: c.number };
      return certificateRow(revised);
    });
    if (revokedNow)
      await notifyCertificateRevoked({
        tenantId: a.tenantId!,
        applicationId: revokedNow.applicationId,
        certificateNumber: revokedNow.number,
        reason: data.reason,
      });
    res.json(result);
  }),
);
app.get(
  "/api/v1/wallet",
  wrap(async (req, res) => {
    roles(req, ["admin", "finance", "approver"]);
    const result = await transaction(tenant(req), async (db) => ({
      balance:
        (
          await db.query(
            "SELECT balance FROM tenant_wallets WHERE tenant_id=$1",
            [tenant(req)],
          )
        ).rows[0]?.balance ?? 0,
      ledger: (
        await db.query(
          "SELECT id,delta,kind,reason,balance_after,created_at FROM credit_ledger WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100",
          [tenant(req)],
        )
      ).rows.map(camelRow),
      subscription: camelRow(
        (
          await db.query(
            "SELECT * FROM tenant_subscriptions WHERE tenant_id=$1",
            [tenant(req)],
          )
        ).rows[0],
      ),
    }));
    res.json(result);
  }),
);
app.get(
  "/api/v1/billing",
  wrap(async (req, res) => {
    roles(req, ["admin", "finance"]);
    const result = await transaction(tenant(req), async (db) => {
      const subscription = (
        await db.query("SELECT * FROM tenant_subscriptions WHERE tenant_id=$1", [
          tenant(req),
        ])
      ).rows[0];
      return {
      // Phase 3C: offices are offered only plans currently on sale; their own
      // current plan rides along separately so its name still renders after
      // the owner hides it (existing subscriptions are unaffected by hiding).
      plans: (
        await db.query(
          "SELECT * FROM subscription_plans WHERE on_sale ORDER BY sort_order, id",
        )
      ).rows.map(camelRow),
      currentPlan: subscription
        ? camelRow(
            (
              await db.query("SELECT * FROM subscription_plans WHERE id=$1", [
                subscription.plan_id,
              ])
            ).rows[0],
          )
        : null,
      subscription: camelRow(subscription),
      orders: (
        await db.query(
          "SELECT * FROM payment_orders WHERE tenant_id=$1 ORDER BY created_at DESC",
          [tenant(req)],
        )
      ).rows.map(camelRow),
      invoices: (
        await db.query(
          "SELECT * FROM invoices WHERE tenant_id=$1 ORDER BY issued_at DESC",
          [tenant(req)],
        )
      ).rows.map(camelRow),
      sandbox: true,
      demoSettleEnabled: demoSettleEnabled(),
      governmentFees: "NOT_CONFIGURED_SEPARATE_ACCOUNTING",
      };
    });
    res.json(result);
  }),
);
app.post(
  "/api/v1/billing/orders",
  wrap(async (req, res) => {
    const a = roles(req, ["admin", "finance"]);
    const data = z
      .object({
        kind: z.enum(["topup", "subscription"]),
        planId: z.string().max(50).optional(),
        credits: z.number().int().min(1).max(100).optional(),
        // Phase 3E (§3.7): an owner coupon code, redeemed against this order.
        couponCode: platformCouponCode.optional(),
      })
      .strict()
      .parse(req.body);
    const result = await transaction(tenant(req), async (db) => {
      let credits: number,
        planId: string | null = null,
        amountMinor = 0;
      if (data.kind === "subscription") {
        const plan = (
          await db.query("SELECT * FROM subscription_plans WHERE id=$1", [
            data.planId ?? "standard-monthly",
          ])
        ).rows[0];
        if (!plan) fail(422, "PLAN_INVALID", "Plan not found.");
        if (!plan.on_sale)
          fail(
            422,
            "PLAN_NOT_ON_SALE",
            "This plan is not available for new orders. / এই প্ল্যানটি নতুন অর্ডারের জন্য উপলব্ধ নয়।",
          );
        credits = plan.grant_credits;
        planId = plan.id;
        amountMinor = plan.price_minor;
      } else credits = data.credits ?? 10;
      // Engineering fixtures have zero monetary value. No live price or gateway contract is implied.
      const order = (
        await db.query(
          "INSERT INTO payment_orders(tenant_id,kind,plan_id,credits,amount_minor,currency,created_by) VALUES($1,$2,$3,$4,$5,'BDT',$6) RETURNING *",
          [a.tenantId, data.kind, planId, credits, amountMinor, a.userId],
        )
      ).rows[0];
      if (!data.couponCode) return camelRow(order);
      // Phase 3E (§3.7): redeem the owner coupon against this order, inside the same
      // transaction — any validation failure rolls the order back with it. The stored
      // amount_minor becomes the net payable amount; the redemption row and the
      // order's coupon_code/discount_minor are the §3.7 record of the redemption.
      const discount = await platformCouponDiscount(db, {
        code: data.couponCode,
        tenantId: tenant(req),
        kind: data.kind,
        planId,
        amountMinor,
      });
      await recordCouponRedemption(db, {
        code: data.couponCode,
        tenantId: tenant(req),
        orderId: order.id,
        discountMinor: discount,
        actorId: a.userId,
      });
      return camelRow(
        (
          await db.query(
            "UPDATE payment_orders SET amount_minor=$2, coupon_code=$3, discount_minor=$4 WHERE id=$1 RETURNING *",
            [order.id, amountMinor - discount, data.couponCode, discount],
          )
        ).rows[0],
      );
    });
    res.status(201).json(result);
  }),
);
/**
 * B2: the sandbox settlement self-signs a webhook with the server's own secret, so it must only exist
 * where explicitly wanted. Off unless DEMO_SETTLE_ENABLED is exactly "true", in every NODE_ENV;
 * when off, the request falls through as if the route were never registered.
 */
export const demoSettleEnabled = () => process.env.DEMO_SETTLE_ENABLED === "true";
/**
 * Issuance mode gate: "demo" unless ISSUANCE_MODE is exactly "official".
 * In official mode the health endpoint reports OFFICIAL. Certificate
 * templates carry no demo branding or disclaimer lines in ANY mode (owner
 * purge, 17 Nov 2026); the mode gates only emblem/seal artwork and the
 * certificate-number prefix. Read per call, like demoSettleEnabled, so
 * tests and operators can flip it via the environment alone. Activation
 * is the owner's decision; the default is always demo.
 */
export const issuanceMode = () =>
  process.env.ISSUANCE_MODE === "official" ? "official" : "demo";
app.post(
  "/api/v1/billing/orders/:id/demo-settle",
  (_req, _res, next) => next(demoSettleEnabled() ? undefined : "route"),
  wrap(async (req, res) => {
    roles(req, ["admin", "finance"]);
    z.object({})
      .strict()
      .parse(req.body ?? {});
    const order = await transaction(
      tenant(req),
      async (db) =>
        (
          await db.query(
            "SELECT * FROM payment_orders WHERE id=$1 AND tenant_id=$2",
            [uuid.parse(req.params.id), tenant(req)],
          )
        ).rows[0],
    );
    if (!order) fail(404, "ORDER_NOT_FOUND", "Order not found.");
    const data = {
      eventId: `demo-event:${order.id}`,
      orderId: order.id,
      tenantId: order.tenant_id,
      amountMinor: order.amount_minor,
      currency: order.currency,
      status: "SETTLED",
    };
    const body = Buffer.from(JSON.stringify(data));
    const signed = signature(body, webhookSecret);
    if (!signatureMatches(signed, signature(body, webhookSecret)))
      throw new Error("Sandbox signing failed");
    res.json(await settle(data, digest(body)));
  }),
);
app.get(
  "/api/v1/owner/tenants",
  wrap(async (req, res) => {
    roles(req, ["owner"]);
    const rows = (await pool.query("SELECT * FROM tenants ORDER BY slug")).rows;
    const items = [];
    for (const t of rows) {
      const wallet = await transaction(t.id, async (db) => ({
        balance: (
          await db.query(
            "SELECT balance FROM tenant_wallets WHERE tenant_id=$1",
            [t.id],
          )
        ).rows[0]?.balance,
        subscription: camelRow(
          (
            await db.query(
              "SELECT * FROM tenant_subscriptions WHERE tenant_id=$1",
              [t.id],
            )
          ).rows[0],
        ),
      }));
      items.push({ ...camelRow(t), ...wallet });
    }
    // Phase 3A: the plan catalogue rides along so the owner UI can offer plan
    // choices for subscription actions without a second round-trip.
    const plans = (
      await pool.query("SELECT * FROM subscription_plans ORDER BY id")
    ).rows.map(camelRow);
    res.json({ items, plans });
  }),
);
app.post(
  "/api/v1/owner/tenants/:id/adjust",
  wrap(async (req, res) => {
    const a = roles(req, ["owner"]);
    const id = uuid.parse(req.params.id);
    const data = z
      .object({
        delta: z
          .number()
          .int()
          .min(-10000)
          .max(10000)
          .refine((n) => n !== 0),
        reason: z.string().trim().min(8).max(500),
      })
      .strict()
      .parse(req.body);
    if (!(await pool.query("SELECT 1 FROM tenants WHERE id=$1", [id])).rowCount)
      fail(404, "NOT_FOUND", "Tenant not found.");
    const result = await transaction(
      id,
      async (db) => {
        const balance = (
          await db.query("SELECT balance FROM lock_tenant_wallet()")
        ).rows[0]?.balance;
        if (balance === undefined || balance + data.delta < 0)
          fail(
            422,
            "NEGATIVE_BALANCE",
            "Adjustment cannot create a negative wallet.",
          );
        const r = (
          await db.query(
            "INSERT INTO credit_ledger(tenant_id,delta,kind,idempotency_key,actor_id,reason,balance_after) VALUES($1,$2,'ADJUSTMENT',$3,$4,$5,0) RETURNING id,delta,kind,reason,balance_after,created_at",
            [
              id,
              data.delta,
              `adjustment:${randomUUID()}`,
              a.userId,
              data.reason,
            ],
          )
        ).rows[0];
        await audit(db, id, a.userId, "WALLET_ADJUSTMENT", r.id, {
          delta: data.delta,
          reason: data.reason,
        });
        return camelRow(r);
      },
      true,
    );
    res.status(201).json(result);
  }),
);
app.post(
  "/api/v1/owner/tenants/:id/subscription",
  wrap(async (req, res) => {
    const a = roles(req, ["owner"]);
    const id = uuid.parse(req.params.id);
    const data = z
      .object({
        action: z.enum([
          "activate",
          "extend",
          "set_expiry",
          "suspend",
          "change_plan",
        ]),
        planId: z.string().min(1).max(50).optional(),
        days: z.number().int().min(1).max(3650).optional(),
        validUntil: z.string().datetime({ offset: true }).optional(),
        status: z.enum(["ACTIVE", "EXPIRED", "SUSPENDED"]).optional(),
        grantCredits: z.boolean().optional(),
        reason: z.string().trim().min(8).max(500),
      })
      .strict()
      .refine((v) => v.action !== "change_plan" || !!v.planId, {
        message: "planId is required to change the plan.",
      })
      .refine((v) => v.action !== "set_expiry" || !!v.validUntil, {
        message: "validUntil is required to set the expiry.",
      })
      .parse(req.body);
    if (!(await pool.query("SELECT 1 FROM tenants WHERE id=$1", [id])).rowCount)
      fail(404, "NOT_FOUND", "Tenant not found.");
    const result = await transaction(
      id,
      async (db) => {
        const { before, after, creditsGranted } = await applySubscriptionAction(
          db,
          id,
          a.userId,
          data,
        );
        return {
          subscription: camelRow(after),
          previous: camelRow(before),
          creditsGranted,
        };
      },
      true,
    );
    res.status(201).json(result);
  }),
);
app.get(
  "/api/v1/owner/payment-orders",
  wrap(async (req, res) => {
    roles(req, ["owner"]);
    const status = z
      .enum(["PENDING", "SETTLED", "CANCELLED", "ALL"])
      .default("PENDING")
      .parse(req.query.status ?? undefined);
    const tenants = (await pool.query("SELECT * FROM tenants ORDER BY slug"))
      .rows;
    const items: any[] = [];
    for (const t of tenants) {
      const orders = await transaction(t.id, async (db) =>
        (
          await db.query(
            status === "ALL"
              ? "SELECT * FROM payment_orders WHERE tenant_id=$1 ORDER BY created_at DESC"
              : "SELECT * FROM payment_orders WHERE tenant_id=$1 AND status=$2 ORDER BY created_at DESC",
            status === "ALL" ? [t.id] : [t.id, status],
          )
        ).rows.map((o) => ({
          ...camelRow(o),
          tenantSlug: t.slug,
          tenantNameBn: t.name_bn,
          tenantNameEn: t.name_en,
        })),
      );
      items.push(...orders);
    }
    items.sort((x, y) =>
      String(y.createdAt).localeCompare(String(x.createdAt)),
    );
    res.json({ items });
  }),
);
const ownerOrderDecision = () =>
  z
    .object({ reason: z.string().trim().min(8).max(500) })
    .strict();
app.post(
  "/api/v1/owner/payment-orders/:id/settle",
  wrap(async (req, res) => {
    const a = roles(req, ["owner"]);
    const id = uuid.parse(req.params.id);
    const data = ownerOrderDecision().parse(req.body);
    const tenantId = await locateOrderTenant(id);
    if (!tenantId) fail(404, "ORDER_NOT_FOUND", "Payment order not found.");
    res.json(await settleOrderManually(id, tenantId!, a, data.reason));
  }),
);
app.post(
  "/api/v1/owner/payment-orders/:id/cancel",
  wrap(async (req, res) => {
    const a = roles(req, ["owner"]);
    const id = uuid.parse(req.params.id);
    const data = ownerOrderDecision().parse(req.body);
    const tenantId = await locateOrderTenant(id);
    if (!tenantId) fail(404, "ORDER_NOT_FOUND", "Payment order not found.");
    res.json(await cancelOrderManually(id, tenantId!, a, data.reason));
  }),
);
app.use("/api/v1", (_req, res) =>
  res
    .status(404)
    .json({ error: { code: "NOT_FOUND", message: "Endpoint not found." } }),
);
app.use(
  (
    error: any,
    req: Req,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const status =
      error instanceof ApiError
        ? error.status
        : error instanceof z.ZodError
          ? 422
          : error.code === "23505"
            ? 409
            : error.type === "entity.too.large"
              ? 413
              : // Security Audit 01, F2: a body the JSON parser rejected is a
                // client error (400 INPUT_INVALID), not a server failure.
                error.type === "entity.parse.failed"
                ? 400
                : 500;
    const code =
      error instanceof ApiError
        ? error.code
        : error instanceof z.ZodError
          ? "INPUT_INVALID"
          : error.code === "23505"
            ? "DUPLICATE"
            : status === 413
              ? "UPLOAD_SIZE"
              : status === 400
                ? "INPUT_INVALID"
                : "INTERNAL_ERROR";
    // QA-03: every server failure gets a short reference that is logged with the
    // full error and returned to the user, so a report can be traced. Only the
    // method and path are logged (never the query string or body, which can
    // carry personal data).
    const errorId =
      status >= 500 ? randomUUID().replace(/-/g, "").slice(0, 10) : undefined;
    if (errorId)
      console.error(
        `[api-error ${errorId}] ${req.method} ${req.path} ->`,
        error,
      );
    // QA-17: generic messages are bilingual so the Bangla UI never shows a
    // bare English sentence.
    const message =
      error instanceof ApiError
        ? error.message
        : error instanceof z.ZodError
          ? "তথ্য সঠিক নয় — চিহ্নিত ঘরগুলো দেখুন। / Input validation failed."
          : status === 409
            ? "একই তথ্য আগে থেকেই আছে। / A duplicate record already exists."
            : status === 413
              ? "ফাইল বা তথ্য অনুমোদিত আকারের চেয়ে বড়। / Request body exceeds the allowed size."
              : status === 400
                ? "তথ্য সঠিক নয় — চিহ্নিত ঘরগুলো দেখুন। / Input validation failed."
                : `কাজটি সম্পন্ন করা যায়নি। সহায়তার জন্য এই রেফারেন্স দিন: ${errorId} / The operation could not be completed (ref ${errorId}).`;
    // QA-17: a ZodError now also returns its field issues, so the UI can point
    // at the exact field instead of only "Input validation failed."
    const issues =
      error instanceof ApiError && error.issues
        ? error.issues
        : error instanceof z.ZodError
          ? error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            }))
          : undefined;
    const send = () =>
      res.status(status).json({
        error: {
          code,
          message,
          ...(issues ? { issues } : {}),
          ...(error instanceof ApiError && error.field ? { field: error.field } : {}),
          ...(errorId ? { errorId } : {}),
        },
      });
    if (req.auth?.tenantId && [403, 404].includes(status)) {
      transaction(req.auth.tenantId, (db) =>
        audit(
          db,
          req.auth!.tenantId!,
          req.auth!.userId,
          "ACCESS_DENIED",
          req.auditResource ?? "",
          { method: req.method, route: req.route?.path ?? "unknown", code },
        ),
      ).then(send, send);
    } else send();
  },
);
function stablePayload(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stablePayload).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stablePayload(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
