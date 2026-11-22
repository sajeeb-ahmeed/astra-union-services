import express from "express";
import { z } from "zod";
import { pool } from "./db.js";
import { fail } from "./models.js";
import type { Auth } from "./app.js";
import { normalizeIdentifier } from "./identifiers.js";
import { createRateLimiter } from "./http-hardening.js";

/**
 * Phase 6b: public requests to include an office in Astra, reviewed by the platform owner. Accepting a
 * request does not create the office by itself; the owner then onboards it with the existing flow.
 */
type Req = express.Request & { auth?: Auth };
const wrap =
  (fn: (req: Req, res: express.Response) => Promise<unknown>) =>
  (req: Req, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);
const view = (r: any) => ({
  id: r.id,
  officeName: r.office_name,
  officeType: r.office_type,
  divisionCode: r.division_code,
  districtCode: r.district_code,
  upazilaCode: r.upazila_code,
  unionCode: r.union_code,
  contactName: r.contact_name,
  contactRole: r.contact_role,
  contactMobile: r.contact_mobile,
  contactEmail: r.contact_email,
  message: r.message,
  status: r.status,
  ownerNote: r.owner_note,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
});
const code = (prefix: string) => z.string().regex(new RegExp(`^${prefix}-[0-9]{2,4}$`)).nullable().optional();

export const publicInclusionRouter = express.Router();
const limiter = createRateLimiter({ limit: 5, windowMs: 60 * 60_000 });
publicInclusionRouter.post(
  "/public/office-inclusion-requests",
  limiter,
  wrap(async (req, res) => {
    const d = z
      .object({
        officeName: z.string().trim().min(3).max(160),
        officeType: z.enum(["UNION", "MUNICIPALITY", "CITY_CORPORATION"]),
        divisionCode: code("div"),
        districtCode: code("dis"),
        upazilaCode: code("upa"),
        unionCode: code("uni"),
        contactName: z.string().trim().min(2).max(120),
        contactRole: z.string().trim().min(2).max(120),
        contactMobile: z.string().max(40),
        contactEmail: z.string().trim().email().max(200).optional().or(z.literal("")),
        message: z.string().trim().max(1000).optional(),
      })
      .strict()
      .parse(req.body);
    const mobile = normalizeIdentifier("mobile", d.contactMobile);
    if (!mobile) fail(422, "IDENTIFIER_INVALID", "Enter an 11-digit Bangladeshi mobile number starting with 01.");
    const row = (
      await pool.query(
        `INSERT INTO office_inclusion_requests(office_name,office_type,division_code,district_code,upazila_code,union_code,contact_name,contact_role,contact_mobile,contact_email,message)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,created_at`,
        [
          d.officeName,
          d.officeType,
          d.divisionCode ?? null,
          d.districtCode ?? null,
          d.upazilaCode ?? null,
          d.unionCode ?? null,
          d.contactName,
          d.contactRole,
          mobile,
          d.contactEmail || null,
          d.message || null,
        ],
      )
    ).rows[0];
    res.status(201).json({ id: row.id, received: true });
  }),
);

export const ownerInclusionRouter = express.Router();
ownerInclusionRouter.get(
  "/owner/office-inclusion-requests",
  wrap(async (req, res) => {
    if (req.auth?.role !== "owner") fail(403, "ROLE_DENIED", "This role is not permitted.");
    const status = z.enum(["NEW", "CONTACTED", "ACCEPTED", "DECLINED"]).optional().parse(req.query.status);
    const rows = (
      await pool.query(
        `SELECT * FROM office_inclusion_requests ${status ? "WHERE status=$1" : "WHERE status IN ('NEW','CONTACTED')"} ORDER BY created_at LIMIT 200`,
        status ? [status] : [],
      )
    ).rows;
    res.json({ items: rows.map(view) });
  }),
);
ownerInclusionRouter.post(
  "/owner/office-inclusion-requests/:id/status",
  wrap(async (req, res) => {
    if (req.auth?.role !== "owner") fail(403, "ROLE_DENIED", "This role is not permitted.");
    const id = z.string().uuid().parse(req.params.id);
    const d = z
      .object({ status: z.enum(["CONTACTED", "ACCEPTED", "DECLINED"]), note: z.string().trim().min(3).max(500).optional() })
      .strict()
      .refine((v) => v.status !== "DECLINED" || !!v.note, { message: "Give a reason for declining." })
      .parse(req.body);
    const row = (
      await pool.query(
        "UPDATE office_inclusion_requests SET status=$2,owner_note=coalesce($3,owner_note),decided_by=$4,decided_at=now() WHERE id=$1 AND status IN ('NEW','CONTACTED') RETURNING *",
        [id, d.status, d.note ?? null, req.auth!.userId],
      )
    ).rows[0];
    if (!row) fail(409, "REQUEST_CLOSED", "This request is not open.");
    res.json(view(row));
  }),
);
