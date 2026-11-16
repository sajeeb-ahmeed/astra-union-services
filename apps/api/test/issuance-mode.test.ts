import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
import {
  renderCertificateHtml,
  type PdfInput,
} from "../src/certificate-template.js";

// ISSUANCE_MODE gate (default "demo"): health reports OFFICIAL and the
// certificate template drops its DEMO branding only when the variable is
// exactly "official". The factual honesty lines (not proof of legal
// identity, not a government-issued document, no government seal) must be
// present in BOTH modes. Env is restored after every test.
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

test("issuance mode: default certificate keeps the DEMO branding and honesty lines", () => {
  delete process.env.ISSUANCE_MODE;
  const html = renderCertificateHtml(residentInput, qr);
  assert.ok(html.includes('<div class="watermark">DEMO</div>'));
  assert.ok(html.includes("DEMO / NOT OFFICIAL"));
  assert.ok(html.includes("Approved demo details"));
  assert.ok(html.includes("Verify demo status"));
  assert.ok(html.includes("approved demonstration application"));
  assert.ok(html.includes("not proof of legal identity or official authorization"));
  assert.ok(html.includes("No government seal, signature or identity number"));
});

test("issuance mode: official certificate drops DEMO branding but keeps the honesty lines", () => {
  process.env.ISSUANCE_MODE = "official";
  try {
    const html = renderCertificateHtml(residentInput, qr);
    assert.ok(!/\bDEMO\b/.test(html), "no DEMO word anywhere in official mode");
    assert.ok(!html.includes("demo status"));
    assert.ok(!html.includes("demo details"));
    assert.ok(!html.includes("demonstration application"));
    assert.ok(html.includes("NOT AN OFFICIAL GOVERNMENT DOCUMENT"));
    assert.ok(html.includes("সরকারি সনদ নয়"));
    assert.ok(html.includes("Approved details"));
    assert.ok(html.includes("Verify status"));
    assert.ok(html.includes("not proof of legal identity or official authorization"));
    assert.ok(html.includes("No government seal, signature or identity number"));
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
});
