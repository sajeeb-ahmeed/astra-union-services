import express from "express";
import { z } from "zod";
import { pool, transaction, audit } from "./db.js";
import { fail } from "./models.js";
import type { Auth } from "./app.js";
import { attachmentReady, decodeUpload } from "./attachments.js";

/**
 * Phase 5b: offices recharge their points wallet by bank deposit and the platform owner confirms it.
 * The deposit slip is an office document in the attachment quarantine; a request can be confirmed only once
 * its slip has a clean scan. Confirmation credits exactly one RECHARGE ledger entry (key `recharge:<id>`).
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
const bankRow = (r: any) => ({
  code: r.code,
  nameBn: r.name_bn,
  nameEn: r.name_en,
  accountName: r.account_name,
  accountNumber: r.account_number,
  branch: r.branch,
  active: r.active,
});
const requestRow = (r: any) => ({
  id: r.id,
  tenantId: r.tenant_id,
  officeSlug: r.office_slug,
  officeNameBn: r.office_name_bn,
  officeNameEn: r.office_name_en,
  amountMinor: Number(r.amount_minor),
  bankCode: r.bank_code,
  depositReference: r.deposit_reference,
  depositDate: typeof r.deposit_date === "string" ? r.deposit_date : r.deposit_date?.toISOString().slice(0, 10),
  status: r.status,
  decisionNote: r.decision_note ?? null,
  proofScanState: r.scan_state ?? undefined,
  createdAt: r.created_at,
  decidedAt: r.decided_at ?? null,
});

export const rechargeRouter = express.Router();

/** Active deposit accounts, for offices preparing a recharge. */
rechargeRouter.get(
  "/recharge-banks",
  wrap(async (req, res) => {
    role(req, ["admin", "finance", "owner"]);
    const rows = (
      await pool.query(
        req.auth!.role === "owner"
          ? "SELECT * FROM recharge_banks ORDER BY active DESC, name_en"
          : "SELECT * FROM recharge_banks WHERE active ORDER BY name_en",
      )
    ).rows;
    res.json({ items: rows.map(bankRow) });
  }),
);
/** Owner: add or update a deposit account. Accounts are switched off, never deleted. */
rechargeRouter.put(
  "/owner/recharge-banks/:code",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const code = z.string().regex(/^[a-z0-9-]{2,40}$/).parse(req.params.code);
    const d = z
      .object({
        nameBn: z.string().trim().min(2).max(120),
        nameEn: z.string().trim().min(2).max(120),
        accountName: z.string().trim().min(2).max(120),
        accountNumber: z.string().trim().regex(/^[0-9A-Za-z -]{4,40}$/),
        branch: z.string().trim().max(120).nullable().optional(),
        active: z.boolean(),
      })
      .strict()
      .parse(req.body);
    const row = (
      await pool.query(
        `INSERT INTO recharge_banks(code,name_bn,name_en,account_name,account_number,branch,active) VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(code) DO UPDATE SET name_bn=$2,name_en=$3,account_name=$4,account_number=$5,branch=$6,active=$7 RETURNING *`,
        [code, d.nameBn, d.nameEn, d.accountName, d.accountNumber, d.branch || null, d.active],
      )
    ).rows[0];
    void a;
    res.json(bankRow(row));
  }),
);

/** Office: request a recharge with the deposit slip. */
rechargeRouter.post(
  "/recharges",
  wrap(async (req, res) => {
    const a = role(req, ["admin", "finance"]);
    // W-016: points recharge is PAUSED. The issuance spend path is retired
    // (points.ts header: issuing no longer deducts points), so nothing can
    // spend points — taking new bank deposits for them would sell dead
    // money. Refuse BEFORE any validation or slip storage, so no deposit
    // evidence is accepted for a paused product. The implementation below
    // is retained for re-enablement: restoring a spend path — or turning
    // recharge back on — is an OWNER DECISION, not implemented here.
    // Requests that were PENDING before the pause are still decided by the
    // owner below; their deposits were already made.
    fail(
      410,
      "POINTS_RECHARGE_DISABLED",
      "Points recharge is paused: points currently have no spend path, so no new deposits are accepted. Ask the platform owner about a spend path before re-enabling recharge.",
    );
    const d = z
      .object({
        amountMinor: z.number().int().min(100).max(100000000),
        bankCode: z.string().regex(/^[a-z0-9-]{2,40}$/),
        depositReference: z.string().trim().min(3).max(80),
        depositDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        proof: z
          .object({
            mimeType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
            base64: z.string().max(2796204),
          })
          .strict(),
      })
      .strict()
      .parse(req.body);
    const date = new Date(`${d.depositDate}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== d.depositDate || date.getTime() > Date.now() + 86400000)
      fail(422, "DEPOSIT_DATE_INVALID", "Enter the real deposit date; it cannot be in the future.");
    const bytes = decodeUpload(d.proof);
    const item = await transaction(a.tenantId!, async (db) => {
      const bank = (await db.query("SELECT 1 FROM recharge_banks WHERE code=$1 AND active", [d.bankCode])).rowCount;
      if (!bank) fail(422, "BANK_UNAVAILABLE", "Choose one of the listed deposit accounts.");
      const proof = (
        await db.query(
          "INSERT INTO attachments(tenant_id,citizen_id,uploaded_by,mime_type,byte_length,bytes,purpose) VALUES($1,NULL,$2,$3,$4,$5,'recharge_proof') RETURNING id,scan_state",
          [a.tenantId, a.userId, d.proof.mimeType, bytes.length, bytes],
        )
      ).rows[0];
      await db.query("SAVEPOINT recharge_create");
      let row;
      try {
        row = (
          await db.query(
            "INSERT INTO recharge_requests(tenant_id,amount_minor,bank_code,deposit_reference,deposit_date,proof_attachment_id,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [a.tenantId, d.amountMinor, d.bankCode, d.depositReference, d.depositDate, proof.id, a.userId],
          )
        ).rows[0];
        await db.query("RELEASE SAVEPOINT recharge_create");
      } catch (error: any) {
        await db.query("ROLLBACK TO SAVEPOINT recharge_create");
        if (error?.code === "23505")
          fail(409, "DEPOSIT_ALREADY_USED", "This deposit reference has already been submitted for this bank.");
        throw error;
      }
      await audit(db, a.tenantId!, a.userId, "RECHARGE_REQUESTED", row.id, {
        amountMinor: d.amountMinor,
        bankCode: d.bankCode,
      });
      return requestRow({ ...row, scan_state: proof.scan_state });
    });
    res.status(201).json(item);
  }),
);
/** Office: its recharge requests with the slip's scan state. */
rechargeRouter.get(
  "/recharges",
  wrap(async (req, res) => {
    const a = role(req, ["admin", "finance"]);
    const items = await transaction(a.tenantId!, async (db) =>
      (
        await db.query(
          "SELECT r.*,x.scan_state FROM recharge_requests r JOIN attachments x ON x.id=r.proof_attachment_id AND x.tenant_id=r.tenant_id WHERE r.tenant_id=$1 ORDER BY r.created_at DESC LIMIT 100",
          [a.tenantId],
        )
      ).rows.map(requestRow),
    );
    res.json({ items });
  }),
);

/** Owner: the cross-office queue (metadata only). */
rechargeRouter.get(
  "/owner/recharges",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    const status = z.enum(["PENDING", "CONFIRMED", "REJECTED"]).default("PENDING").parse(req.query.status);
    const rows = (await pool.query("SELECT * FROM owner_recharge_queue($1)", [status])).rows;
    res.json({ items: rows.map(requestRow) });
  }),
);
async function loadForOwner(db: any, tenantId: string, id: string, lock = false) {
  const row = (
    await db.query(
      `SELECT r.*,x.scan_state,x.content_sha256,x.scanned_sha256,x.scanned_at,x.mime_type FROM recharge_requests r JOIN attachments x ON x.id=r.proof_attachment_id AND x.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND r.id=$2${lock ? " FOR UPDATE OF r" : ""}`,
      [tenantId, id],
    )
  ).rows[0];
  if (!row) fail(404, "NOT_FOUND", "Recharge request not found.");
  return row;
}
const ownerTarget = z.object({ tenantId: uuid }).strict();
/** Owner: open a deposit slip, only after a clean scan. */
rechargeRouter.get(
  "/owner/recharges/:id/proof",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const id = uuid.parse(req.params.id);
    const { tenantId } = ownerTarget.parse(req.query);
    const row = await transaction(tenantId, async (db) => {
      const r = await loadForOwner(db, tenantId, id);
      if (!attachmentReady(r))
        fail(409, "ATTACHMENT_NOT_READY", "The deposit slip is quarantined until its security scan passes.");
      const bytes = (await db.query("SELECT bytes FROM attachments WHERE tenant_id=$1 AND id=$2", [tenantId, r.proof_attachment_id])).rows[0].bytes;
      await audit(db, tenantId, a.userId, "RECHARGE_PROOF_VIEWED", id);
      return { mime: r.mime_type, bytes };
    });
    res.type(row.mime).setHeader("Content-Disposition", 'attachment; filename="deposit-slip"').setHeader("Cache-Control", "no-store");
    res.send(row.bytes);
  }),
);
/** Owner: confirm (credits points once) or reject (with a reason) a pending request.
 * W-016: confirmation stays enabled for requests that were PENDING before the
 * recharge pause — those deposits were already made, so the credit is owed
 * (and the points may become spendable if a spend path is ever restored).
 * New requests are refused at POST /recharges, so nothing new enters the queue. */
rechargeRouter.post(
  "/owner/recharges/:id/decision",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const id = uuid.parse(req.params.id);
    const d = z
      .object({
        tenantId: uuid,
        decision: z.enum(["CONFIRMED", "REJECTED"]),
        note: z.string().trim().min(3).max(500).optional(),
      })
      .strict()
      .refine((v) => v.decision !== "REJECTED" || !!v.note, { message: "Give a reason for rejecting." })
      .parse(req.body);
    const item = await transaction(d.tenantId, async (db) => {
      const r = await loadForOwner(db, d.tenantId, id, true);
      if (r.status !== "PENDING") fail(409, "RECHARGE_ALREADY_DECIDED", "This recharge request has already been decided.");
      if (d.decision === "CONFIRMED" && !attachmentReady(r))
        fail(409, "ATTACHMENT_NOT_READY", "Confirm only after the deposit slip passes its security scan.");
      const updated = (
        await db.query(
          "UPDATE recharge_requests SET status=$3,decided_by=$4,decided_at=now(),decision_note=$5 WHERE tenant_id=$1 AND id=$2 RETURNING *",
          [d.tenantId, id, d.decision, a.userId, d.note ?? null],
        )
      ).rows[0];
      if (d.decision === "CONFIRMED")
        await db.query(
          "INSERT INTO point_ledger(tenant_id,delta_minor,kind,idempotency_key,actor_id,reason,balance_after) VALUES($1,$2,'RECHARGE',$3,$4,$5,0)",
          [d.tenantId, r.amount_minor, `recharge:${id}`, a.userId, `Bank recharge ${r.bank_code} ${r.deposit_reference}`],
        );
      await audit(db, d.tenantId, a.userId, d.decision === "CONFIRMED" ? "RECHARGE_CONFIRMED" : "RECHARGE_REJECTED", id, {
        amountMinor: Number(r.amount_minor),
        note: d.note ?? null,
      });
      return requestRow({ ...updated, scan_state: r.scan_state });
    });
    res.json(item);
  }),
);
