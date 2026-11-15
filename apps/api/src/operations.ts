import express from "express";
import { pool } from "./db.js";
import { fail } from "./models.js";
import type { Auth } from "./app.js";

/**
 * Owner operations: one view of what needs attention across offices. The summary is counts and times only
 * (migration 037). Alerts turn those numbers into plain statements, e.g. the PC malware scanner has stopped.
 */
type Req = express.Request & { auth?: Auth };
const minutes = (from: string | null, now: number) => (from ? Math.floor((now - Date.parse(from)) / 60000) : null);

export function operationsAlerts(summary: any, now = Date.now()) {
  const alerts: { code: string; severity: "warning" | "critical"; minutes?: number; count?: number }[] = [];
  const s = summary.scanner;
  const waiting = Number(s.waiting) + Number(s.scanning);
  const oldest = minutes(s.oldestWaitingAt, now);
  const heartbeat = minutes(s.lastHeartbeatAt, now);
  // Files wait in quarantine while the scanner is off; say so before citizens notice.
  if (waiting > 0 && (heartbeat === null || heartbeat > 10))
    alerts.push({ code: "SCANNER_OFFLINE", severity: "critical", minutes: heartbeat ?? undefined, count: waiting });
  else if (oldest !== null && oldest > 30) alerts.push({ code: "SCAN_QUEUE_SLOW", severity: "warning", minutes: oldest, count: waiting });
  if (Number(s.errors) > 0) alerts.push({ code: "SCAN_ERRORS", severity: "warning", count: Number(s.errors) });
  const q = summary.queues;
  if (Number(q.rechargesPending) > 0) alerts.push({ code: "RECHARGES_PENDING", severity: "warning", count: Number(q.rechargesPending) });
  if (Number(q.officeAccountRequestsPending) > 0)
    alerts.push({ code: "ACCOUNT_REQUESTS_PENDING", severity: "warning", count: Number(q.officeAccountRequestsPending) });
  return alerts;
}

export const operationsRouter = express.Router();
operationsRouter.get("/owner/operations", (req: Req, res, next) => {
  (async () => {
    if (req.auth?.role !== "owner") fail(403, "ROLE_DENIED", "This role is not permitted.");
    const summary = (await pool.query("SELECT owner_operations_summary() s")).rows[0].s;
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...summary, alerts: operationsAlerts(summary) });
  })().catch(next);
});
