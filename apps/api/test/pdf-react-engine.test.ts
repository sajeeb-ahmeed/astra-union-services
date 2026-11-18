import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { demoPayloads, getServiceSchema } from "@astra/shared-schemas";
import type { PdfInput } from "../src/certificate-template.js";
import { generatePdf, pdfEngine, closePdfBrowser } from "../src/pdf.js";
import {
  splitScriptRuns,
  CERT_BENGALI_FAMILY,
  CERT_LATIN_FAMILY,
} from "../src/certificate-fonts.js";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";

/* REACTPDF-MIGRATION-01: the PDF_ENGINE switch. The Chromium engine stays
 * the default and byte-identical; the react-pdf engine renders template v7
 * with no browser process. These tests exercise the flag off AND on, the
 * deliberate font policy (pdffonts: bundled families only, no silent
 * Helvetica fallback), and a full chairman-direct issuance whose stored PDF
 * is produced by the react-pdf engine. */

process.env.NODE_ENV = "test";
process.env.ISSUANCE_MODE = "official";
process.env.CERTIFICATE_OFFICE_ASSETS_DIR = fileURLToPath(
  new URL("../assets/offices/belabo-up/", import.meta.url),
);

const execFileAsync = promisify(execFile);
const belabo = {
  verificationUrl: "https://belabo.astra.test/verify/abc123",
  tenant: {
    id: "belabo-tenant",
    name_bn: "বেলাবো ইউনিয়ন পরিষদ",
    name_en: "Belabo Union Parishad",
  },
  citizen: {
    full_name_bn: "আফসানা আক্তার মীম",
    full_name_en: "Afsana Akter Mim",
    address_bn: "বেলাব গাংকুল পাড়া",
    address_en: "Belab Gangkul Para",
    father_name_bn: "মোঃ আসাদুজ্জামান",
    father_name_en: "Md Asaduzzaman",
    mother_name_bn: "মুক্তি বেগম",
    mother_name_en: "Mukti Begum",
  },
  issuer: {
    nameBn: "মোঃ হাবিবুর রহমান",
    nameEn: "MD HABIBUR RAHMAN",
    accountType: "up_panel_chairman",
  },
  issuedAt: "2026-10-12T09:25:00+06:00",
  identity: { nid: "2405134038" },
  citizenGeography: {
    permanent: {
      division: { bn: "ঢাকা", en: "Dhaka" },
      district: { bn: "নরসিংদী", en: "Narsingdi" },
      upazila: { bn: "বেলাবো", en: "Belabo" },
      union: { bn: "বেলাবো", en: "Belabo" },
      wardNo: 3,
    },
  },
  officeGeography: {
    upazila: { bn: "বেলাবো", en: "Belabo" },
    district: { bn: "নরসিংদী", en: "Narsingdi" },
  },
} as unknown as PdfInput;

function fixture(serviceNo: number, over: Partial<PdfInput> = {}): PdfInput {
  const svc = {
    service_no: serviceNo,
    name_bn: `সেবা ${serviceNo}`,
    name_en: `Service ${serviceNo}`,
  };
  return {
    ...belabo,
    number: "2026-ENGTEST-AB12",
    service: svc,
    payload: { ...demoPayloads[serviceNo] },
    schema: getServiceSchema(serviceNo),
    ...over,
  } as PdfInput;
}

async function pdfText(pdf: Buffer): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reactpdf-test-"));
  const file = path.join(dir, "certificate.pdf");
  fs.writeFileSync(file, pdf);
  const { stdout } = await execFileAsync("pdftotext", [file, "-"]);
  return stdout.replace(/\s+/g, " ");
}
async function pdfFonts(pdf: Buffer): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reactpdf-fonts-"));
  const file = path.join(dir, "certificate.pdf");
  fs.writeFileSync(file, pdf);
  const { stdout } = await execFileAsync("pdffonts", [file]);
  return stdout;
}
const bnDigits = (v: string) =>
  v.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]!);

function withEngine<T>(engine: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.PDF_ENGINE;
  if (engine === undefined) delete process.env.PDF_ENGINE;
  else process.env.PDF_ENGINE = engine;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.PDF_ENGINE;
    else process.env.PDF_ENGINE = prev;
  });
}

test("pdfEngine: defaults to chromium, accepts react-pdf, rejects anything else", () => {
  const prev = process.env.PDF_ENGINE;
  try {
    delete process.env.PDF_ENGINE;
    assert.equal(pdfEngine(), "chromium");
    process.env.PDF_ENGINE = "react-pdf";
    assert.equal(pdfEngine(), "react-pdf");
    process.env.PDF_ENGINE = "wkhtmltopdf";
    assert.throws(() => pdfEngine(), /PDF_ENGINE must be/);
  } finally {
    if (prev === undefined) delete process.env.PDF_ENGINE;
    else process.env.PDF_ENGINE = prev;
  }
});

test("splitScriptRuns: Bengali, Latin and neutral runs split by script", () => {
  const runs = splitScriptRuns("২০২৬-SMOKE৪২-AB১২");
  // Bengali digits + hyphen (neutral attaches to the preceding run)
  assert.equal(runs[0]!.family, CERT_BENGALI_FAMILY);
  assert.equal(runs[0]!.text, "২০২৬-");
  // Latin word in the Latin family
  const latin = runs.find((r) => r.text.includes("SMOKE"));
  assert.ok(latin, "a run carries the Latin word");
  assert.equal(latin!.family, CERT_LATIN_FAMILY);
  // Bengali digits after the Latin word return to the Bengali family
  const tail = runs[runs.length - 1]!;
  assert.equal(tail.family, CERT_BENGALI_FAMILY);
  assert.equal(tail.text, "১২");
  // A neutral-only string yields a single run in the base family
  const neutral = splitScriptRuns("— : —");
  assert.equal(neutral.length, 1);
  assert.equal(neutral[0]!.family, CERT_BENGALI_FAMILY);
  // Latin-base documents split the same way with the roles exchanged
  const en = splitScriptRuns("Certificate 2026", CERT_LATIN_FAMILY);
  assert.ok(en.every((r) => r.family === CERT_LATIN_FAMILY));
});

test("react-pdf engine renders a Bangla certificate: number, attestation, bundled fonts only", async () => {
  const pdf = await withEngine("react-pdf", () => generatePdf(fixture(12)));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const text = await pdfText(pdf);
  assert.ok(
    text.includes(bnDigits("2026-ENGTEST-AB12")),
    "certificate number prints with Bengali digits and Latin letters",
  );
  // NOTE on probe choice: textkit writes shaped glyphs in visual order, so
  // pdftotext extracts Bengali pre-base vowel signs ahead of their consonant
  // ("যাইতেছে" extracts as "যাইেতেছ") even though the rendered page is
  // correct (proof pack: side-by-side PNG comparisons). "প্রত্যয়ন করা" is
  // the attestation's opening and extracts verbatim; full-string fidelity
  // is covered by the proof pack's bag-of-letters attestation check.
  assert.ok(text.includes("প্রত্যয়ন করা"), "Bangla attestation prints");
  // "চেয়ারম্যান" itself extracts with its pre-base sign first
  // ("েচয়ারম্যান"); the issuer surname extracts verbatim.
  assert.ok(text.includes("রহমান"), "signature block prints");
  assert.ok(text.includes("যাচাইকরণ"), "verify line prints");
  const fonts = await pdfFonts(pdf);
  assert.ok(fonts.includes("NotoSansBengali"), "Bengali family embedded");
  assert.ok(fonts.includes("LiberationSans"), "Latin family embedded");
  assert.ok(!fonts.includes("Helvetica"), "no silent Helvetica fallback");
});

test("react-pdf engine renders an English certificate with real Latin glyphs", async () => {
  const input = fixture(12, {
    payload: { ...demoPayloads[12], delivery_language: "en" },
  });
  const pdf = await withEngine("react-pdf", () => generatePdf(input));
  const text = await pdfText(pdf);
  assert.ok(text.includes("2026-ENGTEST-AB12"), "Latin certificate number prints as-is");
  assert.ok(text.includes("permanent resident"), "English attestation prints");
  const fonts = await pdfFonts(pdf);
  assert.ok(!fonts.includes("Helvetica"), "no silent Helvetica fallback");
});

test("engine flag off: the Chromium path still renders the same fixture", async () => {
  const pdf = await withEngine(undefined, () => generatePdf(fixture(12)));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const text = await pdfText(pdf);
  assert.ok(text.includes(bnDigits("2026-ENGTEST-AB12")), "chromium number prints");
  assert.ok(text.includes("প্রত্যয়ন করা"), "chromium attestation prints");
});

/* ---- end-to-end issuance through the API, engine on ---- */

let server: ReturnType<typeof app.listen>, base: string;
type Session = { cookie: string; csrf: string };
const sessions: Record<string, Session> = {};
async function req(method: string, path: string, data?: unknown, who?: string) {
  const session = who ? sessions[who] : undefined;
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, body: await response.json() };
}
async function login(name: string) {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${name}@alpha.local.test`, password: "Demo-Phase1!" }),
  });
  const json = await r.json();
  assert.equal(r.status, 200, JSON.stringify(json));
  sessions[name] = {
    cookie: r.headers.get("set-cookie")!.split(";")[0],
    csrf: json.csrfToken,
  };
}

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const name of ["staff", "approver", "citizen"]) await login(name);
});
after(async () => {
  await closePdfBrowser();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("end-to-end: chairman approval under PDF_ENGINE=react-pdf issues a stored, verifiable PDF", async () => {
  const citizenId = (await req("GET", "/citizens", undefined, "citizen")).body.items[0].id;
  const issued = await withEngine("react-pdf", async () => {
    const created = await req(
      "POST",
      "/applications",
      { citizenId, serviceNo: 45, payload: demoPayloads[45] },
      "staff",
    );
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id as string;
    const submitted = await req("POST", `/applications/${id}/transition`, { action: "submit" }, "staff");
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    const approved = await req("POST", `/applications/${id}/transition`, { action: "approve" }, "approver");
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.state, "ISSUED");
    return approved.body.certificate as { id: string; number: string };
  });
  assert.ok(issued?.id && issued?.number, "a certificate was issued");
  const s = sessions["staff"]!;
  const response = await fetch(`${base}/api/v1/certificates/${issued.id}/pdf`, {
    headers: { Cookie: s.cookie },
  });
  assert.equal(response.status, 200);
  const pdf = Buffer.from(await response.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const text = await pdfText(pdf);
  assert.ok(
    text.includes(bnDigits(issued.number)),
    "stored PDF carries the certificate number",
  );
  assert.ok(
    text.includes("প্রত্যয়ন করা"),
    "stored PDF carries the Bangla attestation opening",
  );
  const fonts = await pdfFonts(pdf);
  assert.ok(!fonts.includes("Helvetica"), "stored PDF uses bundled fonts only");
});
