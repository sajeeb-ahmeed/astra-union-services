import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
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

// ISSUANCE_MODE gate (default "demo"): health reports OFFICIAL only when
// the variable is exactly "official". W-001 (Phase 4 Stage 1): demo
// certificates DO carry demo wording — a banner + "not an official
// certificate" line in Bengali and English, plus a DEMO watermark — while
// official certificates carry none of it. (The old assertion below that
// demo mode carries NO demo wording encoded the W-001 bug itself and was
// reversed with the fix; the 17 Nov 2026 owner purge it cited is superseded
// for demo mode. Official mode stays clean.) Env is restored after every test.
let server: ReturnType<typeof app.listen>;
let base: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
      resolve();
    });
  });
});
after(async () => {
  delete process.env.ISSUANCE_MODE;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const qr = "data:image/png;base64,iVBORw0KGgo=";
const residentInput: PdfInput = {
  number: "CERT-ISSUANCE-1",
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
};

test("issuance mode: health reports DEMO_ONLY by default and OFFICIAL when gated", async () => {
  delete process.env.ISSUANCE_MODE;
  const demo = await (await fetch(`${base}/api/v1/health`)).json();
  assert.equal(demo.mode, "DEMO_ONLY");
  process.env.ISSUANCE_MODE = "official";
  try {
    const official = await (await fetch(`${base}/api/v1/health`)).json();
    assert.equal(official.status, "ok");
    assert.equal(official.mode, "OFFICIAL");
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
  const again = await (await fetch(`${base}/api/v1/health`)).json();
  assert.equal(again.mode, "DEMO_ONLY");
});

test("issuance mode: template 6 demo certificate carries the demo banner, watermark and not-official lines (W-001)", () => {
  delete process.env.ISSUANCE_MODE;
  const html = renderCertificateHtml(residentInput, qr, 6);
  // W-001: the old assertion here (no demo wording in demo mode) encoded
  // the bug — a demo PDF with no unofficial marking could be mistaken for
  // an official certificate. Demo mode now marks the document in Bengali
  // AND English, banner + watermark + honesty line.
  assert.ok(html.includes('class="demo-banner"'), "demo banner box present");
  assert.ok(html.includes(DEMO_BANNER_BN), "Bengali demo banner");
  assert.ok(html.includes(DEMO_BANNER_EN), "English demo banner");
  assert.ok(html.includes(DEMO_NOTICE_BN), "Bengali not-official line");
  assert.ok(html.includes(DEMO_NOTICE_EN), "English not-official line");
  assert.ok(html.includes('<div class="watermark">DEMO</div>'), "DEMO watermark");
  assert.ok(html.includes("Approved details"));
  assert.ok(html.includes("Verify status"));
  assert.ok(html.includes("The details above come from the approved application."));
});

test("issuance mode: template 6 official certificate is equally free of DEMO branding and disclaimers", () => {
  process.env.ISSUANCE_MODE = "official";
  try {
    const html = renderCertificateHtml(residentInput, qr, 6);
    assert.ok(!/\bDEMO\b/.test(html), "no DEMO word anywhere in official mode");
    assert.ok(!html.includes("demo status"));
    assert.ok(!html.includes("demo details"));
    assert.ok(!html.includes("demonstration application"));
    assert.ok(!html.includes("NOT AN OFFICIAL GOVERNMENT DOCUMENT"));
    assert.ok(!html.includes(DEMO_BANNER_BN));
    assert.ok(!html.includes(DEMO_BANNER_EN));
    assert.ok(!html.includes(DEMO_NOTICE_BN));
    assert.ok(!html.includes(DEMO_NOTICE_EN));
    assert.ok(!html.includes('class="demo-banner"'));
    assert.ok(!html.includes('class="watermark"'));
    assert.ok(!html.includes("সরকারি সনদ নয়"));
    assert.ok(!html.includes("not proof of legal identity or official authorization"));
    assert.ok(!html.includes("No government seal, signature or identity number"));
    assert.ok(html.includes("Approved details"));
    assert.ok(html.includes("Verify status"));
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
});
