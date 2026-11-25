import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Phase Y: certificate artwork for Template v7 — OFFICIAL MODE ONLY.
 *
 * Owner decision (16 Nov 2026): official-mode certificates carry the government
 * emblem in the header and the issuing office's own seal as a centre-page
 * watermark, as the official Union Parishad documents do. Demo mode renders
 * NEITHER (a demo is not a real office; the Phase 3 honesty behaviour stands).
 *
 * The emblem is a shared default asset. A seal is OFFICE-specific artwork (it
 * names the office), so it is resolved per office, never as a global:
 *   1. CERTIFICATE_OFFICE_ASSETS_DIR — a deployment directory holding
 *      seal.png + seal-watermark.png for the office this install serves;
 *   2. assets/offices/<tenantId>/ beside this package (per-tenant drop-in).
 * The emblem path may be overridden with CERTIFICATE_EMBLEM_PATH.
 * Missing files resolve to null and the document renders without that artwork.
 *
 * CERTASSETS-01 (as re-confirmed by Md's order of 25 Nov 2026, 12:12):
 * the centre watermark is THAT office's own UP seal, resolved per tenant
 * (tenantId) from the office's profile SEAL setting first
 * (office_certificate_assets, migration 050), falling back to the
 * filesystem drop-ins above when the profile seal is null (e.g. after the
 * office removes it with the new Remove option — WS-5, branch
 * fix/cert-assets-remove). Different UP = different seal; nothing is
 * hardcoded per office and there is no shared default seal. If no seal
 * resolves at all, the document renders with NO watermark — it never falls
 * back to the Government emblem (Md ordered the UP seal) and never to the
 * platform logo. The profile logo/signature still resolve as before (the
 * logo is no longer printed on certificates — see
 * certificate-template-v7.ts — but the bundle field is kept for callers).
 *
 * OPERATIONAL DEPENDENCY (25 Nov 2026): the production profile seal is
 * currently the DigitalUnion platform logo (chairman QA finding 5), so
 * until the owner removes that placeholder via the Remove option and
 * uploads the real Belabo UP seal (or relies on the repo drop-in),
 * production certificates WILL watermark with the platform logo. That is
 * an operational fix (remove + upload the real seal), NOT a code
 * substitution — this resolver must not paper over it by substituting
 * another seal or hiding the watermark.
 */
const moduleAssets = fileURLToPath(new URL("../assets/", import.meta.url));
const cache = new Map<string, string | null>();

function dataUrl(file: string | null): string | null {
  if (!file) return null;
  if (cache.has(file)) return cache.get(file)!;
  let out: string | null = null;
  try {
    if (fs.existsSync(file))
      out = `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
  } catch {
    out = null;
  }
  cache.set(file, out);
  return out;
}

function firstExisting(candidates: (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** Government emblem (shared default), as a data URL, or null when unavailable. */
export function governmentEmblemDataUrl(): string | null {
  return dataUrl(
    firstExisting([
      process.env.CERTIFICATE_EMBLEM_PATH,
      path.join(moduleAssets, "certificates", "govt-emblem.png"),
      path.join(process.cwd(), "apps", "api", "assets", "certificates", "govt-emblem.png"),
      path.join(process.cwd(), "assets", "certificates", "govt-emblem.png"),
    ]),
  );
}

export interface OfficeSealAssets {
  /** Full-strength seal (reserved for future use; v7 prints the watermark form). */
  seal: string | null;
  /** Faint watermark form printed centred behind the document body. */
  watermark: string | null;
}

/** The issuing office's own seal artwork, resolved per office (see header note). */
export function officeSealDataUrls(tenantId?: string | null): OfficeSealAssets {
  const dirs: (string | null | undefined)[] = [
    process.env.CERTIFICATE_OFFICE_ASSETS_DIR,
    tenantId ? path.join(moduleAssets, "offices", tenantId) : null,
    tenantId
      ? path.join(process.cwd(), "apps", "api", "assets", "offices", tenantId)
      : null,
  ];
  const pick = (name: string) =>
    dataUrl(firstExisting(dirs.map((dir) => (dir ? path.join(dir, name) : null))));
  return { seal: pick("seal.png"), watermark: pick("seal-watermark.png") };
}

/* ---------- CERTASSETS-01: the engine-agnostic certificate assets bundle ----------
 *
 * Owner decision (18 Nov 2026): the certificate render engine is migrating
 * from Chromium/HTML to @react-pdf/renderer, with the HTML template kept as
 * the fallback engine and visual reference. So that BOTH engines render the
 * same document, every asset a certificate needs is resolved HERE, once,
 * into one plain bundle of data URLs plus the chairman's display name and
 * designation — no engine reaches into the database, the filesystem or the
 * issuer record itself.
 *
 * Resolution order per artwork kind (first hit wins):
 *   1. the office's uploaded profile artwork (office_certificate_assets,
 *      migration 050 — resolved from the database by certificate-assets.ts
 *      and passed in as `profile`) — for LOGO, SIGNATURE and SEAL. The
 *      profile SEAL is the centre watermark's first source, per tenant
 *      (Md's re-confirmation of 25 Nov 2026, 12:12): that office's own
 *      seal, never hardcoded, never a shared default.
 *   2. the filesystem drop-ins above — the fallback source for the seal
 *      and the seal watermark when the profile seal is null (e.g. the
 *      office removed it with the Remove option and has not uploaded a
 *      replacement yet).
 *   3. nothing (the document renders without that artwork, as before —
 *      no Government-emblem fallback for the watermark).
 * The seal watermark is the pre-faded drop-in file when that is the winning
 * source; otherwise the bundle carries the winning seal itself with
 * `watermarkDerived: true`, and each engine derives the faint form in its
 * own idiom (the HTML template uses CSS opacity).
 */

/** The chairman/issuer identity a certificate's signature block prints. */
export interface CertificateIssuerInfo {
  nameBn?: string | null;
  nameEn?: string | null;
  accountType?: string | null;
}

/** Signature-block designation for the issuer's account type, per language. */
export function chairmanTitle(
  accountType: string | null | undefined,
  bn: boolean,
): string {
  switch (accountType) {
    case "up_panel_chairman":
      return bn ? "প্যানেল চেয়ারম্যান" : "Panel Chairman";
    case "municipality_mayor":
    case "city_corporation_mayor":
      return bn ? "মেয়র" : "Mayor";
    default:
      return bn ? "চেয়ারম্যান" : "Chairman";
  }
}

/** Office-profile artwork as data URLs (the database layer's output shape). */
export interface OfficeProfileArtwork {
  logo?: string | null;
  seal?: string | null;
  signature?: string | null;
}

export interface CertificateArtwork {
  logo: string | null;
  /** Full-strength seal (reserved for future use; templates print the watermark form). */
  seal: string | null;
  watermark: string | null;
  /** True when `watermark` is the full-strength seal and the consuming template must derive the faint form itself. */
  watermarkDerived: boolean;
  signature: string | null;
}

/** Everything a certificate render needs, engine-agnostic. */
export interface CertificateAssetsBundle extends CertificateArtwork {
  emblem: string | null;
  chairmanNameBn: string | null;
  chairmanNameEn: string | null;
  chairmanDesignationBn: string;
  chairmanDesignationEn: string;
}

const clean = (value?: string | null) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** Compose the final artwork for one office.
 *
 * Md's order of 25 Nov 2026, 12:12 (re-confirming the per-UP seal): the
 * centre watermark is the office's own UP seal — the profile SEAL setting
 * first (per tenantId), the deployment drop-ins
 * (CERTIFICATE_OFFICE_ASSETS_DIR / assets/offices/<tenantId>/) second.
 * When neither resolves, seal and watermark are both null and the document
 * renders with no watermark (no Government-emblem fallback — Md ordered
 * the UP seal). Logo and signature still come from the profile uploads,
 * as before. See the header note for the production operational
 * dependency: the stored profile seal is currently the platform logo
 * until the owner removes it (WS-5 Remove option) and uploads the real
 * seal — this resolver deliberately does not substitute anything else.
 */
export function resolveCertificateArtwork(
  tenantId?: string | null,
  profile?: OfficeProfileArtwork,
): CertificateArtwork {
  const dropIn = officeSealDataUrls(tenantId);
  const seal = profile?.seal ?? dropIn.seal;
  let watermark: string | null;
  let watermarkDerived = false;
  if (profile?.seal) {
    watermark = profile.seal;
    watermarkDerived = true;
  } else if (dropIn.watermark) {
    watermark = dropIn.watermark;
  } else if (seal) {
    watermark = seal;
    watermarkDerived = true;
  } else {
    watermark = null;
  }
  return {
    logo: profile?.logo ?? null,
    seal,
    watermark,
    watermarkDerived,
    signature: profile?.signature ?? null,
  };
}

/** The full bundle: artwork + emblem + chairman name/designation. */
export function certificateAssetsBundle(
  tenantId: string | null | undefined,
  profile: OfficeProfileArtwork | undefined,
  issuer: CertificateIssuerInfo | null | undefined,
): CertificateAssetsBundle {
  return {
    ...resolveCertificateArtwork(tenantId, profile),
    emblem: governmentEmblemDataUrl(),
    chairmanNameBn: clean(issuer?.nameBn),
    chairmanNameEn: clean(issuer?.nameEn),
    chairmanDesignationBn: chairmanTitle(issuer?.accountType, true),
    chairmanDesignationEn: chairmanTitle(issuer?.accountType, false),
  };
}
