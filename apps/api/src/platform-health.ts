import express from "express";
import fs from "node:fs";
import { pool } from "./db.js";
import { fail } from "./models.js";
import { operationsAlerts } from "./operations.js";
import { emailAvailable, emailProviderIsLog, emailProviderName } from "./mailer.js";
import { otpAvailable, otpProviderIsLog, otpProviderName } from "./otp.js";
import { smsAvailable, smsProviderIsLog, smsProviderName } from "./sms.js";
import type { Auth } from "./app.js";

/**
 * W-020: platform health for the System Owner — read-only indicators
 * only. Nothing here changes configuration: there is no maintenance
 * mode and no in-product backup mechanism to toggle (both are recorded
 * as such below rather than invented), and any future config change
 * must go through an authorized, audited endpoint of its own.
 * Provider names and booleans only — no keys, secrets or credentials.
 */
type Req = express.Request & { auth?: Auth };
const wrap =
  (fn: (req: Req, res: express.Response) => Promise<unknown>) =>
  (req: Req, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
const appVersion = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ).version as string;
  } catch {
    return "unknown";
  }
})();
const minutes = (from: string | null, now: number) =>
  from ? Math.floor((now - Date.parse(from)) / 60000) : null;

export const platformHealthRouter = express.Router();
platformHealthRouter.get(
  "/owner/platform-health",
  wrap(async (req, res) => {
    if (req.auth?.role !== "owner")
      fail(403, "ROLE_DENIED", "Platform owner access required.");
    const started = Date.now();
    await pool.query("SELECT 1");
    const dbLatencyMs = Date.now() - started;
    const migrations = (
      await pool.query(
        "SELECT count(*)::int AS applied, max(name) AS latest FROM schema_migrations",
      )
    ).rows[0];
    const summary = (await pool.query("SELECT owner_operations_summary() s"))
      .rows[0].s;
    const merchants = (
      await pool.query("SELECT owner_payment_merchants_summary() s")
    ).rows[0].s;
    const now = Date.now();
    const scanner = summary.scanner;
    const heartbeatMinutes = minutes(scanner.lastHeartbeatAt, now);
    const email = {
      provider: emailProviderName(),
      available: emailAvailable(),
      logOnly: emailProviderIsLog(),
    };
    const sms = {
      provider: smsProviderName(),
      available: smsAvailable(),
      logOnly: smsProviderIsLog(),
    };
    const otp = {
      provider: otpProviderName(),
      available: otpAvailable(),
      logOnly: otpProviderIsLog(),
    };
    const alerts = operationsAlerts(summary, now);
    // A log provider sends nothing: in production that is a live
    // outage of the channel, not a healthy state.
    if (!email.available)
      alerts.push({ code: "EMAIL_NOT_CONFIGURED", severity: "warning" });
    else if (email.logOnly)
      alerts.push({ code: "EMAIL_LOG_ONLY", severity: "warning" });
    if (!sms.available)
      alerts.push({ code: "SMS_NOT_CONFIGURED", severity: "warning" });
    else if (sms.logOnly)
      alerts.push({ code: "SMS_LOG_ONLY", severity: "warning" });
    if (!otp.available)
      alerts.push({ code: "OTP_UNAVAILABLE", severity: "warning" });
    res.setHeader("Cache-Control", "no-store");
    res.json({
      checkedAt: new Date().toISOString(),
      app: {
        version: appVersion,
        node: process.version,
        environment: process.env.NODE_ENV ?? "development",
      },
      database: {
        ok: true,
        latencyMs: dbLatencyMs,
        migrationsApplied: migrations.applied,
        latestMigration: migrations.latest,
      },
      scanner: {
        waiting: Number(scanner.waiting),
        scanning: Number(scanner.scanning),
        errors: Number(scanner.errors),
        rejected: Number(scanner.rejected),
        oldestWaitingAt: scanner.oldestWaitingAt,
        lastHeartbeatAt: scanner.lastHeartbeatAt,
        heartbeatMinutesAgo: heartbeatMinutes,
        status:
          Number(scanner.waiting) + Number(scanner.scanning) > 0 &&
          (heartbeatMinutes === null || heartbeatMinutes > 10)
            ? "offline"
            : heartbeatMinutes !== null && heartbeatMinutes > 10
              ? "stale"
              : "ok",
      },
      queues: summary.queues,
      providers: {
        email,
        sms,
        otp,
        payment: {
          merchantsTotal: Number(merchants.merchantsTotal),
          officesConfigured: Number(merchants.officesConfigured),
          byProvider: merchants.byProvider,
          // Gateways are per-office merchant rows plus env gates; the
          // env side is presence-only (never a secret value).
          bkashEnvConfigured:
            (process.env.BKASH_ENVIRONMENT ?? "disabled") !== "disabled",
          sslcommerzLiveEnabled:
            process.env.SSLCOMMERZ_LIVE_ENABLED === "true",
        },
      },
      backup: {
        configured: false,
        note: "Backups are operator-run database dumps; the product holds no backup record, so no backup status is shown as healthy.",
      },
      maintenance: {
        enabled: false,
        note: "No maintenance mode exists in the product; there is no toggle to show.",
      },
      alerts,
    });
  }),
);
