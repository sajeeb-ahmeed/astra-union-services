import express from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { fail } from "./models.js";
import type { Auth } from "./app.js";

/**
 * W-012: global platform statistics for the System Owner. The numbers
 * come from owner_statistics() (migration 068), a SECURITY DEFINER
 * function that aggregates across tenants — the application role cannot
 * read across tenants itself (FORCE RLS). Counts only; no personal data.
 * The range is UTC calendar days (see docs/OWNER_STATISTICS.md).
 */
type Req = express.Request & { auth?: Auth };
const wrap =
  (fn: (req: Req, res: express.Response) => Promise<unknown>) =>
  (req: Req, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
const querySchema = z
  .object({
    from: date.optional(),
    to: date.optional(),
    tenantId: z.string().uuid().optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "Invalid date interval",
  });
function owner(req: Req) {
  if (req.auth?.role !== "owner")
    fail(403, "ROLE_DENIED", "Platform owner access required.");
}
async function loadStatistics(q: { from?: string; to?: string; tenantId?: string }) {
  if (q.tenantId) {
    const exists = (
      await pool.query("SELECT id FROM tenants WHERE id=$1", [q.tenantId])
    ).rowCount;
    if (!exists) fail(404, "NOT_FOUND", "Office not found.");
  }
  const stats = (
    await pool.query("SELECT owner_statistics($1,$2,$3) s", [
      q.from ?? null,
      q.to ?? null,
      q.tenantId ?? null,
    ])
  ).rows[0].s;
  return {
    ...stats,
    from: q.from ?? null,
    to: q.to ?? null,
    timezone: "UTC",
    tenantId: q.tenantId ?? null,
  };
}
const csvCell = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;

export const ownerStatisticsRouter = express.Router();
ownerStatisticsRouter.get(
  "/owner/statistics",
  wrap(async (req, res) => {
    owner(req);
    res.setHeader("Cache-Control", "no-store");
    res.json(await loadStatistics(querySchema.parse(req.query)));
  }),
);
ownerStatisticsRouter.get(
  "/owner/statistics/export",
  wrap(async (req, res) => {
    owner(req);
    // `format` is the export's own parameter — it must not reach the
    // strict statistics query schema.
    const { format, ...rest } = z
      .object({ format: z.enum(["json", "csv"]).default("csv") })
      .passthrough()
      .parse(req.query);
    const stats = await loadStatistics(querySchema.parse(rest));
    if (format === "json") {
      res.setHeader("Cache-Control", "no-store");
      res.json(stats);
      return;
    }
    // One row per office plus a TOTAL row; the office rows add up to it
    // (the same range and counting rules as the JSON body).
    const rows = [
      ["office_slug", "office_name_en", "citizens", "applications", "certificates"],
      ...stats.offices.map((o: any) => [
        o.slug,
        o.nameEn,
        o.citizens,
        o.applications,
        o.certificates,
      ]),
      [
        "TOTAL",
        stats.tenantId ? stats.offices[0]?.nameEn ?? "" : "All offices",
        stats.totals.citizens,
        stats.totals.applications,
        stats.totals.certificates,
      ],
    ];
    const day = stats.to ?? new Date().toISOString().slice(0, 10);
    res
      .type("text/csv")
      .setHeader(
        "Content-Disposition",
        `attachment; filename="digitalunion-statistics-${day}.csv"`,
      )
      .send(
        "\uFEFF" +
          rows.map((r) => r.map(csvCell).join(",")).join("\r\n"),
      );
  }),
);
