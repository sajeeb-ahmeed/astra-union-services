import express from "express";
import { pool } from "./db.js";
import { fail } from "./models.js";
import type { Auth } from "./app.js";
import type { Geography } from "./geography.js";

/**
 * Demand list (billing plan §3.6, owner-approved 18 Nov 08:01): the Phase 3E
 * registration gate refuses a signup whose union is not listed (422
 * UNION_NOT_LISTED, no account created). Those refused attempts are captured
 * here so the owner can see which unions to onboard next — the name, mobile
 * number and claimed geography the registration flow genuinely collected,
 * nothing more (no new form fields, no email, no password material).
 *
 * The capture is deliberately failure-isolated: it runs AFTER the signup
 * transaction has rolled back, in its own pool write, and swallows its own
 * errors — a failed capture must never change the rejection response.
 * Repeat attempts from the same phone for the same union fold into one row
 * (attempts counter, latest name/ward, last_attempt_at) via the partial
 * unique index of migration 049; attempts without a phone have no stable
 * key the flow collected, so each is its own row.
 *
 * Owner read is platform-level, like the other Phase 3 platform tables:
 * server-side role check, geography names resolved from the geo dataset.
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

export async function recordRegistrationDemand(input: {
  nameBn: string;
  nameEn: string;
  phone: string | null;
  geography: Geography;
}): Promise<void> {
  try {
    const g = input.geography;
    if (!g.unionCode) return;
    const values = [
      input.nameBn,
      input.nameEn,
      input.phone,
      g.divisionCode,
      g.districtCode,
      g.upazilaCode,
      g.unionCode,
      g.wardCode ?? null,
    ];
    if (input.phone) {
      await pool.query(
        `INSERT INTO platform_registration_demand(name_bn, name_en, phone, division_code, district_code, upazila_code, union_code, ward_code)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (phone, division_code, district_code, upazila_code, union_code) WHERE phone IS NOT NULL
         DO UPDATE SET attempts = platform_registration_demand.attempts + 1,
                       last_attempt_at = now(),
                       name_bn = EXCLUDED.name_bn,
                       name_en = EXCLUDED.name_en,
                       ward_code = EXCLUDED.ward_code`,
        values,
      );
    } else {
      await pool.query(
        `INSERT INTO platform_registration_demand(name_bn, name_en, phone, division_code, district_code, upazila_code, union_code, ward_code)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        values,
      );
    }
  } catch {
    // Failure-isolated by design: the signup rejection is already decided and
    // its response must not change because a demand capture failed.
  }
}

const demandRow = (r: any) => ({
  id: r.id,
  nameBn: r.name_bn,
  nameEn: r.name_en,
  phone: r.phone ?? null,
  divisionCode: r.division_code,
  districtCode: r.district_code,
  upazilaCode: r.upazila_code,
  unionCode: r.union_code,
  wardCode: r.ward_code ?? null,
  divisionBn: r.division_bn ?? null,
  divisionEn: r.division_en ?? null,
  districtBn: r.district_bn ?? null,
  districtEn: r.district_en ?? null,
  upazilaBn: r.upazila_bn ?? null,
  upazilaEn: r.upazila_en ?? null,
  unionBn: r.union_bn ?? null,
  unionEn: r.union_en ?? null,
  wardBn: r.ward_bn ?? null,
  wardEn: r.ward_en ?? null,
  attempts: r.attempts,
  firstAttemptAt: r.first_attempt_at,
  lastAttemptAt: r.last_attempt_at,
});
const demandUnionRow = (r: any) => ({
  divisionCode: r.division_code,
  districtCode: r.district_code,
  upazilaCode: r.upazila_code,
  unionCode: r.union_code,
  divisionBn: r.division_bn ?? null,
  divisionEn: r.division_en ?? null,
  districtBn: r.district_bn ?? null,
  districtEn: r.district_en ?? null,
  upazilaBn: r.upazila_bn ?? null,
  upazilaEn: r.upazila_en ?? null,
  unionBn: r.union_bn ?? null,
  unionEn: r.union_en ?? null,
  people: r.people,
  attempts: r.attempts,
  lastAttemptAt: r.last_attempt_at,
});

export const demandRouter = express.Router();

/** Owner: every captured registration-demand attempt, most recent first, plus the per-union totals. */
demandRouter.get(
  "/owner/registration-demand",
  wrap(async (req, res) => {
    role(req, ["owner"]);
    const items = (
      await pool.query(
        `SELECT d.id, d.name_bn, d.name_en, d.phone, d.division_code, d.district_code, d.upazila_code,
                d.union_code, d.ward_code, d.attempts, d.first_attempt_at, d.last_attempt_at,
                dv.name_bn AS division_bn, dv.name_en AS division_en,
                di.name_bn AS district_bn, di.name_en AS district_en,
                u.name_bn AS upazila_bn, u.name_en AS upazila_en,
                n.name_bn AS union_bn, n.name_en AS union_en,
                w.name_bn AS ward_bn, w.name_en AS ward_en
         FROM platform_registration_demand d
         LEFT JOIN geo_divisions dv ON dv.code = d.division_code
         LEFT JOIN geo_districts di ON di.code = d.district_code
         LEFT JOIN geo_upazilas u ON u.code = d.upazila_code
         LEFT JOIN geo_unions n ON n.code = d.union_code
         LEFT JOIN geo_wards w ON w.code = d.ward_code
         ORDER BY d.last_attempt_at DESC, d.id
         LIMIT 200`,
      )
    ).rows;
    const byUnion = (
      await pool.query(
        `SELECT d.division_code, d.district_code, d.upazila_code, d.union_code,
                dv.name_bn AS division_bn, dv.name_en AS division_en,
                di.name_bn AS district_bn, di.name_en AS district_en,
                u.name_bn AS upazila_bn, u.name_en AS upazila_en,
                n.name_bn AS union_bn, n.name_en AS union_en,
                count(*)::int AS people, sum(d.attempts)::int AS attempts,
                max(d.last_attempt_at) AS last_attempt_at
         FROM platform_registration_demand d
         LEFT JOIN geo_divisions dv ON dv.code = d.division_code
         LEFT JOIN geo_districts di ON di.code = d.district_code
         LEFT JOIN geo_upazilas u ON u.code = d.upazila_code
         LEFT JOIN geo_unions n ON n.code = d.union_code
         GROUP BY d.division_code, d.district_code, d.upazila_code, d.union_code,
                  dv.name_bn, dv.name_en, di.name_bn, di.name_en,
                  u.name_bn, u.name_en, n.name_bn, n.name_en
         ORDER BY attempts DESC, people DESC, n.name_en`,
      )
    ).rows;
    res.json({ items: items.map(demandRow), byUnion: byUnion.map(demandUnionRow) });
  }),
);
