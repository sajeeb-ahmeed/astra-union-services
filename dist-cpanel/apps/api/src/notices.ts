import express from "express";
import { z } from "zod";
import { pool, type DB } from "./db.js";
import { fail } from "./models.js";
import type { Auth } from "./app.js";

/**
 * Phase 3E: global notices (billing plan §3.8) — the owner's portal-wide notices.
 * The per-office notices of migration 004 stay untouched; a platform notice is
 * published by the owner to the WHOLE portal (homepage + dashboards) for a window:
 * title + body in both languages, an optional link, a start/end, and publish /
 * unpublish at any time. Owner mutations follow the established platform pattern:
 * a mandatory reason and an append-only before/after history
 * (platform_notice_changes), because audit_events is FORCE-RLS tenant-scoped.
 * The public read returns only notices that are live right now.
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

export type NoticeStatus = "live" | "scheduled" | "expired" | "unpublished";
export function noticeStatus(r: any, now = new Date()): NoticeStatus {
  if (!r.published) return "unpublished";
  if (r.starts_at > now) return "scheduled";
  if (r.ends_at && r.ends_at <= now) return "expired";
  return "live";
}
const noticeRow = (r: any) => ({
  id: r.id,
  titleBn: r.title_bn,
  titleEn: r.title_en,
  bodyBn: r.body_bn,
  bodyEn: r.body_en,
  linkUrl: r.link_url ?? null,
  startsAt: r.starts_at,
  endsAt: r.ends_at ?? null,
  published: r.published,
  status: noticeStatus(r),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const noticeState = (r: any) => ({
  titleBn: r.title_bn,
  titleEn: r.title_en,
  bodyBn: r.body_bn,
  bodyEn: r.body_en,
  linkUrl: r.link_url ?? null,
  startsAt: r.starts_at instanceof Date ? r.starts_at.toISOString() : r.starts_at,
  endsAt: r.ends_at == null ? null : r.ends_at instanceof Date ? r.ends_at.toISOString() : r.ends_at,
  published: r.published,
});
const noticeBody = z
  .object({
    titleBn: z.string().trim().min(2).max(200),
    titleEn: z.string().trim().min(2).max(200),
    bodyBn: z.string().trim().min(1).max(4000),
    bodyEn: z.string().trim().min(1).max(4000),
    linkUrl: z
      .string()
      .trim()
      .regex(/^https?:\/\//, "The link must start with http:// or https://")
      .max(500)
      .nullable(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }).nullable(),
    published: z.boolean(),
    reason: z.string().trim().min(8).max(500),
  })
  .strict()
  .refine((v) => !v.endsAt || Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    message: "The end of the notice window must be after its start.",
  });

async function recordNoticeChange(
  db: DB,
  noticeId: string,
  action: "CREATE" | "UPDATE" | "PUBLISH",
  before: any,
  after: any,
  reason: string,
  actorId: string,
) {
  await db.query(
    "INSERT INTO platform_notice_changes(notice_id, action, before_state, after_state, reason, changed_by) VALUES($1,$2,$3,$4,$5,$6)",
    [
      noticeId,
      action,
      before ? JSON.stringify(noticeState(before)) : null,
      JSON.stringify(noticeState(after)),
      reason,
      actorId,
    ],
  );
}
async function withNoticeTx<T>(fn: (db: DB) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client as unknown as DB);
    await client.query("COMMIT");
    return out;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function loadNotice(db: DB, id: string, lock = false) {
  const row = (
    await db.query(`SELECT * FROM platform_notices WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [id])
  ).rows[0];
  if (!row) fail(404, "NOTICE_NOT_FOUND", "Notice not found. / নোটিশটি পাওয়া যায়নি।");
  return row;
}

export const noticesRouter = express.Router();

/** Owner: every platform notice with its derived status (live / scheduled / expired / unpublished). */
noticesRouter.get(
  "/owner/notices",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    const rows = (
      await pool.query("SELECT * FROM platform_notices ORDER BY starts_at DESC, created_at DESC")
    ).rows;
    res.json({ items: rows.map(noticeRow) });
  }),
);
/** Owner: publish a new platform notice. */
noticesRouter.post(
  "/owner/notices",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const d = noticeBody.parse(req.body);
    const notice = await withNoticeTx(async (db) => {
      const row = (
        await db.query(
          `INSERT INTO platform_notices(title_bn, title_en, body_bn, body_en, link_url, starts_at, ends_at, published, created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [d.titleBn, d.titleEn, d.bodyBn, d.bodyEn, d.linkUrl, d.startsAt, d.endsAt, d.published, a.userId],
        )
      ).rows[0];
      await recordNoticeChange(db, row.id, "CREATE", null, row, d.reason, a.userId);
      return row;
    });
    res.status(201).json({ notice: noticeRow(notice) });
  }),
);
/** Owner: edit a notice's content and window. */
noticesRouter.put(
  "/owner/notices/:id",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const id = uuid.parse(req.params.id);
    const d = noticeBody.parse(req.body);
    const notice = await withNoticeTx(async (db) => {
      const before = await loadNotice(db, id, true);
      const row = (
        await db.query(
          `UPDATE platform_notices SET title_bn=$2, title_en=$3, body_bn=$4, body_en=$5, link_url=$6,
                  starts_at=$7, ends_at=$8, published=$9, updated_at=now()
           WHERE id=$1 RETURNING *`,
          [id, d.titleBn, d.titleEn, d.bodyBn, d.bodyEn, d.linkUrl, d.startsAt, d.endsAt, d.published],
        )
      ).rows[0];
      await recordNoticeChange(db, id, "UPDATE", before, row, d.reason, a.userId);
      return row;
    });
    res.json({ notice: noticeRow(notice) });
  }),
);
/** Owner: publish or unpublish a notice at any time, without touching its content. */
noticesRouter.post(
  "/owner/notices/:id/publish",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const id = uuid.parse(req.params.id);
    const d = z
      .object({ published: z.boolean(), reason: z.string().trim().min(8).max(500) })
      .strict()
      .parse(req.body);
    const notice = await withNoticeTx(async (db) => {
      const before = await loadNotice(db, id, true);
      const row = (
        await db.query("UPDATE platform_notices SET published=$2, updated_at=now() WHERE id=$1 RETURNING *", [
          id,
          d.published,
        ])
      ).rows[0];
      await recordNoticeChange(db, id, "PUBLISH", before, row, d.reason, a.userId);
      return row;
    });
    res.json({ notice: noticeRow(notice) });
  }),
);
/** Owner: the audit history of one notice, newest first. */
noticesRouter.get(
  "/owner/notices/:id/changes",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    const id = uuid.parse(req.params.id);
    await loadNotice(pool as unknown as DB, id);
    const rows = (
      await pool.query(
        "SELECT action, before_state, after_state, reason, changed_by, created_at FROM platform_notice_changes WHERE notice_id=$1 ORDER BY created_at DESC, id DESC",
        [id],
      )
    ).rows;
    res.json({
      noticeId: id,
      items: rows.map((r) => ({
        action: r.action,
        before: r.before_state,
        after: r.after_state,
        reason: r.reason,
        changedBy: r.changed_by,
        createdAt: r.created_at,
      })),
    });
  }),
);

/** Public: the platform notices live right now — the portal banner's data. */
export const publicNoticesRouter = express.Router();
publicNoticesRouter.get(
  "/global-notices",
  wrap(async (_req, res) => {
    const rows = (
      await pool.query(
        `SELECT id, title_bn, title_en, body_bn, body_en, link_url, starts_at, ends_at
         FROM platform_notices
         WHERE published AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
         ORDER BY starts_at DESC, created_at DESC LIMIT 5`,
      )
    ).rows;
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        titleBn: r.title_bn,
        titleEn: r.title_en,
        bodyBn: r.body_bn,
        bodyEn: r.body_en,
        linkUrl: r.link_url ?? null,
        startsAt: r.starts_at,
        endsAt: r.ends_at ?? null,
      })),
    });
  }),
);
