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
  CERT_PAPER_BG,
  AUTHORED_ATTESTATION_SERVICES,
  WORDING_BLESSING_BN,
  correctionFieldLabel,
  transferReasonPhrase,
  consentGuardianPurpose,
  deceasedName,
  bnOrd,
  enOrd,
  ordDate,
  ordDateIso,
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
  // Md's order of 25 Nov 2026: Prottoyon's format per reference — services
  // 12 and 37 print A4 landscape (their Prottoyon references are
  // landscape); unreferenced services keep the portrait default.
  assert.deepEqual(certificatePageFormat(12), { size: "A4", orientation: "landscape" });
  assert.deepEqual(certificatePageFormat(37), { size: "A4", orientation: "landscape" });
  assert.deepEqual(certificatePageFormat(45), { size: "A4", orientation: "portrait" });
});

test("v7 QR-MOVE + PHOTO-CORNER: QR top-left, photo top-right corner, verify line bottom-left, no government line anywhere (Md's orders 25 Nov 2026 15:00/15:20/15:21)", () => {
  const PHOTO = "data:image/png;base64,AAAA";
  // Paragraph certificate (service 12): the QR sits in the header row
  // (top-left), the citizen photo sits in the header row's right column
  // (top-right corner — NOT beside the body text), and the footer
  // carries only the left-aligned verify line.
  const para = render({
    number: "DEMO-2026-QR12",
    service: { service_no: 12, name_bn: "নাগরিকত্ব সনদ", name_en: "Citizenship certificate" },
    payload: { delivery_language: "bn", citizenship_basis: "জন্মসূত্রে" },
    citizenPhoto: PHOTO,
    schema: getServiceSchema(12),
  });
  const headRowAt = para.indexOf('<div class="head-row">');
  const qrAt = para.indexOf('class="qr"');
  const headAt = para.indexOf('<header class="up-head">');
  assert.ok(headRowAt >= 0 && qrAt > headRowAt && qrAt < headAt, "QR renders inside the header row, before the centred header (top-left)");
  const footAt = para.indexOf('<footer class="doc-foot">');
  assert.ok(footAt > 0, "footer present");
  assert.ok(!para.slice(footAt).includes('class="qr"'), "footer carries no QR (it moved to the header)");
  assert.ok(para.includes("যাচাইকরণ: https://belabo.astra.test/verify?searchText=DEMO-2026-QR12"), "verify line still prints");
  assert.ok(para.includes(".verify-line{flex:1;text-align:left"), "verify line is left-aligned (bottom-left)");
  const photoAt = para.indexOf('<img class="citizen-photo"');
  const numlineAt = para.indexOf('<div class="numline">');
  assert.ok(photoAt > headAt && photoAt < numlineAt, "photo renders inside the header row, after the centred header (top-right corner)");
  assert.equal(para.split('class="citizen-photo"').length - 1, 1, "exactly one photo (none beside the body text)");

  // Form services 1 and 41 share the header row: their photo also sits
  // in the top-right corner (it used to float at the top of the body).
  for (const no of [1, 41]) {
    const html = render({
      number: "2026111812345678",
      service: { service_no: no, name_bn: "সনদ", name_en: "Certificate" },
      payload: { ...(demoPayloads[no] ?? {}), delivery_language: "bn" },
      citizenPhoto: PHOTO,
      schema: getServiceSchema(no),
    });
    const pAt = html.indexOf('<img class="citizen-photo"');
    const hAt = html.indexOf('<header class="up-head">');
    const bodyAt = html.indexOf(no === 1 ? 'class="generic-form"' : 'class="tl-doc"');
    assert.ok(pAt > hAt && pAt < bodyAt, `svc${no}: photo in the header row, before the body (top-right corner)`);
    assert.equal(html.split('class="citizen-photo"').length - 1, 1, `svc${no}: exactly one photo`);
  }

  // Service 46 compact card: QR top-left, photo top-right, NO government
  // line in either language (the card was the last layout printing it).
  for (const lang of ["bn", "en"] as const) {
    const card = render({
      number: "2026111812345678",
      service: { service_no: 46, name_bn: "পরিবহন অনুমতিপত্র", name_en: "Transport permit" },
      payload: { delivery_language: lang, transport_license_no: "T-9", transport_license_engine_no: "E123" },
      citizenPhoto: PHOTO,
      schema: getServiceSchema(46),
    });
    assert.ok(!card.includes("গণপ্রজাতন্ত্রী বাংলাদেশ সরকার"), `svc46 ${lang}: no Bangla government line`);
    assert.ok(!card.includes("Government of the People's Republic of Bangladesh"), `svc46 ${lang}: no English government line`);
    const cardBody = card.slice(card.indexOf('<div class="tcard">'));
    const cQr = cardBody.indexOf('class="qr-tcard"');
    const cMain = cardBody.indexOf('class="tcard-main"');
    const cPhoto = cardBody.indexOf('class="citizen-photo tcard-photo"');
    assert.ok(cQr >= 0 && cQr < cMain, `svc46 ${lang}: QR before the text zone (top-left)`);
    assert.ok(cPhoto > cMain, `svc46 ${lang}: photo after the text zone (top-right)`);
  }

  // Government-line sweep: no certificate prints it, either language.
  for (const no of [1, 41, 42, 45, 46]) {
    for (const lang of ["bn", "en"] as const) {
      const html = render({
        number: "2026111812345678",
        service: { service_no: no, name_bn: "সনদ", name_en: "Certificate" },
        payload: { ...(demoPayloads[no] ?? {}), delivery_language: lang },
        citizenPhoto: PHOTO,
        schema: getServiceSchema(no),
      });
      assert.ok(!html.includes("গণপ্রজাতন্ত্রী বাংলাদেশ সরকার"), `svc${no} ${lang}: no Bangla government line`);
      assert.ok(!html.includes("Government of the People's Republic of Bangladesh"), `svc${no} ${lang}: no English government line`);
    }
  }
});

test("v7 citizenship: Prottoyon verbatim wording — যাইতেছে register, birth-reg-first identity, both addresses, তাহার blessing", () => {
  const html = render({
    number: "DEMO-2026-ABC123",
    service: { service_no: 12, name_bn: "নাগরিকত্ব সনদ", name_en: "Citizenship certificate" },
    payload: { delivery_language: "bn", citizenship_basis: "জন্মসূত্রে" },
    identity: { birthReg: "20086830720106495" },
    schema: getServiceSchema(12),
  });
  assert.ok(html.includes("@page{size:A4 landscape;"));
  // CERT-PAPER (Md's order, 25 Nov 2026 15:59): the page prints on the
  // warm cream/ivory government-paper tone — @page background plus the
  // root-element background that propagates over the full page canvas.
  assert.ok(html.includes(`;background:${CERT_PAPER_BG}}`));
  assert.ok(html.includes(`html,body{background:${CERT_PAPER_BG}}`));
  // WS-SHELL-GAPS (25 Nov 2026): the meta line prints "নং:-" (colon +
  // hyphen, as on every Prottoyon reference) and the issue date carries
  // the reference ordinal suffix (১২ই).
  assert.ok(html.includes("সনদ নং:- DEMO-২০২৬-ABC১২৩"));
  assert.ok(html.includes("ইস্যুর তারিখ:- ১২ই অক্টোবর ২০২৬"));
  // WS-WORDING (25 Nov 2026): older register, birth-reg number before the
  // parents (no NID slot on service 12), present address always prints.
  assert.ok(html.includes("এই মর্মে প্রত্যয়ন করা যাইতেছে যে, <strong>আফসানা আক্তার মীম</strong>"));
  assert.ok(html.includes("জন্ম নিবন্ধন নম্বরঃ <strong>২০০৮৬৮৩০৭২০১০৬৪৯৫</strong>"));
  assert.ok(!html.includes("জাতীয় পরিচয়পত্র নম্বরঃ"), "service 12 prints the birth-reg number, never the NID");
  assert.ok(html.includes("পিতাঃ <strong>মোঃ আসাদুজ্জামান</strong>"));
  assert.ok(html.includes("মাতাঃ <strong>মুক্তি বেগম</strong>"));
  // CERT-REFINE-01 (A2): no থানাঃ segment in the standard address block.
  assert.ok(html.includes("গ্রাম/বাড়ীঃ বেলাব গাংকুল পাড়া, ওয়ার্ড নম্বরঃ ৩, বেলাবো ইউনিয়ন, উপজেলাঃ বেলাবো, জেলাঃ নরসিংদী"));
  assert.ok(!html.includes("ডাকঘর"), "post office segment omitted — no dataset (steer 7)");
  assert.ok(html.includes("তাহার স্থায়ী ঠিকানাঃ- গ্রাম/বাড়ীঃ বেলাব গাংকুল পাড়া"));
  assert.ok(html.includes("বর্তমান ঠিকানাঃ- গ্রাম/বাড়ীঃ বেলাব গাংকুল পাড়া"), "present address prints even when identical (D5)");
  assert.ok(html.includes("তিনি অত্র এলাকার একজন স্থায়ী বাসিন্দা এবং জন্মসূত্রে বাংলাদেশী নাগরিক।"));
  assert.ok(html.includes("আমি তাহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।"), "blessing uses তাহার (no chandrabindu)");
  assert.ok(!html.includes("তাঁহার"), "no chandrabindu তাঁহার anywhere in the new wording");
  assert.ok(!html.includes("গণপ্রজাতন্ত্রী বাংলাদেশ সরকার"), "no government line — Prottoyon references have none (Md's order 25 Nov 2026)");
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

test("v7 voter area transfer: Prottoyon verbatim wording — spouse in identity, reason phrase, no fields line, তাহার blessing", () => {
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
  assert.ok(html.includes("@page{size:A4 landscape;"));
  // WS-WORDING (25 Nov 2026): the spouse is inline in the identity list
  // (female applicant → স্বামী), the present address prints, the reason
  // phrase leads the residence sentence, and the reference carries no
  // previous-area / residing-since / NID fields line (D17).
  assert.ok(html.includes("স্বামীঃ <strong>তানজীনুর রহমান ভূইয়া পাভেল</strong>"));
  assert.ok(
    html.indexOf("স্বামীঃ") < html.indexOf("পিতাঃ"),
    "spouse segment sits before the father in the identity list",
  );
  assert.ok(html.includes("বর্তমান ঠিকানাঃ- গ্রাম/বাড়ীঃ বেলাব গাংকুল পাড়া"));
  assert.ok(!html.includes("জাতীয় পরিচয়পত্র"), "no NID segment when no NID is recorded");
  assert.ok(html.includes("বৈবাহিক সূত্রে তিনি অত্র এলাকায় স্থায়ীভাবে বসবাস করছেন এবং বাংলাদেশের নাগরিক।"));
  assert.ok(html.includes("তাহার পূর্বের ভোটার এলাকা পরিবর্তন করে অত্র এলাকার ভোটার হিসেবে নিবন্ধন করা যায়।"));
  assert.ok(!html.includes("পূর্বের ভোটার এলাকাঃ"), "no extra fields line (D17)");
  assert.ok(!html.includes("অত্র এলাকায় বসবাসের শুরু"), "no residing-since on the reference");
  assert.ok(html.includes("আমি তাহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।"));
  assert.ok(!/prottoyon/i.test(html));
});

test("v7 trade licence (EN): Prottoyon-matched form — numbered rows 1–14, two signature blocks, ordinal dates, all fee rows (25 Nov 2026)", () => {
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
    // TRADE-42: owner address blocks under owner heads; the tax-schedule
    // serial row is new.
    "Present Address of Owner/Proprietor", "Permanent Address of Owner/Proprietor",
    "Serial No. of Model Tax Schedule, 2013",
    "Trade License Fee (New/Renewal)",
  ])
    assert.ok(html.includes(label), `field label present: ${label}`);
  assert.ok(html.includes("According to Union Parishad Model Tax Schedule 2013"));
  assert.ok(html.includes("2026–2027"));
  assert.ok(html.includes("14th March 2024"));
  // TRADE-42: every fee row prints, with 0.00 where nothing was captured;
  // the order's real total prints when no components were captured.
  assert.ok(html.includes("Signboard Fee"), "all fee rows print");
  assert.ok(html.includes("0.00"));
  assert.ok(html.includes(">Total</span>"), "the order's real total prints");
  assert.ok(html.includes("530.00"));
  // TRADE-42: two signature blocks, as on the Prottoyon reference —
  // administrative officer left, chairman right.
  assert.ok(html.includes("Administrative Officer"), "administrative-officer signature block");
  assert.ok(html.includes("MD HABIBUR RAHMAN"));
  assert.ok(html.includes("Panel Chairman"));
  // TRADE-42: the reference's verbatim validity line (ordinal dates) and
  // NO grant sentence; the QR sits top-left (qr-tl), not in the foot.
  assert.ok(html.includes("This Trade Licence is valid from 1st July 2026 to 30th June 2027."));
  assert.ok(!html.includes("The licence is hereby granted"), "no grant sentence on the Prottoyon reference");
  assert.ok(html.includes("12th October 2026"), "ordinal issue date");
  assert.ok(html.includes('class="qr-tl"'), "QR top-left");
  assert.ok(html.includes("Verification: https://belabo.astra.test/verify?searchText=DEMO-2026-TL789"));
  assert.ok(!/prottoyon/i.test(html));
});

test("v7 trade licence (BN): Bangla labels, ordinal dates, all fee rows, two signatures (Prottoyon match, 25 Nov 2026)", () => {
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
  assert.ok(html.includes("২০২৬–২০২৭"));
  assert.ok(html.includes("১৪ই মার্চ ২০২৪"), "ordinal start date");
  assert.ok(html.includes("১২ই অক্টোবর ২০২৬"), "ordinal issue date");
  assert.ok(html.includes("অত্র ট্রেড লাইসেন্স এর মেয়াদ ১লা জুলাই ২০২৬ইং হইতে ৩০শে জুন ২০২৭ইং তারিখ পর্যন্ত"), "reference validity line");
  assert.ok(html.includes("১৩। আদর্শ কর তফসিল, ২০১৩ এর ক্রমিক নং"), "tax-schedule serial row");
  assert.ok(html.includes("১৪।"), "numbered fee head");
  assert.ok(html.includes("ট্রেড লাইসেন্স ফি (নতুন/নবায়ন)"), "fee head label");
  assert.ok(html.includes("সাইনবোর্ড (পরিচিতিমূলক)"), "all fee rows print");
  assert.ok(html.includes("0.00"), "uncaptured fee lines print 0.00 in Latin digits");
  assert.ok(html.includes(">সর্বমোট</span>"));
  assert.ok(html.includes("৫৩০.০০"), "total prints in Bangla digits");
  assert.ok(html.includes("প্রশাসনিক কর্মকর্তা"), "administrative-officer signature block");
  assert.ok(html.includes("মালিক/স্বত্বাধিকারীর বর্তমান ঠিকানা"), "owner address heads");
  assert.ok(html.includes("ডাকঘর"), "ten-row address blocks");
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

test("v7 modes: demo shows no emblem; official shows the emblem header + UP-seal watermark (Md's order 25 Nov 2026)", () => {
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
  assert.ok(!demo.includes('class="seal-wm"'), "no seal watermark in demo mode");
  assert.ok(!demo.includes("এই নথি আইনগত পরিচয় বা সরকারি অনুমোদনের প্রমাণ নয়।"));
  process.env.ISSUANCE_MODE = "official";
  try {
    const official = render(input);
    // REFINE (25 Nov 2026): service 12 is landscape, so the emblem
    // carries the larger landscape class (reference disc ~22.6mm).
    assert.ok(official.includes('class="emblem emblem-l"'), "government emblem in the official header");
    // Md's order of 25 Nov 2026 (supersedes CERTNO-01): centre watermark =
    // the office's UP seal from the deployment asset dir (configured at the
    // top of this file); the Government emblem never watermarks.
    assert.ok(official.includes('class="seal-wm"'), "UP-seal watermark in official mode");
    assert.ok(!official.includes("emblem-wm"), "no emblem watermark in official mode");
    assert.ok(!official.includes("DEMO / NOT OFFICIAL"));
    assert.ok(!official.includes('class="draft-wm"'));
    // Owner instruction (16 Nov 2026): production output carries NO demo
    // content of any kind — with a production number the whole document is clean.
    const production = render({ ...input, number: "2026-ABC123" });
    const productionText = production.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, "");
    assert.ok(!/demo/i.test(productionText), "no demo wording anywhere in official mode");
    assert.ok(!production.includes("আইনগত পরিচয় বা সরকারি অনুমোদনের প্রমাণ নয়"), "no disclaimer lines in official mode");
    assert.ok(!production.includes("not proof of legal identity"), "no disclaimer lines in official mode");
    assert.ok(production.includes("সনদ নং:- ২০২৬-ABC১২৩"));
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
  // WS-WORDING (25 Nov 2026): service 35 now prints the verbatim Prottoyon
  // reference text (সে throughout) — the authored attestation is superseded.
  assert.ok(character.includes("সে অত্র এলাকার একজন স্থায়ী বাসিন্দা এবং জন্মসূত্রে বাংলাদেশের নাগরিক। আমার জানা মতে, তাহার স্বভাব চরিত্র ভাল এবং বর্তমানে সে অবিবাহিত।"));
  assert.ok(!character.includes("সচ্চরিত্রের অধিকারী"));
  assert.ok(!AUTHORED_ATTESTATION_SERVICES.includes(35));
  assert.ok(!AUTHORED_ATTESTATION_SERVICES.includes(15));
  assert.ok(!AUTHORED_ATTESTATION_SERVICES.includes(22));
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

/* ---------- WS-SHELL-GAPS: ordinal issue dates (all 31 days, both languages) ---------- */

test("ordinals: bnOrd covers all 31 days — ১লা/২রা/৩রা/৪ঠা, ৫ই–১৯ই, ২০শে–৩১শে", () => {
  // Reference-verified boundary: ১৯ই on the character + parent-consent
  // references, ২২শে/২৩শে/২৮শে elsewhere — the শে boundary is 20, not 19.
  const expected = [
    "১লা", "২রা", "৩রা", "৪ঠা", "৫ই", "৬ই", "৭ই", "৮ই", "৯ই", "১০ই",
    "১১ই", "১২ই", "১৩ই", "১৪ই", "১৫ই", "১৬ই", "১৭ই", "১৮ই", "১৯ই",
    "২০শে", "২১শে", "২২শে", "২৩শে", "২৪শে", "২৫শে", "২৬শে", "২৭শে",
    "২৮শে", "২৯শে", "৩০শে", "৩১শে",
  ];
  for (let day = 1; day <= 31; day++) {
    assert.equal(bnOrd(day), expected[day - 1], `bnOrd(${day})`);
  }
});

test("ordinals: enOrd covers all 31 days — 1st/2nd/3rd, 11th/12th/13th, th otherwise", () => {
  const expected = [
    "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th",
    "11th", "12th", "13th", "14th", "15th", "16th", "17th", "18th", "19th",
    "20th", "21st", "22nd", "23rd", "24th", "25th", "26th", "27th",
    "28th", "29th", "30th", "31st",
  ];
  for (let day = 1; day <= 31; day++) {
    assert.equal(enOrd(day), expected[day - 1], `enOrd(${day})`);
  }
});

test("ordinals: ordDate/ordDateIso render the reference dates in both languages", () => {
  assert.equal(ordDate(new Date("2026-11-22T09:25:00+06:00"), true), "২২শে নভেম্বর ২০২৬");
  assert.equal(ordDate(new Date("2026-11-22T09:25:00+06:00"), false), "22nd November 2026");
  assert.equal(ordDate(new Date("2026-10-12T09:25:00+06:00"), true), "১২ই অক্টোবর ২০২৬");
  assert.equal(ordDate(new Date("2026-10-12T09:25:00+06:00"), false), "12th October 2026");
  assert.equal(ordDate(new Date("2026-11-19T09:25:00+06:00"), true), "১৯ই নভেম্বর ২০২৬");
  assert.equal(ordDate(new Date("2026-11-01T09:25:00+06:00"), true), "১লা নভেম্বর ২০২৬");
  assert.equal(ordDate(new Date("2026-11-01T09:25:00+06:00"), false), "1st November 2026");
  assert.equal(ordDate(new Date("2026-11-02T09:25:00+06:00"), false), "2nd November 2026");
  assert.equal(ordDate(new Date("2026-11-03T09:25:00+06:00"), false), "3rd November 2026");
  assert.equal(ordDateIso("2026-11-28", true), "২৮শে নভেম্বর ২০২৬");
  assert.equal(ordDateIso("2026-11-28", false), "28th November 2026");
  assert.equal(ordDateIso("", true), "");
});

test("ws-tables: services 2/3 print the Prottoyon 5-column heir/member table", () => {
  // Service 3 (Warish): reference columns only; a stored age wins over the
  // DOB-derived fallback; gendered relation labels print.
  const warish = render({
    number: "78620469944",
    service: { service_no: 3, name_bn: "ওয়ারিশ সনদ", name_en: "Legal heirs certificate" },
    issuedAt: "2026-11-12T00:00:00+06:00",
    payload: {
      delivery_language: "bn",
      warish_info_name_bn: "মোঃ দুরুজ আলী",
      warish_info_father_name_bn: "রহমত আলী",
      warish_info_mother_name_bn: "ময়মুন নেছা",
      heirs: [
        { warish_heir_name_bn: "মোঃ মনির হোসেন", warish_heir_dob: "1989-02-05", warish_heir_relation: "child", gender: "male", warish_heir_age: 38 },
        { warish_heir_name_bn: "মোসাঃ আনোয়ারা বেগম", warish_heir_dob: "1977-10-16", warish_heir_relation: "child", gender: "female", warish_heir_age: 49 },
        { warish_heir_name_bn: "জোছনা বেগম", warish_heir_dob: "1963-08-10", warish_heir_relation: "spouse", gender: "female" },
      ],
    },
    schema: getServiceSchema(3),
  });
  for (const h of ["ক্রমিক নং", "নাম", "জন্ম তারিখ", "বয়স", "সম্পর্ক"])
    assert.ok(warish.includes(h), `missing header ${h}`);
  for (const gone of ["পিতা/স্বামীর নাম", "জাতীয় পরিচয়পত্র নম্বর", "মোবাইল নম্বর", "ওয়ারিশের নাম"])
    assert.ok(!warish.includes(gone), `retired column still prints: ${gone}`);
  assert.ok(warish.includes('<td style="text-align:center">০৫-০২-১৯৮৯</td>'));
  assert.ok(warish.includes('<td style="text-align:center">৩৮</td>'), "stored age wins (completed years would be ৩৭)");
  assert.ok(warish.includes('<td style="text-align:center">৬৩</td>'), "no stored age: completed years at 12 Nov 2026");
  assert.ok(warish.includes('<td style="text-align:left">পুত্র</td>'));
  assert.ok(warish.includes('<td style="text-align:left">কন্যা</td>'));
  assert.ok(warish.includes('<td style="text-align:left">স্ত্রী</td>'));
  assert.ok(warish.includes('<td style="text-align:left">মোঃ মনির হোসেন</td>'));
  assert.ok(warish.includes('style="width:12%;text-align:center"'), "reference column widths");

  // Service 3, English variant: same columns, English headers/labels.
  const warishEn = render({
    number: "78620469944",
    service: { service_no: 3, name_bn: "ওয়ারিশ সনদ", name_en: "Legal heirs certificate" },
    issuedAt: "2026-11-12T00:00:00+06:00",
    payload: {
      delivery_language: "en",
      warish_info_name: "Md Duruj Ali",
      heirs: [
        { warish_heir_name: "Md Monir Hossain", warish_heir_dob: "1989-02-05", warish_heir_relation: "child", gender: "male", warish_heir_age: 38 },
      ],
    },
    schema: getServiceSchema(3),
  });
  for (const h of ["Sl No", "Name", "Date of birth", "Age", "Relationship"])
    assert.ok(warishEn.includes(h), `missing EN header ${h}`);
  assert.ok(!warishEn.includes("Father/Husband name"));
  assert.ok(warishEn.includes('<td style="text-align:left">Son</td>'));

  // Service 2 (Family): same 5 columns; the ID column is gone.
  const family = render({
    number: "75147645374",
    service: { service_no: 2, name_bn: "পারিবারিক সনদ", name_en: "Family certificate" },
    issuedAt: "2026-11-22T00:00:00+06:00",
    payload: {
      delivery_language: "bn",
      members: [
        { name_bn: "মিজান মিয়া", dob: "1977-02-02", relationship: "self", gender: "male", warish_heir_age: 50 },
        { name_bn: "শিল্পী", dob: "1979-03-03", relationship: "spouse", gender: "female", warish_heir_age: 48 },
        { name_bn: "মোরাদ মিয়া", dob: "2008-01-01", relationship: "child", gender: "male" },
      ],
    },
    schema: getServiceSchema(2),
  });
  for (const h of ["ক্রমিক নং", "নাম", "জন্ম তারিখ", "বয়স", "সম্পর্ক"])
    assert.ok(family.includes(h), `missing header ${h}`);
  assert.ok(!family.includes("আইডি/জন্মনিবন্ধন নং"), "retired ID column still prints");
  assert.ok(family.includes('<td style="text-align:center">৫০</td>'), "stored age wins");
  assert.ok(family.includes('<td style="text-align:center">১৮</td>'), "no stored age: completed years at 22 Nov 2026");
  assert.ok(family.includes('<td style="text-align:left">নিজ</td>'));
  assert.ok(family.includes('<td style="text-align:left">স্ত্রী</td>'));

  // Service 4 keeps the CERT-REFINE-01 column set (its own Prottoyon
  // reference is still unconfirmed) — regression guard for the split.
  const succession = render({
    number: "DEMO-2026-S4",
    service: { service_no: 4, name_bn: "উত্তরাধিকার সনদ", name_en: "Succession certificate" },
    issuedAt: "2026-11-12T00:00:00+06:00",
    payload: {
      delivery_language: "bn",
      warish_info_name_bn: "মৃত ব্যক্তি",
      warish_info_father_name_bn: "পিতা",
      heirs: [
        { warish_heir_name_bn: "ওয়ারিশ", warish_heir_dob: "1990-01-01", warish_heir_relation: "child", warish_heir_father_name_bn: "মৃত ব্যক্তি", warish_heir_nid: "123", warish_heir_mobile_no: "01700000000" },
      ],
    },
    schema: getServiceSchema(4),
  });
  assert.ok(succession.includes("পিতা/স্বামীর নাম"));
  assert.ok(succession.includes("জাতীয় পরিচয়পত্র নম্বর"));
  assert.ok(succession.includes("মোবাইল নম্বর"));
  assert.ok(!succession.includes("ক্রমিক নং"));});

// ---------------------------------------------------------------------------
// WS-WORDING (25 Nov 2026) — verbatim Prottoyon wording for services
// 12/15/19/22/25/33/35/37 + services 2/3 body wording. The reference
// templates are Bangla-only, so every new body gates on delivery_language
// "bn"; the English chassis is unchanged (one sanity check at the end).
// ---------------------------------------------------------------------------

test("ws-wording: service 12 spouse variant (12b) — birth-reg → spouse → father → mother", () => {
  const html = render({
    number: "DEMO-2026-12B",
    citizen: {
      ...belabo.citizen,
      full_name_bn: "মোঃ শহিদুল্লাহ",
      gender: "male",
      spouse_name_bn: "রাশিদা",
    } as PdfInput["citizen"],
    identity: { birthReg: "19936830720109999" },
    service: { service_no: 12, name_bn: "নাগরিকত্ব সনদ", name_en: "Citizenship certificate" },
    payload: { delivery_language: "bn", citizenship_basis: "জন্মসূত্রে" },
    schema: getServiceSchema(12),
  });
  assert.ok(html.includes("জন্ম নিবন্ধন নম্বরঃ <strong>১৯৯৩৬৮৩০৭২০১০৯৯৯৯</strong>"));
  assert.ok(html.includes("স্ত্রীঃ <strong>রাশিদা</strong>"), "male applicant → স্ত্রী");
  const order = ["জন্ম নিবন্ধন নম্বরঃ", "স্ত্রীঃ", "পিতাঃ", "মাতাঃ"].map((s) => html.indexOf(s));
  assert.ok(order.every((i) => i >= 0), "all four identity segments print");
  assert.ok(order[0] < order[1] && order[1] < order[2] && order[2] < order[3], "identity order is birth-reg → spouse → father → mother");
  assert.ok(html.includes("বর্তমান ঠিকানাঃ- গ্রাম/বাড়ীঃ বেলাব গাংকুল পাড়া"));
  assert.ok(html.includes("আমি তাহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।"));
});

test("ws-wording: service 15 new voter — full recommendation text, আমার জানা মতে as two words", () => {
  const html = render({
    number: "DEMO-2026-15",
    citizen: { ...belabo.citizen, full_name_bn: "মোঃ আকরাম হোসেন", gender: "male" } as PdfInput["citizen"],
    identity: { birthReg: "20006830720108888" },
    service: { service_no: 15, name_bn: "নতুন ভোটার সুপারিশ", name_en: "New voter recommendation" },
    payload: { delivery_language: "bn" },
    schema: getServiceSchema(15),
  });
  assert.ok(html.includes("তিনি অত্র ইউনিয়নের স্থায়ী বাসিন্দা এবং বাংলাদেশের নাগরিক। তাহাকে অত্র ইউনিয়ন পরিষদ হইতে নাগরিক সনদ এবং ট্যাক্স রশিদ প্রদান করা হইয়াছে এবং আমার জানা মতে তিনি ইতিপূর্বে কোথাও ভোটার হন নাই। তাই তাহাকে নতুন ভোটার হিসেবে নিবন্ধন করে জাতীয় পরিচয় পত্র দেওয়া যেতে পারে মর্মে সুপারিশ করা হইলো।"));
  assert.ok(!html.includes("জানামতে"), "আমার জানা মতে is two words");
  assert.ok(!html.includes("জন্ম নিবন্ধন নম্বরঃ"), "service 15 carries no birth-reg segment on the reference");
  assert.ok(html.includes("বর্তমান ঠিকানাঃ- গ্রাম/বাড়ীঃ বেলাব গাংকুল পাড়া"));
  assert.ok(html.includes("আমি তাহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।"));
});

test("ws-wording: service 19 guardian consent — child is the subject, guardian consents, dual signature", () => {
  const base19 = {
    number: "DEMO-2026-19",
    citizen: {
      ...belabo.citizen,
      full_name_bn: "আরাফাত",
      father_name_bn: "মোঃ মোবারক হোসেন",
      mother_name_bn: "মোসাঃ জ্যোৎস্না বেগম",
      address_bn: "বেলাব টেকপাড়া",
      gender: "male",
    } as PdfInput["citizen"],
    service: { service_no: 19, name_bn: "অভিভাবকের সম্মতিপত্র", name_en: "Guardian consent letter" },
    schema: getServiceSchema(19),
  };
  const html = render({
    ...base19,
    payload: {
      delivery_language: "bn",
      consent_applicant: "parent",
      consent_subject: "other",
      consent_child_name_bn: "আরাফাত",
      consent_child_relation: "parent",
      consent_guardian_name_bn: "মোসাঃ জ্যোৎস্না বেগম",
      consent_guardian_purpose_bn: "পুলিশ বাহিনীতে যোগদানে",
    },
    schema: getServiceSchema(19),
  });
  assert.ok(html.includes("এই মর্মে প্রত্যয়ন করা যাইতেছে যে, <strong>আরাফাত</strong>, পিতাঃ <strong>মোঃ মোবারক হোসেন</strong>, মাতাঃ <strong>মোসাঃ জ্যোৎস্না বেগম</strong>, তাহার স্থায়ী ঠিকানাঃ-"));
  assert.ok(html.includes("তাহার অভিভাবক মোসাঃ জ্যোৎস্না বেগম স্বজ্ঞানে/স্বেচ্ছায় তাহাকে পুলিশ বাহিনীতে যোগদানে অনুমতি/সম্মতি প্রদান করিল। এ বিষয়ে তাহার অভিভাবক ও তার পরিবারের কারও কোনো আপত্তি নেই।"));
  assert.ok(!html.includes('<div class="consent-grid"'), "the child-identity grid markup is gone (D9) — the CSS rule stays, English still uses the grid");
  assert.ok(!html.includes("সন্তানের নাম:"), "no child-name field label in the new model");
  assert.ok(!html.includes("করিলাম"), "no first-person consent clause — the guardian consents, not the citizen");
  assert.ok(html.includes('class="dual-sign"'), "guardian signature block sits bottom-left beside the chairman block");
  assert.ok(html.includes('class="guardian-sign-left"'), "guardian block is the name only — no dotted rule, no label");
  assert.ok(html.includes("আমি তাহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।"));

  // Purpose falls back to the schema subject label when no free-text
  // purpose is recorded (education → "শিক্ষা বিষয়ে"); the dual sign
  // still renders when the guardian name is known.
  const education = render({
    ...base19,
    payload: {
      delivery_language: "bn",
      consent_applicant: "parent",
      consent_subject: "education",
      consent_child_name_bn: "আরাফাত",
      consent_child_relation: "parent",
      consent_guardian_name_bn: "মোসাঃ জ্যোৎস্না বেগম",
    },
    schema: getServiceSchema(19),
  });
  assert.ok(education.includes("তাহাকে শিক্ষা বিষয়ে অনুমতি/সম্মতি প্রদান করিল।"));
  assert.ok(education.includes('class="dual-sign"'), "dual sign renders when the guardian name is known");

  // No guardian name recorded → the clause stays grammatical without a
  // name and the left signature block stays empty (no child-name fallback).
  const noName = render({
    ...base19,
    payload: {
      delivery_language: "bn",
      consent_applicant: "parent",
      consent_subject: "education",
      consent_child_name_bn: "আরাফাত",
      consent_child_relation: "parent",
    },
    schema: getServiceSchema(19),
  });
  assert.ok(noName.includes("তাহার অভিভাবক স্বজ্ঞানে/স্বেচ্ছায়"));
  assert.ok(!noName.includes('class="dual-sign"'), "no guardian block without a recorded guardian name");
});

test("ws-wording: service 22 unmarried + service 35 character — সে/তিনি pronouns, reference titles", () => {
  const html22 = render({
    number: "DEMO-2026-22",
    citizen: { ...belabo.citizen, full_name_bn: "মোঃ রাকিব হোসেন", gender: "male" } as PdfInput["citizen"],
    identity: { birthReg: "20016830720107777" },
    service: { service_no: 22, name_bn: "অবিবাহিত সনদ", name_en: "Unmarried certificate" },
    payload: { delivery_language: "bn" },
    schema: getServiceSchema(22),
  });
  assert.ok(html22.includes("তিনি অত্র এলাকার একজন স্থায়ী বাসিন্দা। আমার জানা মতে, বর্তমানে তিনি অবিবাহিত।"));
  assert.ok(!html22.includes("স্থানীয় তদন্ত"), "the old local-enquiry attestation is gone");
  assert.ok(html22.includes("আমি তাহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।"));

  const html35 = render({
    number: "DEMO-2026-35",
    citizen: { ...belabo.citizen, full_name_bn: "সানজিদা আক্তার", gender: "female" } as PdfInput["citizen"],
    identity: { birthReg: "20026830720106666" },
    service: { service_no: 35, name_bn: "চারিত্রিক সনদ", name_en: "Character certificate" },
    payload: { delivery_language: "bn" },
    schema: getServiceSchema(35),
  });
  assert.ok(html35.includes("চারিত্রিক সনদ</h2>"), "reference title (D12)");
  assert.ok(!html35.includes("নাগরিকত্ব ও চারিত্রিক সনদপত্র"), "the combined CERTNO-01 title is overridden for Bangla");
  assert.ok(html35.includes("সে অত্র এলাকার একজন স্থায়ী বাসিন্দা এবং জন্মসূত্রে বাংলাদেশের নাগরিক। আমার জানা মতে, তাহার স্বভাব চরিত্র ভাল এবং বর্তমানে সে অবিবাহিত।"));
  assert.ok(!html35.includes("রাষ্ট্রবিরোধী"), "the old character attestation is gone");
  assert.ok(html35.includes("আমি তাহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।"));
});

test("ws-wording: service 25 married — single paragraph, spouse first, inline dates DD-MM-YYYY", () => {
  const html = render({
    number: "DEMO-2026-25",
    citizen: {
      ...belabo.citizen,
      full_name_bn: "শেফালী বেগম",
      spouse_name_bn: "শফিউল্লা",
      father_name_bn: "বকুল মিয়া",
      mother_name_bn: "রোশেনা",
      gender: "female",
    } as PdfInput["citizen"],
    identity: {},
    service: { service_no: 25, name_bn: "বিবাহিত সনদ", name_en: "Married certificate" },
    payload: {
      delivery_language: "bn",
      marriage_info_spouse_name_bn: "শফিউল্লা",
      marriage_info_spouse_nid: "7308465371",
      marriage_info_spouse_dob: "1993-04-09",
      marriage_info_date: "2019-12-13",
    },
    schema: getServiceSchema(25),
  });
  assert.ok(html.indexOf("স্বামীঃ") < html.indexOf("পিতাঃ"), "spouse comes FIRST in the identity list (D10)");
  assert.ok(html.includes("আমার জানা মতে, বর্তমানে সে বিবাহিত। তিনি শফিউল্লা, জাতীয় পরিচয়পত্র নম্বরঃ ৭৩০৮৪৬৫৩৭১, জন্ম তারিখঃ ০৯-০৪-১৯৯৩ এর সাথে, ১৩-১২-২০১৯ তারিখে বিবাহ বন্ধনে আবদ্ধ হন।"));
  assert.ok(!html.includes('<div class="person-block"'), "the groom/bride person-block markup is gone (D10) — the CSS rule stays, English still uses the blocks");
  assert.ok(!html.includes(">বর<") && !html.includes(">কনে<"), "no groom/bride headings");
  assert.ok(html.includes("আমি তাহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।"));

  // No marriage date recorded → the closing sentence is omitted entirely
  // (the attestation ends at "সে বিবাহিত।" — no empty slots).
  const noDate = render({
    number: "DEMO-2026-25B",
    citizen: {
      ...belabo.citizen,
      full_name_bn: "শেফালী বেগম",
      spouse_name_bn: "শফিউল্লা",
      father_name_bn: "বকুল মিয়া",
      mother_name_bn: "রোশেনা",
      gender: "female",
    } as PdfInput["citizen"],
    identity: {},
    service: { service_no: 25, name_bn: "বিবাহিত সনদ", name_en: "Married certificate" },
    payload: { delivery_language: "bn", marriage_info_spouse_name_bn: "শফিউল্লা" },
    schema: getServiceSchema(25),
  });
  assert.ok(noDate.includes("বর্তমানে সে বিবাহিত।"));
  assert.ok(!noDate.includes("বিবাহ বন্ধনে আবদ্ধ হন"), "no closing sentence without a marriage date");
});

test("ws-wording: service 33 NID correction — reference title, 3-column table, fixed labels", () => {
  const html = render({
    number: "DEMO-2026-33",
    citizen: {
      ...belabo.citizen,
      full_name_bn: "সূচরিতা সূচি",
      spouse_name_bn: "রাইসুল ইসলাম",
      father_name_bn: "মোঃ ফজলু মিয়া",
      mother_name_bn: "সামসু নাহার বেগম",
      gender: "female",
      present_same_as_permanent: false,
      present_address_bn: "চর আমলাব, ডাকঘরঃ আমলাবো - ১৬৪০",
    } as PdfInput["citizen"],
    citizenGeography: {
      ...belabo.citizenGeography,
      present: {
        union: { bn: "চরউজিলাব", en: "Char Ujilabh" },
        upazila: { bn: "বেলাবো", en: "Belabo" },
        district: { bn: "নরসিংদী", en: "Narsingdi" },
        wardNo: 3,
      },
    },
    service: { service_no: 33, name_bn: "জাতীয় পরিচয়পত্র তথ্য সংশোধন", name_en: "NID correction" },
    payload: {
      delivery_language: "bn",
      corrections: [
        { correction_category_id: "name", incorrect_info: "সূচরিতা", correct_info: "সূচরিতা সূচি" },
        { correction_category_id: "name_en", incorrect_info: "Suchorita", correct_info: "Suchorita Suchi" },
        { correction_category_id: "father_name", incorrect_info: "মোঃ ফজলু", correct_info: "মোঃ ফজলু মিয়া" },
        { correction_category_id: "father_name_en", incorrect_info: "Md Fozlu", correct_info: "Md Fozlu Mia" },
      ],
    },
    schema: getServiceSchema(33),
  });
  assert.ok(html.includes("জাতীয় পরিচয়পত্র তথ্য সংশোধন</h2>"), "reference title (D21) — not a catalog change");
  assert.ok(!html.includes("জাতীয় পরিচয় তথ্য সংশোধন প্রত্যয়ন"), "the catalog title is overridden for Bangla");
  assert.ok(html.includes("ধরণ") && html.includes("ভুল তথ্য") && html.includes("সুপারিশকৃত সঠিক তথ্য"), "reference table headers");
  assert.ok(!html.includes("ক্রমিক"), "no serial column on the reference");
  assert.ok(!html.includes(">সঠিক তথ্য</th>"), "the old 'সঠিক তথ্য' header is gone");
  assert.ok(html.includes("নিজের নাম</td>"), "row 1 labels 'নিজের নাম', not 'নাম'");
  assert.ok(html.includes("নিজের নাম ইংরেজি</td>"), "name_en row label");
  assert.ok(html.includes("পিতার নাম ইংরেজি</td>"), "father_name_en row label");
  assert.ok(!html.includes("name_en") && !html.includes("father_name_en"), "no raw ids in the table");
  assert.ok(html.includes("মাতাঃ <strong>সামসু নাহার বেগম</strong> অত্র এলাকার একজন স্থায়ী বাসিন্দা।"), "resident clause directly after the mother, no comma (D11)");
  assert.ok(html.indexOf("অত্র এলাকার একজন স্থায়ী বাসিন্দা।") < html.indexOf("তাহার স্থায়ী ঠিকানাঃ-"), "resident clause comes BEFORE the addresses");
  assert.ok(html.includes("বর্তমান ঠিকানাঃ- গ্রাম/বাড়ীঃ চর আমলাব, ডাকঘরঃ আমলাবো - ১৬৪০, ওয়ার্ড নম্বরঃ ৩, চরউজিলাব ইউনিয়ন"), "present address is genuinely different");
  assert.ok(html.includes("আবেদনকারীর প্রদত্ত তথ্য মতে, তাহার জাতীয় পরিচয়পত্রে নিম্নোক্ত তথ্য ভুল লিপিবদ্ধ করা হয় এবং তাহার আবেদনের প্রেক্ষিতে তা সঠিকভাবে লিপিবদ্ধ করার সুপারিশ করা হলঃ"));
  assert.ok(html.indexOf("সুপারিশকৃত সঠিক তথ্য") < html.indexOf("আমি তাহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।"), "blessing follows the table");
});

test("ws-wording: service 37 reason phrase — free-text verbatim, code map, no fields line", () => {
  // Free-text companion wins verbatim ("জমি ক্রয় করা সূত্রে" is the
  // reference phrase; there is no land-purchase schema code — GAP-37).
  assert.strictEqual(
    transferReasonPhrase({ application_voter_area_transfer_reason: "other", application_voter_area_transfer_reason_other_bn: "জমি ক্রয় করা সূত্রে" }, true),
    "জমি ক্রয় করা সূত্রে",
  );
  assert.strictEqual(transferReasonPhrase({ application_voter_area_transfer_reason: "marriage" }, true), "বৈবাহিক সূত্রে");
  assert.strictEqual(transferReasonPhrase({ application_voter_area_transfer_reason: "employment" }, true), "চাকরির কারণে");
  assert.strictEqual(transferReasonPhrase({ application_voter_area_transfer_reason: "relocation" }, true), "বসবাসের স্থান পরিবর্তনের কারণে");
  assert.strictEqual(transferReasonPhrase({ application_voter_area_transfer_reason: "other" }, true), "");
  assert.strictEqual(transferReasonPhrase({ application_voter_area_transfer_reason: "জমি ক্রয় করা সূত্রে" }, true), "জমি ক্রয় করা সূত্রে", "an unknown value prints verbatim, never a raw code");
  const html = render({
    number: "DEMO-2026-37",
    citizen: {
      ...belabo.citizen,
      full_name_bn: "মোঃ আবদুল করিম",
      spouse_name_bn: "ফাতেমা বেগম",
      gender: "male",
    } as PdfInput["citizen"],
    identity: {},
    service: { service_no: 37, name_bn: "ভোটার এলাকা স্থানান্তর প্রত্যয়ন", name_en: "Voter area transfer" },
    payload: {
      delivery_language: "bn",
      application_voter_area_transfer_reason: "other",
      application_voter_area_transfer_reason_other_bn: "জমি ক্রয় করা সূত্রে",
    },
    schema: getServiceSchema(37),
  });
  assert.ok(html.includes("জমি ক্রয় করা সূত্রে তিনি অত্র এলাকায় স্থায়ীভাবে বসবাস করছেন এবং বাংলাদেশের নাগরিক।"));
  assert.ok(!html.includes("পূর্বের ভোটার এলাকাঃ"));
});

test("ws-wording: services 2/3 — older register, list endings, no total line, reference closings", () => {
  const warish = render({
    number: "DEMO-2026-03",
    service: { service_no: 3, name_bn: "ওয়ারিশান সনদ", name_en: "Warish certificate" },
    payload: {
      delivery_language: "bn",
      warish_info_name_bn: "মোঃ দুরুজ আলী",
      warish_info_father_name_bn: "মৃত রহমত আলী",
      warish_info_mother_name_bn: "মৃত ময়মুন নেছা",
      warish_info_spouse_name_bn: "",
      warish_info_age: "৬০",
      heirs: [
        { heir_name_bn: "মোঃ আলমগীর হোসেন", heir_relation_bn: "পুত্র", heir_age: "৩২" },
        { heir_name_bn: "মোসাঃ ফাতেমা বেগম", heir_relation_bn: "কন্যা", heir_age: "২৮" },
      ],
    },
    schema: getServiceSchema(3),
  });
  assert.ok(warish.includes("এই মর্মে প্রত্যয়ন করা যাইতেছে যে, <strong>মৃত মোঃ দুরুজ আলী</strong>, পিতা/স্বামীঃ <strong>মৃত রহমত আলী</strong>, মাতাঃ <strong>মৃত ময়মুন নেছা</strong> অত্র এলাকার একজন স্থায়ী বাসিন্দা।"));
  assert.ok(warish.includes("তাহার স্থায়ী ঠিকানাঃ- গ্রাম/বাড়ীঃ বেলাব গাংকুল পাড়া"));
  assert.ok(warish.includes("বর্তমান ঠিকানাঃ- গ্রাম/বাড়ীঃ বেলাব গাংকুল পাড়া"));
  assert.ok(warish.includes("উল্লিখিত ব্যক্তির ওয়ারিশগণের তালিকা নিম্নরূপঃ"));
  assert.ok(!warish.includes("মোট ওয়ারিশ:"), "no total line on the reference");
  assert.ok(!warish.includes("তিনি মৃত্যুবরণ করেছেন"), "no death/register sentences on the Bangla reference");
  assert.ok(warish.includes("উল্লিখিত ব্যক্তি/ব্যক্তিগণ ছাড়া আর কোনো ওয়ারিশান নাই। সকল প্রকার দেনাপাওনা/সম্পত্তি/বিষয় নিষ্পত্তি করার ব্যাপারে কেবলমাত্র উল্লিখিত ব্যক্তি/ব্যক্তিগণই ওয়ারিশান হিসেবে বিবেচিত হইবে।"));
  assert.ok(warish.includes("আমি সকল ওয়ারিশগণের মঙ্গল কামনা করিতেছি।"));
  assert.ok(warish.includes("বিঃদ্রঃ আবেদনকারী যদি ইচ্ছাকৃতভাবে কোন ওয়ারিশ বাদ দিয়ে থাকেন বা কোন ভুল তথ্য প্রদান করিয়া থাকেন তাহলে তিনি দায়ী থাকিবেন। তাহার জন্য বেলাবো ইউনিয়ন পরিষদ কার্যালয় কোন ভাবেই দায়ী থাকিবেন না এবং উক্ত সনদ বাতিল বলিয়া গণ্য করা হইবে।"));

  const family = render({
    number: "DEMO-2026-02",
    citizen: {
      ...belabo.citizen,
      full_name_bn: "মিজান মিয়া",
      father_name_bn: "মোঃ আবু তাহের",
      mother_name_bn: "মালেকা",
      gender: "male",
    } as PdfInput["citizen"],
    service: { service_no: 2, name_bn: "পারিবারিক সনদ", name_en: "Family certificate" },
    payload: {
      delivery_language: "bn",
      members: [
        { name_bn: "মিজান মিয়া", relation_bn: "নিজে", age: "৪০" },
        { name_bn: "মোসাঃ রাবেয়া বেগম", relation_bn: "স্ত্রী", age: "৩৫" },
        { name_bn: "মোঃ রাকিব হোসেন", relation_bn: "পুত্র", age: "১২" },
      ],
    },
    schema: getServiceSchema(2),
  });
  assert.ok(family.includes("এই মর্মে প্রত্যয়ন করা যাইতেছে যে, <strong>মিজান মিয়া</strong>, পিতা/স্বামীঃ <strong>মোঃ আবু তাহের</strong>, মাতাঃ <strong>মালেকা</strong> অত্র এলাকার একজন স্থায়ী বাসিন্দা।"));
  assert.ok(family.includes("উল্লিখিত ব্যক্তির পরিবারের সদস্যগণের তালিকা নিম্নরূপঃ"));
  assert.ok(!family.includes("জন পুত্র"), "no children-counts line on the reference");
  assert.ok(!family.includes("একই পরিবারের সদস্য"), "no same-family line on the reference");
  assert.ok(family.includes("উল্লিখিত সদস্য/সদস্যগণ ছাড়া আর কোনো সদস্য নাই। আবেদনকারী যদি ইচ্ছাকৃতভাবে কোন সদস্য বাদ দিয়ে থাকেন তাহলে অনুমোদনকারী কোন ভাবেই দায়ী থাকিবেন না এবং উক্ত সনদ বাতিল বলিয়া গণ্য করা হইবে।"));
  assert.ok(family.includes("আমি সকল সদস্যগণের মঙ্গল কামনা করিতেছি।"));
  assert.ok(!family.includes("বিঃদ্রঃ"), "no বিঃদ্রঃ caveat on the family reference");

  // Service 4 keeps the old behaviour (regression guard): the total line
  // still prints on the death-registration certificate.
  const service4 = render({
    number: "DEMO-2026-04",
    service: { service_no: 4, name_bn: "মৃত্যু নিবন্ধন", name_en: "Death registration" },
    payload: {
      delivery_language: "bn",
      warish_info_name_bn: "মোঃ দুরুজ আলী",
      warish_info_father_name_bn: "মৃত রহমত আলী",
      warish_info_mother_name_bn: "মৃত ময়মুন নেছা",
      warish_info_spouse_name_bn: "",
      warish_info_age: "৬০",
      heirs: [{ heir_name_bn: "মোঃ আলমগীর হোসেন", heir_relation_bn: "পুত্র", heir_age: "৩২" }],
    },
    schema: getServiceSchema(4),
  });
  assert.ok(service4.includes("মোট ওয়ারিশ: ১ জন।"));
});

test("ws-wording: blessing coverage — 21/27/45 keep the corrected তাহার spelling; helpers are map-first", () => {
  const html21 = render({
    number: "DEMO-2026-21",
    service: { service_no: 21, name_bn: "কৃষক সনদ", name_en: "Farmer certificate" },
    payload: { delivery_language: "bn", farming_activity: "ধান" },
    schema: getServiceSchema(21),
  });
  assert.ok(html21.includes(WORDING_BLESSING_BN));
  // NOTE: no "!includes('তাঁহার')" here — the generic chassis (services
  // outside the wording set) still prints "তাঁহার স্থায়ী ঠিকানাঃ" before
  // the address label, and 27's authored attestation still contains
  // "তাঁহার বিরুদ্ধে…". Both are out of this task's scope (other services'
  // wording untouched); only the blessing spelling was corrected for them.
  const html45 = render({
    number: "DEMO-2026-45",
    service: { service_no: 45, name_bn: "স্থায়ী বাসিন্দা সনদ", name_en: "Resident certificate" },
    payload: { delivery_language: "bn", residence_since: "2020-01-01" },
    schema: getServiceSchema(45),
  });
  assert.ok(html45.includes(WORDING_BLESSING_BN));
  const html27 = render({
    number: "DEMO-2026-27",
    service: { service_no: 27, name_bn: "পাসপোর্ট আবেদন প্রত্যয়ন", name_en: "Passport application certificate" },
    payload: { delivery_language: "bn", passport_purpose: "travel" },
    schema: getServiceSchema(27),
  });
  assert.ok(html27.includes(WORDING_BLESSING_BN));
  assert.ok(html27.includes("বরাবর,"), "service 27 is still the passport recommendation letter");
  assert.ok(html27.includes("বিষয়ঃ পাসপোর্ট প্রদানের সুপারিশ।"));

  // correctionFieldLabel: the fixed map is authoritative — the schema's
  // "নাম" label never overrides "নিজের নাম".
  const schema33 = getServiceSchema(33);
  assert.strictEqual(correctionFieldLabel("name", schema33, true), "নিজের নাম");
  assert.strictEqual(correctionFieldLabel("name_en", schema33, true), "নিজের নাম ইংরেজি");
  assert.strictEqual(correctionFieldLabel("father_name_en", schema33, true), "পিতার নাম ইংরেজি");
  assert.strictEqual(correctionFieldLabel("father_name", schema33, true), "পিতার নাম");
  assert.strictEqual(correctionFieldLabel("date_of_birth", schema33, true), "জন্ম তারিখ");
  // consentGuardianPurpose: free text wins; code maps to "{label} বিষয়ে";
  // nothing recorded → empty (no invented purpose).
  const schema19 = getServiceSchema(19);
  assert.strictEqual(
    consentGuardianPurpose({ consent_guardian_purpose_bn: "পুলিশ বাহিনীতে যোগদানে", consent_subject: "other" }, schema19, true),
    "পুলিশ বাহিনীতে যোগদানে",
  );
  assert.strictEqual(consentGuardianPurpose({ consent_subject: "education" }, schema19, true), "শিক্ষা বিষয়ে");
  assert.strictEqual(consentGuardianPurpose({}, schema19, true), "");
  // deceasedName prefixes once, never twice.
  assert.strictEqual(deceasedName("মোঃ দুরুজ আলী"), "মৃত মোঃ দুরুজ আলী");
  assert.strictEqual(deceasedName("মৃত মোঃ দুরুজ আলী"), "মৃত মোঃ দুরুজ আলী");
  assert.strictEqual(deceasedName(""), "");
});

test("ws-wording: English chassis is unchanged — service 12 EN keeps the old model", () => {
  const html = render({
    number: "DEMO-2026-EN12",
    service: { service_no: 12, name_bn: "নাগরিকত্ব সনদ", name_en: "Citizenship certificate" },
    payload: { delivery_language: "en", citizenship_basis: "জন্মসূত্রে" },
    schema: getServiceSchema(12),
  });
  assert.ok(html.includes("This is to certify that"));
  assert.ok(html.includes("National ID No: <strong>2405134038</strong>"), "English keeps the NID segment");
  assert.ok(html.includes("I wish the certificate holder every success and prosperity."));
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
    // CERTNO-DDMM (owner order, 25 Nov 2026): 14 consecutive digits —
    // Asia/Dhaka DDMM (day+month) + 10 random digits.
    assert.match(number, /^\d{14}$/);
    const [, dhakaMonth, dhakaDay] = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(new Date())
      .split("-");
    assert.equal(number.slice(0, 4), `${dhakaDay}${dhakaMonth}`);
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
