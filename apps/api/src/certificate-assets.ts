import express from "express";
import { z } from "zod";
import { createHash } from "node:crypto";
import { transaction, audit, type DB } from "./db.js";
import { fail } from "./models.js";
import { decodeUpload } from "./attachments.js";
import { generatePdf, type PdfInput } from "./pdf.js";
import {
  certificateAssetsBundle,
  type CertificateAssetsBundle,
  type CertificateIssuerInfo,
} from "./template-assets.js";
import type { Auth } from "./app.js";

/**
 * CERTASSETS-01 (owner-approved plan, 18 Nov 2026): office certificate assets.
 *
 * Each office keeps its own certificate artwork — office LOGO, office SEAL and
 * the chairman's SIGNATURE image — in the database (migration 050), uploaded
 * once from the office profile and picked up dynamically by Template v7 at
 * issuance. Bytes live outside the deployable app folder (the attachments
 * storage pattern: bytea in PostgreSQL), so a cPanel redeploy cannot wipe
 * them, and a new union onboards with zero developer time.
 *
 * Validation reuses the attachment pipeline's decodeUpload() — magic-byte
 * signature checked against the declared type, 2 MiB cap — restricted here to
 * PNG/JPEG artwork. Versions are append-only: a replace INSERTs the next
 * version and an immutable change row (reason mandatory), and the same event
 * lands in audit_events, so asset changes show in the office audit log and
 * the owner's audit view. The full citizen-attachment antivirus queue is not
 * reused: its schema binds every row to a citizen document, while these are
 * office-supplied brand assets uploaded by the office's own chairman/admin.
 *
 * Resolution at issuance (prepareIssuance in app.ts, and the preview below)
 * is profile-first; Template v7 then falls back to the legacy filesystem
 * drop-ins (template-assets.ts) and finally to no artwork — the pre-existing
 * behaviour for offices that never upload anything.
 */
type Req = express.Request & { auth?: Auth };
const wrap =
  (fn: (req: Req, res: express.Response) => Promise<unknown>) =>
  (req: Req, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

export const CERTIFICATE_ASSET_KINDS = ["LOGO", "SEAL", "SIGNATURE"] as const;
export type CertificateAssetKind = (typeof CERTIFICATE_ASSET_KINDS)[number];
const kindParam = z.enum(["logo", "seal", "signature"]);
const kindOf = (raw: string): CertificateAssetKind =>
  kindParam.parse(raw).toUpperCase() as CertificateAssetKind;

function officeActor(req: Req): Auth & { tenantId: string } {
  const a = req.auth ?? fail(401, "LOGIN_REQUIRED", "Sign in required.");
  if (!["admin", "approver"].includes(a.role))
    fail(
      403,
      "ROLE_DENIED",
      "Only the office admin or chairman can manage certificate assets.",
    );
  if (!a.tenantId)
    fail(403, "TENANT_REQUIRED", "An active tenant membership is required.");
  return a as Auth & { tenantId: string };
}
function ownerActor(req: Req): Auth {
  const a = req.auth ?? fail(401, "LOGIN_REQUIRED", "Sign in required.");
  if (a.role !== "owner")
    fail(403, "ROLE_DENIED", "Only the platform owner can do this.");
  return a;
}

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const dataUrl = (mimeType: string, bytes: Buffer) =>
  `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;

export interface CertificateArtwork {
  logo: string | null;
  seal: string | null;
  signature: string | null;
}

/**
 * The office's current profile artwork as data URLs (null per kind when the
 * office has not uploaded it). Runs inside the caller's tenant transaction so
 * RLS scopes the read to that office alone.
 */
export async function resolveCertificateAssets(
  db: DB,
  tenantId: string,
): Promise<CertificateArtwork> {
  const rows = (
    await db.query(
      "SELECT DISTINCT ON (kind) kind, mime_type, bytes FROM office_certificate_assets WHERE tenant_id=$1 ORDER BY kind, version DESC",
      [tenantId],
    )
  ).rows;
  const artwork: CertificateArtwork = { logo: null, seal: null, signature: null };
  for (const row of rows)
    artwork[row.kind.toLowerCase() as keyof CertificateArtwork] = dataUrl(
      row.mime_type,
      row.bytes,
    );
  return artwork;
}

/**
 * The single entry point a render engine calls: the office's profile artwork
 * composed with the drop-in fallback, the shared emblem and the chairman's
 * name/designation into the engine-agnostic bundle (template-assets.ts).
 * The HTML template composes the same bundle synchronously from PdfInput;
 * the @react-pdf/renderer engine (owner decision, 18 Nov 2026) will consume
 * this async form directly.
 */
export async function resolveCertificateAssetsBundle(
  db: DB,
  tenantId: string,
  issuer?: CertificateIssuerInfo | null,
): Promise<CertificateAssetsBundle> {
  const profile = await resolveCertificateAssets(db, tenantId);
  return certificateAssetsBundle(tenantId, profile, issuer ?? null);
}

async function currentAsset(db: DB, tenantId: string, kind: CertificateAssetKind) {
  return (
    await db.query(
      "SELECT id, version, mime_type, byte_length, content_sha256, uploaded_by, created_at FROM office_certificate_assets WHERE tenant_id=$1 AND kind=$2 ORDER BY version DESC LIMIT 1",
      [tenantId, kind],
    )
  ).rows[0];
}

async function assetOverview(db: DB, tenantId: string) {
  const items = [];
  for (const kind of CERTIFICATE_ASSET_KINDS) {
    const current = await currentAsset(db, tenantId, kind);
    const history = (
      await db.query(
        `SELECT c.version, c.action, c.reason, c.created_at, u.display_name AS changed_by_name
         FROM office_certificate_asset_changes c JOIN platform_users u ON u.id = c.changed_by
         WHERE c.tenant_id=$1 AND c.kind=$2 ORDER BY c.version DESC LIMIT 20`,
        [tenantId, kind],
      )
    ).rows;
    items.push({
      kind,
      current: current
        ? {
            version: current.version,
            mimeType: current.mime_type,
            byteLength: current.byte_length,
            contentSha256: current.content_sha256,
            uploadedAt: current.created_at,
          }
        : null,
      history: history.map((h) => ({
        version: h.version,
        action: h.action,
        reason: h.reason,
        changedByName: h.changed_by_name,
        createdAt: h.created_at,
      })),
    });
  }
  // CH-006: the logo and the seal must be distinct images — an office
  // that uploads the same bytes twice (e.g. the DigitalUnion logo as
  // the seal) prints the wrong image on every certificate. Flag any
  // kind whose bytes are identical to another kind's current bytes; the
  // upload still succeeds (warn, don't block), but the profile page
  // says so plainly and the office must upload the real image.
  const byHash = new Map<string, string>();
  for (const item of items) {
    if (!item.current) continue;
    const other = byHash.get(item.current.contentSha256);
    if (other) {
      (item.current as any).duplicateOf = other;
      const otherItem = items.find((i) => i.kind === other);
      if (otherItem?.current) (otherItem.current as any).duplicateOf = item.kind;
    } else byHash.set(item.current.contentSha256, item.kind);
  }
  return { items };
}

async function currentBytes(db: DB, tenantId: string, kind: CertificateAssetKind) {
  return (
    await db.query(
      "SELECT mime_type, bytes FROM office_certificate_assets WHERE tenant_id=$1 AND kind=$2 ORDER BY version DESC LIMIT 1",
      [tenantId, kind],
    )
  ).rows[0];
}

export const certificateAssetsRouter = express.Router();

certificateAssetsRouter.get(
  "/office/certificate-assets",
  wrap(async (req, res) => {
    const a = officeActor(req);
    res.json(
      await transaction(a.tenantId, async (db) =>
        assetOverview(db, a.tenantId),
      ),
    );
  }),
);

certificateAssetsRouter.put(
  "/office/certificate-assets/:kind",
  wrap(async (req, res) => {
    const a = officeActor(req);
    const kind = kindOf(String(req.params.kind).toLowerCase());
    const input = z
      .object({
        mimeType: z.enum(["image/png", "image/jpeg"]),
        base64: z.string().max(2796204),
        reason: z.string().trim().min(8).max(500).optional(),
      })
      .strict()
      .parse(req.body);
    // Same decode + magic-byte validation as citizen attachment uploads.
    const bytes = decodeUpload(input);
    const result = await transaction(a.tenantId, async (db) => {
      // Serialise per office+kind so version numbers never race.
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `cert-assets:${a.tenantId}:${kind}`,
      ]);
      const current = await currentAsset(db, a.tenantId, kind);
      if (current && !input.reason)
        fail(
          422,
          "REASON_REQUIRED",
          "Replacing an existing certificate asset requires a reason (at least 8 characters).",
        );
      const version = (current?.version ?? 0) + 1;
      const row = (
        await db.query(
          "INSERT INTO office_certificate_assets(tenant_id,kind,version,mime_type,byte_length,content_sha256,bytes,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at",
          [
            a.tenantId,
            kind,
            version,
            input.mimeType,
            bytes.length,
            sha256(bytes),
            bytes,
            a.userId,
          ],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO office_certificate_asset_changes(tenant_id,asset_id,kind,version,action,reason,changed_by) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          a.tenantId,
          row.id,
          kind,
          version,
          current ? "REPLACED" : "UPLOADED",
          input.reason ?? null,
          a.userId,
        ],
      );
      await audit(
        db,
        a.tenantId,
        a.userId,
        current
          ? "OFFICE_CERTIFICATE_ASSET_REPLACED"
          : "OFFICE_CERTIFICATE_ASSET_UPLOADED",
        row.id,
        { kind, version, byteLength: bytes.length },
      );
      // CH-006: warn when these bytes are identical to another kind's
      // current image (logo uploaded as the seal, or vice versa).
      let duplicateOf: CertificateAssetKind | null = null;
      for (const other of CERTIFICATE_ASSET_KINDS) {
        if (other === kind) continue;
        const otherCurrent = await currentAsset(db, a.tenantId, other);
        if (otherCurrent?.content_sha256 === sha256(bytes)) {
          duplicateOf = other;
          break;
        }
      }
      return {
        kind,
        version,
        replaced: !!current,
        mimeType: input.mimeType,
        byteLength: bytes.length,
        contentSha256: sha256(bytes),
        uploadedAt: row.created_at,
        duplicateOf,
      };
    });
    const { replaced, ...body } = result;
    res.status(replaced ? 200 : 201).json(body);
  }),
);

certificateAssetsRouter.get(
  "/office/certificate-assets/:kind/image",
  wrap(async (req, res) => {
    const a = officeActor(req);
    const kind = kindOf(String(req.params.kind).toLowerCase());
    const row = await transaction(a.tenantId, async (db) =>
      currentBytes(db, a.tenantId, kind),
    );
    if (!row) fail(404, "NOT_FOUND", "No such certificate asset.");
    res.type(row.mime_type).setHeader("Cache-Control", "private, no-store");
    res.send(Buffer.from(row.bytes));
  }),
);

/**
 * Sample-certificate preview: renders the REAL template + PDF path with the
 * office's current assets and clearly sample citizen data. Nothing is stored
 * and no certificate is issued — the PDF exists only in this response. The
 * render follows the deployment's issuance mode exactly as a real issuance
 * would, so what the chairman sees is what would print. It is a GET (a
 * read-only render) so the workspace can open it directly in a new tab.
 */
certificateAssetsRouter.get(
  "/office/certificate-assets/preview",
  wrap(async (req, res) => {
    const a = officeActor(req);
    const input = z
      .object({
        serviceNo: z.coerce.number().int().min(1).max(47).default(12),
      })
      .strict()
      .parse(req.query ?? {});
    const prepared = await transaction(a.tenantId, async (db) => {
      const tenant = (
        await db.query("SELECT * FROM tenants WHERE id=$1", [a.tenantId])
      ).rows[0];
      const service = (
        await db.query(
          "SELECT * FROM service_catalog WHERE service_no=$1",
          [input.serviceNo],
        )
      ).rows[0];
      const issuer = (
        await db.query(
          "SELECT u.display_name, u.name_bn, m.account_type FROM platform_users u LEFT JOIN staff_memberships m ON m.user_id=u.id AND m.tenant_id=$2 WHERE u.id=$1",
          [a.userId, a.tenantId],
        )
      ).rows[0];
      return {
        tenant,
        service,
        issuer,
        assets: await resolveCertificateAssets(db, a.tenantId),
      };
    });
    if (!prepared.service)
      fail(404, "NOT_FOUND", "Service not found in the catalog.");
    const pdfInput: PdfInput = {
      number: "PREVIEW-0000",
      verificationUrl: `${process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:5173"}/verify/preview`,
      tenant: {
        id: prepared.tenant.id,
        name_bn: prepared.tenant.name_bn,
        name_en: prepared.tenant.name_en,
        division: prepared.tenant.division,
        district: prepared.tenant.district,
        upazila: prepared.tenant.upazila,
      },
      service: {
        service_no: prepared.service.service_no,
        name_bn: prepared.service.name_bn,
        name_en: prepared.service.name_en,
      },
      citizen: {
        full_name_bn: "নমুনা নাগরিক",
        full_name_en: "Sample Citizen",
        address_bn: "নমুনা ঠিকানা",
        address_en: "Sample address",
        father_name_bn: "নমুনা পিতা",
        father_name_en: "Sample Father",
        mother_name_bn: "নমুনা মাতা",
        mother_name_en: "Sample Mother",
      },
      payload: { delivery_language: "bn" },
      issuedAt: new Date().toISOString(),
      issuer: {
        nameBn: prepared.issuer?.name_bn ?? null,
        nameEn: prepared.issuer?.display_name ?? null,
        accountType: prepared.issuer?.account_type ?? null,
      },
      assets: prepared.assets,
    };
    const pdf = await generatePdf(pdfInput);
    res
      .type("application/pdf")
      .setHeader(
        "Content-Disposition",
        'inline; filename="certificate-preview.pdf"',
      );
    res.send(pdf);
  }),
);

/** Owner read-only view of any office's certificate assets (plan §4.1). */
certificateAssetsRouter.get(
  "/owner/tenants/:id/certificate-assets",
  wrap(async (req, res) => {
    ownerActor(req);
    const tenantId = z.string().uuid().parse(req.params.id);
    const exists = await transaction(tenantId, async (db) =>
      (
        await db.query("SELECT 1 FROM tenants WHERE id=$1", [tenantId])
      ).rowCount,
    );
    if (!exists) fail(404, "NOT_FOUND", "Office not found.");
    res.json(
      await transaction(tenantId, async (db) => assetOverview(db, tenantId)),
    );
  }),
);

certificateAssetsRouter.get(
  "/owner/tenants/:id/certificate-assets/:kind/image",
  wrap(async (req, res) => {
    ownerActor(req);
    const tenantId = z.string().uuid().parse(req.params.id);
    const kind = kindOf(String(req.params.kind).toLowerCase());
    const row = await transaction(tenantId, async (db) =>
      currentBytes(db, tenantId, kind),
    );
    if (!row) fail(404, "NOT_FOUND", "No such certificate asset.");
    res.type(row.mime_type).setHeader("Cache-Control", "private, no-store");
    res.send(Buffer.from(row.bytes));
  }),
);
