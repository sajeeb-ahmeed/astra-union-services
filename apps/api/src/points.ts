import express from "express";
import { z } from "zod";
import { pool, transaction, audit, type DB } from "./db.js";
import { fail } from "./models.js";
import type { Auth } from "./app.js";

/**
 * Phase 5a: the points wallet (1 BDT = 1 point, in poisha) beside the credit wallet. The append-only
 * point_ledger is the source of truth; balances change only through ledger entries (migration 029).
 */
type Req = express.Request & { auth?: Auth };
const wrap =
  (fn: (req: Req, res: express.Response) => Promise<unknown>) =>
  (req: Req, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);
function role(req: Req, allowed: string[]) {
  if (!req.auth || !allowed.includes(req.auth.role)) fail(403, "ROLE_DENIED", "This role is not permitted.");
  return req.auth!;
}
const uuid = z.string().uuid();
const serviceNumber = z.coerce.number().int().min(1).max(47);

const ledgerRow = (r: any) => ({
  id: r.id,
  deltaMinor: Number(r.delta_minor),
  kind: r.kind,
  reason: r.reason,
  certificateId: r.certificate_id,
  balanceAfterMinor: Number(r.balance_after),
  createdAt: r.created_at,
});

/** The service's current owner-set price in poisha, or 0 when it has none. */
export async function currentPointPrice(db: DB, serviceNo: number) {
  const row = (
    await db.query(
      "SELECT price_minor FROM service_point_prices WHERE service_no=$1 ORDER BY version DESC LIMIT 1",
      [serviceNo],
    )
  ).rows[0];
  return (row?.price_minor ?? 0) as number;
}
/**
 * Deduct a certificate's point price inside the issuance transaction. Exactly once per certificate: the
 * idempotency key and the unique issuance index both name the certificate.
 */
export async function chargeIssuancePoints(
  db: DB,
  tenantId: string,
  serviceNo: number,
  certificateId: string,
  actorId: string,
) {
  const price = await currentPointPrice(db, serviceNo);
  if (!price) return 0;
  const balance = Number(
    (await db.query("SELECT balance_minor FROM point_wallets WHERE tenant_id=$1", [tenantId])).rows[0]?.balance_minor ?? 0,
  );
  if (balance < price)
    fail(
      402,
      "POINTS_INSUFFICIENT",
      `This certificate costs ${(price / 100).toFixed(2)} points and the office has ${(balance / 100).toFixed(2)}. Recharge the points wallet. The approved application is kept.`,
    );
  await db.query(
    "INSERT INTO point_ledger(tenant_id,delta_minor,kind,idempotency_key,certificate_id,actor_id,reason,balance_after) VALUES($1,$2,'ISSUANCE',$3,$4,$5,'Certificate issuance',0)",
    [tenantId, -price, `issuance:${certificateId}`, certificateId, actorId],
  );
  return price;
}

export const pointsRouter = express.Router();

/** The office's points balance and recent movements. */
pointsRouter.get(
  "/wallet/points",
  wrap(async (req, res) => {
    const a = role(req, ["admin", "finance", "approver", "staff"]);
    const result = await transaction(a.tenantId!, async (db) => {
      const wallet = (await db.query("SELECT balance_minor FROM point_wallets WHERE tenant_id=$1", [a.tenantId])).rows[0];
      const ledger = (
        await db.query("SELECT * FROM point_ledger WHERE tenant_id=$1 ORDER BY created_at DESC, id LIMIT 100", [a.tenantId])
      ).rows.map(ledgerRow);
      const prices = (
        await db.query(
          "SELECT DISTINCT ON (p.service_no) p.service_no,p.price_minor FROM service_point_prices p JOIN tenant_service_configuration c ON c.service_no=p.service_no AND c.tenant_id=$1 AND c.enabled ORDER BY p.service_no,p.version DESC",
          [a.tenantId],
        )
      ).rows.map((r) => ({ serviceNo: r.service_no, priceMinor: r.price_minor }));
      return { balanceMinor: Number(wallet?.balance_minor ?? 0), ledger, prices };
    });
    res.json(result);
  }),
);

/** Owner: the current point price of every service. */
pointsRouter.get(
  "/owner/point-prices",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    const rows = (
      await pool.query(
        `SELECT s.service_no,s.name_bn,s.name_en,p.version,p.price_minor,p.created_at
         FROM service_catalog s LEFT JOIN LATERAL (SELECT * FROM service_point_prices x WHERE x.service_no=s.service_no ORDER BY x.version DESC LIMIT 1) p ON true
         ORDER BY s.service_no`,
      )
    ).rows;
    res.json({
      items: rows.map((r) => ({
        serviceNo: r.service_no,
        nameBn: r.name_bn,
        nameEn: r.name_en,
        version: r.version ?? 0,
        priceMinor: r.price_minor ?? 0,
        updatedAt: r.created_at ?? null,
      })),
    });
  }),
);
/**
 * Owner: publish a new price version for one service. Versions are never edited, and each records who set it,
 * when and why, so the price table is its own audit trail (platform-level, not tied to one office).
 */
pointsRouter.post(
  "/owner/point-prices/:no",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const serviceNo = serviceNumber.parse(req.params.no);
    const d = z
      .object({
        expectedVersion: z.number().int().min(0).max(2147483646),
        priceMinor: z.number().int().min(0).max(10000000),
        reason: z.string().trim().min(3).max(500),
      })
      .strict()
      .parse(req.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('service_point_prices'), $1)", [serviceNo]);
      const current = (
        await client.query("SELECT coalesce(max(version),0)::int v FROM service_point_prices WHERE service_no=$1", [serviceNo])
      ).rows[0].v;
      if (current !== d.expectedVersion)
        fail(409, "POINT_PRICE_STALE", "The price changed. Reload the current version before publishing.");
      const row = (
        await client.query(
          "INSERT INTO service_point_prices(service_no,version,price_minor,reason,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [serviceNo, current + 1, d.priceMinor, d.reason, a.userId],
        )
      ).rows[0];
      await client.query("COMMIT");
      res.status(201).json({ serviceNo, version: row.version, priceMinor: row.price_minor });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);
/** Owner: an office's points balance and movements. */
pointsRouter.get(
  "/owner/tenants/:id/points",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    const id = uuid.parse(req.params.id);
    const result = await transaction(id, async (db) => {
      const wallet = (await db.query("SELECT balance_minor FROM point_wallets WHERE tenant_id=$1", [id])).rows[0];
      if (!wallet) fail(404, "NOT_FOUND", "Office not found.");
      const ledger = (
        await db.query("SELECT * FROM point_ledger WHERE tenant_id=$1 ORDER BY created_at DESC, id LIMIT 100", [id])
      ).rows.map(ledgerRow);
      return { balanceMinor: Number(wallet.balance_minor), ledger };
    });
    res.json(result);
  }),
);
/**
 * Owner: adjust an office's points through the ledger (never by editing the balance). `requestKey` makes a
 * retried request apply once.
 */
pointsRouter.post(
  "/owner/tenants/:id/points/adjust",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const id = uuid.parse(req.params.id);
    const d = z
      .object({
        deltaMinor: z
          .number()
          .int()
          .min(-100000000)
          .max(100000000)
          .refine((n) => n !== 0),
        reason: z.string().trim().min(8).max(500),
        requestKey: uuid,
      })
      .strict()
      .parse(req.body);
    const entry = await transaction(id, async (db) => {
      const wallet = (await db.query("SELECT balance_minor FROM point_wallets WHERE tenant_id=$1", [id])).rows[0];
      if (!wallet) fail(404, "NOT_FOUND", "Office not found.");
      const key = `adjustment:${d.requestKey}`;
      const existing = (
        await db.query("SELECT * FROM point_ledger WHERE tenant_id=$1 AND idempotency_key=$2", [id, key])
      ).rows[0];
      if (existing) return ledgerRow(existing);
      if (Number(wallet.balance_minor) + d.deltaMinor < 0)
        fail(422, "NEGATIVE_BALANCE", "The adjustment cannot make the points balance negative.");
      const row = (
        await db.query(
          "INSERT INTO point_ledger(tenant_id,delta_minor,kind,idempotency_key,actor_id,reason,balance_after) VALUES($1,$2,'ADJUSTMENT',$3,$4,$5,0) RETURNING *",
          [id, d.deltaMinor, key, a.userId, d.reason],
        )
      ).rows[0];
      await audit(db, id, a.userId, "POINTS_ADJUSTED", row.id, { deltaMinor: d.deltaMinor, reason: d.reason });
      return ledgerRow(row);
    });
    res.status(201).json(entry);
  }),
);
