import express from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import {
  serviceCatalog,
  getServiceSchema,
  getCatalogPreviewSchema,
  validateForm,
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
export type Auth = {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  tenantId: string | null;
  csrfToken: string;
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
  const visit = async (v: any): Promise<void> => {
    if (Array.isArray(v)) {
      for (const item of v) await visit(item);
    } else if (v && typeof v === "object") {
      if (v.attachmentId) {
        const r = (
          await db.query(
            "SELECT mime_type,byte_length FROM attachments WHERE id=$1 AND citizen_id=$2",
            [uuid.parse(v.attachmentId), citizenId],
          )
        ).rows[0];
        if (!r || r.mime_type !== v.mimeType || r.byte_length !== v.byteLength)
          fail(
            422,
            "ATTACHMENT_INVALID",
            "Private upload reference is not valid for this applicant and tenant.",
          );
      } else for (const value of Object.values(v)) await visit(value);
    }
  };
  await visit(payload);
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
app.use("/api/v1", publicManagementRouter);
app.use("/api/v1", publicToolsRouter);
app.get(
  "/api/v1/health",
  wrap(async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "PostgreSQL", mode: "DEMO_ONLY" });
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
const loginAttempts = new Map<string, { count: number; expires: number }>();
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
    const data = z
      .object({
        email: z.string().email().max(150),
        password: z.string().min(1).max(200),
      })
      .strict()
      .parse(req.body);
    const user = (
      await pool.query("SELECT * FROM platform_users WHERE email=$1", [
        data.email.toLowerCase(),
      ])
    ).rows[0];
    if (
      !user ||
      !user.active ||
      !checkPassword(data.password, user.password_hash)
    )
      fail(401, "INVALID_LOGIN", "Invalid sign-in credentials.");
    const membership = (
      await pool.query(
        "SELECT m.*,t.status FROM staff_memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.active AND t.status='ACTIVE' ORDER BY t.slug LIMIT 1",
        [user.id],
      )
    ).rows[0];
    if (!membership && user.platform_role !== "owner")
      fail(403, "MEMBERSHIP_INACTIVE", "No active tenant membership.");
    const token = randomToken();
    const csrfToken = randomToken();
    await pool.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,now()+interval '8 hours')",
      [digest(token), user.id, membership?.tenant_id ?? null, csrfToken],
    );
    res.setHeader(
      "Set-Cookie",
      `astra_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    );
    const tenantData = membership
      ? (
          await pool.query("SELECT * FROM tenants WHERE id=$1", [
            membership.tenant_id,
          ])
        ).rows[0]
      : null;
    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: membership?.role ?? "owner",
        tenantId: membership?.tenant_id ?? null,
      },
      tenant: camelRow(tenantData),
      csrfToken,
    });
  }),
);
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
          "SELECT s.*,u.email,u.display_name,u.active,u.platform_role,m.role,m.active membership_active,t.status tenant_status FROM sessions s JOIN platform_users u ON u.id=s.user_id LEFT JOIN staff_memberships m ON m.user_id=s.user_id AND m.tenant_id=s.tenant_id LEFT JOIN tenants t ON t.id=s.tenant_id WHERE s.token_hash=$1 AND s.expires_at>now()",
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
app.use("/api/v1", protectedToolsRouter);
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
app.get(
  "/api/v1/citizens",
  wrap(async (req, res) => {
    const a = roles(req, [...staffRead, "citizen"]);
    const q = String(req.query.q ?? "").slice(0, 100);
    const items = await transaction(tenant(req), async (db) =>
      (
        await db.query(
          `SELECT * FROM citizens WHERE tenant_id=$1 ${a.role === "citizen" ? "AND user_id=$2" : ""} AND (full_name_bn ILIKE ${a.role === "citizen" ? "$3" : "$2"} OR full_name_en ILIKE ${a.role === "citizen" ? "$3" : "$2"} OR synthetic_reference ILIKE ${a.role === "citizen" ? "$3" : "$2"}) ORDER BY created_at DESC LIMIT 100`,
          a.role === "citizen"
            ? [a.tenantId, a.userId, `%${q}%`]
            : [a.tenantId, `%${q}%`],
        )
      ).rows.map(citizenRow),
    );
    res.json({ items });
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
        syntheticReference: z.string().regex(/^DEMO-[A-Za-z0-9-]{3,50}$/),
      })
      .strict()
      .parse(req.body);
    const item = await transaction(tenant(req), async (db) => {
      if (
        a.role === "citizen" &&
        (await db.query("SELECT 1 FROM citizens WHERE user_id=$1", [a.userId]))
          .rowCount
      )
        fail(409, "PROFILE_EXISTS", "This demo account already has a profile.");
      const r = (
        await db.query(
          "INSERT INTO citizens(tenant_id,user_id,full_name_bn,full_name_en,date_of_birth,address_bn,address_en,synthetic_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            a.tenantId,
            a.role === "citizen" ? a.userId : null,
            data.nameBn,
            data.nameEn,
            data.dateOfBirth,
            data.addressBn,
            data.addressEn,
            data.syntheticReference,
          ],
        )
      ).rows[0];
      await audit(db, a.tenantId!, a.userId, "DEMO_CITIZEN_REGISTERED", r.id, {
        verification: "SYNTHETIC_DEMO",
      });
      return citizenRow(r);
    });
    res.status(201).json(item);
  }),
);
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
    const result = await transaction(tenant(req), async (db) => {
      const values = [
        a.tenantId,
        state,
        no,
        a.role === "citizen" ? a.userId : null,
        `%${search}%`,
      ];
      const from = `FROM applications a JOIN citizens c ON c.id=a.citizen_id AND c.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND ($2::text IS NULL OR a.state=$2) AND ($3::int IS NULL OR a.service_no=$3) AND ($4::uuid IS NULL OR c.user_id=$4) AND (a.id::text ILIKE $5 OR c.full_name_bn ILIKE $5 OR c.full_name_en ILIKE $5 OR c.synthetic_reference ILIKE $5)`;
      const items = (
        await db.query(
          `SELECT a.* ${from} ORDER BY a.updated_at DESC,a.id LIMIT $6 OFFSET $7`,
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
      const r = (
        await db.query(
          "INSERT INTO applications(tenant_id,citizen_id,service_no,schema_version,schema_hash,created_by) VALUES($1,$2,$3,$6,$4,$5) RETURNING *",
          [
            a.tenantId,
            data.citizenId,
            data.serviceNo,
            sv.schema_hash,
            a.userId,
            schemaVersion,
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
      await event(db, { ...r, state: null }, a, "create", "DRAFT");
      return camelRow(r);
    });
    res.status(201).json(result);
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
        citizen: citizenRow(
          (await db.query("SELECT * FROM citizens WHERE id=$1", [r.citizen_id]))
            .rows[0],
        ),
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
        .object({ payload: z.record(z.string(), z.unknown()).optional() })
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
        const payload = { ...(d.payload ?? original) };
        if (parent.service_no === 42) {
          payload.has_previous_license = true;
          payload.previous_license_number = cert.number;
        }
        const schemaVersion = getServiceSchema(parent.service_no).version;
        await validatePayload(
          db,
          parent.service_no,
          payload,
          schemaVersion,
          parent.citizen_id,
        );
        const schema = (
          await db.query(
            "SELECT schema_hash FROM service_versions WHERE service_no=$1 AND version=$2",
            [parent.service_no, schemaVersion],
          )
        ).rows[0];
        const child = (
          await db.query(
            "INSERT INTO applications(tenant_id,citizen_id,service_no,schema_version,schema_hash,created_by) VALUES($1,$2,$3,$6,$4,$5) RETURNING *",
            [
              a.tenantId,
              parent.citizen_id,
              parent.service_no,
              schema.schema_hash,
              a.userId,
              schemaVersion,
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
        return { ...camelRow(child), sourceCertificateId: cert.id };
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
app.post(
  "/api/v1/applications/:id/transition",
  wrap(async (req, res) => {
    const a = actor(req);
    roles(req, [...staffRead, "citizen"]);
    const data = z
      .object({
        action: z.enum([
          "submit",
          "review",
          "request_correction",
          "resubmit",
          "approve",
          "reject",
          "cancel",
        ]),
        reason: z.string().trim().min(3).max(500).optional(),
      })
      .strict()
      .parse(req.body);
    const result = await transaction(tenant(req), async (db) => {
      const r = await loadApplication(db, String(req.params.id), a, true);
      let next: string;
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
        case "review":
          roles(req, ["reviewer"]);
          if (!["SUBMITTED", "RESUBMITTED"].includes(r.state))
            fail(
              409,
              "STATE_CONFLICT",
              "Review requires a submitted application.",
            );
          next = "UNDER_REVIEW";
          break;
        case "request_correction":
          roles(req, ["reviewer"]);
          if (r.state !== "UNDER_REVIEW")
            fail(409, "STATE_CONFLICT", "Correction requires review.");
          if (!data.reason)
            fail(422, "REASON_REQUIRED", "A correction reason is required.");
          next = "CORRECTION_REQUIRED";
          break;
        case "approve":
          await authorization(db, a, r.service_no);
          if (r.state !== "UNDER_REVIEW")
            fail(409, "STATE_CONFLICT", "Approval requires completed review.");
          next = "APPROVED";
          break;
        case "reject":
          roles(req, ["reviewer", "approver"]);
          if (!["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"].includes(r.state))
            fail(
              409,
              "STATE_CONFLICT",
              "Rejection requires an active review application.",
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
      }
      const updated = (
        await db.query(
          "UPDATE applications SET state=$2,updated_at=now(),approved_by=CASE WHEN $2='APPROVED' THEN $3 ELSE approved_by END,approved_version=CASE WHEN $2='APPROVED' THEN latest_version ELSE approved_version END WHERE id=$1 RETURNING *",
          [r.id, next, a.userId],
        )
      ).rows[0];
      await event(db, r, a, data.action, next, data.reason);
      return camelRow(updated);
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
    const prepared = await transaction(tenant(req), async (db) => {
      const r = await loadApplication(db, id, a);
      await authorization(db, a, r.service_no);
      const existing = (
        await db.query("SELECT * FROM certificates WHERE application_id=$1", [
          id,
        ])
      ).rows[0];
      if (existing) return { existing };
      if (r.state !== "APPROVED" || r.approved_version !== r.latest_version)
        fail(
          409,
          "APPROVAL_REQUIRED",
          "This application requires final approval of its current payload.",
        );
      await validateRenewalSource(db, r.id);
      return {
        r,
        tenant: (
          await db.query("SELECT * FROM tenants WHERE id=$1", [a.tenantId])
        ).rows[0],
        service: (
          await db.query("SELECT * FROM service_catalog WHERE service_no=$1", [
            r.service_no,
          ])
        ).rows[0],
        citizen: (
          await db.query("SELECT * FROM citizens WHERE id=$1", [r.citizen_id])
        ).rows[0],
        payload: (
          await db.query(
            "SELECT payload FROM application_payload_versions WHERE application_id=$1 AND version=$2",
            [id, r.latest_version],
          )
        ).rows[0].payload,
        schema: (
          await db.query(
            "SELECT schema_json FROM service_versions WHERE service_no=$1 AND version=$2",
            [r.service_no, r.schema_version],
          )
        ).rows[0].schema_json,
        renewal: (
          await db.query(
            "SELECT c.number FROM renewal_links l JOIN certificates c ON c.id=l.source_certificate_id AND c.tenant_id=l.tenant_id WHERE l.application_id=$1",
            [r.id],
          )
        ).rows[0]?.number,
      };
    });
    if (prepared.existing) {
      res.json(certificateRow(prepared.existing));
      return;
    }
    const certId = randomUUID(),
      token = randomToken(),
      number = `DEMO-${new Date().getFullYear()}-${certId.slice(0, 18).toUpperCase()}`;
    const verificationUrl = `${publicOrigin}/verify/${token}`;
    const pdf = await generatePdf({
      number,
      verificationUrl,
      tenant: prepared.tenant,
      service: prepared.service,
      citizen: prepared.citizen,
      payload: prepared.payload,
      schema: prepared.schema,
      renewalNumber: prepared.renewal,
    });
    const result = await transaction(
      tenant(req),
      async (db) => {
        const r = await loadApplication(db, id, a, true);
        await authorization(db, a, r.service_no);
        const existing = (
          await db.query("SELECT * FROM certificates WHERE application_id=$1", [
            id,
          ])
        ).rows[0];
        if (existing) return certificateRow(existing);
        if (r.state !== "APPROVED" || r.approved_version !== r.latest_version)
          fail(
            409,
            "APPROVAL_REQUIRED",
            "Current payload requires final approval.",
          );
        await validateRenewalSource(db, r.id);
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
            "INSERT INTO certificates(id,tenant_id,application_id,number,service_no,verification_token,token_hash,pdf,issued_by,template_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
            [
              certId,
              a.tenantId,
              id,
              number,
              r.service_no,
              token,
              digest(token),
              pdf,
              a.userId,
              DEMO_TEMPLATE_VERSION,
            ],
          )
        ).rows[0];
        await db.query(
          "INSERT INTO credit_ledger(tenant_id,delta,kind,idempotency_key,certificate_id,actor_id,reason,balance_after) VALUES($1,$2,'ISSUANCE',$3,$4,$5,'DEMO certificate issuance',0)",
          [a.tenantId, -cost, `issuance:${c.id}`, c.id, a.userId],
        );
        if (
          process.env.NODE_ENV === "test" &&
          req.header("X-Test-Failure") === "after-debit"
        )
          throw new Error("Injected issuance transaction failure");
        await db.query(
          "UPDATE applications SET state='ISSUED',updated_at=now() WHERE id=$1",
          [id],
        );
        await event(db, r, a, "issue", "ISSUED");
        await db.query(
          "INSERT INTO outbox_events(tenant_id,kind,resource_id) VALUES($1,'DEMO_CERTIFICATE_ISSUED',$2)",
          [a.tenantId, c.id],
        );
        return certificateRow(c);
      },
      true,
    );
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
app.post(
  "/api/v1/billing/orders/:id/demo-settle",
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
app.post(
  "/api/v1/attachments",
  wrap(async (req, res) => {
    const a = roles(req, ["citizen", "staff", "admin"]);
    const data = z
      .object({
        citizenId: uuid,
        mimeType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
        base64: z.string().max(2796204),
      })
      .strict()
      .parse(req.body);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64))
      fail(422, "UPLOAD_INVALID", "Malformed base64 upload.");
    const bytes = Buffer.from(data.base64, "base64");
    if (bytes.length < 8 || bytes.length > 2097152)
      fail(422, "UPLOAD_SIZE", "Uploads must be between 8 bytes and 2 MiB.");
    const valid =
      data.mimeType === "application/pdf"
        ? bytes.subarray(0, 5).toString() === "%PDF-" &&
          bytes.subarray(-1024).includes(Buffer.from("%%EOF"))
        : data.mimeType === "image/png"
          ? bytes.length >= 45 &&
            bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
            bytes.subarray(12, 16).toString() === "IHDR" &&
            bytes.subarray(-8, -4).toString() === "IEND"
          : bytes[0] === 255 &&
            bytes[1] === 216 &&
            bytes[2] === 255 &&
            bytes.at(-2) === 255 &&
            bytes.at(-1) === 217;
    if (!valid)
      fail(
        422,
        "UPLOAD_TYPE",
        "File signature or end marker does not match its declared MIME type.",
      );
    const result = await transaction(tenant(req), async (db) => {
      const c = (
        await db.query(
          `SELECT 1 FROM citizens WHERE id=$1 AND tenant_id=$2 ${a.role === "citizen" ? "AND user_id=$3" : ""}`,
          a.role === "citizen"
            ? [data.citizenId, a.tenantId, a.userId]
            : [data.citizenId, a.tenantId],
        )
      ).rowCount;
      if (!c) fail(404, "NOT_FOUND", "Citizen not found.");
      const r = (
        await db.query(
          "INSERT INTO attachments(tenant_id,citizen_id,uploaded_by,mime_type,byte_length,bytes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,mime_type,byte_length,scan_state",
          [
            a.tenantId,
            data.citizenId,
            a.userId,
            data.mimeType,
            bytes.length,
            bytes,
          ],
        )
      ).rows[0];
      await audit(
        db,
        a.tenantId!,
        a.userId,
        "PRIVATE_ATTACHMENT_UPLOADED",
        r.id,
      );
      return {
        attachmentId: r.id,
        mimeType: r.mime_type,
        byteLength: r.byte_length,
        scanState: r.scan_state,
      };
    });
    res.status(201).json(result);
  }),
);
app.get(
  "/api/v1/attachments/:id",
  wrap(async (req, res) => {
    const a = roles(req, [...staffRead, "citizen"]);
    const result = await transaction(tenant(req), async (db) => {
      const r = (
        await db.query("SELECT * FROM attachments WHERE id=$1", [
          uuid.parse(req.params.id),
        ])
      ).rows[0];
      if (!r) fail(404, "NOT_FOUND", "Attachment not found.");
      if (
        a.role === "citizen" &&
        !(
          await db.query("SELECT 1 FROM citizens WHERE id=$1 AND user_id=$2", [
            r.citizen_id,
            a.userId,
          ])
        ).rowCount
      )
        fail(404, "NOT_FOUND", "Attachment not found.");
      return r;
    });
    res
      .type(result.mime_type)
      .setHeader(
        "Content-Disposition",
        'attachment; filename="private-upload"',
      );
    res.send(result.bytes);
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
