import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { demoPayloads, getServiceSchema } from "@astra/shared-schemas";
import {
  renderCertificateHtml,
  DEMO_TEMPLATE_VERSION,
  type PdfInput,
} from "../src/certificate-template.js";
import {
  certificatePageFormat,
  AUTHORED_ATTESTATION_SERVICES,
} from "../src/certificate-template-v7.js";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import { closePdfBrowser } from "../src/pdf.js";

// The Belabo office's configured seal assets ship in the repo; point the
// per-office asset resolver at them for the official-mode assertions.
process.env.CERTIFICATE_OFFICE_ASSETS_DIR = fileURLToPath(
  new URL("../assets/offices/belabo-up/", import.meta.url),
);

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

test("template 7 is the current version; page formats are per-service data", () => {
  assert.equal(DEMO_TEMPLATE_VERSION, 7);
  // CERT-REFINE-01 (A5): svc12/svc37 join the single A4-portrait shell.
  assert.deepEqual(certificatePageFormat(12), { size: "A4", orientation: "portrait" });
  assert.deepEqual(certificatePageFormat(37), { size: "A4", orientation: "portrait" });
  assert.deepEqual(certificatePageFormat(45), { size: "A4", orientation: "portrait" });
});

test("v7 citizenship: sampled paragraph pattern, Bangla digits and date, A4 portrait (CERT-REFINE-01)", () => {
  const html = render({
    number: "DEMO-2026-ABC123",
    service: { service_no: 12, name_bn: "নাগরিকত্ব সনদ", name_en: "Citizenship certificate" },
    payload: { delivery_language: "bn", citizenship_basis: "জন্মসূত্রে" },
    schema: getServiceSchema(12),
  });
  assert.ok(html.includes("@page{size:A4;"));
  // CERT-REFINE-02 (R2-08/R2-16): the hyphen in "নং:-" is deleted.
  assert.ok(html.includes("সনদ নং: DEMO-২০২৬-ABC১২৩"));
  // CERT-REFINE-01 (A4): suffix-free cholito date.
  assert.ok(html.includes("ইস্যুর তারিখ: ১২ অক্টোবর ২০২৬"));
  assert.ok(html.includes("এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, <strong>আফসানা আক্তার মীম</strong>"));
  assert.ok(html.includes("জাতীয় পরিচয়পত্র নম্বরঃ <strong>২৪০৫১৩৪০৩৮</strong>"));
  assert.ok(html.includes("পিতাঃ <strong>মোঃ আসাদুজ্জামান</strong>"));
  assert.ok(html.includes("মাতাঃ <strong>মুক্তি বেগম</strong>"));
  // CERT-REFINE-01 (A2): no থানাঃ segment in the standard address block.
  assert.ok(html.includes("গ্রাম/বাড়ীঃ বেলাব গাংকুল পাড়া, ওয়ার্ড নম্বরঃ ৩, বেলাবো ইউনিয়ন, উপজেলাঃ বেলাবো, জেলাঃ নরসিংদী"));
  assert.ok(!html.includes("ডাকঘর"), "post office segment omitted — no dataset (steer 7)");
  assert.ok(html.includes("তিনি অত্র এলাকার একজন স্থায়ী বাসিন্দা এবং জন্মসূত্রে বাংলাদেশী নাগরিক।"));
  assert.ok(html.includes("আমি তাঁহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।"));
  assert.ok(html.includes("গণপ্রজাতন্ত্রী বাংলাদেশ সরকার"), "A1 government header line");
  assert.ok(html.includes("মোঃ হাবিবুর রহমান"));
  assert.ok(html.includes("প্যানেল চেয়ারম্যান"));
  // CERT-REFINE-01 (A6): the printed URL carries Latin digits.
  assert.ok(html.includes("যাচাইকরণ: https://belabo.astra.test/verify?searchText=DEMO-2026-ABC123"));
  assert.ok(!/prottoyon/i.test(html), "no Prottoyon branding anywhere");
});

test("v7 nationality: QAFIX-03 select codes print their labels; pinned free text prints verbatim", () => {
  const service = { service_no: 11, name_bn: "জাতীয়তা সনদ", name_en: "Nationality certificate" };
  const bn = render({
    number: "DEMO-2026-NAT11",
    service,
    payload: { delivery_language: "bn", claimed_nationality: "indian" },
    schema: getServiceSchema(11),
  });
  assert.ok(bn.includes("তিনি জাতীয়তায় ভারতীয়।"), "Bangla document prints the Bangla label");
  const en = render({
    number: "DEMO-2026-NAT11",
    service,
    payload: { delivery_language: "en", claimed_nationality: "indian" },
    schema: getServiceSchema(11),
  });
  // (The paragraph is HTML-escaped, so the apostrophe in "person's"
  // renders as &#39; — assert on the sentence body.)
  assert.ok(en.includes("nationality is Indian."), "English document prints the English label");
  assert.ok(!en.includes("nationality is indian"), "the raw select code never prints");
  // Applications pinned to the pre-QAFIX-03 versions carry free text; it
  // still renders verbatim in both languages.
  const legacyBn = render({
    number: "DEMO-2026-NAT11",
    service,
    payload: { delivery_language: "bn", claimed_nationality: "কানাডীয়" },
    schema: getServiceSchema(11),
  });
  assert.ok(legacyBn.includes("তিনি জাতীয়তায় কানাডীয়।"));
  const legacyEn = render({
    number: "DEMO-2026-NAT11",
    service,
    payload: { delivery_language: "en", claimed_nationality_en: "Canadian" },
    schema: getServiceSchema(11),
  });
  assert.ok(legacyEn.includes("nationality is Canadian."));
});

test("v7 profession: QAFIX-04 select codes print their labels; pinned free text prints verbatim", () => {
  const service = { service_no: 17, name_bn: "পেশাগত সনদ", name_en: "Occupation certificate" };
  const bn = render({
    number: "DEMO-2026-PROF17",
    service,
    payload: { delivery_language: "bn", profession: "teacher" },
    schema: getServiceSchema(17),
  });
  assert.ok(bn.includes("তিনি পেশায় একজন শিক্ষক।"), "Bangla document prints the Bangla label");
  const en = render({
    number: "DEMO-2026-PROF17",
    service,
    payload: { delivery_language: "en", profession: "teacher" },
    schema: getServiceSchema(17),
  });
  // (The paragraph is HTML-escaped, so the apostrophe in "person's"
  // renders as &#39; — assert on the sentence body.)
  assert.ok(en.includes("is a Teacher by profession."), "English document prints the English label");
  assert.ok(!en.includes("is a teacher by profession."), "the raw select code never prints");
  // Applications pinned to the pre-QAFIX-04 versions carry free text; it
  // still renders verbatim in both languages.
  const legacyBn = render({
    number: "DEMO-2026-PROF17",
    service,
    payload: { delivery_language: "bn", profession_bn: "দর্জি" },
    schema: getServiceSchema(17),
  });
  assert.ok(legacyBn.includes("তিনি পেশায় একজন দর্জি।"));
  const legacyEn = render({
    number: "DEMO-2026-PROF17",
    service,
    payload: { delivery_language: "en", profession_en: "Tailor" },
    schema: getServiceSchema(17),
  });
  assert.ok(legacyEn.includes("is a Tailor by profession."));
});

test("v7 community: QAFIX-04 select codes print their labels; pinned free text prints verbatim", () => {
  const service = { service_no: 18, name_bn: "সম্প্রদায় সনদ", name_en: "Community certificate" };
  const bn = render({
    number: "DEMO-2026-COMM18",
    service,
    payload: { delivery_language: "bn", community_name: "chakma" },
    schema: getServiceSchema(18),
  });
  assert.ok(bn.includes("তিনি চাকমা সম্প্রদায়ের সদস্য।"), "Bangla document prints the Bangla label");
  const en = render({
    number: "DEMO-2026-COMM18",
    service,
    payload: { delivery_language: "en", community_name: "chakma" },
    schema: getServiceSchema(18),
  });
  assert.ok(en.includes("member of the Chakma community."), "English document prints the English label");
  assert.ok(!en.includes("member of the chakma community."), "the raw select code never prints");
  // Applications pinned to the pre-QAFIX-04 versions carry free text; it
  // still renders verbatim in both languages (the trailing
  // "সম্প্রদায়" / " community" stripped as before).
  const legacyBn = render({
    number: "DEMO-2026-COMM18",
    service,
    payload: { delivery_language: "bn", community_name: "মুসলিম সম্প্রদায়" },
    schema: getServiceSchema(18),
  });
  assert.ok(legacyBn.includes("তিনি মুসলিম সম্প্রদায়ের সদস্য।"));
  const legacyEn = render({
    number: "DEMO-2026-COMM18",
    service,
    payload: { delivery_language: "en", community_name_en: "Muslim community" },
    schema: getServiceSchema(18),
  });
  assert.ok(legacyEn.includes("member of the Muslim community."));
});

test("v7 tribal: QAFIX-08 select codes print their labels; pinned free text prints verbatim", () => {
  const service = { service_no: 40, name_bn: "উপজাতি সনদ", name_en: "Tribal certificate" };
  const bn = render({
    number: "DEMO-2026-TRIB40",
    service,
    payload: { delivery_language: "bn", community_name: "chakma" },
    schema: getServiceSchema(40),
  });
  assert.ok(bn.includes("তিনি চাকমা ক্ষুদ্র নৃ-গোষ্ঠী সম্প্রদায়ের সদস্য।"), "Bangla document prints the Bangla label");
  assert.ok(!bn.includes("chakma"), "the raw select code never prints");
  const en = render({
    number: "DEMO-2026-TRIB40",
    service,
    payload: { delivery_language: "en", community_name: "chakma" },
    schema: getServiceSchema(40),
  });
  assert.ok(en.includes("member of the Chakma ethnic minority community."), "English document prints the English label");
  // Applications pinned to the pre-QAFIX-08 versions carry free text
  // in both fields; it still renders verbatim.
  const legacyBn = render({
    number: "DEMO-2026-TRIB40",
    service,
    payload: { delivery_language: "bn", community_name: "চাকমা সম্প্রদায়" },
    schema: getServiceSchema(40, 4),
  });
  assert.ok(legacyBn.includes("তিনি চাকমা ক্ষুদ্র নৃ-গোষ্ঠী সম্প্রদায়ের সদস্য।"));
  const legacyEn = render({
    number: "DEMO-2026-TRIB40",
    service,
    payload: { delivery_language: "en", community_name_en: "Chakma community" },
    schema: getServiceSchema(40, 4),
  });
  assert.ok(legacyEn.includes("member of the Chakma ethnic minority community."));
});

test("v7 orphan: QAFIX-05 guardian-relation codes print their labels; father-only attestation names the father", () => {
  const service = { service_no: 24, name_bn: "এতিম সনদ", name_en: "Orphan certificate" };
  const bn = render({
    number: "DEMO-2026-ORPH24",
    service,
    payload: {
      delivery_language: "bn",
      orphan_father_name_bn: "আব্দুল করিম",
      orphan_father_death_date: "2019-11-02",
      orphan_guardian_name_bn: "করিম চাচা",
      orphan_guardian_relation: "uncle",
      guardian_or_support_details: "চাচার তত্ত্বাবধানে আছেন।",
      orphanhood_declaration: "পিতার মৃত্যুর পর এতিম হয়েছেন।",
    },
    schema: getServiceSchema(24),
  });
  assert.ok(bn.includes("তাঁহার পিতা মৃত আব্দুল করিম"), "Bangla attestation names the late father");
  assert.ok(bn.includes("(চাচা/মামা)"), "Bangla document prints the Bangla relation label");
  assert.ok(!bn.includes("(uncle)"), "the raw relation code never prints");
  assert.ok(bn.includes("তিনি এতিম।"));
  const en = render({
    number: "DEMO-2026-ORPH24",
    service,
    payload: {
      delivery_language: "en",
      orphan_father_name_en: "Abdul Karim",
      orphan_father_death_date: "2019-11-02",
      orphan_guardian_name_en: "Karim Chacha",
      orphan_guardian_relation: "uncle",
    },
    schema: getServiceSchema(24),
  });
  assert.ok(en.includes("The person&#39;s father, the late Abdul Karim, died on 2 November 2019."), "English attestation names the late father with a human date");
  assert.ok(en.includes("(Uncle)"), "English document prints the English relation label");
  assert.ok(!en.includes("(uncle)"), "the raw relation code never prints");
  assert.ok(en.includes("The person is an orphan."));
});

test("v7 voter area transfer: A4 portrait, no spouse segment, captured marriage attestation (CERT-REFINE-01)", () => {
  const html = render({
    number: "DEMO-2026-DEF456",
    citizen: {
      ...belabo.citizen,
      full_name_bn: "তামরীন আক্তার বীথি",
      spouse_name_bn: "তানজীনুর রহমান ভূইয়া পাভেল",
      father_name_bn: "মোঃ শহিদুল্লাহ",
      mother_name_bn: "বিলকিছ বেগম",
      gender: "female",
    } as PdfInput["citizen"],
    identity: {},
    service: { service_no: 37, name_bn: "ভোটার এলাকা স্থানান্তর প্রত্যয়ন", name_en: "Voter area transfer" },
    payload: { delivery_language: "bn", application_voter_area_transfer_reason: "marriage" },
    schema: getServiceSchema(37),
  });
  assert.ok(html.includes("@page{size:A4;"));
  // CERT-REFINE-01 (A2): the spouse segment left the standard identity block.
  assert.ok(!html.includes("স্বামীঃ"));
  assert.ok(!html.includes("জাতীয় পরিচয়পত্র"), "no NID segment when no NID is recorded");
  assert.ok(html.includes("বৈবাহিক সূত্রে তিনি অত্র এলাকায় স্থায়ীভাবে বসবাস করছেন এবং বাংলাদেশের নাগরিক।"));
  assert.ok(html.includes("তাঁহার পূর্বের ভোটার এলাকা পরিবর্তন করে অত্র এলাকার ভোটার হিসেবে নিবন্ধন করা যায়।"));
  assert.ok(!/prottoyon/i.test(html));
});

test("v7 trade licence (EN): grouped fields, real total, chairman-only signature, validity + grant lines (CERT-REFINE-01)", () => {
  const html = render({
    number: "DEMO-2026-TL789",
    order: { totalMinor: 53000 },
    service: { service_no: 42, name_bn: "ট্রেড লাইসেন্স", name_en: "Trade license" },
    payload: {
      delivery_language: "en",
      business_name_en: "Messrs Rahman Traders",
      proprietor_name_en: "Md Rahman",
      proprietor_mother_name: "Amena Begum",
      proprietor_father_name: "Md Karim",
      business_type: "retail",
      business_address_en: "Belabo Bazar",
      trade_license_email: "a@b.test",
      mobile: "01712345678",
      start_date: "2024-03-14",
    },
    schema: getServiceSchema(42),
  });
  for (const label of [
    "Business Organization Name", "Owner&#39;s/Proprietor&#39;s Name", "Mother&#39;s Name", "Father&#39;s Name",
    "Spouse&#39;s Name (If applicable)", "Nature of Business (Individual/Joint/Others)", "Business Type",
    "Address of Business Organization", "Birth Registration/NID/Passport", "TIN", "BIN",
    "Telephone/Mobile Number", "E-mail", "Fiscal Year", "Business Starting Date",
    // CERT-REFINE-01 §42: stacked address blocks under short heads; the
    // colliding serial label is gone.
    "Present Address", "Permanent Address",
    "Trade License Fee (New/Renewal)",
  ])
    assert.ok(html.includes(label), `field label present: ${label}`);
  assert.ok(html.includes("According to Union Parishad Model Tax Schedule 2013"));
  assert.ok(html.includes("2026 - 2027"));
  assert.ok(html.includes("14 March 2024"));
  // CERT-REFINE-01 §42: components print only from real fee fields; with none
  // recorded the table carries the order's real total alone.
  assert.ok(html.includes(">Total</td>"), "the order's real total prints");
  assert.ok(html.includes("530.00"));
  assert.ok(!html.includes("Signboard Fee"), "no fee-component rows without fee data");
  assert.ok(!html.includes("Administrative Officer"), "chairman-only signature model (steer 5)");
  // CERT-REFINE-01 §42: validity + grant lines now print (spec-verbatim).
  assert.ok(html.includes("Validity: 1 July 2026 to 30 June 2027."));
  assert.ok(html.includes("The licence is hereby granted to the above business to carry on its trade."));
  assert.ok(html.includes("MD HABIBUR RAHMAN"));
  assert.ok(html.includes("Panel Chairman"));
  assert.ok(html.includes("Verification: https://belabo.astra.test/verify?searchText=DEMO-2026-TL789"));
  assert.ok(!/prottoyon/i.test(html));
});

test("v7 trade licence (BN): Bangla labels, digits and total", () => {
  const html = render({
    number: "DEMO-2026-TL789",
    order: { totalMinor: 53000 },
    service: { service_no: 42, name_bn: "ট্রেড লাইসেন্স", name_en: "Trade license" },
    payload: {
      delivery_language: "bn",
      business_name_bn: "মেসার্স রহমান ট্রেডার্স",
      proprietor_name_bn: "মোঃ রহমান",
      business_type: "retail",
      mobile: "01712345678",
      start_date: "2024-03-14",
    },
    schema: getServiceSchema(42),
  });
  assert.ok(html.includes("ট্রেড লাইসেন্স নং: DEMO-২০২৬-TL৭৮৯"));
  assert.ok(html.includes("ইউনিয়ন পরিষদ আদর্শ কর তফসিল ২০১৩ মোতাবেক"));
  assert.ok(html.includes("২০২৬ - ২০২৭"));
  assert.ok(html.includes(">সর্বমোট</td>"));
  assert.ok(html.includes("৫৩০.০০"));
  // CERT-REFINE-01 (A6): Latin digits in the printed URL.
  assert.ok(html.includes("যাচাইকরণ: https://belabo.astra.test/verify?searchText=DEMO-2026-TL789"));
  assert.ok(!/prottoyon/i.test(html));
});

test("v7 trade licence: QAFIX-08 organisation-type codes print their labels; pinned free text prints verbatim", () => {
  const service = { service_no: 42, name_bn: "ট্রেড লাইসেন্স", name_en: "Trade license" };
  const en = render({
    number: "DEMO-2026-TL790",
    service,
    payload: {
      delivery_language: "en",
      business_name_en: "Messrs Rahman Traders",
      proprietor_name_en: "Md Rahman",
      business_type: "retail",
      trade_license_org_type: "private_limited",
      mobile: "01712345678",
      start_date: "2024-03-14",
    },
    schema: getServiceSchema(42),
  });
  assert.ok(en.includes("Private limited company"), "English document prints the English label");
  assert.ok(!en.includes("private_limited"), "the raw select code never prints");
  const bn = render({
    number: "DEMO-2026-TL790",
    service,
    payload: {
      delivery_language: "bn",
      business_name_bn: "মেসার্স রহমান ট্রেডার্স",
      proprietor_name_bn: "মোঃ রহমান",
      business_type: "retail",
      trade_license_org_type: "private_limited",
      mobile: "01712345678",
      start_date: "2024-03-14",
    },
    schema: getServiceSchema(42),
  });
  assert.ok(bn.includes("প্রাইভেট লিমিটেড কোম্পানি"), "Bangla document prints the Bangla label");
  // Applications pinned to the pre-QAFIX-08 versions carry the
  // free-text pair; it still renders verbatim in both languages.
  const legacyEn = render({
    number: "DEMO-2026-TL790",
    service,
    payload: {
      delivery_language: "en",
      business_name_en: "Messrs Rahman Traders",
      proprietor_name_en: "Md Rahman",
      business_type: "retail",
      trade_license_org_type: "Family business",
      trade_license_org_type_bn: "পারিবারিক ব্যবসা",
      mobile: "01712345678",
      start_date: "2024-03-14",
    },
    schema: getServiceSchema(42, 5),
  });
  assert.ok(legacyEn.includes("Family business"));
  const legacyBn = render({
    number: "DEMO-2026-TL790",
    service,
    payload: {
      delivery_language: "bn",
      business_name_bn: "মেসার্স রহমান ট্রেডার্স",
      proprietor_name_bn: "মোঃ রহমান",
      business_type: "retail",
      trade_license_org_type: "Family business",
      trade_license_org_type_bn: "পারিবারিক ব্যবসা",
      mobile: "01712345678",
      start_date: "2024-03-14",
    },
    schema: getServiceSchema(42, 5),
  });
  assert.ok(legacyBn.includes("পারিবারিক ব্যবসা"));
});

test("v7 non-remarriage: QAFIX-09 divorce payloads print the divorce sentences; pinned death payloads print verbatim", () => {
  const service = { service_no: 44, name_bn: "পুনঃবিবাহ না হওয়ার প্রত্যয়ন", name_en: "Non-remarriage certificate" };
  const divorceEn = render({
    number: "DEMO-2026-NR440",
    service,
    payload: {
      delivery_language: "en",
      previous_spouse_name: "আব্দুল করিম",
      previous_spouse_name_en: "Abdul Karim",
      marriage_end_type: "divorce",
      divorce_date: "2021-05-10",
    },
    schema: getServiceSchema(44),
  });
  assert.ok(divorceEn.includes("ended in divorce on 10 May 2021"), "English divorce sentence with the divorce date");
  assert.ok(divorceEn.includes("Since the divorce, the person has not remarried."));
  assert.ok(!divorceEn.includes("the late Abdul Karim"), "no widowhood wording on the divorce path");
  const divorceBn = render({
    number: "DEMO-2026-NR440",
    service,
    payload: {
      delivery_language: "bn",
      previous_spouse_name: "আব্দুল করিম",
      previous_spouse_name_en: "Abdul Karim",
      marriage_end_type: "divorce",
      divorce_date: "2021-05-10",
    },
    schema: getServiceSchema(44),
  });
  assert.ok(divorceBn.includes("বিবাহ বিচ্ছেদ ঘটে"), "Bangla divorce sentence prints");
  assert.ok(divorceBn.includes("বিবাহ বিচ্ছেদের পর হইতে তিনি অদ্যাবধি পুনরায় বিবাহ বন্ধনে আবদ্ধ হন নাই।"));
  assert.ok(!divorceBn.includes("মৃত্যুবরণ করেন"), "no death wording on the divorce path");
  // Pinned payloads (no marriage_end_type) print the historical
  // death sentences byte-identically in both languages.
  const deathEn = render({
    number: "DEMO-2026-NR441",
    service,
    payload: {
      delivery_language: "en",
      previous_spouse_name_en: "Abdul Karim",
      spouse_death_date: "2020-02-03",
    },
    schema: getServiceSchema(44, 4),
  });
  // (The paragraph is HTML-escaped in the document: ' renders as
  // &#39; — the Workstream C/E assertion trap.)
  assert.ok(deathEn.includes("The person&#39;s spouse, the late Abdul Karim, died on 3 February 2020."));
  assert.ok(deathEn.includes("Since the spouse&#39;s death, the person has not remarried and has been living with the children."));
  const deathBn = render({
    number: "DEMO-2026-NR441",
    service,
    payload: {
      delivery_language: "bn",
      previous_spouse_name: "আব্দুল করিম",
      spouse_death_date: "2020-02-03",
    },
    schema: getServiceSchema(44, 4),
  });
  assert.ok(deathBn.includes("মৃত্যুবরণ করেন।"), "Bangla death sentence prints as before");
  assert.ok(deathBn.includes("স্বামীর মৃত্যুর পর তিনি অদ্যাবধি পুনরায় বিবাহ বন্ধনে আবদ্ধ হন নাই"));
});

test("v7 modes: demo shows no emblem; official shows the emblem header + emblem watermark and no seal (CERTNO-01)", () => {
  const input: Partial<PdfInput> = {
    number: "DEMO-2026-ABC123",
    service: { service_no: 12, name_bn: "নাগরিকত্ব সনদ", name_en: "Citizenship certificate" },
    payload: { delivery_language: "bn", citizenship_basis: "জন্মসূত্রে" },
    schema: getServiceSchema(12),
  };
  delete process.env.ISSUANCE_MODE;
  const demo = render(input);
  assert.ok(!demo.includes("DEMO / NOT OFFICIAL"));
  assert.ok(!demo.includes('class="emblem"'), "no emblem in demo mode");
  assert.ok(!demo.includes('class="emblem-wm"'), "no emblem watermark in demo mode");
  assert.ok(!demo.includes("seal-wm"), "no seal watermark in demo mode");
  assert.ok(!demo.includes("এই নথি আইনগত পরিচয় বা সরকারি অনুমোদনের প্রমাণ নয়।"));
  process.env.ISSUANCE_MODE = "official";
  try {
    const official = render(input);
    assert.ok(official.includes('class="emblem"'), "government emblem in the official header");
    // CERTNO-01: centre watermark = the government emblem; the office seal
    // is not printed anywhere (supersedes the CERTASSETS-01 seal watermark).
    assert.ok(official.includes('class="emblem-wm"'), "government emblem watermark in official mode");
    assert.ok(!official.includes("seal-wm"), "no seal watermark in official mode");
    assert.ok(!official.includes("DEMO / NOT OFFICIAL"));
    assert.ok(!official.includes('class="draft-wm"'));
    // Owner instruction (16 Nov 2026): production output carries NO demo
    // content of any kind — with a production number the whole document is clean.
    const production = render({ ...input, number: "2026-ABC123" });
    const productionText = production.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, "");
    assert.ok(!/demo/i.test(productionText), "no demo wording anywhere in official mode");
    assert.ok(!production.includes("আইনগত পরিচয় বা সরকারি অনুমোদনের প্রমাণ নয়"), "no disclaimer lines in official mode");
    assert.ok(!production.includes("not proof of legal identity"), "no disclaimer lines in official mode");
    assert.ok(production.includes("সনদ নং: ২০২৬-ABC১২৩"));
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
});

test("v7 deceased-subject, members table and authored attestation spot checks", () => {
  const death = render({
    number: "DEMO-2026-D1",
    service: { service_no: 7, name_bn: "মৃত্যু প্রত্যয়ন", name_en: "Death attestation" },
    payload: {
      delivery_language: "bn",
      dead_info_name_bn: "মৃত ব্যক্তি",
      dead_info_father_name_bn: "পিতা",
      dead_info_dod: "2026-01-05",
      dead_info_register_no: "12345",
    },
    schema: getServiceSchema(7),
  });
  assert.ok(death.includes("<strong>মৃত ব্যক্তি</strong>"));
  // CERT-REFINE-01 (A4): cholito register.
  assert.ok(death.includes("মৃত্যুবরণ করেছেন"));
  assert.ok(death.includes("মৃত্যু নিবন্ধন নংঃ ১২৩৪৫।"));
  const family = render({
    number: "DEMO-2026-F2",
    service: { service_no: 2, name_bn: "পারিবারিক সনদ", name_en: "Family certificate" },
    payload: { delivery_language: "bn", members: demoPayloads[2]!.members },
    schema: getServiceSchema(2),
  });
  assert.ok(family.includes("পরিবারের সদস্য"));
  assert.ok(family.includes('class="data"'));
  const character = render({
    number: "DEMO-2026-C35",
    service: { service_no: 35, name_bn: "চারিত্রিক সনদ", name_en: "Character certificate" },
    payload: { delivery_language: "bn" },
    schema: getServiceSchema(35),
  });
  assert.ok(character.includes("সচ্চরিত্রের অধিকারী"));
  assert.ok(AUTHORED_ATTESTATION_SERVICES.includes(35));
  assert.ok(!AUTHORED_ATTESTATION_SERVICES.includes(12));
  assert.ok(!AUTHORED_ATTESTATION_SERVICES.includes(37));
});

test("v7 attestation fixes (owner review 17 Nov): income fallbacks, remarriage wording, electricity land slots", () => {
  // Service 23 (annual income) without an amount: fallback sentence, never empty.
  const annualBn = render({
    number: "DEMO-2026-A23",
    service: { service_no: 23, name_bn: "বাৎসরিক আয় সনদ", name_en: "Annual income certificate" },
    payload: { delivery_language: "bn" },
    schema: getServiceSchema(23),
  });
  assert.ok(annualBn.includes("আবেদনকারীর নিজের বার্ষিক আয় আবেদনে উল্লিখিত অনুযায়ী।"));
  const annualEn = render({
    number: "DEMO-2026-A23E",
    service: { service_no: 23, name_bn: "বাৎসরিক আয় সনদ", name_en: "Annual income certificate" },
    payload: { delivery_language: "en" },
    schema: getServiceSchema(23),
  });
  assert.ok(annualEn.includes("The person&#39;s annual income is as stated in the application."));
  // With an amount, the real sentence still wins and the fallback stays out.
  const annualWithAmount = render({
    number: "DEMO-2026-A23A",
    service: { service_no: 23, name_bn: "বাৎসরিক আয় সনদ", name_en: "Annual income certificate" },
    payload: { delivery_language: "en", income_info_amount: 240000 },
    schema: getServiceSchema(23),
  });
  // CERTNO-01: with an amount and no applicant-supplied words, the words are
  // generated — figures AND words always print together.
  assert.ok(annualWithAmount.includes("The applicant&#39;s own annual income is BDT 2,40,000 (in words: Two Lakh Forty Thousand Taka only)."));
  assert.ok(!annualWithAmount.includes("as stated in the application"));

  // Service 29 (monthly income) without an amount: fallback sentence, never empty.
  const monthlyBn = render({
    number: "DEMO-2026-M29",
    service: { service_no: 29, name_bn: "মাসিক আয় সনদ", name_en: "Monthly income certificate" },
    payload: { delivery_language: "bn" },
    schema: getServiceSchema(29),
  });
  assert.ok(monthlyBn.includes("আবেদনকারীর নিজের মাসিক আয় আবেদনে উল্লিখিত অনুযায়ী।"));
  const monthlyEn = render({
    number: "DEMO-2026-M29E",
    service: { service_no: 29, name_bn: "মাসিক আয় সনদ", name_en: "Monthly income certificate" },
    payload: { delivery_language: "en" },
    schema: getServiceSchema(29),
  });
  assert.ok(monthlyEn.includes("The person&#39;s monthly income is as stated in the application."));

  // Service 13 (remarriage, EN): "remarried to <name>". The payload carries
  // the schema-produced key (application_husband_name), as the live flow does.
  const remarriage = render({
    number: "DEMO-2026-R13",
    service: { service_no: 13, name_bn: "পুনঃবিবাহ সনদ", name_en: "Remarriage certificate" },
    payload: { delivery_language: "en", application_husband_name: "Karim Uddin" },
    schema: getServiceSchema(13),
  });
  assert.ok(remarriage.includes("The person has remarried to Karim Uddin (as per the kabinnama/marriage registration)."));
  assert.ok(!remarriage.includes("has remarried Karim"));

  // Service 6 (electricity): the clause reads the schema-produced
  // electricity_connection_* keys (LIVEQA2 finding 1 — bare mouza/khatiyan/daag
  // are never produced, so the clause silently never printed live).
  const elecBn = render({
    number: "DEMO-2026-E6",
    service: { service_no: 6, name_bn: "বিদ্যুৎ সংযোগ অনাপত্তি", name_en: "Electricity connection NOC" },
    payload: { delivery_language: "bn", electricity_connection_mouza_name_bn: "বেলাবো" },
    schema: getServiceSchema(6),
  });
  assert.ok(elecBn.includes("মৌজাঃ বেলাবো"));
  assert.ok(!elecBn.includes("খতিয়ান"), "no khatiyan slot when absent");
  assert.ok(!elecBn.includes("দাগ নং"), "no daag slot when absent");
  const elecEn = render({
    number: "DEMO-2026-E6E",
    service: { service_no: 6, name_bn: "বিদ্যুৎ সংযোগ অনাপত্তি", name_en: "Electricity connection NOC" },
    payload: { delivery_language: "en", electricity_connection_mouza_name: "Belabo" },
    schema: getServiceSchema(6),
  });
  assert.ok(elecEn.includes("Mouza: Belabo"));
  assert.ok(!elecEn.includes("Khatiyan"), "no khatiyan slot when absent");
  assert.ok(!elecEn.includes("Daag"), "no daag slot when absent");
  // With the sub-values present, the full land clause still prints.
  const elecFull = render({
    number: "DEMO-2026-E6F",
    service: { service_no: 6, name_bn: "বিদ্যুৎ সংযোগ অনাপত্তি", name_en: "Electricity connection NOC" },
    payload: {
      delivery_language: "bn",
      electricity_connection_mouza_name_bn: "বেলাবো",
      electricity_connection_khatiyan_no: "123",
      electricity_connection_daag_no: "456",
    },
    schema: getServiceSchema(6),
  });
  assert.ok(elecFull.includes("খতিয়ান নংঃ ১২৩"));
  assert.ok(elecFull.includes("দাগ নংঃ ৪৫৬"));

  // Service 20 (freedom fighter): the ID/gazette segments read the
  // schema-produced freedom_fighter_* keys (same key-mapping class as S6 —
  // ff_id_no/gazette_no are never produced, so the segments never printed).
  const ffBn = render({
    number: "DEMO-2026-F20",
    service: { service_no: 20, name_bn: "মুক্তিযোদ্ধা সনদ", name_en: "Freedom fighter certificate" },
    payload: {
      delivery_language: "bn",
      freedom_fighter_id_number: "778899",
      freedom_fighter_gazette_number: "4455",
    },
    schema: getServiceSchema(20),
  });
  // CERT-REFINE-02 (R2-16): identifier fields render EXACTLY as stored —
  // no digit-script conversion inside identifier strings (the plan's
  // example: "FF-778899" as issued, not "FF-৭৭৮৮৯৯"). The two BN
  // assertions below were updated from the retired bnDigits behaviour.
  assert.ok(ffBn.includes("মুক্তিযোদ্ধা পরিচিতি নংঃ 778899"));
  assert.ok(ffBn.includes("গেজেট নংঃ 4455"));
  const ffEn = render({
    number: "DEMO-2026-F20E",
    service: { service_no: 20, name_bn: "মুক্তিযোদ্ধা সনদ", name_en: "Freedom fighter certificate" },
    payload: {
      delivery_language: "en",
      freedom_fighter_id_number: "778899",
      freedom_fighter_gazette_number: "4455",
    },
    schema: getServiceSchema(20),
  });
  assert.ok(ffEn.includes("Freedom fighter ID no: 778899."));
  assert.ok(ffEn.includes("Gazette no: 4455."));
});

test("template 6 remains selectable and byte-stable in shape", () => {
  const html = renderCertificateHtml(
    {
      ...belabo,
      number: "DEMO-SIGN",
      service: { service_no: 3, name_bn: "সেবা", name_en: "Service" },
      payload: { delivery_language: "en" },
      schema: getServiceSchema(3),
    } as PdfInput,
    qr,
    6,
  );
  assert.ok(!html.includes("DEMO / NOT OFFICIAL"));
  assert.ok(html.includes("Template 6"));
  assert.ok(!html.includes("সনদ নং:-"));
});

/* ---------- DB-backed: issuance stores v7 and the printed number verifies ---------- */
let server: ReturnType<typeof app.listen>, base: string;
const sessions: Record<string, { cookie: string; csrf: string }> = {};
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
  sessions[name] = { cookie: r.headers.get("set-cookie")!.split(";")[0]!, csrf: json.csrfToken };
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

test("issued certificates are template 7 and verify by printed number (Latin and Bangla digits)", async () => {
  const citizenId = (await req("GET", "/citizens", undefined, "citizen")).body.items[0].id;
  const created = await req("POST", "/applications", { citizenId, serviceNo: 45, payload: demoPayloads[45] }, "staff");
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id as string;
  const submitted = await req("POST", `/applications/${id}/transition`, { action: "submit" }, "staff");
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const approved = await req("POST", `/applications/${id}/transition`, { action: "approve" }, "approver");
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const certificate = approved.body.certificate;
  assert.equal(certificate.templateVersion, 7);
  const byNumber = await req("GET", `/verify/by-number/${encodeURIComponent(certificate.number)}`);
  assert.equal(byNumber.status, 200, JSON.stringify(byNumber.body));
  assert.equal(byNumber.body.status, "ISSUED");
  const bnNumber = certificate.number.replace(/\d/g, (d: string) => "০১২৩৪৫৬৭৮৯"[Number(d)]!);
  const byBnNumber = await req("GET", `/verify/by-number/${encodeURIComponent(bnNumber)}`);
  assert.equal(byBnNumber.status, 200, JSON.stringify(byBnNumber.body));
  assert.equal(byBnNumber.body.status, "ISSUED");
  const missing = await req("GET", "/verify/by-number/DEMO-1999-NOSUCH");
  assert.equal(missing.status, 404);
});

/* Real-flow regression (LIVEQA2 finding 1): service 6 submitted through the
 * API with the schema-produced electricity_connection_* keys must print the
 * land-details clause on the ISSUED PDF — the template previously read bare
 * mouza/khatiyan/daag keys the form never produces, so the clause was dead. */
const execFileAsync = promisify(execFile);
async function issuedPdfText(certificateId: string): Promise<string> {
  const s = sessions["staff"]!;
  const response = await fetch(`${base}/api/v1/certificates/${certificateId}/pdf`, {
    headers: { Cookie: s.cookie },
  });
  assert.equal(response.status, 200);
  const pdf = Buffer.from(await response.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v7-s6-"));
  const file = path.join(dir, "certificate.pdf");
  fs.writeFileSync(file, pdf);
  const { stdout } = await execFileAsync("pdftotext", [file, "-"]);
  return stdout.replace(/\s+/g, " ");
}
async function issueElectricity(payload: Record<string, unknown>): Promise<string> {
  const citizenId = (await req("GET", "/citizens", undefined, "citizen")).body.items[0].id;
  const created = await req("POST", "/applications", { citizenId, serviceNo: 6, payload }, "staff");
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id as string;
  const submitted = await req("POST", `/applications/${id}/transition`, { action: "submit" }, "staff");
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const approved = await req("POST", `/applications/${id}/transition`, { action: "approve" }, "approver");
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.certificate.templateVersion, 7);
  return approved.body.certificate.id as string;
}

test("service 6 issued via the API prints the land clause from the schema keys (BN)", async () => {
  const full = await issueElectricity({
    ...demoPayloads[6],
    delivery_language: "bn",
    electricity_connection_mouza_name_bn: "বেলাবো",
    electricity_connection_mouza_name: "Belabo",
    electricity_connection_khatiyan_no: "123",
    electricity_connection_daag_no: "456",
  });
  const fullText = await issuedPdfText(full);
  assert.ok(fullText.includes("জমির বিবরণঃ মৌজাঃ বেলাবো"), "land clause prints the mouza");
  assert.ok(fullText.includes("খতিয়ান নংঃ ১২৩"), "land clause prints the khatiyan number");
  assert.ok(fullText.includes("দাগ নংঃ ৪৫৬"), "land clause prints the daag number");

  // A mouza-only application cannot exist through the live form: khatiyan and
  // daag are REQUIRED schema fields, so omitting them is a 422 before any
  // certificate can issue. The conditional no-empty-slot rendering is pinned
  // at render level in the attestation-fixes test above (defence for payloads
  // that arrive without the sub-values by any other path).
  const mouzaOnlyPayload: Record<string, unknown> = {
    ...demoPayloads[6],
    delivery_language: "bn",
    electricity_connection_mouza_name_bn: "বেলাবো",
    electricity_connection_mouza_name: "Belabo",
  };
  delete mouzaOnlyPayload.electricity_connection_khatiyan_no;
  delete mouzaOnlyPayload.electricity_connection_daag_no;
  const citizenId = (await req("GET", "/citizens", undefined, "citizen")).body.items[0].id;
  const rejected = await req(
    "POST",
    "/applications",
    { citizenId, serviceNo: 6, payload: mouzaOnlyPayload },
    "staff",
  );
  assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
  const requiredPaths = (rejected.body.error.issues as { path: string; code: string }[])
    .filter((i) => i.code === "required")
    .map((i) => i.path);
  assert.ok(requiredPaths.includes("electricity_connection_khatiyan_no"));
  assert.ok(requiredPaths.includes("electricity_connection_daag_no"));
});

test("official mode issues production numbers with no DEMO- prefix", async () => {
  process.env.ISSUANCE_MODE = "official";
  try {
    // CERT-REFINE-01 (A7): official issuance is gated on a configured
    // chairman signature — upload one through the real endpoint first.
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
    // 201 on first upload, 200 when replacing an existing asset.
    assert.ok([200, 201].includes(upload.status), JSON.stringify(upload.body));
    const citizenId = (await req("GET", "/citizens", undefined, "citizen")).body.items[0].id;
    const created = await req("POST", "/applications", { citizenId, serviceNo: 45, payload: demoPayloads[45] }, "staff");
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id as string;
    await req("POST", `/applications/${id}/transition`, { action: "submit" }, "staff");
    const approved = await req("POST", `/applications/${id}/transition`, { action: "approve" }, "approver");
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    const number = approved.body.certificate.number as string;
    assert.ok(!/demo/i.test(number), `production number carries no demo wording: ${number}`);
    // CERTNO-01: 16 consecutive digits, prefixed with the Asia/Dhaka issue date.
    assert.match(number, /^\d{16}$/);
    const dhakaToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(new Date())
      .replace(/-/g, "");
    assert.equal(number.slice(0, 8), dhakaToday);
    const byNumber = await req("GET", `/verify/by-number/${encodeURIComponent(number)}`);
    assert.equal(byNumber.status, 200, JSON.stringify(byNumber.body));
    assert.equal(byNumber.body.status, "ISSUED");
  } finally {
    delete process.env.ISSUANCE_MODE;
  }
});

test("CERT-REFINE-01 svc38: disability type prints from the operational field application_autistic_type", () => {  // The operational schema's type field is application_autistic_type (legacy
  // id); the renderer must read it — reading a never-populated key leaves the
  // certificate's core fact blank.
  const base = {
    number: "2026111900000038",
    service: { service_no: 38, name_bn: "প্রতিবন্ধী সনদ", name_en: "Disability certificate" },
    payload: {
      delivery_language: "bn",
      application_autistic_type: "physical",
      support_needs: "হুইলচেয়ার ও যাতায়াত সহায়তা",
      support_needs_en: "Wheelchair and transport assistance",
    },
  } as Partial<PdfInput>;
  const bn = render(base);
  assert.ok(bn.includes("প্রতিবন্ধিতার ধরণঃ শারীরিক"), "BN render names the disability type");
  const en = render({
    ...base,
    payload: { ...(base.payload as object), delivery_language: "en" },
  } as Partial<PdfInput>);
  assert.ok(
    en.includes(
      "The certificate holder is a person with a disability (disability type: Physical).",
    ),
    "EN render names the disability type (CERT-REFINE-02 R2-15 sentence)",
  );
});

test("CERT-REFINE-01 svc18: EN community name is not doubled when the value already ends in 'community'", () => {
  const html = render({
    number: "2026111900000018",
    service: { service_no: 18, name_bn: "সম্প্রদায় সনদ", name_en: "Community certificate" },
    payload: {
      delivery_language: "en",
      community_name: "মুসলিম সম্প্রদায়",
      community_name_en: "Muslim community",
    },
  } as Partial<PdfInput>);
  assert.ok(html.includes("member of the Muslim community."), "single 'community' in the EN sentence");
  assert.ok(!html.includes("community community"), "no doubled 'community'");
});
