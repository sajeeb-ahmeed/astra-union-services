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
