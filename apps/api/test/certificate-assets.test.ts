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
  const bundle = await transaction(alphaId, async (db) =>
    resolveCertificateAssetsBundle(db, alphaId, {
      nameBn: "মোঃ হাবিবুর রহমান",
      nameEn: "MD HABIBUR RAHMAN",
      accountType: "up_panel_chairman",
    }),
  );
  assert.equal(bundle.logo, dataUrlOf(logoPngV2));
  assert.equal(bundle.seal, dataUrlOf(belaboSealPng));
  assert.equal(bundle.watermark, dataUrlOf(belaboSealPng));
  assert.equal(bundle.watermarkDerived, true, "profile seal watermark is engine-derived");
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

test("certassets: template renders profile logo, signature and a derived seal watermark in official mode", () => {
  process.env.ISSUANCE_MODE = "official";
  try {
    const html = renderCertificateHtml(
      templateInput({
        assets: { logo: dataUrlOf(logoPng), seal: dataUrlOf(belaboSealPng), signature: dataUrlOf(signaturePng) },
      }),
      qrStub,
    );
    assert.ok(html.includes(`<img class="office-logo" alt="" src="${dataUrlOf(logoPng)}"`), "logo in the header");
    assert.ok(html.includes(`<img class="sign-img" alt="" src="${dataUrlOf(signaturePng)}"`), "signature above the line");
    assert.ok(
      html.includes(`<img class="seal-wm derived" alt="" src="${dataUrlOf(belaboSealPng)}"`),
      "watermark derived from the profile seal",
    );
    assert.ok(html.includes(".seal-wm.derived{opacity:.15}"), "derivation is a faint CSS opacity");
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
    assert.ok(!html.includes('<img class="seal-wm"'), "no watermark without any seal source");
    assert.ok(html.includes('<div class="sign-line"></div>'), "the signature line itself remains");
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
});

test("certassets: drop-in watermark is used when there is no profile seal, and the profile seal beats the drop-in", () => {
  process.env.ISSUANCE_MODE = "official";
  process.env.CERTIFICATE_OFFICE_ASSETS_DIR = fileURLToPath(
    new URL("../assets/offices/belabo-up/", import.meta.url),
  );
  try {
    const dropInOnly = renderCertificateHtml(templateInput(), qrStub);
    assert.ok(dropInOnly.includes('class="seal-wm"'), "pre-faded drop-in watermark, not derived");
    assert.ok(!dropInOnly.includes("seal-wm derived"));
    const profileWins = renderCertificateHtml(
      templateInput({ assets: { seal: dataUrlOf(logoPng) } }),
      qrStub,
    );
    assert.ok(
      profileWins.includes(`<img class="seal-wm derived" alt="" src="${dataUrlOf(logoPng)}"`),
      "profile seal outranks the drop-in files",
    );
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
  assert.ok(!html.includes('<img class="seal-wm"'));
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
  const created = await req(
    "POST",
    "/applications",
    { citizenId, serviceNo, payload: demoPayloads[serviceNo] },
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

test("certassets: end-to-end — alpha issues with logo, seal watermark and signature; beta issues with the plain fallback", async () => {
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
    const { pdf: betaPdf } = await approveAndFetch(betaApp, "betaApprover");
    assert.ok(betaPdf.length > 10000);
    if (proofDir) {
      const file = path.join(proofDir, "beta-service-45-no-assets.pdf");
      fs.writeFileSync(file, betaPdf);
      saved.push(file);
    }
    if (saved.length) console.log(`certassets proof pack: ${saved.join(" · ")}`);
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
});
