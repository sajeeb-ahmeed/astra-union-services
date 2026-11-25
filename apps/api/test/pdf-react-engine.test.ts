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

test("react-pdf layout: the plain number and the issue date can never collide (CERT-REFINE-01 A8, strip superseded 25 Nov 2026)", async () => {
  // The current production number (14 digits since CERTNO-DDMM) in the
  // shared number/date row (the citizen photo now sits in the header
  // row's top-right corner — PHOTO-CORNER 25 Nov 2026 — so it no longer
  // narrows the body column).
  const photo =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const pdf = await withEngine("react-pdf", () =>
    generatePdf(
      fixture(45, {
        number: "25111234567890",
        citizenPhoto: photo,
        payload: { delivery_language: "bn" },
      } as Partial<PdfInput>),
    ),
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reactpdf-bbox-"));
  const file = path.join(dir, "certificate.pdf");
  fs.writeFileSync(file, pdf);
  const { stdout } = await execFileAsync("pdftotext", ["-bbox", file, "-"]);
  const words = [...stdout.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map(
    (m) => ({ xMin: +m[1]!, yMin: +m[2]!, xMax: +m[3]!, yMax: +m[4]!, text: m[5]! }),
  );
  // Md's order of 25 Nov 2026: the number prints PLAIN — one word,
  // never one-digit-per-box cells (14 digits since CERTNO-DDMM).
  const numberWord = words.find((w) => /^[০-৯]{14}$/.test(w.text));
  assert.ok(numberWord, "the plain 14-digit number prints as one word");
  const band = {
    top: numberWord!.yMin - 3,
    bottom: numberWord!.yMax + 3,
  };
  const year = words.find((w) => w.text === "২০২৬" && w.yMin < 300);
  assert.ok(year, "the issue-date year prints");
  // A8's invariant is NON-COLLISION: no other word may overlap the
  // number word's rectangle (the row wraps with flexWrap, so the date
  // group may sit on its own right-aligned line instead).
  const rowWords = words.filter(
    (w) => w !== numberWord && w.yMin > band.top - 30 && w.yMin < band.bottom + 30,
  );
  for (const w of rowWords) {
    const overlaps =
      w.xMin < numberWord!.xMax && w.xMax > numberWord!.xMin && w.yMin < band.bottom && w.yMax > band.top;
    assert.ok(!overlaps, `date-row word "${w.text}" overlaps the plain number`);
  }
});

test("react-pdf layout: service 46 renders as a standard A4 family certificate (CERT-REFINE-02 R2-05)", async () => {
  const pdf = await withEngine("react-pdf", () =>
    generatePdf(fixture(46, { number: "2026111812345678" } as Partial<PdfInput>)),
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reactpdf-veh-"));
  const file = path.join(dir, "vehicle.pdf");
  fs.writeFileSync(file, pdf);
  const { stdout: info } = await execFileAsync("pdfinfo", [file]);
  // A4 portrait, one page — the landscape card (243.78 × 153.07 pt) is gone.
  assert.ok(info.includes("595.28 x 841.89 pts"), `A4 portrait page (saw: ${info.match(/Page size:.*/)?.[0]})`);
  assert.ok(/Pages:\s+1/.test(info), "one page");
  const text = await pdfText(pdf);
  // The licence number prints EXACTLY as stored in the demo payload
  // (R2-16: no digit conversion inside identifier strings).
  const demo46 = demoPayloads[46] as Record<string, unknown>;
  const licenceNo = String(demo46.transport_license_no ?? "");
  if (licenceNo) assert.ok(text.includes(licenceNo), `licence no ${licenceNo} prints as stored`);
  // The family shell is present: the chairman signature block prints.
  // (Extraction is visual order — the title's pre-base sign extracts first,
  // exactly as the Bangla-engine test below documents for "চেয়ারম্যান".)
  assert.ok(text.includes("েচয়ারম্যান"), "signature block title prints");
});

test("react-pdf engine renders a Bangla certificate: number, attestation, bundled fonts only", async () => {  const pdf = await withEngine("react-pdf", () => generatePdf(fixture(12)));
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
  // REFINE (25 Nov 2026): one verify label in both engines, as on the
  // references — "যাচাইকরণ:" (was "যাচাই করুন:" + a numerals line).
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
  // CERT-REFINE-01 (A7): this file runs in official mode — issuance is
  // gated on a configured chairman signature, uploaded through the real
  // endpoint before any approval below.
  const sigPng =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const upload = await req(
    "PUT",
    "/office/certificate-assets/signature",
    {
      mimeType: "image/png",
      base64: sigPng,
      reason: "CERT-REFINE-01 official-issuance gate test setup",
    },
    "approver",
  );
  assert.ok([200, 201].includes(upload.status), JSON.stringify(upload.body));
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
  // CERT-REFINE-01 (A6): the printed verification URL now carries the
  // number in Latin digits (previously it printed Bengali digits, which is
  // what made the old bnDigits assertion pass); the number also prints in
  // Latin digits in the footer line under the verify URL.
  assert.ok(
    text.includes(issued.number),
    "stored PDF carries the certificate number",
  );
  assert.ok(
    text.includes("প্রত্যয়ন করা"),
    "stored PDF carries the Bangla attestation opening",
  );
  const fonts = await pdfFonts(pdf);
  assert.ok(!fonts.includes("Helvetica"), "stored PDF uses bundled fonts only");
});
