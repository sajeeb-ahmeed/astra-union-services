import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PNG } from "pngjs";
import { demoPayloads, getServiceSchema } from "@astra/shared-schemas";
import {
  renderCertificateHtml,
  type PdfInput,
} from "../src/certificate-template.js";
import {
  amountInWordsBn,
  amountInWordsEn,
  certificatePageFormat,
  numberStripHtml,
} from "../src/certificate-template-v7.js";
import { dhakaDateStamp } from "../src/dhaka.js";
import { app, retryOnCertificateNumberCollision } from "../src/app.js";
import { pool, transaction } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

/**
 * CERTNO-01 (owner-approved 18 Nov 2026): 16-digit certificate numbers and
 * references, bilingual issuance, the government-emblem watermark, the
 * dynamic citizen photo, the digit strip, and the per-service layouts from
 * the 47-format catalog (receipt 1, premises licence 41, transport card 46,
 * recommendation letter 27, combined title 35).
 */

const qr = "data:image/png;base64,AAAA";
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
const render = (over: Partial<PdfInput>) =>
  renderCertificateHtml({ ...belabo, ...over } as PdfInput, qr);
const PHOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/* ---------- unit: Dhaka pinning ---------- */

test("certno: the date stamp is the Asia/Dhaka calendar date regardless of host TZ", () => {
  // 19:30 UTC is 01:30 the NEXT day in Dhaka (UTC+6).
  assert.equal(dhakaDateStamp(new Date("2026-11-18T19:30:00.000Z")), "20261119");
  // 10:00 UTC is 16:00 the same day in Dhaka.
  assert.equal(dhakaDateStamp(new Date("2026-11-18T10:00:00.000Z")), "20261118");
  // 18:00 UTC is exactly midnight Dhaka — the new day.
  assert.equal(dhakaDateStamp(new Date("2026-11-18T18:00:00.000Z")), "20261119");
});

/* ---------- unit: amount in words ---------- */

test("certno: amount-in-words uses South-Asian grouping in both languages", () => {
  assert.equal(amountInWordsEn(0), "Zero");
  assert.equal(amountInWordsEn(5), "Five");
  assert.equal(amountInWordsEn(21), "Twenty One");
  assert.equal(amountInWordsEn(100), "One Hundred");
  assert.equal(amountInWordsEn(115), "One Hundred Fifteen");
  assert.equal(amountInWordsEn(1000), "One Thousand");
  assert.equal(amountInWordsEn(240000), "Two Lakh Forty Thousand");
  assert.equal(amountInWordsEn(10000000), "One Crore");
  assert.equal(amountInWordsEn(12345678), "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight");
  assert.equal(amountInWordsBn(0), "শূন্য");
  assert.equal(amountInWordsBn(240000), "দুই লক্ষ চল্লিশ হাজার");
  assert.equal(amountInWordsBn(10000000), "এক কোটি");
  assert.equal(amountInWordsBn(530), "পাঁচ শত ত্রিশ");
});

/* ---------- unit: the digit strip ---------- */

test("certno: the number strip boxes 16 digits, Bengali on Bangla, plain text otherwise", () => {
  const bn = numberStripHtml("2026111812345678", true);
  assert.ok(bn.includes('class="numstrip"'));
  assert.equal((bn.match(/<i>/g) ?? []).length, 16);
  assert.ok(bn.includes("<i>২</i>"), "Bengali digits in the boxes");
  const en = numberStripHtml("2026111812345678", false);
  assert.ok(en.includes("<i>2</i>"), "Latin digits in the boxes");
  const demo = numberStripHtml("DEMO-2026111812345678", true);
  assert.ok(demo.includes("DEMO-"), "the demo marker stays visible");
  assert.equal((demo.match(/<i>/g) ?? []).length, 16);
  const legacy = numberStripHtml("2026-ABC123", true);
  assert.ok(!legacy.includes("numstrip"), "legacy numbers print as plain text");
  assert.equal(legacy, "২০২৬-ABC১২৩");
});

/* ---------- unit: collision retry ---------- */

test("certno: the issuance retry regenerates only on a certificates_number_key collision", async () => {
  const collision = () =>
    Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "certificates_number_key",
    });
  let attempts = 0;
  const ok = await retryOnCertificateNumberCollision(async () => {
    attempts++;
    if (attempts < 3) throw collision();
    return "issued";
  });
  assert.equal(ok, "issued");
  assert.equal(attempts, 3, "two collisions were retried past");
  // A different unique violation is NOT retried.
  let other = 0;
  await assert.rejects(
    retryOnCertificateNumberCollision(async () => {
      other++;
      throw Object.assign(new Error("app dup"), {
        code: "23505",
        constraint: "certificates_application_id_key",
      });
    }),
  );
  assert.equal(other, 1);
  // A persistent collision exhausts the bounded budget and propagates.
  let always = 0;
  await assert.rejects(
    retryOnCertificateNumberCollision(async () => {
      always++;
      throw collision();
    }),
  );
  assert.equal(always, 5);
});

/* ---------- template level: photo, titles, special layouts ---------- */

test("certno: the citizen photo prints only when present, in both languages", () => {
  const withPhoto = render({
    number: "2026111812345678",
    service: { service_no: 12, name_bn: "নাগরিকত্ব সনদ", name_en: "Citizenship certificate" },
    payload: { delivery_language: "bn" },
    citizenPhoto: PHOTO,
    schema: getServiceSchema(12),
  });
  assert.ok(withPhoto.includes('<img class="citizen-photo"'), "photo prints on the Bangla render");
  assert.ok(withPhoto.includes('class="numstrip"'), "the strip prints for a 16-digit number");
  const withPhotoEn = render({
    number: "2026111812345678",
    service: { service_no: 12, name_bn: "নাগরিকত্ব সনদ", name_en: "Citizenship certificate" },
    payload: { delivery_language: "en" },
    citizenPhoto: PHOTO,
    schema: getServiceSchema(12),
  });
  assert.ok(withPhotoEn.includes('<img class="citizen-photo"'), "photo prints on the English render");
  const without = render({
    number: "2026111812345678",
    service: { service_no: 12, name_bn: "নাগরিকত্ব সনদ", name_en: "Citizenship certificate" },
    payload: { delivery_language: "bn" },
    schema: getServiceSchema(12),
  });
  assert.ok(!without.includes('<img class="citizen-photo"'), "no photo element at all when absent");
});

test("certno: service 35 prints the combined title (owner decision D2)", () => {
  const bn = render({
    number: "2026111812345678",
    service: { service_no: 35, name_bn: "চারিত্রিক সনদ", name_en: "Character certificate" },
    payload: { delivery_language: "bn" },
    schema: getServiceSchema(35),
  });
  assert.ok(bn.includes("নাগরিকত্ব ও চারিত্রিক সনদপত্র"));
  const en = render({
    number: "2026111812345678",
    service: { service_no: 35, name_bn: "চারিত্রিক সনদ", name_en: "Character certificate" },
    payload: { delivery_language: "en" },
    schema: getServiceSchema(35),
  });
  assert.ok(en.includes("Citizenship and Character Certificate"));
});

test("certno: service 27 renders as a recommendation letter (owner decision D5)", () => {
  const bn = render({
    number: "2026111812345678",
    service: { service_no: 27, name_bn: "পাসপোর্ট সুপারিশ পত্র", name_en: "Passport recommendation letter" },
    payload: { delivery_language: "bn", passport_purpose: "চিকিৎসা" },
    schema: getServiceSchema(27),
  });
  assert.ok(bn.includes("বরাবর,"));
  assert.ok(bn.includes("বিষয়ঃ পাসপোর্ট প্রদানের সুপারিশ।"));
  assert.ok(bn.includes("পাসপোর্ট প্রদানে এই কার্যালয়ের কোনো আপত্তি নাই"));
  const en = render({
    number: "2026111812345678",
    service: { service_no: 27, name_bn: "পাসপোর্ট সুপারিশ পত্র", name_en: "Passport recommendation letter" },
    payload: { delivery_language: "en" },
    schema: getServiceSchema(27),
  });
  assert.ok(en.includes("Subject: Recommendation for passport issuance."));
  assert.ok(en.includes("Regional Passport Office"));
});

test("certno: service 1 renders the tax receipt with the year table and amount in words", () => {
  const html = render({
    number: "2026111812345678",
    service: { service_no: 1, name_bn: "হোল্ডিং ট্যাক্স রশিদ", name_en: "Holding tax receipt" },
    payload: {
      delivery_language: "bn",
      holding_reference: "H-102",
      tax_year: "2025-2026",
      property_description: "দোকান ঘর",
    },
    order: { totalMinor: 53000 },
    schema: getServiceSchema(1),
  });
  assert.ok(html.includes("হোল্ডিং নম্বর"));
  assert.ok(html.includes("করের বছর"), "year-wise table header");
  assert.ok(html.includes("কথায়ঃ পাঁচ শত ত্রিশ টাকা মাত্র।"), "amount in words on the receipt");
});

test("certno: service 41 renders on the licence layout with the fiscal validity line (owner decision D4)", () => {
  const html = render({
    number: "2026111812345678",
    service: { service_no: 41, name_bn: "প্রাঙ্গণ লাইসেন্স", name_en: "Premises licence" },
    payload: {
      delivery_language: "bn",
      primises_license_proprietor_bn: "আফসানা আক্তার মীম",
      primises_license_org_name_bn: "মীম স্টোর",
      primises_license_org_ward_no: 3,
    },
    schema: getServiceSchema(41),
  });
  assert.ok(html.includes("লাইসেন্সধারী"));
  assert.ok(html.includes("মেয়াদঃ"), "validity line prints");
  assert.ok(html.includes("৩০শে জুন"), "validity ends 30 June");
});

test("certno: service 46 is a small QR card page", () => {
  assert.deepEqual(certificatePageFormat(46), { size: "86mm 54mm", orientation: "landscape" });
  const html = render({
    number: "2026111812345678",
    service: { service_no: 46, name_bn: "পরিবহন অনুমতিপত্র", name_en: "Transport permit" },
    payload: {
      delivery_language: "bn",
      transport_license_no: "T-9",
      transport_license_transport_name_bn: "মিশুক",
      engine_no: "E123",
    },
    schema: getServiceSchema(46),
  });
  assert.ok(html.includes("@page{size:86mm 54mm"));
  assert.ok(html.includes('class="tcard"'));
  assert.ok(html.includes("ইঞ্জিন নং"));
});

test("certno: service 23 guardian variant certifies the guardian's income with words", () => {
  const en = render({
    number: "2026111812345678",
    service: { service_no: 23, name_bn: "বাৎসরিক আয় সনদ", name_en: "Annual income certificate" },
    payload: {
      delivery_language: "en",
      income_info_amount: 120000,
      other_person: true,
      other_person_name: "Md Asaduzzaman",
    },
    schema: getServiceSchema(23),
  });
  assert.ok(en.includes("The annual income of the guardian, Md Asaduzzaman, is BDT 1,20,000 (in words: One Lakh Twenty Thousand)."));
});

/* ---------- API level: photo endpoints + bilingual issuance ---------- */

let server: ReturnType<typeof app.listen>, base: string;
const sessions: Record<string, { cookie: string; csrf: string; user: any }> = {};
async function req(method: string, p: string, data?: unknown, who?: string) {
  const s = who ? sessions[who] : undefined;
  const response = await fetch(`${base}/api/v1${p}`, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(s ? { Cookie: s.cookie, "X-CSRF-Token": s.csrf } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
async function reqBytes(p: string, who: string) {
  const s = sessions[who]!;
  const response = await fetch(`${base}/api/v1${p}`, { headers: { Cookie: s.cookie } });
  return {
    status: response.status,
    type: response.headers.get("content-type") ?? "",
    bytes: Buffer.from(await response.arrayBuffer()),
  };
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
    cookie: r.headers.get("set-cookie")!.split(";")[0]!,
    csrf: json.csrfToken,
    user: json.user,
  };
}
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const name of ["staff", "approver"]) await login(name);
});
after(async () => {
  await closePdfBrowser().catch(() => {});
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

function tinyPng(): Buffer {
  const png = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 30;
    png.data[i + 1] = 120;
    png.data[i + 2] = 90;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

test("certno: citizen photo upload, read-back, validation and removal", async () => {
  const created = await req(
    "POST",
    "/citizens",
    {
      nameBn: "ছবি টেস্ট নাগরিক",
      nameEn: "Photo Test Citizen",
      dateOfBirth: "1992-04-10",
      addressBn: "ঠিকানা",
      addressEn: "Address",
    },
    "staff",
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const citizenId = created.body.id as string;
  assert.equal(created.body.hasPhoto, false);
  assert.equal((await reqBytes(`/citizens/${citizenId}/photo/image`, "staff")).status, 404);

  const png = tinyPng();
  const uploaded = await req(
    "PUT",
    `/citizens/${citizenId}/photo`,
    { mimeType: "image/png", base64: png.toString("base64") },
    "staff",
  );
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.hasPhoto, true);
  const image = await reqBytes(`/citizens/${citizenId}/photo/image`, "staff");
  assert.equal(image.status, 200);
  assert.ok(image.type.includes("image/png"));
  assert.ok(image.bytes.equals(png), "the stored bytes round-trip exactly");

  // Validation: a PDF is not a photo; garbage bytes fail the magic-byte check.
  const pdfMime = await req(
    "PUT",
    `/citizens/${citizenId}/photo`,
    { mimeType: "application/pdf", base64: png.toString("base64") },
    "staff",
  );
  assert.notEqual(pdfMime.status, 200);
  const garbage = await req(
    "PUT",
    `/citizens/${citizenId}/photo`,
    { mimeType: "image/png", base64: Buffer.from("not a png at all, just text").toString("base64") },
    "staff",
  );
  assert.equal(garbage.status, 422, JSON.stringify(garbage.body));

  const removed = await req("DELETE", `/citizens/${citizenId}/photo`, undefined, "staff");
  assert.equal(removed.status, 200);
  assert.equal(removed.body.hasPhoto, false);
  assert.equal((await reqBytes(`/citizens/${citizenId}/photo/image`, "staff")).status, 404);
});

const execFileAsync = promisify(execFile);
async function pdfDigits(bytes: Buffer): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "certno-"));
  const file = path.join(dir, "certificate.pdf");
  fs.writeFileSync(file, bytes);
  const { stdout } = await execFileAsync("pdftotext", [file, "-"]);
  return stdout
    .replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)))
    .replace(/\D/g, "");
}

test("certno: one issuance stores both languages under one 16-digit number; legacy rows answer LANGUAGE_VERSION_UNAVAILABLE", async () => {
  const citizenId = (await req("GET", "/citizens", undefined, "staff")).body.items[0].id;
  const created = await req(
    "POST",
    "/applications",
    { citizenId, serviceNo: 45, payload: demoPayloads[45] },
    "staff",
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.match(created.body.reference, /^\d{16}$/, "the application reference is 16 digits");
  const id = created.body.id as string;
  await req("POST", `/applications/${id}/transition`, { action: "submit" }, "staff");
  const approved = await req("POST", `/applications/${id}/transition`, { action: "approve" }, "approver");
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const certificate = approved.body.certificate;
  assert.match(certificate.number, /^DEMO-\d{16}$/, "test-mode number keeps the DEMO- marker over 16 digits");
  const digits = certificate.number.replace(/\D/g, "");
  assert.equal(digits.length, 16);
  assert.ok(certificate.pdfUrlEn, "the English download is offered");

  const bnPdf = await reqBytes(`/certificates/${certificate.id}/pdf`, "staff");
  assert.equal(bnPdf.status, 200);
  assert.equal(bnPdf.bytes.subarray(0, 5).toString(), "%PDF-");
  const enPdf = await reqBytes(`/certificates/${certificate.id}/pdf?lang=en`, "staff");
  assert.equal(enPdf.status, 200);
  assert.equal(enPdf.bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(!bnPdf.bytes.equals(enPdf.bytes), "the two language renders differ");
  assert.ok((await pdfDigits(bnPdf.bytes)).includes(digits), "Bangla PDF carries the 16-digit number");
  assert.ok((await pdfDigits(enPdf.bytes)).includes(digits), "English PDF carries the same number");

  // Grouped verification input resolves the same certificate.
  const grouped = digits.replace(/(\d{4})(\d{4})(\d{4})(\d{4})/, "$1-$2-$3-$4");
  const byGrouped = await req("GET", `/verify/by-number/${encodeURIComponent(`DEMO-${grouped}`)}`);
  assert.equal(byGrouped.status, 200, JSON.stringify(byGrouped.body));

  // A pre-bilingual row (pdf_en NULL) answers honestly for ?lang=en.
  const tenantId = sessions["staff"]!.user.tenantId as string;
  await transaction(tenantId, async (db) => {
    await db.query("UPDATE certificates SET pdf_en=NULL WHERE id=$1", [certificate.id]);
  });
  const legacyEn = await fetch(`${base}/api/v1/certificates/${certificate.id}/pdf?lang=en`, {
    headers: { Cookie: sessions["staff"]!.cookie },
  });
  assert.equal(legacyEn.status, 404);
  assert.equal((await legacyEn.json()).error?.code, "LANGUAGE_VERSION_UNAVAILABLE");
  const legacyBn = await reqBytes(`/certificates/${certificate.id}/pdf`, "staff");
  assert.equal(legacyBn.status, 200, "the Bangla document still downloads");
});

test("certno: the react-pdf engine prints the boxed digits (line-height regression guard)", async () => {
  const { renderCertificatePdfReact } = await import("../src/pdf-react.js");
  const input = {
    number: "2026111861146099",
    verificationUrl: "http://127.0.0.1:5173/verify?searchText=2026111861146099",
    tenant: { name_bn: "বেলাবো ইউনিয়ন পরিষদ", name_en: "Belabo Union Parishad" },
    service: { service_no: 12, name_bn: "নাগরিকত্ব সনদ", name_en: "Citizenship certificate" },
    citizen: {
      full_name_bn: "আফসানা আক্তার মীম",
      full_name_en: "Afsana Akter Mim",
      address_bn: "বেলাব গাংকুল পাড়া",
      address_en: "Belab Gangkul Para",
    },
    payload: { delivery_language: "en" },
    issuedAt: "2026-11-18T04:00:00.000Z",
    issuer: {
      name_bn: "মোঃ হাবিবুর রহমান",
      name_en: "Md Habibur Rahman",
      designation_bn: "চেয়ারম্যান",
      designation_en: "Chairman",
    },
  } as any;
  const qr =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const pdf = await renderCertificatePdfReact(input, qr);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "certno-react-"));
  const file = path.join(dir, "certificate.pdf");
  fs.writeFileSync(file, pdf);
  const { stdout } = await execFileAsync("pdftotext", [file, "-"]);
  // The verify URL also carries the number; remove it so only the printed
  // strip can satisfy the digit-stream check.
  const stream = stdout
    .replace(/searchText=\S+/g, "")
    .replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)))
    .replace(/\D/g, "");
  assert.ok(
    stream.includes("2026111861146099"),
    "the 16 strip digits must be present as printed text in the react-pdf render",
  );
});

test("certno: the certificates_number_key constraint is the collision backstop the retry keys on", async () => {
  const tenantId = sessions["staff"]!.user.tenantId as string;
  const constraint = await transaction(tenantId, async (db) => {
    const rows = (
      await db.query(
        "SELECT conname FROM pg_constraint WHERE conname='certificates_number_key'",
      )
    ).rows;
    return rows[0]?.conname as string | undefined;
  });
  assert.equal(constraint, "certificates_number_key");
});
