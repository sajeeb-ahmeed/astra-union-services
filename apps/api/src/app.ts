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
import { pointsRouter, chargeIssuancePoints } from "./points.js";
import { rechargeRouter } from "./recharge.js";
import { merchantRouter } from "./gateways.js";
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
async function authorization(db: DB, a: Auth, no: number) {
  const current = await db.query(
    "SELECT 1 FROM approval_authorizations aa JOIN staff_memberships m ON m.tenant_id=aa.tenant_id AND m.user_id=aa.user_id JOIN platform_users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id WHERE aa.tenant_id=$1 AND aa.user_id=$2 AND aa.service_no=$3 AND aa.active AND m.active AND m.role='approver' AND u.active AND t.status='ACTIVE' FOR SHARE OF aa,m,u,t",
    [a.tenantId, a.userId, no],
  );
  if (a.role !== "approver" || !current.rowCount)
    fail(
      403,
      "APPROVAL_AUTHORITY_REQUIRED",
      "An active service-specific demonstration approval authorization is required.",
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
      if (order.status === "SETTLED")
        return { settled: true, replayed: true, orderId: order.id };
      await db.query(
        "INSERT INTO credit_ledger(tenant_id,delta,kind,idempotency_key,actor_id,reason,balance_after) VALUES($1,$2,$3,$4,$5,$6,0)",
        [
          data.tenantId,
          order.credits,
          order.kind === "subscription" ? "PLAN_GRANT" : "TOPUP",
          `payment:${order.id}`,
          order.created_by,
          "Verified synthetic sandbox settlement",
        ],
      );
      if (order.kind === "subscription") {
        const plan = (
          await db.query("SELECT * FROM subscription_plans WHERE id=$1", [
            order.plan_id,
          ])
        ).rows[0];
        await db.query(
          "INSERT INTO tenant_subscriptions(tenant_id,plan_id,valid_until,status) VALUES($1,$2,now()+($3::int*interval '1 day'),'ACTIVE') ON CONFLICT(tenant_id) DO UPDATE SET plan_id=excluded.plan_id,valid_until=greatest(tenant_subscriptions.valid_until,now())+($3::int*interval '1 day'),status='ACTIVE'",
          [data.tenantId, plan.id, plan.duration_days],
        );
      }
      await db.query("UPDATE payment_orders SET status='SETTLED' WHERE id=$1", [
        order.id,
      ]);
      await db.query(
        "INSERT INTO invoices(tenant_id,order_id,amount_minor,currency) VALUES($1,$2,$3,$4)",
        [data.tenantId, order.id, order.amount_minor, order.currency],
      );
      await audit(
        db,
        data.tenantId,
        order.created_by,
        "SANDBOX_PAYMENT_SETTLED",
        order.id,
        { credits: order.credits },
      );
      return { settled: true, replayed: false, orderId: order.id };
    },
    true,
  );
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
app.use("/api/v1", publicOfficeRegistrationRouter);
app.use("/api/v1", publicManagementRouter);
app.use("/api/v1", geographyRouter);
app.use("/api/v1", publicToolsRouter);
app.use("/api/v1", publicPaymentsRouter);
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
      },
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
    if (!/^[A-Z0-9][A-Z0-9-]{3,79}$/.test(number))
      fail(404, "NOT_FOUND", "Verification record not found.");
    const record = (
      await pool.query("SELECT * FROM public_verify_by_number($1)", [number])
    ).rows[0];
    if (!record) fail(404, "NOT_FOUND", "Verification record not found.");
    res.json(camelRow(record));
  }),
);
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
app.use("/api/v1", rechargeRouter);
app.use("/api/v1", merchantRouter);
app.use("/api/v1", refundsRouter);
app.use("/api/v1", ownerInclusionRouter);
app.use("/api/v1", ownerWitnessRouter);
app.use("/api/v1", operationsRouter);
app.use("/api/v1", paymentsRouter);
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
    const q = String(req.query.q ?? "").slice(0, 100);
    const { items, total } = await transaction(tenant(req), async (db) => {
      const filter = `WHERE tenant_id=$1 ${a.role === "citizen" ? "AND user_id=$2" : ""} AND (full_name_bn ILIKE ${a.role === "citizen" ? "$3" : "$2"} OR full_name_en ILIKE ${a.role === "citizen" ? "$3" : "$2"} OR synthetic_reference ILIKE ${a.role === "citizen" ? "$3" : "$2"})`;
      const params =
        a.role === "citizen"
          ? [a.tenantId, a.userId, `%${q}%`]
          : [a.tenantId, `%${q}%`];
      return {
        items: (
          await db.query(
            `SELECT * FROM citizens ${filter} ORDER BY created_at DESC LIMIT 100`,
            params,
          )
        ).rows.map(citizenRow),
        // Phase 1: the dashboard shows the real count, not the length of this 100-row page.
        total: (
          await db.query(`SELECT count(*)::int n FROM citizens ${filter}`, params)
        ).rows[0].n as number,
      };
    });
    res.json({ items, total });
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
          ),
        addressBn: z.string().min(4).max(500),
        addressEn: z.string().min(4).max(500),
        syntheticReference: z
          .string()
          .regex(/^DEMO-[A-Za-z0-9-]{3,50}$/)
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
        fail(409, "PROFILE_EXISTS", "This demo account already has a profile.");
      const r = (
        await db.query(
          "INSERT INTO citizens(tenant_id,user_id,full_name_bn,full_name_en,date_of_birth,address_bn,address_en,synthetic_reference,division_code,district_code,upazila_code,union_code,ward_code,present_same_as_permanent,present_address_bn,present_address_en,present_division_code,present_district_code,present_upazila_code,present_union_code,present_ward_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *",
          [
            a.tenantId,
            a.role === "citizen" ? a.userId : null,
            data.nameBn,
            data.nameEn,
            data.dateOfBirth,
            data.addressBn,
            data.addressEn,
            data.syntheticReference ?? `DEMO-${randomUUID()}`,
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
    const search = z.string().max(100).default("").parse(req.query.q);
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
    // Phase 6c: an optional date range (Asia/Dhaka calendar days, inclusive) and a renewals-only filter.
    const range = dateRange.parse({ from: req.query.from, to: req.query.to });
    const renewalOnly = req.query.renewal === "true";
    const result = await transaction(tenant(req), async (db) => {
      const values = [
        a.tenantId,
        state,
        no,
        a.role === "citizen" ? a.userId : null,
        `%${search}%`,
      ];
      const from = `FROM applications a JOIN citizens c ON c.id=a.citizen_id AND c.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND ($2::text IS NULL OR a.state=$2) AND ($3::int IS NULL OR a.service_no=$3) AND ($4::uuid IS NULL OR c.user_id=$4) AND (a.id::text ILIKE $5 OR c.full_name_bn ILIKE $5 OR c.full_name_en ILIKE $5 OR c.synthetic_reference ILIKE $5 OR c.contact_mobile ILIKE $5)${range.from ? ` AND (a.created_at AT TIME ZONE 'Asia/Dhaka')::date >= '${range.from}'::date` : ""}${range.to ? ` AND (a.created_at AT TIME ZONE 'Asia/Dhaka')::date <= '${range.to}'::date` : ""}${renewalOnly ? " AND EXISTS(SELECT 1 FROM renewal_links l WHERE l.tenant_id=a.tenant_id AND l.application_id=a.id)" : ""}`;
      const items = (
        await db.query(
          `SELECT a.*,EXISTS(SELECT 1 FROM renewal_links l WHERE l.tenant_id=a.tenant_id AND l.application_id=a.id) AS is_renewal ${from} ORDER BY a.updated_at DESC,a.id LIMIT $6 OFFSET $7`,
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
      const r = (
        await db.query(
          "INSERT INTO applications(tenant_id,citizen_id,service_no,schema_version,schema_hash,created_by,order_mode) VALUES($1,$2,$3,$6,$4,$5,$7) RETURNING *",
          [
            a.tenantId,
            data.citizenId,
            data.serviceNo,
            sv.schema_hash,
            a.userId,
            schemaVersion,
            order ? "POLICY" : "LEGACY",
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
      const row = (
        await db.query(
          `SELECT a.id,a.service_no,a.state,cert.id certificate_id,cert.number certificate_number,cert.status certificate_status
           FROM applications a
           JOIN citizens c ON c.id=a.citizen_id AND c.tenant_id=a.tenant_id
           LEFT JOIN certificates cert ON cert.application_id=a.id AND cert.tenant_id=a.tenant_id
           WHERE a.tenant_id=$1 AND (a.id::text=lower($2) OR upper(cert.number)=upper($2))
             AND ($3::uuid IS NULL OR c.user_id=$3)`,
          [a.tenantId, input.data, a.role === "citizen" ? a.userId : null],
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
              await validatePayload(
                db,
                parent.service_no,
                upgrade.payload,
                latestVersion,
                parent.citizen_id,
              );
              payload = upgrade.payload;
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
        const child = (
          await db.query(
            "INSERT INTO applications(tenant_id,citizen_id,service_no,schema_version,schema_hash,created_by,order_mode) VALUES($1,$2,$3,$6,$4,$5,$7) RETURNING *",
            [
              a.tenantId,
              parent.citizen_id,
              parent.service_no,
              schema.schema_hash,
              a.userId,
              schemaVersion,
              order ? "POLICY" : "LEGACY",
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
 * closed (fee not yet collected, insufficient credits/points, inactive subscription, incomplete
 * profile, disabled service, revoked renewal source). Those gates keep the exact failure semantics
 * the old two-step flow had: the decision stands, nothing is issued or charged.
 */
const DECISION_STATES = ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"];
const APPROVE_STATES = [...DECISION_STATES, "APPROVED"];
const ISSUANCE_GATE_CODES = new Set([
  "ORDER_PAYMENT_REQUIRED",
  "PROFILE_INCOMPLETE",
  "RENEWAL_SOURCE_INVALID",
  "INSUFFICIENT_CREDITS",
  "SUBSCRIPTION_INACTIVE",
  "POINTS_INSUFFICIENT",
  "SERVICE_DISABLED",
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
      if (
        !(
          await db.query(
            "SELECT 1 FROM tenant_subscriptions WHERE tenant_id=$1 AND status='ACTIVE' AND valid_until>now() FOR UPDATE",
            [a.tenantId],
          )
        ).rowCount
      )
        fail(
          402,
          "SUBSCRIPTION_INACTIVE",
          "An active tenant subscription is required. Application is retained.",
        );
      const cost = (
        await db.query(
          "SELECT credit_cost FROM tenant_service_configuration WHERE tenant_id=$1 AND service_no=$2 AND enabled",
          [a.tenantId, r.service_no],
        )
      ).rows[0]?.credit_cost;
      if (!cost) fail(422, "SERVICE_DISABLED", "Service is disabled.");
      const wallet = (
        await db.query("SELECT balance FROM lock_tenant_wallet()")
      ).rows[0];
      if (!wallet || wallet.balance < cost)
        fail(
          402,
          "INSUFFICIENT_CREDITS",
          "Insufficient tenant credits. Approved application is retained.",
        );
      const c = (
        await db.query(
          "INSERT INTO certificates(id,tenant_id,application_id,number,service_no,token_hash,pdf,issued_by,template_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            meta.certId,
            a.tenantId,
            id,
            meta.number,
            r.service_no,
            digest(meta.token),
            meta.pdf,
            a.userId,
            DEMO_TEMPLATE_VERSION,
          ],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO credit_ledger(tenant_id,delta,kind,idempotency_key,certificate_id,actor_id,reason,balance_after) VALUES($1,$2,'ISSUANCE',$3,$4,$5,'DEMO certificate issuance',0)",
        [a.tenantId, -cost, `issuance:${c.id}`, c.id, a.userId],
      );
      // Phase 5a: the owner-set point price, deducted once in the same transaction (402 keeps it approved).
      await chargeIssuancePoints(db, a.tenantId!, r.service_no, c.id, a.userId);
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
function newCertificateNumber(certId: string): string {
  const fragment = certId.slice(0, 18).toUpperCase();
  return process.env.ISSUANCE_MODE === "official"
    ? `${new Date().getFullYear()}-${fragment}`
    : `DEMO-${new Date().getFullYear()}-${fragment}`;
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
    const certId = randomUUID(),
      token = randomToken(),
      number = newCertificateNumber(certId);
    const verificationUrl = `${publicOrigin}/verify/${token}`;
    const pdf = await generatePdf({
      number,
      verificationUrl,
      tenant: prepared.tenant,
      service: prepared.service,
      citizen: prepared.citizen,
      payload: prepared.payload,
      schema: prepared.schema,
      geographyNames: prepared.geographyNames,
      renewalNumber: prepared.renewal,
      ...prepared.pdfExtras,
    });
    const certificate = await finalizeIssuance(
      a,
      id,
      { certId, token, number, verificationUrl, pdf },
      {
        states: APPROVE_STATES,
        stateMessage: "Approval requires a submitted application.",
        recordApproval: true,
        testFailure: req.header("X-Test-Failure"),
      },
    );
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
    const certId = randomUUID(),
      token = randomToken(),
      number = newCertificateNumber(certId);
    const verificationUrl = `${publicOrigin}/verify/${token}`;
    const pdf = await generatePdf({
      number,
      verificationUrl,
      tenant: prepared.tenant,
      service: prepared.service,
      citizen: prepared.citizen,
      payload: prepared.payload,
      schema: prepared.schema,
      geographyNames: prepared.geographyNames,
      renewalNumber: prepared.renewal,
      ...prepared.pdfExtras,
    });
    const result = await finalizeIssuance(
      a,
      id,
      { certId, token, number, verificationUrl, pdf },
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
      return c;
    });
    res
      .type("application/pdf")
      .setHeader(
        "Content-Disposition",
        `inline; filename="${cert.number}.pdf"`,
      );
    res.send(cert.pdf);
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
      return certificateRow(revised);
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
    const result = await transaction(tenant(req), async (db) => ({
      plans: (
        await db.query("SELECT * FROM subscription_plans ORDER BY id")
      ).rows.map(camelRow),
      subscription: camelRow(
        (
          await db.query(
            "SELECT * FROM tenant_subscriptions WHERE tenant_id=$1",
            [tenant(req)],
          )
        ).rows[0],
      ),
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
    }));
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
            data.planId ?? "demo-monthly",
          ])
        ).rows[0];
        if (!plan) fail(422, "PLAN_INVALID", "Plan not found.");
        credits = plan.grant_credits;
        planId = plan.id;
        amountMinor = plan.price_minor;
      } else credits = data.credits ?? 10;
      // Engineering fixtures have zero monetary value. No live price or gateway contract is implied.
      return camelRow(
        (
          await db.query(
            "INSERT INTO payment_orders(tenant_id,kind,plan_id,credits,amount_minor,currency,created_by) VALUES($1,$2,$3,$4,$5,'BDT',$6) RETURNING *",
            [a.tenantId, data.kind, planId, credits, amountMinor, a.userId],
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
 * In official mode the health endpoint reports OFFICIAL and the certificate
 * template drops its DEMO branding (the factual not-a-government-document
 * honesty lines stay in both modes). Read per call, like demoSettleEnabled,
 * so tests and operators can flip it via the environment alone. Activation
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
    res.json({ items });
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
              : "INTERNAL_ERROR";
    const message =
      error instanceof ApiError
        ? error.message
        : error instanceof z.ZodError
          ? "Input validation failed."
          : status === 409
            ? "A duplicate record already exists."
            : status === 413
              ? "Request body exceeds the allowed size."
              : "The operation could not be completed.";
    const send = () =>
      res.status(status).json({
        error: {
          code,
          message,
          ...(error instanceof ApiError && error.issues
            ? { issues: error.issues }
            : {}),
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
