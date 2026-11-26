/**
 * W-001 (Phase 4 Stage 1, P1) — every newly generated demo certificate PDF
 * carries clear unofficial/demo wording in Bengali AND English.
 *
 * HTML assertions check the exact Bengali strings; PDF text extraction
 * (pdftotext) checks the English lines, "DEMO" and the Bengali banner head
 * "নমুনা সনদ" — pdftotext reorders Bengali pre-base vowel signs (see
 * pdf-react-engine.test.ts), so full Bengali sentences are asserted at the
 * HTML level, not on extracted PDF text.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getServiceSchema } from "@astra/shared-schemas";
import {
  renderCertificateHtml,
  type PdfInput,
} from "../src/certificate-template.js";
import {
  DEMO_BANNER_BN,
  DEMO_BANNER_EN,
  DEMO_NOTICE_BN,
  DEMO_NOTICE_EN,
} from "../src/demo-notice.js";
import { closePdfBrowser, generatePdf } from "../src/pdf.js";
import { renderCertificatePdfReact } from "../src/pdf-react.js";
import { pool } from "../src/db.js";

process.env.NODE_ENV = "test";
// The Chromium renderer and the pg pool (pulled in through pdf.ts) keep the
// event loop alive; without this the runner never exits.
after(async () => {
  await closePdfBrowser();
  await pool.end();
});
const execFileAsync = promisify(execFile);
const qr = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const residentInput: PdfInput = {
  number: "DEMO-2026112512345678",
  verificationUrl: "https://example.test/verify/x",
  tenant: { name_bn: "টেস্ট ইউনিয়ন", name_en: "Test Union" },
  service: { service_no: 45, name_bn: "বাসিন্দা সনদ", name_en: "Resident certificate" },
  citizen: {
    full_name_bn: "টেস্ট নাগরিক",
    full_name_en: "Test Citizen",
    address_bn: "ঠিকানা",
    address_en: "Address",
  },
  payload: {
    delivery_language: "en",
    residence_since: "2020-01-01",
    purpose_en: "Test",
    purpose_bn: "টেস্ট",
    permanent_address_en: "Address",
    permanent_address_bn: "ঠিকানা",
  },
  schema: getServiceSchema(45),
} as PdfInput;

async function pdfText(pdf: Buffer): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-cert-"));
  const file = path.join(dir, "certificate.pdf");
  fs.writeFileSync(file, pdf);
  const { stdout } = await execFileAsync("pdftotext", [file, "-"]);
  return stdout.replace(/\s+/g, " ");
}
async function pdfWords(pdf: Buffer): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-cert-bbox-"));
  const file = path.join(dir, "certificate.pdf");
  fs.writeFileSync(file, pdf);
  const { stdout } = await execFileAsync("pdftotext", ["-bbox", file, "-"]);
  return stdout;
}
function assertDemoText(text: string, where: string) {
  assert.ok(text.includes("DEMO"), `${where}: DEMO watermark text`);
  assert.ok(text.includes("This is not an official certificate"), `${where}: English banner line`);
  assert.ok(
    text.includes("This is a demo certificate made for testing only. It is not valid for official use."),
    `${where}: English not-official line`,
  );
  assert.ok(text.includes("নমুনা সনদ"), `${where}: Bengali banner head`);
}
function assertNoDemoText(text: string, where: string) {
  assert.ok(!text.includes("DEMO"), `${where}: no DEMO word`);
  assert.ok(!text.includes("not an official certificate"), `${where}: no not-official line`);
  assert.ok(!text.includes("নমুনা সনদ"), `${where}: no Bengali demo banner`);
}

test("W-001: demo HTML (template 6 and 7) carries the banner, watermark and both-language lines; official carries none", () => {
  delete process.env.ISSUANCE_MODE;
  for (const version of [6, 7]) {
    const html = renderCertificateHtml(residentInput, qr, version);
    assert.ok(html.includes(DEMO_BANNER_BN), `v${version}: Bengali banner`);
    assert.ok(html.includes(DEMO_BANNER_EN), `v${version}: English banner`);
    assert.ok(html.includes(DEMO_NOTICE_BN), `v${version}: Bengali notice`);
    assert.ok(html.includes(DEMO_NOTICE_EN), `v${version}: English notice`);
    assert.ok(html.includes("DEMO"), `v${version}: DEMO watermark`);
  }
  process.env.ISSUANCE_MODE = "official";
  try {
    // Official mode also uses a production number (no DEMO- marker).
    const officialInput = { ...residentInput, number: "2026112512345678" };
    for (const version of [6, 7]) {
      const html = renderCertificateHtml(officialInput, qr, version);
      assert.ok(!html.includes(DEMO_BANNER_BN), `v${version} official: no Bengali banner`);
      assert.ok(!html.includes(DEMO_BANNER_EN), `v${version} official: no English banner`);
      assert.ok(!html.includes(DEMO_NOTICE_BN), `v${version} official: no Bengali notice`);
      assert.ok(!html.includes(DEMO_NOTICE_EN), `v${version} official: no English notice`);
      assert.ok(!html.includes("DEMO"), `v${version} official: no DEMO word`);
    }
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
});

test("W-001: demo PDF text extraction (Chromium engine, template 7 and 6) carries the demo wording; official does not", async () => {
  delete process.env.ISSUANCE_MODE;
  try {
    for (const version of [7, 6]) {
      const pdf = await generatePdf(residentInput, version);
      assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
      assertDemoText(await pdfText(pdf), `Chromium v${version} demo PDF`);
    }
    // The banner sits at the top of the page, not buried in the footer.
    const v7 = await generatePdf(residentInput, 7);
    const bbox = await pdfWords(v7);
    const certWord = /<word xMin="[\d.]+" yMin="([\d.]+)"[^>]*>CERTIFICATE<\/word>/.exec(bbox);
    assert.ok(certWord, "the banner CERTIFICATE word is extractable with coordinates");
    assert.ok(Number(certWord[1]) < 150, `banner near the top of the page (yMin ${certWord[1]} < 150)`);
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
  process.env.ISSUANCE_MODE = "official";
  try {
    for (const version of [7, 6]) {
      const pdf = await generatePdf({ ...residentInput, number: "2026112512345678" }, version);
      assertNoDemoText(await pdfText(pdf), `Chromium v${version} official PDF`);
    }
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
});

test("W-001: demo PDF text extraction (react-pdf engine, template 7) carries the demo wording; official does not", async () => {
  delete process.env.ISSUANCE_MODE;
  try {
    const demo = await renderCertificatePdfReact(residentInput, qr);
    assert.equal(demo.subarray(0, 5).toString(), "%PDF-");
    assertDemoText(await pdfText(demo), "react-pdf demo PDF");
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
  process.env.ISSUANCE_MODE = "official";
  try {
    const official = await renderCertificatePdfReact({ ...residentInput, number: "2026112512345678" }, qr);
    assertNoDemoText(await pdfText(official), "react-pdf official PDF");
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
});
