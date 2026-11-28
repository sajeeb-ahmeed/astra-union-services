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
  plainNumberHtml,
} from "../src/certificate-template-v7.js";
import { dhakaDateStamp, dhakaDayMonthStamp } from "../src/dhaka.js";
import { randomTenDigits } from "../src/references.js";
import {
  app,
  newCertificateNumber,
  retryOnCertificateNumberCollision,
} from "../src/app.js";
import { pool, transaction } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

/**
 * CERTNO-01 (owner-approved 18 Nov 2026), AS SUPERSEDED by Md's order of
 * 25 Nov 2026 ("sob gulo certificate e prottoyon er provide kora
 * certificate er design er moto format e hobe"): bilingual issuance, the
 * per-service layouts from the 47-format catalog (receipt 1, premises
 * licence 41, transport card 46, recommendation letter 27, combined
 * title 35). The digit strip and the government-emblem watermark are
 * GONE: the number prints plain and the centre watermark is the
 * office's UP seal from the deployment asset dir (or no watermark when
 * no seal asset resolves).
 *
 * CERTNO-DDMM (owner order, 25 Nov 2026 — "sonod number gulo only date
 * months + 10 digit random number (do not duplicated sonod number)"):
 * NEW certificate numbers are 14 digits — Asia/Dhaka DDMM + 10
 * cryptographically random digits — and are never duplicated
 * (certificates_number_key + bounded collision retry). Already-issued
 * 16-digit CERTNO-01 numbers keep verifying; nothing renumbers.
 * Application/citizen public references are unchanged (16-digit
 * YYYYMMDD + 8 random, references.ts).
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

test("certno: the DDMM stamp is the Asia/Dhaka day+month (CERTNO-DDMM prefix)", () => {
  // 25 Nov in Dhaka (10:00 UTC is 16:00 the same day in Dhaka).
  assert.equal(dhakaDayMonthStamp(new Date("2026-11-25T10:00:00.000Z")), "2511");
  // 19:30 UTC is 01:30 the NEXT day in Dhaka — 26 Nov.
  assert.equal(dhakaDayMonthStamp(new Date("2026-11-25T19:30:00.000Z")), "2611");
  // Single-digit day and month stay zero-padded (5 Jan → "0501").
  assert.equal(dhakaDayMonthStamp(new Date("2026-01-05T10:00:00.000Z")), "0501");
});

test("certno: new certificate numbers are DDMM + 10 random digits, never duplicated by construction (CERTNO-DDMM)", () => {
  for (let i = 0; i < 50; i++) assert.match(randomTenDigits(), /^\d{10}$/);
  const previous = process.env.ISSUANCE_MODE;
  try {
    process.env.ISSUANCE_MODE = "official";
    const official = newCertificateNumber();
    assert.match(official, /^\d{14}$/, "official number is 14 digits");
    assert.equal(official.slice(0, 4), dhakaDayMonthStamp(), "prefix is today's Dhaka DDMM");
    delete process.env.ISSUANCE_MODE;
    assert.match(newCertificateNumber(), /^DEMO-\d{14}$/, "test-mode number keeps the DEMO- marker over 14 digits");
  } finally {
    if (previous === undefined) delete process.env.ISSUANCE_MODE;
    else process.env.ISSUANCE_MODE = previous;
  }
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

/* ---------- unit: the plain number (CERTNO-01 strip superseded, Md's order 25 Nov 2026) ---------- */

test("certno: the number prints plain, Bengali on Bangla, Latin on English, no digit boxes", () => {
  // CERTNO-DDMM format: DDMM (2511) + 10 random digits.
  const bn = plainNumberHtml("25111234567890", true);
  assert.equal(bn, "২৫১১১২৩৪৫৬৭৮৯০");
  assert.ok(!bn.includes("numstrip"), "no digit-box strip markup");
  assert.ok(!bn.includes("<i>"), "no per-digit boxes");
  const en = plainNumberHtml("25111234567890", false);
  assert.equal(en, "25111234567890");
  const demo = plainNumberHtml("DEMO-25111234567890", true);
  assert.ok(demo.includes("DEMO-"), "the demo marker stays visible");
  assert.equal(demo, "DEMO-২৫১১১২৩৪৫৬৭৮৯০");
  // Already-issued 16-digit CERTNO-01 numbers still print plain, unchanged.
  assert.equal(plainNumberHtml("2026111812345678", true), "২০২৬১১১৮১২৩৪৫৬৭৮");
  const legacy = plainNumberHtml("2026-ABC123", true);
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
  // A persistent collision exhausts the bounded budget and fails with the
  // clear CERTNO-DDMM error (never a duplicated number).
  let always = 0;
  await assert.rejects(
    retryOnCertificateNumberCollision(async () => {
      always++;
      throw collision();
    }),
    /CERTIFICATE_NUMBER_GENERATION_FAILED/,
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
  assert.ok(withPhoto.includes("সনদ নং:- ২০২৬১১১৮১২৩৪৫৬৭৮"), "the plain number prints for a 16-digit number");
  assert.ok(!withPhoto.includes("numstrip"), "no digit-box strip anywhere");
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

test("certno: service 35 prints the Prottoyon reference title (supersedes owner decision D2 for BN, 25 Nov 2026)", () => {
  const bn = render({
    number: "2026111812345678",
    service: { service_no: 35, name_bn: "চারিত্রিক সনদ", name_en: "Character certificate" },
    payload: { delivery_language: "bn" },
    schema: getServiceSchema(35),
  });
  // Md's 25 Nov 2026 ruling (ALL certificates in Prottoyon format): the
  // reference prints exactly "চারিত্রিক সনদ" — the CERTNO-01 D2 combined
  // title "নাগরিকত্ব ও চারিত্রিক সনদপত্র" no longer prints in Bangla.
  assert.ok(bn.includes("চারিত্রিক সনদ"));
  assert.ok(!bn.includes("নাগরিকত্ব ও চারিত্রিক সনদপত্র"));
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

test("certno: service 27 renders the QAFIX-06 select purposes from the label map in both languages", () => {
  // The repaired form stores a select value; the letter must print
  // its mapped label, not the raw value.
  const bn = render({
    number: "2026111812345678",
    service: { service_no: 27, name_bn: "পাসপোর্ট সুপারিশ পত্র", name_en: "Passport recommendation letter" },
    payload: { delivery_language: "bn", passport_purpose: "hajj" },
    schema: getServiceSchema(27),
  });
  assert.ok(bn.includes("হজ্জ"), "BN letter prints the mapped Hajj label");
  assert.ok(!bn.includes("hajj"), "BN letter never prints the raw select value");
  const en = render({
    number: "2026111812345678",
    service: { service_no: 27, name_bn: "পাসপোর্ট সুপারিশ পত্র", name_en: "Passport recommendation letter" },
    payload: { delivery_language: "en", passport_purpose: "hajj" },
    schema: getServiceSchema(27),
  });
  assert.ok(en.includes("Hajj"), "EN letter prints the mapped Hajj label");
  // A legacy free-text purpose (pinned payload) still prints as stored.
  const legacy = render({
    number: "2026111812345678",
    service: { service_no: 27, name_bn: "পাসপোর্ট সুপারিশ পত্র", name_en: "Passport recommendation letter" },
    payload: { delivery_language: "bn", passport_purpose: "চিকিৎসা" },
    schema: getServiceSchema(27, 3),
  });
  assert.ok(legacy.includes("চিকিৎসা"), "legacy free text prints exactly as stored");
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
  assert.ok(html.includes("অর্থবছর"), "year-wise table header (CERT-REFINE-01 spec column)");
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
  assert.ok(html.includes("মেয়াদ"), "validity line prints");
  assert.ok(html.includes("৩০ জুন"), "validity ends 30 June (suffix-free, CERT-REFINE-01 A4)");
});

test("certno: service 46 is a standard A4 portrait page (CERT-REFINE-02 R2-05)", () => {
  // The landscape QR card is retired: service 46 uses the family shell.
  assert.deepEqual(certificatePageFormat(46), { size: "A4", orientation: "portrait" });
  const html = render({
    number: "2026111812345678",
    service: { service_no: 46, name_bn: "পরিবহন অনুমতিপত্র", name_en: "Transport permit" },
    payload: {
      delivery_language: "bn",
      transport_license_no: "T-9",
      transport_license_transport_name_bn: "মিশুক",
      transport_license_engine_no: "E123",
    },
    schema: getServiceSchema(46),
  });
  assert.ok(html.includes("@page{size:A4"));
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
  assert.ok(en.includes("The annual income of the guardian, Md Asaduzzaman, is BDT 1,20,000 (in words: One Lakh Twenty Thousand Taka only)."));
});

test("certno: service 23 income_earner select certifies the guardian's income with words (QAFIX-05)", () => {
  // From v5 the earner is chosen from the income_earner select; the
  // pinned other_person payload above keeps rendering through the
  // fallback, and this is the new path.
  const en = render({
    number: "2026111812345679",
    service: { service_no: 23, name_bn: "বাৎসরিক আয় সনদ", name_en: "Annual income certificate" },
    payload: {
      delivery_language: "en",
      income_info_amount: 120000,
      income_earner: "other_person",
      other_person_name: "Md Asaduzzaman",
    },
    schema: getServiceSchema(23),
  });
  assert.ok(en.includes("The annual income of the guardian, Md Asaduzzaman, is BDT 1,20,000 (in words: One Lakh Twenty Thousand Taka only)."));
  // And "self" still certifies the applicant's own income.
  const self = render({
    number: "2026111812345680",
    service: { service_no: 23, name_bn: "বাৎসরিক আয় সনদ", name_en: "Annual income certificate" },
    payload: {
      delivery_language: "en",
      income_info_amount: 120000,
      income_earner: "self",
    },
    schema: getServiceSchema(23),
  });
  assert.ok(self.includes("The applicant&#39;s own annual income is BDT 1,20,000 (in words: One Lakh Twenty Thousand Taka only)."));
});

test("certno: service 29 guardian variant certifies the guardian's monthly income (pinned path)", () => {
  const en = render({
    number: "2026111812345681",
    service: { service_no: 29, name_bn: "মাসিক আয় সনদ", name_en: "Monthly income certificate" },
    payload: {
      delivery_language: "en",
      income_info_amount: 30000,
      other_person: true,
      other_person_name: "Md Asaduzzaman",
    },
    schema: getServiceSchema(29, 4),
  });
  assert.ok(en.includes("The monthly income of the guardian, Md Asaduzzaman, is BDT 30,000"));
});

test("certno: service 29 income_earner select prints the other person's own amount (QAFIX-06)", () => {
  // From v5 the earner is chosen from the income_earner select and
  // the other person's own monthly amount is captured; the
  // certificate must print THAT amount against their name, not the
  // applicant's shared amount.
  const en = render({
    number: "2026111812345682",
    service: { service_no: 29, name_bn: "মাসিক আয় সনদ", name_en: "Monthly income certificate" },
    payload: {
      delivery_language: "en",
      income_info_amount: 30000,
      income_earner: "other_person",
      other_person_name: "Md Asaduzzaman",
      other_person_income_amount: 45000,
    },
    schema: getServiceSchema(29),
  });
  assert.ok(en.includes("The monthly income of the guardian, Md Asaduzzaman, is BDT 45,000"), en.slice(0, 400));
  assert.ok(!en.includes("BDT 30,000"), "the applicant's amount must not print against the guardian");
  const bn = render({
    number: "2026111812345683",
    service: { service_no: 29, name_bn: "মাসিক আয় সনদ", name_en: "Monthly income certificate" },
    payload: {
      delivery_language: "bn",
      income_info_amount: 30000,
      income_earner: "other_person",
      other_person_name_bn: "মোঃ আসাদুজ্জামান",
      other_person_income_amount: 45000,
    },
    schema: getServiceSchema(29),
  });
  assert.ok(bn.includes("৪৫,০০০"), "BN certificate prints the other person's amount in Bangla digits");
  assert.ok(!bn.includes("৩০,০০০"), "BN certificate must not print the applicant's amount");
  // And "self" still certifies the applicant's own monthly income.
  const self = render({
    number: "2026111812345684",
    service: { service_no: 29, name_bn: "মাসিক আয় সনদ", name_en: "Monthly income certificate" },
    payload: {
      delivery_language: "en",
      income_info_amount: 30000,
      income_earner: "self",
    },
    schema: getServiceSchema(29),
  });
  assert.ok(self.includes("The applicant&#39;s own monthly income is BDT 30,000"));
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

test("certno: one issuance stores both languages under one 14-digit number; legacy rows answer LANGUAGE_VERSION_UNAVAILABLE", async () => {
  const citizenId = (await req("GET", "/citizens", undefined, "staff")).body.items[0].id;
  const created = await req(
    "POST",
    "/applications",
    { citizenId, serviceNo: 45, payload: demoPayloads[45] },
    "staff",
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  // Application references are unchanged by CERTNO-DDMM (still 16 digits).
  assert.match(created.body.reference, /^\d{16}$/, "the application reference is 16 digits");
  const id = created.body.id as string;
  await req("POST", `/applications/${id}/transition`, { action: "submit" }, "staff");
  const approved = await req("POST", `/applications/${id}/transition`, { action: "approve" }, "approver");
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const certificate = approved.body.certificate;
  assert.match(certificate.number, /^DEMO-\d{14}$/, "test-mode number keeps the DEMO- marker over 14 digits (CERTNO-DDMM)");
  const digits = certificate.number.replace(/\D/g, "");
  assert.equal(digits.length, 14);
  assert.equal(digits.slice(0, 4), dhakaDayMonthStamp(), "the number starts with today's Dhaka DDMM");
  assert.ok(certificate.pdfUrlEn, "the English download is offered");

  const bnPdf = await reqBytes(`/certificates/${certificate.id}/pdf`, "staff");
  assert.equal(bnPdf.status, 200);
  assert.equal(bnPdf.bytes.subarray(0, 5).toString(), "%PDF-");
  const enPdf = await reqBytes(`/certificates/${certificate.id}/pdf?lang=en`, "staff");
  assert.equal(enPdf.status, 200);
  assert.equal(enPdf.bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(!bnPdf.bytes.equals(enPdf.bytes), "the two language renders differ");
  assert.ok((await pdfDigits(bnPdf.bytes)).includes(digits), "Bangla PDF carries the 14-digit number");
  assert.ok((await pdfDigits(enPdf.bytes)).includes(digits), "English PDF carries the same number");

  // Grouped verification input resolves the same certificate.
  const grouped = digits.replace(/(\d{4})(\d{4})(\d{4})(\d{2})/, "$1-$2-$3-$4");
  const byGrouped = await req("GET", `/verify/by-number/${encodeURIComponent(`DEMO-${grouped}`)}`);
  assert.equal(byGrouped.status, 200, JSON.stringify(byGrouped.body));

  // A pre-bilingual row (pdf_en NULL) answers honestly for ?lang=en.
  const tenantId = sessions["staff"]!.user.tenantId as string;
  await transaction(tenantId, async (db) => {
    await db.query("UPDATE certificates SET pdf_en=NULL, languages=NULL WHERE id=$1", [certificate.id]);
  });
  const legacyEn = await fetch(`${base}/api/v1/certificates/${certificate.id}/pdf?lang=en`, {
    headers: { Cookie: sessions["staff"]!.cookie },
  });
  assert.equal(legacyEn.status, 404);
  assert.equal((await legacyEn.json()).error?.code, "LANGUAGE_VERSION_UNAVAILABLE");
  const legacyBn = await reqBytes(`/certificates/${certificate.id}/pdf`, "staff");
  assert.equal(legacyBn.status, 200, "the Bangla document still downloads");
});

test("certno: an already-issued 16-digit CERTNO-01 number still verifies after CERTNO-DDMM (nothing renumbers)", async () => {
  const citizenId = (await req("GET", "/citizens", undefined, "staff")).body.items[0].id;
  const created = await req(
    "POST",
    "/applications",
    { citizenId, serviceNo: 45, payload: demoPayloads[45] },
    "staff",
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id as string;
  await req("POST", `/applications/${id}/transition`, { action: "submit" }, "staff");
  const approved = await req("POST", `/applications/${id}/transition`, { action: "approve" }, "approver");
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const certificate = approved.body.certificate;
  assert.match(certificate.number, /^DEMO-\d{14}$/, "new issuance mints the 14-digit CERTNO-DDMM format");
  // Simulate a pre-CERTNO-DDMM issued row: rewrite the stored number to a
  // 16-digit CERTNO-01 value (fixture date, never minted) and prove the
  // by-number lookup still resolves it — plain and grouped.
  const legacyNumber = "1999010199999999";
  const tenantId = sessions["staff"]!.user.tenantId as string;
  await transaction(tenantId, async (db) => {
    await db.query("UPDATE certificates SET number=$1 WHERE id=$2", [legacyNumber, certificate.id]);
  });
  const byPlain = await req("GET", `/verify/by-number/${legacyNumber}`);
  assert.equal(byPlain.status, 200, JSON.stringify(byPlain.body));
  assert.equal(byPlain.body.status, "ISSUED");
  const byGrouped = await req(
    "GET",
    `/verify/by-number/${encodeURIComponent("1999-0101-9999-9999")}`,
  );
  assert.equal(byGrouped.status, 200, JSON.stringify(byGrouped.body));
  assert.equal(byGrouped.body.status, "ISSUED");
});

test("certno: the react-pdf engine prints the plain number digits (line-height regression guard)", async () => {
  const { renderCertificatePdfReact } = await import("../src/pdf-react.js");
  const input = {
    number: "25116114609912",
    verificationUrl: "http://127.0.0.1:5173/verify?searchText=25116114609912",
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
  // number can satisfy the digit-stream check.
  const stream = stdout
    .replace(/searchText=\S+/g, "")
    .replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)))
    .replace(/\D/g, "");
  assert.ok(
    stream.includes("25116114609912"),
    "the 14 plain-number digits must be present as printed text in the react-pdf render",
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
