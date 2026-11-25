import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pg from "pg";
import { demoPayloads } from "@astra/shared-schemas";
import { app } from "../src/app.js";
import { pool, adminConnectionString, transaction } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";
import {
  renderCertificateHtml,
  type PdfInput,
} from "../src/certificate-template.js";
import { resolveCertificateAssets, resolveCertificateAssetsBundle } from "../src/certificate-assets.js";

/**
 * CERTASSETS-01: office certificate assets (plan §6 steps A–C).
 *
 * Alpha is the proof office: the seed already gave it the Belabo seal as
 * profile SEAL v1; this suite uploads a logo and a signature through the API,
 * replaces the seal through the API, then issues real certificates in
 * official mode and (when CERTASSETS_PROOF_DIR is set) saves the PDFs as the
 * visual proof pack. Beta never uploads anything and stands as the
 * no-assets fallback office.
 */
process.env.NODE_ENV = "test";
delete process.env.CERTIFICATE_OFFICE_ASSETS_DIR;

const admin = new pg.Pool({ connectionString: adminConnectionString });
let server: ReturnType<typeof app.listen>, base: string;
let alphaId: string, betaId: string;
type Session = { cookie: string; csrf: string };
const s: Record<string, Session> = {};

async function req(method: string, pathName: string, data?: unknown, who?: string) {
  const session = who ? s[who] : undefined;
  const response = await fetch(`${base}/api/v1${pathName}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const type = response.headers.get("content-type") ?? "";
  return {
    status: response.status,
    body: type.includes("json") ? await response.json() : null,
  };
}
async function reqBytes(method: string, pathName: string, who?: string) {
  const session = who ? s[who] : undefined;
  const response = await fetch(`${base}/api/v1${pathName}`, {
    method,
    headers: session ? { Cookie: session.cookie } : {},
  });
  return {
    status: response.status,
    type: response.headers.get("content-type") ?? "",
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}
async function login(key: string, email: string) {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Demo-Phase1!" }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  s[key] = { cookie: r.headers.get("set-cookie")!.split(";")[0], csrf: json.csrfToken };
}

/* --- small real PNGs, drawn pixel by pixel (pngjs is a repo devDependency) --- */
function drawPng(
  width: number,
  height: number,
  draw: (set: (x: number, y: number, r: number, g: number, b: number, a: number) => void) => void,
): Buffer {
  const png = new PNG({ width, height });
  const set = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = a;
  };
  draw(set);
  return PNG.sync.write(png);
}
const logoPng = drawPng(120, 60, (set) => {
  for (let y = 0; y < 60; y++) for (let x = 0; x < 120; x++) set(x, y, 4, 89, 44, 255);
  for (let y = 14; y < 46; y++) for (let x = 34; x < 86; x++) set(x, y, 255, 255, 255, 255);
  for (let y = 22; y < 38; y++) for (let x = 52; x < 68; x++) set(x, y, 198, 32, 40, 255);
});
const logoPngV2 = drawPng(120, 60, (set) => {
  for (let y = 0; y < 60; y++) for (let x = 0; x < 120; x++) set(x, y, 10, 60, 120, 255);
  for (let y = 14; y < 46; y++) for (let x = 34; x < 86; x++) set(x, y, 255, 215, 0, 255);
});
const signaturePng = drawPng(200, 80, (set) => {
  for (let x = 8; x < 192; x++) {
    const y = Math.round(42 + Math.sin(x / 11) * 13);
    for (let d = -2; d <= 2; d++) set(x, y + d, 18, 18, 130, 255);
  }
  for (let x = 24; x < 96; x++) {
    const y = Math.round(66 - (x - 24) / 5);
    for (let d = -2; d <= 2; d++) set(x, y + d, 18, 18, 130, 255);
  }
});
const belaboSealPng = fs.readFileSync(
  new URL("../assets/offices/belabo-up/seal.png", import.meta.url),
);
const belaboSealWatermarkPng = fs.readFileSync(
  new URL("../assets/offices/belabo-up/seal-watermark.png", import.meta.url),
);
const b64 = (bytes: Buffer) => bytes.toString("base64");
const dataUrlOf = (bytes: Buffer) => `data:image/png;base64,${b64(bytes)}`;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  alphaId = (await admin.query("SELECT id FROM tenants WHERE slug='alpha'")).rows[0].id;
  betaId = (await admin.query("SELECT id FROM tenants WHERE slug='beta'")).rows[0].id;
  await login("alphaAdmin", "admin@alpha.local.test");
  await login("alphaApprover", "approver@alpha.local.test");
  await login("alphaStaff", "staff@alpha.local.test");
  await login("alphaCitizen", "citizen@alpha.local.test");
  await login("betaAdmin", "admin@beta.local.test");
  await login("betaStaff", "staff@beta.local.test");
  await login("betaApprover", "approver@beta.local.test");
  await login("betaCitizen", "citizen@beta.local.test");
  await login("owner", "owner@astra.demo.test");
});
after(async () => {
  delete process.env.ISSUANCE_MODE;
  delete process.env.CERTIFICATE_OFFICE_ASSETS_DIR;
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  await admin.end();
});

test("certassets: role gates — citizens, staff and anonymous callers are refused; admin and chairman may read", async () => {
  assert.equal((await req("GET", "/office/certificate-assets", undefined, "alphaCitizen")).status, 403);
  assert.equal((await req("GET", "/office/certificate-assets", undefined, "alphaStaff")).status, 403);
  assert.equal((await req("GET", "/office/certificate-assets")).status, 401);
  assert.equal(
    (await req("PUT", "/office/certificate-assets/logo", { mimeType: "image/png", base64: b64(logoPng) }, "alphaCitizen")).status,
    403,
  );
  assert.equal((await req("GET", "/office/certificate-assets", undefined, "alphaAdmin")).status, 200);
  assert.equal((await req("GET", "/office/certificate-assets", undefined, "alphaApprover")).status, 200);
  // Owner endpoints refuse non-owners outright.
  assert.equal((await req("GET", `/owner/tenants/${alphaId}/certificate-assets`, undefined, "alphaAdmin")).status, 403);
  assert.equal((await req("GET", `/owner/tenants/${alphaId}/certificate-assets`, undefined, "alphaCitizen")).status, 403);
});

test("certassets: upload validation — non-image bytes, wrong declared type and oversize are rejected", async () => {
  const notImage = await req(
    "PUT",
    "/office/certificate-assets/logo",
    { mimeType: "image/png", base64: b64(Buffer.from("this is not an image at all")) },
    "alphaAdmin",
  );
  assert.equal(notImage.status, 422);
  assert.equal(notImage.body.error.code, "UPLOAD_TYPE");
  const mismatch = await req(
    "PUT",
    "/office/certificate-assets/logo",
    { mimeType: "image/jpeg", base64: b64(logoPng) },
    "alphaAdmin",
  );
  assert.equal(mismatch.status, 422);
  assert.equal(mismatch.body.error.code, "UPLOAD_TYPE");
  const pdfDeclared = await req(
    "PUT",
    "/office/certificate-assets/logo",
    { mimeType: "application/pdf", base64: b64(logoPng) },
    "alphaAdmin",
  );
  assert.equal(pdfDeclared.status, 422); // zod: only image/png|image/jpeg are acceptable upload types here
  const oversize = await req(
    "PUT",
    "/office/certificate-assets/logo",
    { mimeType: "image/png", base64: b64(Buffer.alloc(2097153)) },
    "alphaAdmin",
  );
  assert.equal(oversize.status, 422);
  assert.equal(oversize.body.error.code, "UPLOAD_SIZE");
  // Nothing was stored by the rejected attempts.
  const overview = await req("GET", "/office/certificate-assets", undefined, "alphaAdmin");
  assert.equal(overview.body.items.find((i: any) => i.kind === "LOGO").current, null);
});

test("certassets: the seeded Belabo seal resolves as alpha's profile SEAL v1; beta resolves to nulls", async () => {
  const alpha = await transaction(alphaId, async (db) => resolveCertificateAssets(db, alphaId));
  assert.equal(alpha.seal, dataUrlOf(belaboSealPng));
  assert.equal(alpha.logo, null);
  assert.equal(alpha.signature, null);
  const beta = await transaction(betaId, async (db) => resolveCertificateAssets(db, betaId));
  assert.deepEqual(beta, { logo: null, seal: null, signature: null });
  const overview = await req("GET", "/office/certificate-assets", undefined, "alphaAdmin");
  const seal = overview.body.items.find((i: any) => i.kind === "SEAL");
  assert.equal(seal.current.version, 1);
  assert.equal(seal.history.length, 1);
  assert.equal(seal.history[0].action, "UPLOADED");
});

test("certassets: upload, reason-gated replace, version history, change rows and audit events", async () => {
  const v1 = await req(
    "PUT",
    "/office/certificate-assets/logo",
    { mimeType: "image/png", base64: b64(logoPng) },
    "alphaAdmin",
  );
  assert.equal(v1.status, 201, JSON.stringify(v1.body));
  assert.equal(v1.body.version, 1);
  // A replace without a reason is refused and stores nothing.
  const noReason = await req(
    "PUT",
    "/office/certificate-assets/logo",
    { mimeType: "image/png", base64: b64(logoPngV2) },
    "alphaAdmin",
  );
  assert.equal(noReason.status, 422);
  assert.equal(noReason.body.error.code, "REASON_REQUIRED");
  const v2 = await req(
    "PUT",
    "/office/certificate-assets/logo",
    { mimeType: "image/png", base64: b64(logoPngV2), reason: "Office adopted the new logo design" },
    "alphaAdmin",
  );
  assert.equal(v2.status, 200, JSON.stringify(v2.body));
  assert.equal(v2.body.version, 2);
  const sig = await req(
    "PUT",
    "/office/certificate-assets/signature",
    { mimeType: "image/png", base64: b64(signaturePng) },
    "alphaApprover", // the chairman himself uploads his signature
  );
  assert.equal(sig.status, 201, JSON.stringify(sig.body));
  const sealV2 = await req(
    "PUT",
    "/office/certificate-assets/seal",
    { mimeType: "image/png", base64: b64(belaboSealPng), reason: "Re-uploaded the office seal through the profile" },
    "alphaAdmin",
  );
  assert.equal(sealV2.status, 200, JSON.stringify(sealV2.body));
  assert.equal(sealV2.body.version, 2);

  const overview = await req("GET", "/office/certificate-assets", undefined, "alphaAdmin");
  const logo = overview.body.items.find((i: any) => i.kind === "LOGO");
  assert.equal(logo.current.version, 2);
  assert.deepEqual(logo.history.map((h: any) => h.action), ["REPLACED", "UPLOADED"]);
  assert.equal(logo.history[0].reason, "Office adopted the new logo design");

  // The served image is byte-identical to the current version's upload.
  const served = await reqBytes("GET", "/office/certificate-assets/logo/image", "alphaAdmin");
  assert.equal(served.status, 200);
  assert.ok(served.bytes.equals(logoPngV2));

  // Append-only guarantees, checked at the database layer the API itself uses.
  const changes = await admin.query(
    "SELECT action, reason FROM office_certificate_asset_changes WHERE tenant_id=$1 AND kind='LOGO' ORDER BY version",
    [alphaId],
  );
  assert.deepEqual(changes.rows.map((r: any) => r.action), ["UPLOADED", "REPLACED"]);
  const audits = await admin.query(
    "SELECT action FROM audit_events WHERE tenant_id=$1 AND action LIKE 'OFFICE_CERTIFICATE_ASSET%' ORDER BY created_at",
    [alphaId],
  );
  assert.ok(audits.rows.some((r: any) => r.action === "OFFICE_CERTIFICATE_ASSET_UPLOADED"));
  assert.ok(audits.rows.some((r: any) => r.action === "OFFICE_CERTIFICATE_ASSET_REPLACED"));
  // Append-only, enforced in depth: the app role holds no UPDATE grant on
  // either table (permission denied before any row is touched), and the
  // changes table additionally carries the immutable-record trigger.
  await assert.rejects(
    transaction(alphaId, async (db) =>
      db.query("UPDATE office_certificate_asset_changes SET reason='tampered' WHERE tenant_id=$1", [alphaId]),
    ),
    /permission denied/,
  );
  await assert.rejects(
    transaction(alphaId, async (db) =>
      db.query("UPDATE office_certificate_assets SET version=99 WHERE tenant_id=$1", [alphaId]),
    ),
  );
});

test("certassets: tenant isolation — beta cannot see or fetch alpha's assets; the owner can view any office", async () => {
  const betaOverview = await req("GET", "/office/certificate-assets", undefined, "betaAdmin");
  assert.equal(betaOverview.status, 200);
  assert.ok(betaOverview.body.items.every((i: any) => i.current === null && i.history.length === 0));
  assert.equal((await reqBytes("GET", "/office/certificate-assets/logo/image", "betaAdmin")).status, 404);
  assert.equal((await reqBytes("GET", "/office/certificate-assets/seal/image", "betaAdmin")).status, 404);
  const ownerView = await req("GET", `/owner/tenants/${alphaId}/certificate-assets`, undefined, "owner");
  assert.equal(ownerView.status, 200);
  assert.equal(ownerView.body.items.find((i: any) => i.kind === "LOGO").current.version, 2);
  assert.equal(ownerView.body.items.find((i: any) => i.kind === "SEAL").current.version, 2);
  assert.equal(ownerView.body.items.find((i: any) => i.kind === "SIGNATURE").current.version, 1);
  const ownerImage = await reqBytes("GET", `/owner/tenants/${alphaId}/certificate-assets/seal/image`, "owner");
  assert.equal(ownerImage.status, 200);
  assert.ok(ownerImage.bytes.equals(belaboSealPng));
  const ownerBeta = await req("GET", `/owner/tenants/${betaId}/certificate-assets`, undefined, "owner");
  assert.ok(ownerBeta.body.items.every((i: any) => i.current === null));
  assert.equal(
    (await req("GET", "/owner/tenants/00000000-0000-4000-8000-000000000000/certificate-assets", undefined, "owner")).status,
    404,
  );
});

test("certassets: the engine-agnostic bundle carries artwork, emblem and chairman name + designation", async () => {
  // Runs after the upload tests: alpha holds LOGO v2, SEAL v2, SIGNATURE v1.
  // Md's order of 25 Nov 2026, 12:12 (per-UP seal, re-confirmed): the
  // profile SEAL is the bundle's seal/watermark first source, per tenant —
  // alpha's SEAL v2 (the real Belabo seal bytes, uploaded in the test
  // above) is the watermark, derived (full-strength seal, faded by the
  // engines). Logo and signature still come from the profile uploads.
  const bundle = await transaction(alphaId, async (db) =>
    resolveCertificateAssetsBundle(db, alphaId, {
      nameBn: "মোঃ হাবিবুর রহমান",
      nameEn: "MD HABIBUR RAHMAN",
      accountType: "up_panel_chairman",
    }),
  );
  assert.equal(bundle.logo, dataUrlOf(logoPngV2));
  assert.equal(bundle.seal, dataUrlOf(belaboSealPng), "profile seal feeds the bundle seal");
  assert.equal(bundle.watermark, dataUrlOf(belaboSealPng), "profile seal is the watermark first source");
  assert.equal(bundle.watermarkDerived, true, "full-strength profile seal is derived by the engines");
  assert.equal(bundle.signature, dataUrlOf(signaturePng));
  assert.ok(bundle.emblem?.startsWith("data:image/png;base64,"), "shared emblem rides the bundle");
  assert.equal(bundle.chairmanNameBn, "মোঃ হাবিবুর রহমান");
  assert.equal(bundle.chairmanNameEn, "MD HABIBUR RAHMAN");
  assert.equal(bundle.chairmanDesignationBn, "প্যানেল চেয়ারম্যান");
  assert.equal(bundle.chairmanDesignationEn, "Panel Chairman");
  const empty = await transaction(betaId, async (db) =>
    resolveCertificateAssetsBundle(db, betaId, null),
  );
  assert.equal(empty.logo, null);
  assert.equal(empty.seal, null);
  assert.equal(empty.watermark, null);
  assert.equal(empty.watermarkDerived, false);
  assert.equal(empty.signature, null);
  assert.equal(empty.chairmanNameBn, null);
  assert.equal(empty.chairmanDesignationEn, "Chairman");
});

/* --- Template-level resolution (no DB): profile > drop-in > none --- */
const templateInput = (over: Partial<PdfInput> = {}): PdfInput =>
  ({
    number: "2026-TEST-0001",
    verificationUrl: "https://example.test/verify/token",
    tenant: { id: "tenant-x", name_bn: "টেস্ট ইউনিয়ন পরিষদ", name_en: "Test Union Parishad" },
    service: { service_no: 45, name_bn: "বাসিন্দা সনদ", name_en: "Resident certificate" },
    citizen: {
      full_name_bn: "টেস্ট নাগরিক",
      full_name_en: "Test Citizen",
      address_bn: "টেস্ট ঠিকানা",
      address_en: "Test address",
    },
    payload: { delivery_language: "bn", residence_since: "2020-01-01", purpose_bn: "পরীক্ষা", permanent_address_bn: "টেস্ট ঠিকানা" },
    issuer: { nameBn: "টেস্ট চেয়ারম্যান", nameEn: "Test Chairman", accountType: "up_panel_chairman" },
    issuedAt: "2026-11-18T00:00:00.000Z",
    ...over,
  }) as PdfInput;
const qrStub = "data:image/png;base64,AAAA";

test("certassets: template renders the signature but no logo, and the profile seal as the watermark (Md's order 25 Nov 2026, 12:12)", () => {
  process.env.ISSUANCE_MODE = "official";
  try {
    const html = renderCertificateHtml(
      templateInput({
        assets: { logo: dataUrlOf(logoPng), seal: dataUrlOf(belaboSealPng), signature: dataUrlOf(signaturePng) },
      }),
      qrStub,
    );
    // Prottoyon references show no office logo anywhere on the certificate.
    assert.ok(!html.includes('<img class="office-logo"'), "no logo in the header");
    assert.ok(html.includes(`<img class="sign-img" alt="" src="${dataUrlOf(signaturePng)}"`), "signature above the line");
    // Per-UP seal, profile first (Md 12:12): the profile seal IS the
    // centre watermark, derived (full-strength seal faded to .08 by the
    // HTML engine). Never the Government emblem.
    assert.ok(html.includes('class="seal-wm"'), "seal watermark element present");
    assert.ok(html.includes(dataUrlOf(belaboSealPng)), "the profile seal is the watermark source");
    assert.ok(html.includes('style="opacity:.08"'), "full-strength profile seal is faded by the engine");
    assert.ok(!html.includes("emblem-wm"), "no emblem watermark — CERTNO-01 superseded");
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
});

test("certassets: template without profile assets matches the previous fallback exactly in kind", () => {
  process.env.ISSUANCE_MODE = "official";
  try {
    const html = renderCertificateHtml(templateInput(), qrStub);
    assert.ok(!html.includes('<img class="office-logo"'), "no logo slot content");
    assert.ok(!html.includes('<img class="sign-img"'), "blank signature line only");
    assert.ok(!html.includes('class="seal-wm"'), "no seal watermark element");
    // No watermark of any kind when no seal resolves at all (Md's order
    // 25 Nov 2026 supersedes the CERTNO-01 emblem watermark).
    assert.ok(!html.includes("emblem-wm"), "no emblem watermark without a drop-in seal");
    assert.ok(html.includes('<div class="sign-line"></div>'), "the signature line itself remains");
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
});

test("certassets: the profile seal outranks the drop-in; with no profile seal the drop-in seal prints (Md's order 25 Nov 2026, 12:12)", () => {
  process.env.ISSUANCE_MODE = "official";
  process.env.CERTIFICATE_OFFICE_ASSETS_DIR = fileURLToPath(
    new URL("../assets/offices/belabo-up/", import.meta.url),
  );
  try {
    const dropInOnly = renderCertificateHtml(templateInput(), qrStub);
    assert.ok(dropInOnly.includes('class="seal-wm"'), "drop-in seal-watermark renders as the watermark");
    assert.ok(dropInOnly.includes(dataUrlOf(belaboSealWatermarkPng)), "the pre-faded drop-in watermark is the source when no profile seal is set");
    assert.ok(!dropInOnly.includes("emblem-wm"), "no emblem watermark");
    assert.ok(!dropInOnly.includes(dataUrlOf(belaboSealPng)), "the full-strength drop-in seal.png itself is not printed — only its pre-faded watermark form");
    // A profile seal outranks the drop-in: the watermark is the profile
    // seal (here deliberately a non-seal image, as in production where
    // the profile seal is the platform logo until the owner removes it —
    // the fix is operational, not a code substitution).
    const withProfileSeal = renderCertificateHtml(
      templateInput({ assets: { seal: dataUrlOf(logoPng) } }),
      qrStub,
    );
    assert.ok(withProfileSeal.includes('class="seal-wm"'), "seal watermark element present");
    assert.ok(withProfileSeal.includes(dataUrlOf(logoPng)), "the profile seal wins over the drop-in");
    assert.ok(!withProfileSeal.includes(dataUrlOf(belaboSealWatermarkPng)), "the drop-in watermark is not used when a profile seal is set");
  } finally {
    delete process.env.ISSUANCE_MODE;
    delete process.env.CERTIFICATE_OFFICE_ASSETS_DIR;
  }
});

test("certassets: demo mode prints no profile artwork (the official-mode gate is unchanged)", () => {
  delete process.env.ISSUANCE_MODE;
  const html = renderCertificateHtml(
    templateInput({
      assets: { logo: dataUrlOf(logoPng), seal: dataUrlOf(belaboSealPng), signature: dataUrlOf(signaturePng) },
    }),
    qrStub,
  );
  assert.ok(!html.includes('<img class="office-logo"'));
  assert.ok(!html.includes('<img class="sign-img"'));
  assert.ok(!html.includes('class="seal-wm"'));
  assert.ok(!html.includes('<img class="emblem-wm"'), "no emblem watermark outside official mode");
});

test("certassets: preview renders a real sample PDF with the office assets and stores nothing", async () => {
  const before = (await admin.query("SELECT count(*)::int n FROM certificates WHERE tenant_id=$1", [alphaId])).rows[0].n;
  assert.equal((await reqBytes("GET", "/office/certificate-assets/preview?serviceNo=12", "alphaCitizen")).status, 403);
  process.env.ISSUANCE_MODE = "official";
  try {
    const preview = await reqBytes("GET", "/office/certificate-assets/preview?serviceNo=12", "alphaAdmin");
    assert.equal(preview.status, 200);
    assert.ok(preview.type.includes("application/pdf"));
    assert.equal(preview.bytes.subarray(0, 5).toString(), "%PDF-");
    assert.ok(preview.bytes.length > 10000, "a real rendered document, not a stub");
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
  const after = (await admin.query("SELECT count(*)::int n FROM certificates WHERE tenant_id=$1", [alphaId])).rows[0].n;
  assert.equal(after, before, "preview must never store a certificate");
});

/* --- End-to-end issuance (the proof pack) --- */
async function issueCertificate(who: string, citizenWho: string, serviceNo: number) {
  const citizens = await req("GET", "/citizens", undefined, citizenWho);
  const citizenId = citizens.body.items[0].id;
  // QAFIX-08: the trade form no longer collects fee components
  // (fees are system-set only), so an official trade licence now
  // issues against an ORDER instead — a zero-fee policy published
  // for this office, with the form's language agreeing with the
  // order's (the orders module rejects a mismatch).
  let payload: Record<string, unknown> = demoPayloads[serviceNo];
  let order: Record<string, unknown> | undefined;
  if (serviceNo === 42) {
    const current = (
      await admin.query(
        "SELECT COALESCE(MAX(version),0)::int v FROM service_order_policies WHERE tenant_id=$1 AND service_no=42",
        [alphaId],
      )
    ).rows[0].v as number;
    const published = await req(
      "POST",
      "/admin/services/42/order-policies",
      {
        expectedVersion: current,
        reason: "Synthetic certificate-assets regression; not a government tariff",
        statutoryFeeMinor: 0,
        processingFeeMinor: 0,
        emergencySurchargeMinor: 0,
        deliveryFeesMinor: { office_collection: 0, digital_copy: 0 },
        deliveryModes: ["office_collection", "digital_copy"],
        urgencies: ["normal"],
      },
      "alphaAdmin",
    );
    assert.equal(published.status, 201, JSON.stringify(published.body));
    payload = { ...payload, delivery_language: "en" };
    order = {
      policyVersion: published.body.policy.version,
      preferences: {
        addressBasis: "registered_profile",
        certificateLanguage: "en",
        deliveryMode: "office_collection",
        urgency: "normal",
      },
    };
  }
  const created = await req(
    "POST",
    "/applications",
    { citizenId, serviceNo, payload, ...(order ? { order } : {}) },
    who,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id as string;
  const submitted = await req("POST", `/applications/${id}/transition`, { action: "submit" }, who);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  return id;
}
async function approveAndFetch(id: string, approverWho: string) {
  const approved = await req("POST", `/applications/${id}/transition`, { action: "approve" }, approverWho);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.state, "ISSUED");
  const cert = approved.body.certificate;
  assert.ok(cert?.id && cert?.number);
  const pdf = await reqBytes("GET", `/certificates/${cert.id}/pdf`, approverWho);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.bytes.subarray(0, 5).toString(), "%PDF-");
  return { cert, pdf: pdf.bytes };
}

test("certassets: end-to-end — alpha issues with signature and its profile-seal watermark (no logo on the certificate); beta is blocked by the A7 signature gate", async () => {
  process.env.ISSUANCE_MODE = "official";
  const proofDir = process.env.CERTASSETS_PROOF_DIR;
  try {
    const saved: string[] = [];
    for (const serviceNo of [45, 12, 42]) {
      const appId = await issueCertificate("alphaStaff", "alphaCitizen", serviceNo);
      const { cert, pdf } = await approveAndFetch(appId, "alphaApprover");
      assert.ok(pdf.length > 10000, `service ${serviceNo} certificate PDF is a real document`);
      if (proofDir) {
        fs.mkdirSync(proofDir, { recursive: true });
        const file = path.join(proofDir, `alpha-service-${serviceNo}-with-assets.pdf`);
        fs.writeFileSync(file, pdf);
        saved.push(`${file} (${cert.number})`);
      }
    }
    const betaApp = await issueCertificate("betaStaff", "betaCitizen", 45);
    // CERT-REFINE-01 (A7): beta has NO signature asset, so official-mode
    // issuance is now blocked at approval with SIGNATURE_MISSING instead of
    // silently issuing an unsigned-looking certificate. (The plain-fallback
    // render without artwork remains covered at render level.)
    const betaApprove = await req(
      "POST",
      `/applications/${betaApp}/transition`,
      { action: "approve" },
      "betaApprover",
    );
    assert.equal(betaApprove.status, 422, JSON.stringify(betaApprove.body));
    assert.equal(betaApprove.body.error.code, "SIGNATURE_MISSING");
    if (saved.length) console.log(`certassets proof pack: ${saved.join(" · ")}`);
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
});

/* --- WS-5 ASSETS-REMOVE: removal is a tombstone, never a physical delete ---
 * These tests run last in the file, after every test that reads alpha's
 * assets, and they never assume an absolute version: the shared dev database
 * carries whatever earlier runs uploaded, so every version is read first and
 * asserted relative to it. Each removal is followed by a re-upload, so the
 * office is left with a live asset of every kind.
 */
const REMOVE_REASON = "Placeholder artwork no longer needed";
async function overviewItem(who: string, kind: string) {
  const overview = await req("GET", "/office/certificate-assets", undefined, who);
  assert.equal(overview.status, 200, JSON.stringify(overview.body));
  return overview.body.items.find((i: any) => i.kind === kind);
}

test("certassets: remove role gates — citizens, staff and anonymous callers cannot remove", async () => {
  assert.equal(
    (await req("DELETE", "/office/certificate-assets/logo", { reason: REMOVE_REASON }, "alphaCitizen")).status,
    403,
  );
  assert.equal(
    (await req("DELETE", "/office/certificate-assets/logo", { reason: REMOVE_REASON }, "alphaStaff")).status,
    403,
  );
  assert.equal(
    (await req("DELETE", "/office/certificate-assets/logo", { reason: REMOVE_REASON })).status,
    401,
  );
});

test("certassets: remove with no asset is 404; a short or missing reason is 422 and stores nothing", async () => {
  // Beta never uploaded anything: there is nothing to remove.
  assert.equal(
    (await req("DELETE", "/office/certificate-assets/logo", { reason: REMOVE_REASON }, "betaAdmin")).status,
    404,
  );
  const before = await overviewItem("alphaAdmin", "LOGO");
  assert.ok(before.current, "alpha holds a logo to attempt the removal against");
  const resolvedBefore = await transaction(alphaId, async (db) => resolveCertificateAssets(db, alphaId));
  // A present-but-short reason fails input validation (same as PUT).
  const short = await req("DELETE", "/office/certificate-assets/logo", { reason: "short" }, "alphaAdmin");
  assert.equal(short.status, 422);
  assert.equal(short.body.error.code, "INPUT_INVALID");
  // A missing reason fails with REASON_REQUIRED — the same audit rule as a
  // reason-less replace: the removal reason is the audit trail.
  const noReasonBody = await req("DELETE", "/office/certificate-assets/logo", {}, "alphaAdmin");
  assert.equal(noReasonBody.status, 422);
  assert.equal(noReasonBody.body.error.code, "REASON_REQUIRED");
  const noReasonAtAll = await req("DELETE", "/office/certificate-assets/logo", undefined, "alphaAdmin");
  assert.equal(noReasonAtAll.status, 422);
  assert.equal(noReasonAtAll.body.error.code, "REASON_REQUIRED");
  const after = await overviewItem("alphaAdmin", "LOGO");
  assert.equal(after.current.version, before.current.version, "rejected removals store nothing");
  const resolvedAfter = await transaction(alphaId, async (db) => resolveCertificateAssets(db, alphaId));
  assert.equal(resolvedAfter.logo, resolvedBefore.logo, "the logo still resolves after rejected removals");
});

test("certassets: remove tombstones the kind — resolve, overview and image all read null; history keeps REMOVED", async () => {
  const before = await overviewItem("alphaAdmin", "LOGO");
  const uploaded = await req(
    "PUT",
    "/office/certificate-assets/logo",
    { mimeType: "image/png", base64: b64(logoPng), reason: "Fresh upload for the removal proof" },
    "alphaAdmin",
  );
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.version, before.current.version + 1);
  const removed = await req(
    "DELETE",
    "/office/certificate-assets/logo",
    { reason: REMOVE_REASON },
    "alphaAdmin",
  );
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.deepEqual(
    { kind: removed.body.kind, version: removed.body.version, removed: removed.body.removed },
    { kind: "LOGO", version: uploaded.body.version + 1, removed: true },
  );
  assert.ok(removed.body.removedAt, "the tombstone carries its removal time");

  const resolved = await transaction(alphaId, async (db) => resolveCertificateAssets(db, alphaId));
  assert.equal(resolved.logo, null, "a removed kind resolves to null, not to the previous version");
  const overview = await overviewItem("alphaAdmin", "LOGO");
  assert.equal(overview.current, null, "the overview shows the empty state after removal");
  assert.equal(overview.history[0].action, "REMOVED");
  assert.equal(overview.history[0].reason, REMOVE_REASON);
  assert.equal(overview.history[0].version, removed.body.version);
  assert.equal(
    (await reqBytes("GET", "/office/certificate-assets/logo/image", "alphaAdmin")).status,
    404,
  );
  // The owner view agrees: no current asset, REMOVED on top of the history.
  const ownerView = await req("GET", `/owner/tenants/${alphaId}/certificate-assets`, undefined, "owner");
  const ownerLogo = ownerView.body.items.find((i: any) => i.kind === "LOGO");
  assert.equal(ownerLogo.current, null);
  assert.equal(ownerLogo.history[0].action, "REMOVED");
  // Depth: the tombstone row itself carries removed=true and is the latest
  // version; the older rows are untouched. (No claim is made that it is the
  // only tombstone ever: a previous proof run may have left its own.)
  const rows = await admin.query(
    "SELECT version, removed FROM office_certificate_assets WHERE tenant_id=$1 AND kind='LOGO' ORDER BY version",
    [alphaId],
  );
  const tombstoneRow = rows.rows.find((r: any) => r.version === removed.body.version);
  assert.equal(tombstoneRow?.removed, true, "the new version row is the tombstone");
  assert.equal(rows.rows.at(-1).version, removed.body.version, "the tombstone is the latest version");
  const changes = await admin.query(
    "SELECT action, reason FROM office_certificate_asset_changes WHERE tenant_id=$1 AND kind='LOGO' ORDER BY version DESC LIMIT 1",
    [alphaId],
  );
  assert.deepEqual(changes.rows.map((r: any) => [r.action, r.reason]), [["REMOVED", REMOVE_REASON]]);
  const audits = await admin.query(
    "SELECT action FROM audit_events WHERE tenant_id=$1 AND action='OFFICE_CERTIFICATE_ASSET_REMOVED' ORDER BY created_at DESC LIMIT 1",
    [alphaId],
  );
  assert.equal(audits.rows.length, 1);
});

test("certassets: remove twice is 404 the second time", async () => {
  assert.equal(
    (await req("DELETE", "/office/certificate-assets/logo", { reason: REMOVE_REASON }, "alphaAdmin")).status,
    404,
  );
});

test("certassets: remove then re-upload works and still needs a reason", async () => {
  const tombstone = await overviewItem("alphaAdmin", "LOGO");
  assert.equal(tombstone.current, null, "the logo is still removed here");
  const tombstoneVersion = tombstone.history[0].version;
  const noReason = await req(
    "PUT",
    "/office/certificate-assets/logo",
    { mimeType: "image/png", base64: b64(logoPngV2) },
    "alphaAdmin",
  );
  assert.equal(noReason.status, 422);
  assert.equal(noReason.body.error.code, "REASON_REQUIRED");
  const reuploaded = await req(
    "PUT",
    "/office/certificate-assets/logo",
    { mimeType: "image/png", base64: b64(logoPngV2), reason: "Real office logo received after staging" },
    "alphaAdmin",
  );
  assert.equal(reuploaded.status, 200, JSON.stringify(reuploaded.body));
  assert.equal(reuploaded.body.version, tombstoneVersion + 1);
  const resolved = await transaction(alphaId, async (db) => resolveCertificateAssets(db, alphaId));
  assert.equal(resolved.logo, dataUrlOf(logoPngV2));
  const served = await reqBytes("GET", "/office/certificate-assets/logo/image", "alphaAdmin");
  assert.equal(served.status, 200);
  assert.ok(served.bytes.equals(logoPngV2));
});

test("certassets: remove never resurrects an older version", async () => {
  const beforeAssets = await transaction(alphaId, async (db) => resolveCertificateAssets(db, alphaId));
  assert.ok(beforeAssets.logo, "alpha holds a logo before the seal proof");
  const v1 = await req(
    "PUT",
    "/office/certificate-assets/seal",
    { mimeType: "image/png", base64: b64(belaboSealPng), reason: "Seal re-uploaded for the tombstone proof" },
    "alphaAdmin",
  );
  assert.equal(v1.status, 200, JSON.stringify(v1.body));
  const v2 = await req(
    "PUT",
    "/office/certificate-assets/seal",
    { mimeType: "image/png", base64: b64(logoPngV2), reason: "Seal replaced with a different image" },
    "alphaAdmin",
  );
  assert.equal(v2.status, 200, JSON.stringify(v2.body));
  assert.equal(v2.body.version, v1.body.version + 1);
  const removed = await req(
    "DELETE",
    "/office/certificate-assets/seal",
    { reason: REMOVE_REASON },
    "alphaAdmin",
  );
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(removed.body.version, v2.body.version + 1);
  const resolved = await transaction(alphaId, async (db) => resolveCertificateAssets(db, alphaId));
  assert.equal(resolved.seal, null, "the tombstone hides v2's bytes as well as v1's");
  assert.equal(resolved.logo, beforeAssets.logo, "removing the seal leaves the logo untouched");
  // Restore a live seal so the office is not left without one.
  const restored = await req(
    "PUT",
    "/office/certificate-assets/seal",
    { mimeType: "image/png", base64: b64(belaboSealPng), reason: "Seal restored after the tombstone proof" },
    "alphaAdmin",
  );
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.version, removed.body.version + 1);
  assert.equal(
    (await transaction(alphaId, async (db) => resolveCertificateAssets(db, alphaId))).seal,
    dataUrlOf(belaboSealPng),
  );
});

test("certassets: remove leaves the other kinds untouched and cannot cross tenants", async () => {
  const before = await transaction(alphaId, async (db) => resolveCertificateAssets(db, alphaId));
  assert.ok(before.logo && before.seal && before.signature, "alpha holds all three kinds here");
  const removed = await req(
    "DELETE",
    "/office/certificate-assets/signature",
    { reason: REMOVE_REASON },
    "alphaApprover",
  );
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  const after = await transaction(alphaId, async (db) => resolveCertificateAssets(db, alphaId));
  assert.equal(after.logo, before.logo, "the logo survives a signature removal");
  assert.equal(after.seal, before.seal, "the seal survives a signature removal");
  assert.equal(after.signature, null, "only the signature is gone");
  // Beta's admin cannot touch alpha's assets: beta has no signature of its
  // own, so its DELETE 404s, and alpha's logo is byte-identical afterwards.
  assert.equal(
    (await req("DELETE", "/office/certificate-assets/signature", { reason: REMOVE_REASON }, "betaAdmin")).status,
    404,
  );
  assert.equal(
    (await req("DELETE", "/office/certificate-assets/logo", { reason: REMOVE_REASON }, "betaAdmin")).status,
    404,
  );
  const untouched = await transaction(alphaId, async (db) => resolveCertificateAssets(db, alphaId));
  assert.equal(untouched.logo, before.logo);
  // Restore the chairman's signature.
  const restored = await req(
    "PUT",
    "/office/certificate-assets/signature",
    { mimeType: "image/png", base64: b64(signaturePng), reason: "Signature restored after the removal proof" },
    "alphaApprover",
  );
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.version, removed.body.version + 1);
});
