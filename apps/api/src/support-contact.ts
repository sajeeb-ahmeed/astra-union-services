import express from "express";
import { z } from "zod";
import { pool, type DB } from "./db.js";
import { fail } from "./models.js";
import type { Auth } from "./app.js";

/**
 * F-001: the platform's public support contact is owner-configurable.
 *
 * The audit found no phone number, email or office hours anywhere on the
 * public site — the shells hard-coded an empty SUPPORT_CONTACT and every
 * surface hid the empty fields. The real channels are the owner's to
 * supply: they live in platform_settings (the same store as the branding
 * and the fee payer), so an owner-only write needs a mandatory reason and
 * lands one append-only platform_setting_changes row per changed key, and
 * nothing is seeded — a key that was never set renders as "not published"
 * (the field stays hidden), never as a placeholder or an invented value.
 * The public read returns the stored values with empty defaults applied.
 */
export type SupportContact = {
  phone: string;
  email: string;
  hoursBn: string;
  hoursEn: string;
};
export const SUPPORT_CONTACT_DEFAULTS: SupportContact = {
  phone: "",
  email: "",
  hoursBn: "",
  hoursEn: "",
};
const SUPPORT_CONTACT_FIELDS = [
  ["phone", "support_phone"],
  ["email", "support_email"],
  ["hoursBn", "support_hours_bn"],
  ["hoursEn", "support_hours_en"],
] as const;

type Req = express.Request & { auth?: Auth };
const wrap =
  (fn: (req: Req, res: express.Response) => Promise<unknown>) =>
  (req: Req, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);
function role(req: Req, allowed: string[]) {
  if (!req.auth || !allowed.includes(req.auth.role))
    fail(403, "ROLE_DENIED", "This action requires a different role.");
  return req.auth;
}

/** The platform's current support contact: stored values where the owner set them, empty elsewhere. */
export async function platformSupportContact(db: DB): Promise<SupportContact> {
  const rows = (
    await db.query("SELECT key, value FROM platform_settings WHERE key = ANY($1)", [
      SUPPORT_CONTACT_FIELDS.map(([, key]) => key),
    ])
  ).rows;
  const stored = new Map(rows.map((r) => [r.key as string, r.value as string]));
  return {
    phone: stored.get("support_phone") ?? SUPPORT_CONTACT_DEFAULTS.phone,
    email: stored.get("support_email") ?? SUPPORT_CONTACT_DEFAULTS.email,
    hoursBn: stored.get("support_hours_bn") ?? SUPPORT_CONTACT_DEFAULTS.hoursBn,
    hoursEn: stored.get("support_hours_en") ?? SUPPORT_CONTACT_DEFAULTS.hoursEn,
  };
}

const emailOrEmpty = z
  .string()
  .trim()
  .max(120)
  .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
    message: "Enter a valid email address or leave it blank.",
  });
const putSchema = z
  .object({
    phone: z.string().trim().max(40),
    email: emailOrEmpty,
    hoursBn: z.string().trim().max(200),
    hoursEn: z.string().trim().max(200),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();

export const supportContactRouter = express.Router();

/** Public: the support contact the shells render (empty fields = not published). Mounted before the session gate. */
supportContactRouter.get(
  "/support-contact",
  wrap(async (_req, res) => {
    res.json(await platformSupportContact(pool as unknown as DB));
  }),
);

/** Owner routes — mounted after the session gate (req.auth is populated there). */
export const ownerSupportContactRouter = express.Router();

/** Owner: the current support contact (stored values with empty defaults applied). */
ownerSupportContactRouter.get(
  "/owner/support-contact",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    res.json(await platformSupportContact(pool as unknown as DB));
  }),
);
/** Owner: replace the support contact. Only keys whose value actually changes are written, and each changed key gets its own history row. Clearing a field to empty hides it publicly. */
ownerSupportContactRouter.put(
  "/owner/support-contact",
  wrap(async (req, res) => {
    const a = role(req, ["owner"]);
    const d = putSchema.parse(req.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('platform_support_contact'))");
      const db = client as unknown as DB;
      const current = await platformSupportContact(db);
      for (const [field, key] of SUPPORT_CONTACT_FIELDS) {
        if (d[field] === current[field]) continue;
        if (d[field] === "") {
          // platform_settings.value cannot be empty (CHECK length 1..500):
          // clearing a field deletes its key, and the read falls back to
          // the empty default — the field is "not published" again.
          await client.query("DELETE FROM platform_settings WHERE key=$1", [key]);
        } else {
          await client.query(
            `INSERT INTO platform_settings(key, value, updated_by, updated_at) VALUES($1,$2,$3,now())
             ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
            [key, d[field], a.userId],
          );
        }
        await client.query(
          "INSERT INTO platform_setting_changes(key, value, reason, changed_by) VALUES($1,$2,$3,$4)",
          [key, d[field], d.reason, a.userId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    res.json(await platformSupportContact(pool as unknown as DB));
  }),
);
