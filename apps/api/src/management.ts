import express from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pool, transaction, audit } from "./db.js";
import {
  hashPassword,
  checkPassword,
  randomToken,
  digest,
} from "./security.js";
import { camelRow, fail } from "./models.js";
import type { Auth } from "./app.js";

type Req = express.Request & { auth?: Auth };
const uuid = z.string().uuid();
const wrap =
  (fn: (req: Req, res: express.Response) => Promise<unknown>) =>
  (req: Req, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);
function role(req: Req, allowed: string[]) {
  if (!req.auth || !allowed.includes(req.auth.role))
    fail(403, "ROLE_DENIED", "This role is not permitted.");
  return req.auth!;
}
const pageInput = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
});
const roleInput = z.enum([
  "admin",
  "approver",
  "reviewer",
  "staff",
  "finance",
  "citizen",
]);
const password = z.string().min(12).max(200);
const email = z
  .string()
  .email()
  .max(150)
  .transform((s) => s.toLowerCase());
const officeInput = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{2,49}$/),
  nameBn: z.string().min(2).max(150),
  nameEn: z.string().min(2).max(150),
  division: z.string().min(2).max(100),
  district: z.string().min(2).max(100),
  upazila: z.string().min(2).max(100),
  officeType: z.enum(["UNION", "MUNICIPALITY", "CITY_CORPORATION"]),
});
export const publicManagementRouter = express.Router();
export const managementRouter = express.Router();
async function recoveryEligible(
  db: import("./db.js").DB,
  tenantId: string,
  userId: string,
) {
  const u = (
    await db.query(
      "SELECT u.id FROM platform_users u JOIN staff_memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.tenant_id=$2 AND u.active AND m.active AND u.platform_role IS NULL AND m.role<>'admin' AND NOT EXISTS(SELECT 1 FROM staff_memberships other WHERE other.user_id=u.id AND other.tenant_id<>$2) FOR SHARE OF u,m",
      [userId, tenantId],
    )
  ).rows[0];
  if (!u)
    fail(
      404,
      "RECOVERY_UNAVAILABLE",
      "Recovery is unavailable for this account.",
    );
}
managementRouter.post(
  "/admin/users/:id/recovery",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]),
      id = uuid.parse(req.params.id);
    z.object({})
      .strict()
      .parse(req.body ?? {});
    const token = randomToken();
    const result = await transaction(a.tenantId!, async (db) => {
      await recoveryEligible(db, a.tenantId!, id);
      await db.query(
        "UPDATE password_recovery_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL",
        [id],
      );
      const row = (
        await db.query(
          "INSERT INTO password_recovery_tokens(token_hash,tenant_id,user_id,created_by,expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes') RETURNING expires_at",
          [digest(token), a.tenantId, id, a.userId],
        )
      ).rows[0];
      await audit(db, a.tenantId!, a.userId, "PASSWORD_RECOVERY_CREATED", id, {
        delivery: "MANUAL_TRUSTED_CHANNEL",
      });
      return {
        token,
        recoveryUrl: `${process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:5173"}/recover?token=${token}`,
        expiresAt: row.expires_at,
      };
    });
    res.status(201).json(result);
  }),
);
publicManagementRouter.post(
  "/auth/recover",
  wrap(async (req, res) => {
    const d = z
        .object({
          token: z.string().regex(/^[a-f0-9]{64}$/),
          newPassword: password,
        })
        .strict()
        .parse(req.body),
      hash = digest(d.token);
    const found = (
      await pool.query("SELECT * FROM locate_password_recovery($1)", [hash])
    ).rows[0];
    if (!found)
      fail(422, "RECOVERY_INVALID", "Recovery link is invalid or expired.");
    await transaction(
      found.tenant_id,
      async (db) => {
        const r = (
          await db.query(
            "SELECT * FROM password_recovery_tokens WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",
            [hash],
          )
        ).rows[0];
        if (!r)
          fail(422, "RECOVERY_INVALID", "Recovery link is invalid or expired.");
        await recoveryEligible(db, found.tenant_id, r.user_id);
        if (
          !(
            await db.query(
              "SELECT 1 FROM tenants WHERE id=$1 AND status='ACTIVE' FOR SHARE",
              [found.tenant_id],
            )
          ).rowCount
        )
          fail(422, "RECOVERY_INVALID", "Recovery link is invalid or expired.");
        await db.query(
          "UPDATE platform_users SET password_hash=$2 WHERE id=$1",
          [r.user_id, hashPassword(d.newPassword)],
        );
        await db.query(
          "UPDATE sessions SET expires_at=now() WHERE user_id=$1",
          [r.user_id],
        );
        await db.query(
          "UPDATE password_recovery_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL",
          [r.user_id],
        );
        await audit(
          db,
          found.tenant_id,
          r.user_id,
          "PASSWORD_RECOVERY_COMPLETED",
          r.user_id,
        );
      },
      true,
    );
    res.json({ recovered: true });
  }),
);
managementRouter.get(
  "/admin/office",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]);
    res.json(
      camelRow(
        (await pool.query("SELECT * FROM tenants WHERE id=$1", [a.tenantId]))
          .rows[0],
      ),
    );
  }),
);
managementRouter.patch(
  "/admin/office",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]),
      d = officeInput
        .omit({ slug: true })
        .partial()
        .strict()
        .refine((v) => Object.keys(v).length > 0)
        .parse(req.body);
    const item = await transaction(a.tenantId!, async (db) => {
      const r = (
        await db.query(
          "UPDATE tenants SET name_bn=coalesce($2,name_bn),name_en=coalesce($3,name_en),division=coalesce($4,division),district=coalesce($5,district),upazila=coalesce($6,upazila),office_type=coalesce($7,office_type) WHERE id=$1 RETURNING *",
          [
            a.tenantId,
            d.nameBn,
            d.nameEn,
            d.division,
            d.district,
            d.upazila,
            d.officeType,
          ],
        )
      ).rows[0];
      await audit(db, a.tenantId!, a.userId, "OFFICE_UPDATED", a.tenantId, d);
      return camelRow(r);
    });
    res.json(item);
  }),
);

publicManagementRouter.get(
  "/offices",
  wrap(async (req, res) => {
    const p = pageInput.parse(req.query),
      q = z
        .string()
        .max(100)
        .parse(req.query.q ?? "");
    const filters = ["division", "district", "upazila", "type"].map((k) =>
      z
        .string()
        .max(100)
        .parse(req.query[k] ?? ""),
    );
    const values = [`%${q}%`, ...filters];
    const where =
      "status='ACTIVE' AND (name_bn ILIKE $1 OR name_en ILIKE $1 OR slug ILIKE $1) AND ($2='' OR division=$2) AND ($3='' OR district=$3) AND ($4='' OR upazila=$4) AND ($5='' OR office_type=$5)";
    const [items, count] = await Promise.all([
      pool.query(
        `SELECT id,slug,name_bn,name_en,division,district,upazila,office_type,demo FROM tenants WHERE ${where} ORDER BY name_en,id LIMIT $6 OFFSET $7`,
        [...values, p.pageSize, (p.page - 1) * p.pageSize],
      ),
      pool.query(
        `SELECT count(*)::int total FROM tenants WHERE ${where}`,
        values,
      ),
    ]);
    res.json({
      items: items.rows.map(camelRow),
      total: count.rows[0].total,
      ...p,
    });
  }),
);
publicManagementRouter.get(
  "/offices/:slug",
  wrap(async (req, res) => {
    const office = (
      await pool.query(
        "SELECT id,slug,name_bn,name_en,division,district,upazila,office_type,demo FROM tenants WHERE slug=$1 AND status='ACTIVE'",
        [req.params.slug],
      )
    ).rows[0];
    if (!office) fail(404, "NOT_FOUND", "Office not found.");
    const services = await transaction(office.id, async (db) =>
      (
        await db.query(
          "SELECT s.service_no,s.name_bn,s.name_en,s.readiness,c.credit_cost FROM service_catalog s JOIN tenant_service_configuration c USING(service_no) WHERE c.enabled ORDER BY s.service_no",
        )
      ).rows.map(camelRow),
    );
    const notices = (
      await pool.query(
        "SELECT * FROM public_notices() WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50",
        [office.id],
      )
    ).rows.map(camelRow);
    res.json({ office: camelRow(office), services, notices });
  }),
);
publicManagementRouter.get(
  "/notices",
  wrap(async (req, res) => {
    const p = pageInput.parse(req.query),
      office = z
        .string()
        .max(50)
        .parse(req.query.office ?? "");
    const search = `%${z
      .string()
      .max(100)
      .parse(req.query.q ?? "")}%`;
    const [rows, count] = await Promise.all([
      pool.query(
        "SELECT * FROM public_notices() WHERE ($1='' OR office_slug=$1) AND (title_bn ILIKE $4 OR title_en ILIKE $4 OR body_bn ILIKE $4 OR body_en ILIKE $4) ORDER BY created_at DESC,id LIMIT $2 OFFSET $3",
        [office, p.pageSize, (p.page - 1) * p.pageSize, search],
      ),
      pool.query(
        "SELECT count(*)::int total FROM public_notices() WHERE ($1='' OR office_slug=$1) AND (title_bn ILIKE $2 OR title_en ILIKE $2 OR body_bn ILIKE $2 OR body_en ILIKE $2)",
        [office, search],
      ),
    ]);
    res.json({
      items: rows.rows.map(camelRow),
      total: count.rows[0].total,
      ...p,
    });
  }),
);
publicManagementRouter.post(
  "/auth/signup",
  wrap(async (req, res) => {
    const d = z
      .object({
        email,
        password,
        displayName: z.string().min(2).max(120),
        tenantId: uuid,
        nameBn: z.string().min(2).max(120),
        nameEn: z.string().min(2).max(120),
        dateOfBirth: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine(
            (v) =>
              Number.isFinite(Date.parse(v)) &&
              new Date(v).toISOString().slice(0, 10) === v,
          ),
        addressBn: z.string().min(4).max(500),
        addressEn: z.string().min(4).max(500),
        syntheticReference: z.string().regex(/^DEMO-[A-Za-z0-9-]{3,50}$/),
      })
      .strict()
      .parse(req.body);
    await transaction(d.tenantId, async (db) => {
      if (
        !(
          await db.query(
            "SELECT 1 FROM tenants WHERE id=$1 AND status='ACTIVE' FOR SHARE",
            [d.tenantId],
          )
        ).rowCount
      )
        fail(404, "NOT_FOUND", "Active office not found.");
      const user = (
        await db.query(
          "INSERT INTO platform_users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id",
          [d.email, d.displayName, hashPassword(d.password)],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,'citizen')",
        [user.id, d.tenantId],
      );
      await db.query(
        "INSERT INTO citizens(tenant_id,user_id,full_name_bn,full_name_en,date_of_birth,address_bn,address_en,synthetic_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          d.tenantId,
          user.id,
          d.nameBn,
          d.nameEn,
          d.dateOfBirth,
          d.addressBn,
          d.addressEn,
          d.syntheticReference,
        ],
      );
      await audit(db, d.tenantId, user.id, "DEMO_SELF_REGISTRATION", user.id);
    });
    res
      .status(201)
      .json({ registered: true, verificationState: "SYNTHETIC_DEMO" });
  }),
);
managementRouter.post(
  "/auth/password",
  wrap(async (req, res) => {
    const a = role(req, [
      "owner",
      "admin",
      "staff",
      "reviewer",
      "approver",
      "finance",
      "citizen",
    ]);
    const d = z
      .object({
        currentPassword: z.string().min(1).max(200),
        newPassword: password,
      })
      .strict()
      .parse(req.body);
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const user = (
        await db.query(
          "SELECT password_hash FROM platform_users WHERE id=$1 FOR UPDATE",
          [a.userId],
        )
      ).rows[0];
      if (!checkPassword(d.currentPassword, user.password_hash))
        fail(422, "PASSWORD_MISMATCH", "Current password is incorrect.");
      await db.query("UPDATE platform_users SET password_hash=$2 WHERE id=$1", [
        a.userId,
        hashPassword(d.newPassword),
      ]);
      await db.query(
        "UPDATE sessions SET expires_at=now() WHERE user_id=$1 AND csrf_token<>$2",
        [a.userId, a.csrfToken],
      );
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
    res.json({ changed: true });
  }),
);
managementRouter.get(
  "/admin/users",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]);
    const rows = await transaction(a.tenantId!, async (db) =>
      (
        await db.query(
          "SELECT u.id,u.email,u.display_name,m.role,m.active FROM staff_memberships m JOIN platform_users u ON u.id=m.user_id WHERE m.tenant_id=$1 ORDER BY u.display_name",
          [a.tenantId],
        )
      ).rows.map(camelRow),
    );
    res.json({ items: rows });
  }),
);
managementRouter.post(
  "/admin/users",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]),
      d = z
        .object({
          email,
          displayName: z.string().min(2).max(120),
          password,
          role: roleInput,
        })
        .strict()
        .parse(req.body);
    const item = await transaction(a.tenantId!, async (db) => {
      const u = (
        await db.query(
          "INSERT INTO platform_users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id,email,display_name",
          [d.email, d.displayName, hashPassword(d.password)],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,$3)",
        [u.id, a.tenantId, d.role],
      );
      await audit(db, a.tenantId!, a.userId, "MEMBERSHIP_CREATED", u.id, {
        role: d.role,
      });
      return { ...camelRow(u), role: d.role, active: true };
    });
    res.status(201).json(item);
  }),
);
managementRouter.patch(
  "/admin/users/:id",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]),
      id = uuid.parse(req.params.id),
      d = z
        .object({ role: roleInput.optional(), active: z.boolean().optional() })
        .strict()
        .refine((v) => Object.keys(v).length > 0)
        .parse(req.body);
    if (
      id === a.userId &&
      ((d.role && d.role !== "admin") || d.active === false)
    )
      fail(
        422,
        "SELF_ADMIN_CHANGE",
        "Another administrator must change your administrative membership.",
      );
    const item = await transaction(a.tenantId!, async (db) => {
      const r = (
        await db.query(
          "UPDATE staff_memberships SET role=coalesce($3,role),active=coalesce($4,active) WHERE tenant_id=$1 AND user_id=$2 RETURNING user_id,role,active",
          [a.tenantId, id, d.role, d.active],
        )
      ).rows[0];
      if (!r) fail(404, "NOT_FOUND", "Membership not found.");
      await audit(db, a.tenantId!, a.userId, "MEMBERSHIP_UPDATED", id, d);
      return camelRow(r);
    });
    res.json(item);
  }),
);
managementRouter.get(
  "/admin/authorizations",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]);
    res.json({
      items: await transaction(a.tenantId!, async (db) =>
        (
          await db.query(
            "SELECT * FROM approval_authorizations ORDER BY user_id,service_no",
          )
        ).rows.map(camelRow),
      ),
    });
  }),
);
managementRouter.put(
  "/admin/authorizations/:userId/:serviceNo",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]),
      id = uuid.parse(req.params.userId),
      no = z.coerce.number().int().min(1).max(47).parse(req.params.serviceNo),
      d = z
        .object({
          active: z.boolean(),
          authorityNote: z.string().trim().min(12).max(500),
        })
        .strict()
        .parse(req.body);
    const item = await transaction(a.tenantId!, async (db) => {
      if (
        !(
          await db.query(
            "SELECT 1 FROM staff_memberships WHERE tenant_id=$1 AND user_id=$2 AND active AND role='approver'",
            [a.tenantId, id],
          )
        ).rowCount
      )
        fail(
          422,
          "APPROVER_REQUIRED",
          "Select an active approver in this office.",
        );
      const r = (
        await db.query(
          "INSERT INTO approval_authorizations(tenant_id,user_id,service_no,active,authority_note) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,user_id,service_no) DO UPDATE SET active=excluded.active,authority_note=excluded.authority_note RETURNING *",
          [a.tenantId, id, no, d.active, `DEMO ONLY: ${d.authorityNote}`],
        )
      ).rows[0];
      await audit(
        db,
        a.tenantId!,
        a.userId,
        "DEMO_APPROVAL_GRANT_UPDATED",
        id,
        { serviceNo: no, active: d.active },
      );
      return camelRow(r);
    });
    res.json(item);
  }),
);
managementRouter.get(
  "/admin/services",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]);
    res.json({
      items: await transaction(a.tenantId!, async (db) =>
        (
          await db.query(
            "SELECT c.*,s.name_bn,s.name_en FROM tenant_service_configuration c JOIN service_catalog s USING(service_no) ORDER BY service_no",
          )
        ).rows.map(camelRow),
      ),
    });
  }),
);
managementRouter.patch(
  "/admin/services/:no",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]),
      no = z.coerce.number().int().min(1).max(47).parse(req.params.no),
      d = z
        .object({
          enabled: z.boolean().optional(),
          creditCost: z.number().int().min(1).max(10000).optional(),
        })
        .strict()
        .refine((v) => Object.keys(v).length > 0)
        .parse(req.body);
    const r = await transaction(a.tenantId!, async (db) => {
      const r = (
        await db.query(
          "UPDATE tenant_service_configuration SET enabled=coalesce($3,enabled),credit_cost=coalesce($4,credit_cost) WHERE tenant_id=$1 AND service_no=$2 RETURNING *",
          [a.tenantId, no, d.enabled, d.creditCost],
        )
      ).rows[0];
      if (!r) fail(404, "NOT_FOUND", "Service setting not found.");
      await audit(
        db,
        a.tenantId!,
        a.userId,
        "SERVICE_CONFIGURATION_UPDATED",
        String(no),
        d,
      );
      return camelRow(r);
    });
    res.json(r);
  }),
);
const noticeInput = z.object({
  titleBn: z.string().min(2).max(180),
  titleEn: z.string().min(2).max(180),
  bodyBn: z.string().min(2).max(5000),
  bodyEn: z.string().min(2).max(5000),
  published: z.boolean(),
});
managementRouter.get(
  "/admin/notices",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]);
    res.json({
      items: await transaction(a.tenantId!, async (db) =>
        (
          await db.query("SELECT * FROM notices ORDER BY created_at DESC")
        ).rows.map(camelRow),
      ),
    });
  }),
);
managementRouter.post(
  "/admin/notices",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]),
      d = noticeInput.strict().parse(req.body);
    const item = await transaction(a.tenantId!, async (db) => {
      const r = (
        await db.query(
          "INSERT INTO notices(tenant_id,title_bn,title_en,body_bn,body_en,published,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            a.tenantId,
            d.titleBn,
            d.titleEn,
            d.bodyBn,
            d.bodyEn,
            d.published,
            a.userId,
          ],
        )
      ).rows[0];
      await audit(db, a.tenantId!, a.userId, "NOTICE_CREATED", r.id);
      return camelRow(r);
    });
    res.status(201).json(item);
  }),
);
managementRouter.patch(
  "/admin/notices/:id",
  wrap(async (req, res) => {
    const a = role(req, ["admin"]),
      id = uuid.parse(req.params.id),
      d = noticeInput
        .partial()
        .strict()
        .refine((v) => Object.keys(v).length > 0)
        .parse(req.body);
    const item = await transaction(a.tenantId!, async (db) => {
      const r = (
        await db.query(
          "UPDATE notices SET title_bn=coalesce($2,title_bn),title_en=coalesce($3,title_en),body_bn=coalesce($4,body_bn),body_en=coalesce($5,body_en),published=coalesce($6,published),updated_at=now() WHERE id=$1 RETURNING *",
          [id, d.titleBn, d.titleEn, d.bodyBn, d.bodyEn, d.published],
        )
      ).rows[0];
      if (!r) fail(404, "NOT_FOUND", "Notice not found.");
      await audit(db, a.tenantId!, a.userId, "NOTICE_UPDATED", id);
      return camelRow(r);
    });
    res.json(item);
  }),
);
managementRouter.post(
  "/owner/tenants",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]),
      d = officeInput
        .extend({
          adminEmail: email,
          adminName: z.string().min(2).max(120),
          adminPassword: password,
        })
        .strict()
        .parse(req.body),
      id = randomUUID();
    const item = await transaction(id, async (db) => {
      const t = (
        await db.query(
          "INSERT INTO tenants(id,slug,name_bn,name_en,division,district,upazila,office_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            id,
            d.slug,
            d.nameBn,
            d.nameEn,
            d.division,
            d.district,
            d.upazila,
            d.officeType,
          ],
        )
      ).rows[0];
      const u = (
        await db.query(
          "INSERT INTO platform_users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id",
          [d.adminEmail, d.adminName, hashPassword(d.adminPassword)],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO staff_memberships(user_id,tenant_id,role) VALUES($1,$2,'admin')",
        [u.id, id],
      );
      await db.query("INSERT INTO tenant_wallets(tenant_id) VALUES($1)", [id]);
      await db.query(
        "INSERT INTO tenant_subscriptions(tenant_id,plan_id,valid_until,status) VALUES($1,'demo-monthly',now(),'EXPIRED')",
        [id],
      );
      await db.query(
        "INSERT INTO tenant_service_configuration(tenant_id,service_no) SELECT $1,service_no FROM service_catalog",
        [id],
      );
      await audit(db, id, a.userId, "TENANT_CREATED", id, { demo: true });
      return camelRow(t);
    });
    res.status(201).json(item);
  }),
);
managementRouter.patch(
  "/owner/tenants/:id",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]),
      id = uuid.parse(req.params.id),
      d = z
        .object({ status: z.enum(["ACTIVE", "SUSPENDED"]) })
        .strict()
        .parse(req.body);
    const item = await transaction(id, async (db) => {
      const t = (
        await db.query("UPDATE tenants SET status=$2 WHERE id=$1 RETURNING *", [
          id,
          d.status,
        ])
      ).rows[0];
      if (!t) fail(404, "NOT_FOUND", "Tenant not found.");
      await audit(db, id, a.userId, "TENANT_STATUS_UPDATED", id, d);
      return camelRow(t);
    });
    res.json(item);
  }),
);
