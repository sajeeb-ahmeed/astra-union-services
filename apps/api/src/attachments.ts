import express from "express";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import type { Auth } from "./app.js";
import { pool, transaction, audit, type DB } from "./db.js";
import { digest, randomToken } from "./security.js";
import { ApiError, fail } from "./models.js";
import { createRateLimiter } from "./http-hardening.js";

type Request = express.Request & { auth?: Auth };
const uuid = z.string().uuid();
const version = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._+:/()-]*$/);
const scannerIdentity = z
  .object({
    workerId: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
    engineVersion: version,
    signatureVersion: version,
    signatureUpdatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
const finishInput = scannerIdentity
  .omit({ workerId: true })
  .extend({
    attachmentId: uuid,
    tenantId: uuid,
    leaseToken: z.string().regex(/^[a-f0-9]{64}$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    verdict: z.enum(["CLEAN", "REJECTED", "ERROR"]),
    reasonCode: z.enum([
      "OK",
      "UNSAFE_FILE",
      "SCAN_FAILED",
      "SCAN_LIMIT",
      "UNSUPPORTED_FILE",
      "SCANNER_UNAVAILABLE",
    ]),
  })
  .strict();
export type ScannerIdentity = z.infer<typeof scannerIdentity>;
export type ScanCompletion = z.infer<typeof finishInput>;
const wrap =
  (fn: (req: Request, res: express.Response) => Promise<unknown>) =>
  (req: Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
function actor(req: Request, permitted: string[]): Auth & { tenantId: string } {
  const a = req.auth ?? fail(401, "LOGIN_REQUIRED", "Sign in required.");
  if (!permitted.includes(a.role))
    fail(403, "ROLE_DENIED", "This role cannot access private attachments.");
  if (!a.tenantId)
    fail(403, "TENANT_REQUIRED", "An active tenant membership is required.");
  return a as Auth & { tenantId: string };
}
const readRoles = ["citizen", "staff", "admin", "reviewer", "approver"];
function freshSignature(value: string) {
  const time = Date.parse(value),
    now = Date.now();
  if (
    !Number.isFinite(time) ||
    time < now - 48 * 3600_000 ||
    time > now + 5 * 60_000
  )
    fail(
      422,
      "SCANNER_DEFINITIONS_INVALID",
      "Current scanner definitions are required.",
    );
}
const attachmentMetadata =
  "a.id,a.tenant_id,a.citizen_id,a.mime_type,a.byte_length,a.scan_state,a.content_sha256,a.scanned_sha256,a.scanned_at,a.scan_attempts,a.next_retry_at,a.scan_reason";
async function loadAttachment(
  db: DB,
  id: string,
  a: Auth,
  lock = false,
  includeBytes = false,
) {
  const row = (
    await db.query(
      `SELECT ${attachmentMetadata}${includeBytes ? ",a.bytes" : ""} FROM attachments a JOIN citizens c ON c.id=a.citizen_id AND c.tenant_id=a.tenant_id WHERE a.id=$1 AND a.tenant_id=$2 ${a.role === "citizen" ? "AND c.user_id=$3" : ""} ${lock ? "FOR UPDATE OF a" : ""}`,
      a.role === "citizen" ? [id, a.tenantId, a.userId] : [id, a.tenantId],
    )
  ).rows[0];
  if (!row) fail(404, "NOT_FOUND", "Attachment not found.");
  return row;
}
async function scannerAvailable(db: DB, tenantId: string) {
  return !!(
    await db.query(
      "SELECT 1 FROM attachment_scanner_heartbeats WHERE tenant_id=$1 AND seen_at>clock_timestamp()-interval '120 seconds' AND signature_updated_at>=clock_timestamp()-interval '48 hours' AND signature_updated_at<=clock_timestamp()+interval '5 minutes'",
      [tenantId],
    )
  ).rowCount;
}
function ready(row: any) {
  return (
    row.scan_state === "CLEAN" &&
    row.scanned_sha256 === row.content_sha256 &&
    !!row.scanned_at
  );
}
async function status(db: DB, row: any, a: Auth) {
  const available = await scannerAvailable(db, row.tenant_id);
  const retryAfter =
    row.scan_state === "ERROR" && row.scan_attempts < 3
      ? (row.next_retry_at?.toISOString() ?? null)
      : null;
  return {
    attachmentId: row.id,
    mimeType: row.mime_type,
    byteLength: row.byte_length,
    scanState: row.scan_state,
    downloadAllowed: ready(row),
    retryAllowed:
      ["citizen", "staff", "admin"].includes(a.role) &&
      row.scan_state === "ERROR" &&
      row.scan_attempts < 3 &&
      !!row.next_retry_at &&
      row.next_retry_at.getTime() <= Date.now(),
    retryAfter,
    reasonCode: row.scan_reason,
    scannedAt: row.scanned_at?.toISOString() ?? null,
    scannerAvailable: available,
  };
}
async function scanEvent(
  db: DB,
  row: any,
  event: string,
  actorId: string | null = null,
) {
  await db.query(
    "INSERT INTO attachment_scan_events(tenant_id,attachment_id,event,attempt,content_sha256,worker_id,reason_code,engine_version,signature_version,signature_updated_at,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      row.tenant_id,
      row.id,
      event,
      row.scan_attempts,
      row.content_sha256,
      row.scan_worker_id,
      row.scan_reason,
      row.scan_engine_version,
      row.scan_signature_version,
      row.scan_signature_updated_at,
      actorId,
    ],
  );
}

/** All references are checked under the caller's tenant transaction. Lock in ID
 * order so a final issuance gate and competing scans cannot observe torn state. */
export async function validateAttachmentReferences(
  db: DB,
  payload: unknown,
  citizenId: string,
  requireClean = false,
) {
  const references: { path: string; value: any }[] = [];
  function visit(value: any, path: string) {
    if (Array.isArray(value))
      value.forEach((item, i) => visit(item, `${path}[${i}]`));
    else if (value && typeof value === "object") {
      if (Object.hasOwn(value, "attachmentId"))
        references.push({ path, value });
      else
        for (const [key, item] of Object.entries(value))
          visit(item, path ? `${path}.${key}` : key);
    }
  }
  visit(payload, "");
  const rows = new Map<string, any>();
  for (const id of [
    ...new Set(references.map(({ value }) => uuid.parse(value.attachmentId))),
  ].sort()) {
    const row = (
      await db.query(
        "SELECT id,mime_type,byte_length,scan_state,content_sha256,scanned_sha256,scanned_at FROM attachments WHERE id=$1 AND citizen_id=$2 FOR SHARE",
        [id, citizenId],
      )
    ).rows[0];
    if (!row)
      fail(
        422,
        "ATTACHMENT_INVALID",
        "Private upload reference is not valid for this applicant and tenant.",
      );
    rows.set(id, row);
  }
  const issues = [];
  for (const { path, value } of references) {
    const row = rows.get(value.attachmentId);
    if (
      row.mime_type !== value.mimeType ||
      row.byte_length !== value.byteLength
    )
      fail(
        422,
        "ATTACHMENT_INVALID",
        "Private upload reference is not valid for this applicant and tenant.",
      );
    if (requireClean && !ready(row))
      issues.push({
        path,
        attachmentId: row.id,
        code: "attachment_not_ready",
        message: {
          bn: "নথির নিরাপত্তা যাচাই সম্পন্ন হয়নি। পরিষ্কার ফল পাওয়া পর্যন্ত অপেক্ষা করুন অথবা নথিটি বদলান।",
          en: "This document has not passed its security scan. Wait for a clean result or replace the document.",
        },
      });
  }
  if (issues.length)
    throw new ApiError(
      409,
      "ATTACHMENT_NOT_READY",
      "Supporting documents must pass security scanning before this action.",
      issues,
    );
}

export const attachmentsRouter = express.Router();
attachmentsRouter.post(
  "/attachments",
  wrap(async (req, res) => {
    const a = actor(req, ["citizen", "staff", "admin"]);
    const input = z
      .object({
        citizenId: uuid,
        mimeType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
        base64: z.string().max(2796204),
      })
      .strict()
      .parse(req.body);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64))
      fail(422, "UPLOAD_INVALID", "Malformed base64 upload.");
    const bytes = Buffer.from(input.base64, "base64");
    if (bytes.length < 8 || bytes.length > 2097152)
      fail(422, "UPLOAD_SIZE", "Uploads must be between 8 bytes and 2 MiB.");
    if (bytes.toString("base64") !== input.base64)
      fail(422, "UPLOAD_INVALID", "Malformed base64 upload.");
    const valid =
      input.mimeType === "application/pdf"
        ? bytes.subarray(0, 5).toString() === "%PDF-" &&
          bytes.subarray(-1024).includes(Buffer.from("%%EOF"))
        : input.mimeType === "image/png"
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
    const result = await transaction(a.tenantId, async (db) => {
      const citizen = (
        await db.query(
          `SELECT 1 FROM citizens WHERE id=$1 AND tenant_id=$2 ${a.role === "citizen" ? "AND user_id=$3" : ""}`,
          a.role === "citizen"
            ? [input.citizenId, a.tenantId, a.userId]
            : [input.citizenId, a.tenantId],
        )
      ).rowCount;
      if (!citizen) fail(404, "NOT_FOUND", "Citizen not found.");
      const row = (
        await db.query(
          "INSERT INTO attachments(tenant_id,citizen_id,uploaded_by,mime_type,byte_length,bytes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [
            a.tenantId,
            input.citizenId,
            a.userId,
            input.mimeType,
            bytes.length,
            bytes,
          ],
        )
      ).rows[0];
      await audit(
        db,
        a.tenantId,
        a.userId,
        "PRIVATE_ATTACHMENT_UPLOADED",
        row.id,
        { scanState: "QUARANTINED" },
      );
      return status(db, row, a);
    });
    res.status(201).json(result);
  }),
);
attachmentsRouter.get(
  "/attachments/:id/status",
  wrap(async (req, res) => {
    const a = actor(req, readRoles),
      id = uuid.parse(req.params.id);
    z.object({}).strict().parse(req.query);
    res.json(
      await transaction(a.tenantId, async (db) =>
        status(db, await loadAttachment(db, id, a), a),
      ),
    );
  }),
);
attachmentsRouter.post(
  "/attachments/:id/retry",
  wrap(async (req, res) => {
    const a = actor(req, ["citizen", "staff", "admin"]),
      id = uuid.parse(req.params.id);
    z.object({}).strict().parse(req.body);
    res.json(
      await transaction(a.tenantId, async (db) => {
        const row = await loadAttachment(db, id, a, true);
        if (row.scan_state !== "ERROR" || row.scan_attempts >= 3)
          fail(
            409,
            "ATTACHMENT_RETRY_DENIED",
            "This document cannot be retried. Replace it if needed.",
          );
        if (!row.next_retry_at || row.next_retry_at.getTime() > Date.now())
          fail(
            429,
            "ATTACHMENT_RETRY_WAIT",
            "Please wait before retrying the security scan.",
          );
        const next = (
          await db.query(
            "UPDATE attachments SET scan_state='QUARANTINED',scan_reason='PENDING_SCAN',next_retry_at=NULL WHERE id=$1 RETURNING *",
            [id],
          )
        ).rows[0];
        await scanEvent(db, next, "RETRY_REQUESTED", a.userId);
        return status(db, next, a);
      }),
    );
  }),
);
attachmentsRouter.get(
  "/attachments/:id",
  wrap(async (req, res) => {
    const a = actor(req, readRoles),
      id = uuid.parse(req.params.id);
    const row = await transaction(a.tenantId, async (db) => {
      const row = await loadAttachment(db, id, a, false, true);
      if (!ready(row))
        fail(
          409,
          "ATTACHMENT_NOT_READY",
          "This document is quarantined until its security scan passes.",
        );
      return row;
    });
    res
      .type(row.mime_type)
      .setHeader(
        "Content-Disposition",
        'attachment; filename="private-upload"',
      );
    res.send(row.bytes);
  }),
);

/** Trusted scanner service only. No cookie/session/Origin may authenticate it. */
export const attachmentScannerRouter = express.Router();
const scannerLimiter = createRateLimiter({
  limit: 120,
  windowMs: 60_000,
  key: () => "attachment-scanner",
});
attachmentScannerRouter.use("/internal/attachment-scans", (req, res, next) => {
  try {
    const secret = process.env.ATTACHMENT_SCANNER_SECRET;
    const supplied = req.header("Authorization");
    if (
      req.header("Cookie") !== undefined ||
      req.header("Origin") !== undefined ||
      !secret ||
      !/^[a-f0-9]{64}$/i.test(secret) ||
      !supplied ||
      !/^Bearer [a-f0-9]{64}$/i.test(supplied) ||
      !timingSafeEqual(
        Buffer.from(supplied.slice(7), "hex"),
        Buffer.from(secret, "hex"),
      )
    )
      fail(401, "SCANNER_AUTH_REQUIRED", "Scanner authentication is required.");
    scannerLimiter(req, res, next);
  } catch (error) {
    next(error);
  }
});
attachmentScannerRouter.post(
  "/internal/attachment-scans/claim",
  wrap(async (req, res) => {
    res.json({
      job: await claimAttachmentScan(scannerIdentity.parse(req.body)),
    });
  }),
);
attachmentScannerRouter.post(
  "/internal/attachment-scans/finish",
  wrap(async (req, res) => {
    await finishAttachmentScan(finishInput.parse(req.body));
    res.json({ accepted: true });
  }),
);

/** Callers are trusted server code. HTTP validates the same schema and supplies no scope override. */
export async function claimAttachmentScan(raw: ScannerIdentity) {
  const input = scannerIdentity.parse(raw);
  freshSignature(input.signatureUpdatedAt);
  const tenants = (
    await pool.query("SELECT id FROM tenants WHERE status='ACTIVE' ORDER BY id")
  ).rows;
  if (!tenants.length) return null;
  // A shared transaction lock gives concurrent workers the same fair schedule.
  // Every statement still uses the restricted role and an explicit tenant scope.
  return transaction(tenants[0].id, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(1095976001,15)");
    const candidates: { id: string; lastClaimed: number }[] = [];
    for (const tenant of tenants) {
      await db.query("SELECT set_config('astra.tenant_id',$1,true)", [
        tenant.id,
      ]);
      await db.query(
        "INSERT INTO attachment_scanner_heartbeats(tenant_id,worker_id,engine_version,signature_version,signature_updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id) DO UPDATE SET worker_id=EXCLUDED.worker_id,engine_version=EXCLUDED.engine_version,signature_version=EXCLUDED.signature_version,signature_updated_at=EXCLUDED.signature_updated_at,seen_at=clock_timestamp()",
        [
          tenant.id,
          input.workerId,
          input.engineVersion,
          input.signatureVersion,
          input.signatureUpdatedAt,
        ],
      );
      const expired = (
        await db.query(
          "SELECT id FROM attachments WHERE scan_state='SCANNING' AND lease_expires_at<=clock_timestamp() ORDER BY lease_expires_at,id LIMIT 20 FOR UPDATE SKIP LOCKED",
        )
      ).rows;
      for (const row of expired) {
        const next = (
          await db.query(
            "UPDATE attachments SET scan_state='ERROR',scan_reason='SCAN_FAILED',lease_token_hash=NULL,lease_expires_at=NULL,next_retry_at=clock_timestamp()+interval '60 seconds' WHERE id=$1 RETURNING *",
            [row.id],
          )
        ).rows[0];
        await scanEvent(db, next, "LEASE_EXPIRED");
      }
      const eligible = (
        await db.query(
          "SELECT last_claimed_at FROM attachment_scanner_heartbeats WHERE tenant_id=$1 AND EXISTS(SELECT 1 FROM attachments WHERE scan_attempts<3 AND (scan_state='QUARANTINED' OR (scan_state='ERROR' AND next_retry_at<=clock_timestamp())))",
          [tenant.id],
        )
      ).rows[0];
      if (eligible)
        candidates.push({
          id: tenant.id,
          lastClaimed: eligible.last_claimed_at?.getTime() ?? 0,
        });
    }
    candidates.sort(
      (a, b) => a.lastClaimed - b.lastClaimed || a.id.localeCompare(b.id),
    );
    for (const tenant of candidates) {
      await db.query("SELECT set_config('astra.tenant_id',$1,true)", [
        tenant.id,
      ]);
      const row = (
        await db.query(
          "SELECT * FROM attachments WHERE scan_attempts<3 AND (scan_state='QUARANTINED' OR (scan_state='ERROR' AND next_retry_at<=clock_timestamp())) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
        )
      ).rows[0];
      if (!row) continue;
      const token = randomToken();
      const next = (
        await db.query(
          "UPDATE attachments SET scan_state='SCANNING',scan_attempts=scan_attempts+1,lease_token_hash=$2,lease_expires_at=clock_timestamp()+interval '120 seconds',next_retry_at=NULL,scan_reason='PENDING_SCAN',scan_worker_id=$3,scan_engine_version=$4,scan_signature_version=$5,scan_signature_updated_at=$6 WHERE id=$1 RETURNING *",
          [
            row.id,
            digest(token),
            input.workerId,
            input.engineVersion,
            input.signatureVersion,
            input.signatureUpdatedAt,
          ],
        )
      ).rows[0];
      await scanEvent(db, next, "CLAIMED");
      await db.query(
        "UPDATE attachment_scanner_heartbeats SET last_claimed_at=clock_timestamp() WHERE tenant_id=$1",
        [tenant.id],
      );
      return {
        attachmentId: row.id,
        tenantId: tenant.id,
        mimeType: row.mime_type,
        byteLength: row.byte_length,
        sha256: row.content_sha256,
        base64: row.bytes.toString("base64"),
        leaseToken: token,
        leaseExpiresAt: next.lease_expires_at.toISOString(),
      };
    }
    return null;
  });
}
export async function finishAttachmentScan(raw: ScanCompletion) {
  const input = finishInput.parse(raw);
  freshSignature(input.signatureUpdatedAt);
  if (
    (input.verdict === "CLEAN" && input.reasonCode !== "OK") ||
    (input.verdict !== "CLEAN" && input.reasonCode === "OK") ||
    (input.verdict === "REJECTED" &&
      !["UNSAFE_FILE", "SCAN_LIMIT", "UNSUPPORTED_FILE"].includes(
        input.reasonCode,
      )) ||
    (input.verdict === "ERROR" && input.reasonCode === "UNSAFE_FILE")
  )
    fail(
      422,
      "SCAN_RESULT_INVALID",
      "The scan verdict and reason do not agree.",
    );
  await transaction(input.tenantId, async (db) => {
    const row = (
      await db.query(
        "SELECT * FROM attachments WHERE id=$1 AND tenant_id=$2 FOR UPDATE",
        [input.attachmentId, input.tenantId],
      )
    ).rows[0];
    if (
      !row ||
      row.scan_state !== "SCANNING" ||
      row.lease_token_hash !== digest(input.leaseToken) ||
      row.content_sha256 !== input.sha256 ||
      row.scan_engine_version !== input.engineVersion ||
      row.scan_signature_version !== input.signatureVersion ||
      row.scan_signature_updated_at?.toISOString() !==
        new Date(input.signatureUpdatedAt).toISOString()
    )
      fail(
        409,
        "SCAN_LEASE_INVALID",
        "Scan lease is unavailable or no longer current.",
      );
    // The lease predicate is evaluated by PostgreSQL after taking the row lock.
    const next = (
      await db.query(
        "UPDATE attachments SET scan_state=$3,scan_reason=$4,lease_token_hash=NULL,lease_expires_at=NULL,next_retry_at=CASE WHEN $3='ERROR' THEN clock_timestamp()+interval '60 seconds' ELSE NULL END,scanned_at=CASE WHEN $3 IN ('CLEAN','REJECTED') THEN clock_timestamp() ELSE NULL END,scanned_sha256=CASE WHEN $3 IN ('CLEAN','REJECTED') THEN content_sha256 ELSE NULL END WHERE id=$1 AND tenant_id=$2 AND lease_expires_at>clock_timestamp() RETURNING *",
        [input.attachmentId, input.tenantId, input.verdict, input.reasonCode],
      )
    ).rows[0];
    if (!next)
      fail(
        409,
        "SCAN_LEASE_INVALID",
        "Scan lease is unavailable or no longer current.",
      );
    await scanEvent(db, next, input.verdict);
  });
}
