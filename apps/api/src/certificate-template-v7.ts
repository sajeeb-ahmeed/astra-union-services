import {
  type FormSchema,
  type FieldDefinition,
  isFieldVisible,
  getServiceSchema,
} from "@astra/shared-schemas";
import type { PdfInput, GeoNameParts } from "./certificate-template.js";
import {
  certificateAssetsBundle,
  type CertificateAssetsBundle,
} from "./template-assets.js";

/**
 * Template 7 (Phase Y) — the official Union Parishad document format, modelled
 * on owner-supplied Belabo UP documents issued through the incumbent system.
 * The FORMAT and the two captured wording patterns (citizenship #12, voter area
 * transfer #37) follow those documents; the product identity stays Astra's:
 * the verification line and QR use Astra's own origin, and no Prottoyon
 * branding appears anywhere.
 *
 * Exactness scope (PHASEY-SPEC.md): wording is captured ONLY for #12 (by-birth
 * variant) and #37 (marriage variant). Every other attestation sentence is
 * AUTHORED in standard UP phrasing and is OWNER-APPROVAL-PENDING — see
 * AUTHORED_ATTESTATION_SERVICES. Page size/orientation is per-service data
 * (CERTIFICATE_PAGE_FORMATS), never a global. Template 6 stays selectable.
 *
 * Modes (ISSUANCE_MODE gate, unchanged): official mode prints the
 * government emblem in the header; other modes render no state artwork.
 *
 * CERTNO-01 (owner-approved 18 Nov 2026): the centre watermark is the
 * Government of Bangladesh emblem, large and faint, in official mode — the
 * same for every office; the office's own seal is NOT printed anywhere (the
 * office logo stays in the header). The certificate number is 16 digits and
 * prints one digit per box in a strip (Bengali digits on the Bangla version,
 * English digits on the English version). The citizen photo (migration 051)
 * prints top-right only when the citizen has one; when absent, nothing at
 * all renders in the photo position.
 */
export const TEMPLATE_V7 = 7;

const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
export const bnDigits = (value: unknown) =>
  String(value ?? "").replace(/\d/g, (digit) => "০১২৩৪৫৬৭৮৯"[Number(digit)]!);
export const latinDigits = (value: unknown) =>
  String(value ?? "").replace(/[০-৯]/g, (digit) =>
    String("০১২৩৪৫৬৭৮৯".indexOf(digit)),
);
export const present = (value: unknown) =>
  value !== undefined && value !== null && String(value).trim() !== "";
export const text = (value: unknown) => (present(value) ? String(value).trim() : "");

/* ---------- dates (all rendered in the office timezone, Asia/Dhaka) ---------- */
const BN_MONTHS = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];
const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function dhakaParts(when: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(when);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute") };
}
/** Bangla ordinal day as printed on the samples: ১লা, ২রা, ৩রা, ৪ঠা, ৫ই…১৮ই, ১৯শে…৩১শে. */
function bnOrdinal(day: number): string {
  if (day === 1) return "১লা";
  if (day === 2) return "২রা";
  if (day === 3) return "৩রা";
  if (day === 4) return "৪ঠা";
  if (day <= 18) return `${bnDigits(day)}ই`;
  return `${bnDigits(day)}শে`;
}
export function bnDate(when: Date): string {
  const p = dhakaParts(when);
  return `${bnOrdinal(p.day)} ${BN_MONTHS[p.month - 1]} ${bnDigits(p.year)}`;
}
export function bnDateIso(iso: unknown): string {
  const raw = text(iso);
  if (!raw) return "";
  const parsed = new Date(`${raw.slice(0, 10)}T00:00:00+06:00`);
  return Number.isNaN(parsed.getTime()) ? bnDigits(raw) : bnDate(parsed);
}
export function enDate(when: Date): string {
  const p = dhakaParts(when);
  return `${EN_MONTHS[p.month - 1]} ${p.day}, ${p.year}`;
}
export function enDateLong(when: Date): string {
  const p = dhakaParts(when);
  return `${p.day} ${EN_MONTHS[p.month - 1]} ${p.year}`;
}
export function enDateIso(iso: unknown): string {
  const raw = text(iso);
  if (!raw) return "";
  const parsed = new Date(`${raw.slice(0, 10)}T00:00:00+06:00`);
  return Number.isNaN(parsed.getTime()) ? raw : enDateLong(parsed);
}
export function issueTime(when: Date): string {
  const p = dhakaParts(when);
  const hh = String(p.hour).padStart(2, "0");
  const mm = String(p.minute).padStart(2, "0");
  return `${hh}:${mm}`;
}
/** Bangladesh fiscal year (July–June) containing the issue date. */
export function fiscalYear(when: Date): { start: number; end: number } {
  const p = dhakaParts(when);
  const start = p.month >= 7 ? p.year : p.year - 1;
  return { start, end: start + 1 };
}
export const money = (minor: unknown) =>
  present(minor) ? (Number(minor) / 100).toFixed(2) : "";

/* ---------- amount in words (CERTNO-01: figures AND words on money documents) ----------
 * South-Asian grouping (thousand / lakh / crore) in both languages. Used when
 * the applicant did not supply their own words; an applicant-supplied
 * income_info_amount_word always wins. */
const EN_ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const EN_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function enBelowHundred(n: number): string {
  if (n < 20) return EN_ONES[n]!;
  const rest = n % 10;
  return rest ? `${EN_TENS[Math.floor(n / 10)]} ${EN_ONES[rest]}` : EN_TENS[Math.floor(n / 10)]!;
}
function enBelowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (!hundreds) return enBelowHundred(rest);
  return rest ? `${EN_ONES[hundreds]} Hundred ${enBelowHundred(rest)}` : `${EN_ONES[hundreds]} Hundred`;
}
export function amountInWordsEn(amount: number): string {
  let n = Math.floor(Math.abs(Number(amount) || 0));
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1_000);
  const rest = n % 1_000;
  if (crore) parts.push(`${amountInWordsEn(crore)} Crore`);
  if (lakh) parts.push(`${enBelowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${enBelowHundred(thousand)} Thousand`);
  if (rest) parts.push(enBelowThousand(rest));
  return parts.join(" ");
}
const BN_ONES = [
  "শূন্য", "এক", "দুই", "তিন", "চার", "পাঁচ", "ছয়", "সাত", "আট", "নয়",
  "দশ", "এগারো", "বারো", "তেরো", "চৌদ্দ", "পনেরো", "ষোলো", "সতেরো", "আঠারো", "ঊনিশ",
];
const BN_TENS = ["", "", "বিশ", "ত্রিশ", "চল্লিশ", "পঞ্চাশ", "ষাট", "সত্তর", "আশি", "নব্বই"];
function bnBelowHundred(n: number): string {
  if (n < 20) return BN_ONES[n]!;
  const rest = n % 10;
  return rest ? `${BN_TENS[Math.floor(n / 10)]} ${BN_ONES[rest]}` : BN_TENS[Math.floor(n / 10)]!;
}
function bnBelowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (!hundreds) return bnBelowHundred(rest);
  return rest ? `${BN_ONES[hundreds]} শত ${bnBelowHundred(rest)}` : `${BN_ONES[hundreds]} শত`;
}
export function amountInWordsBn(amount: number): string {
  let n = Math.floor(Math.abs(Number(amount) || 0));
  if (n === 0) return "শূন্য";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1_000);
  const rest = n % 1_000;
  if (crore) parts.push(`${amountInWordsBn(crore)} কোটি`);
  if (lakh) parts.push(`${bnBelowHundred(lakh)} লক্ষ`);
  if (thousand) parts.push(`${bnBelowHundred(thousand)} হাজার`);
  if (rest) parts.push(bnBelowThousand(rest));
  return parts.join(" ");
}

/* ---------- per-service page format (data, not globals) ---------- */
export interface CertificatePageFormat {
  /** CSS @page size: a named size ("A4" | "Letter") or an explicit "Wmm Hmm" pair. */
  size: string;
  orientation: "portrait" | "landscape";
}
export const CERTIFICATE_PAGE_FORMATS: Record<number, CertificatePageFormat> = {
  // Sampled: citizenship prints on A4 landscape; voter area transfer on US Letter portrait.
  12: { size: "A4", orientation: "landscape" },
  37: { size: "Letter", orientation: "portrait" },
  // CERTNO-01 catalog: service 46 (transport permit) is a small QR card.
  46: { size: "86mm 54mm", orientation: "landscape" },
};
export const DEFAULT_PAGE_FORMAT: CertificatePageFormat = {
  size: "A4",
  orientation: "portrait",
};
export function certificatePageFormat(serviceNo?: number): CertificatePageFormat {
  return (
    (serviceNo !== undefined && CERTIFICATE_PAGE_FORMATS[serviceNo]) ||
    DEFAULT_PAGE_FORMAT
  );
}
/** Services rendered in the numbered FORM layout instead of the paragraph chassis. */
export const FORM_SERVICES = new Set([1, 41, 42, 46]);

/* ---------- chairman signature title (from the issuer's account type) ----------
 * The mapping itself lives in template-assets.ts (chairmanTitle), where the
 * engine-agnostic certificate assets bundle is composed; re-exported here so
 * this module's surface is unchanged. */
export { chairmanTitle } from "./template-assets.js";

/* ---------- attestation corpus ----------
 * CAPTURED (from the samples, verbatim pattern): #12 by-birth, #37 marriage.
 * Everything else is AUTHORED standard UP phrasing — OWNER-APPROVAL-PENDING.
 * Functions receive the payload so basis/reason/amount slots come from data. */
type AttestFn = (payload: Record<string, unknown>) => string;
type Attestation = string | AttestFn;
const run = (a: Attestation | undefined, payload: Record<string, unknown>) =>
  typeof a === "function" ? a(payload) : (a ?? "");
const joinSentences = (...parts: string[]) => parts.filter((p) => p.trim()).join(" ");

export const ATTESTATIONS_BN: Record<number, Attestation> = {
  2: "এই সনদে উল্লিখিত ব্যক্তিগণ একই পরিবারের সদস্য বলিয়া প্রত্যয়ন করা যাইতেছে।",
  5: (p) =>
    present(p.authority_delegation_letter_name_bn)
      ? `তাহার দাখিলকৃত ক্ষমতা অর্পণ পত্র অনুযায়ী ${text(p.authority_delegation_letter_name_bn)} তাহার প্রতিনিধি হিসেবে স্বীকৃত।`
      : "তাহার দাখিলকৃত ক্ষমতা অর্পণ পত্র অনুযায়ী মনোনীত ব্যক্তি তাহার প্রতিনিধি হিসেবে স্বীকৃত।",
  6: (p) => {
    // The form schema produces electricity_connection_* keys; the clause must
    // read those (bare mouza/khatiyan/daag are never produced — LIVEQA2 finding 1).
    const mouza =
      text(p.electricity_connection_mouza_name_bn) ||
      text(p.electricity_connection_mouza_name);
    return joinSentences(
      "তাহার নামে নতুন বিদ্যুৎ সংযোগ প্রদানের বিষয়ে এই কার্যালয়ের কোনো আপত্তি নাই।",
      present(mouza)
        ? `জমির বিবরণঃ মৌজাঃ ${mouza}${present(p.electricity_connection_khatiyan_no) ? `, খতিয়ান নংঃ ${bnDigits(p.electricity_connection_khatiyan_no)}` : ""}${present(p.electricity_connection_daag_no) ? `, দাগ নংঃ ${bnDigits(p.electricity_connection_daag_no)}` : ""}।`
        : "",
    );
  },
  8: "তিনি রোহিঙ্গা নাগরিক নন; তিনি বাংলাদেশের নাগরিক এবং অত্র এলাকার স্থায়ী বাসিন্দা।",
  9: (p) =>
    joinSentences(
      "তাহার ভোটার তথ্য যাচাই করিয়া সঠিক পাওয়া গিয়াছে।",
      present(p.voter_application_no)
        ? `ভোটার আবেদন নংঃ ${bnDigits(p.voter_application_no)}।`
        : "",
    ),
  10: (p) =>
    joinSentences(
      present(p.unemployed_since)
        ? `তিনি ${bnDateIso(p.unemployed_since)} হইতে বেকার আছেন।`
        : "তিনি বর্তমানে বেকার আছেন।",
      present(p.last_occupation) ? `তাহার সর্বশেষ পেশা ছিল ${text(p.last_occupation)}।` : "",
    ),
  11: (p) =>
    present(p.claimed_nationality)
      ? `তিনি জাতীয়তায় ${text(p.claimed_nationality)} বলিয়া প্রত্যয়ন করা যাইতেছে।`
      : "তিনি বাংলাদেশী জাতীয়তার অধিকারী বলিয়া প্রত্যয়ন করা যাইতেছে।",
  // CAPTURED (by-birth variant). Other bases fall back to the authored generic line.
  12: (p) => {
    const basis = `${text(p.citizenship_basis)} ${text(p.citizenship_basis_bn)}`;
    return /জন্ম|birth/i.test(basis) || !basis.trim()
      ? "তিনি অত্র এলাকার একজন স্থায়ী বাসিন্দা এবং জন্মসূত্রে বাংলাদেশী নাগরিক।"
      : "তিনি অত্র এলাকার একজন স্থায়ী বাসিন্দা এবং বাংলাদেশের নাগরিক।";
  },
  13: (p) =>
    present(p.application_husband_name_bn)
      ? `তিনি ${text(p.application_husband_name_bn)} এর সহিত পুনরায় বিবাহ বন্ধনে আবদ্ধ হইয়াছেন।`
      : "তিনি পুনরায় বিবাহ বন্ধনে আবদ্ধ হইয়াছেন।",
  14: "তিনি ভূমিহীন; তাহার নিজের নামে কোনো জমি নাই বলিয়া প্রত্যয়ন করা যাইতেছে।",
  15: "তিনি অত্র এলাকার ভোটার তালিকায় নতুন ভোটার হিসেবে নিবন্ধনের যোগ্য বলিয়া প্রত্যয়ন করা যাইতেছে।",
  16: (p) =>
    joinSentences(
      present(p.deceased_spouse_name)
        ? `তাহার স্বামী ${text(p.deceased_spouse_name)} মৃত্যুবরণ করিয়াছেন।`
        : "",
      present(p.spouse_death_date) ? `মৃত্যুর তারিখঃ ${bnDateIso(p.spouse_death_date)}।` : "",
      "তিনি বিধবা।",
    ),
  17: (p) =>
    present(p.profession_bn)
      ? `তিনি পেশায় একজন ${text(p.profession_bn)}।`
      : "তাহার পেশা আবেদনে উল্লিখিত অনুযায়ী প্রত্যয়ন করা যাইতেছে।",
  18: (p) =>
    present(p.community_name)
      ? `তিনি ${text(p.community_name)} সম্প্রদায়ের সদস্য।`
      : "তিনি আবেদনে উল্লিখিত সম্প্রদায়ের সদস্য।",
  19: (p) =>
    present(p.consent_applicant_name_bn)
      ? `${text(p.consent_applicant_name_bn)} অভিভাবক হিসেবে উক্ত বিষয়ে সম্মতি প্রদান করিয়াছেন বলিয়া প্রত্যয়ন করা যাইতেছে।`
      : "অভিভাবক হিসেবে তিনি উক্ত বিষয়ে সম্মতি প্রদান করিয়াছেন বলিয়া প্রত্যয়ন করা যাইতেছে।",
  20: (p) =>
    joinSentences(
      "তিনি একজন বীর মুক্তিযোদ্ধা।",
      present(p.freedom_fighter_id_number) ? `মুক্তিযোদ্ধা পরিচিতি নংঃ ${bnDigits(p.freedom_fighter_id_number)}।` : "",
      present(p.freedom_fighter_batch) ? `ব্যাচঃ ${bnDigits(p.freedom_fighter_batch)}।` : "",
      present(p.freedom_fighter_certificate_number) ? `মুক্তিযোদ্ধা সনদ নংঃ ${bnDigits(p.freedom_fighter_certificate_number)}।` : "",
      present(p.freedom_fighter_certificate_given_date) ? `সনদ প্রদানের তারিখঃ ${bnDateIso(p.freedom_fighter_certificate_given_date)}।` : "",
      present(p.freedom_fighter_muktibarta_number) ? `মুক্তিবার্তা নংঃ ${bnDigits(p.freedom_fighter_muktibarta_number)}।` : "",
      present(p.freedom_fighter_indian_gazette) ? `ভারতীয় গেজেটঃ ${text(p.freedom_fighter_indian_gazette)}।` : "",
      present(p.freedom_fighter_gazette_number) ? `গেজেট নংঃ ${bnDigits(p.freedom_fighter_gazette_number)}।` : "",
      present(p.other_freedom_fighter_name_bn)
        ? `তিনি অপর মুক্তিযোদ্ধা ${text(p.other_freedom_fighter_name_bn)}${present(p.other_freedom_fighter_relation) ? ` (${text(p.other_freedom_fighter_relation)})` : ""} এর সহিত সম্পর্কিত।`
        : "",
    ),
  21: (p) =>
    present(p.farming_activity)
      ? `তিনি পেশায় একজন কৃষক এবং ${text(p.farming_activity)} এর সহিত জড়িত।`
      : "তিনি পেশায় একজন কৃষক।",
  22: "তিনি অবিবাহিত; তিনি কখনো বিবাহ বন্ধনে আবদ্ধ হন নাই।",
  23: (p) => {
    // CERTNO-01 catalog: the amount prints in figures AND words — the
    // applicant's own words win, otherwise the words are generated. The
    // guardian variant (other_person) certifies the guardian's income.
    const words = present(p.income_info_amount_word)
      ? text(p.income_info_amount_word)
      : present(p.income_info_amount)
        ? amountInWordsBn(Number(p.income_info_amount))
        : "";
    const subject =
      p.other_person === true
        ? present(p.other_person_name_bn)
          ? `তাহার অভিভাবক ${text(p.other_person_name_bn)} এর`
          : "তাহার অভিভাবকের"
        : "তাহার";
    return joinSentences(
      present(p.income_info_amount)
        ? `${subject} বার্ষিক আয় ${bnDigits(Number(p.income_info_amount).toLocaleString("en-IN"))} টাকা (কথায়ঃ ${words})।`
        : "তাহার বার্ষিক আয় আবেদনে উল্লিখিত অনুযায়ী।",
      present(p.profession_bn) ? `তাহার পেশাঃ ${text(p.profession_bn)}।` : "",
    );
  },
  24: "তিনি এতিম বলিয়া প্রত্যয়ন করা যাইতেছে।",
  25: (p) =>
    joinSentences(
      present(p.marriage_info_spouse_name_bn)
        ? `তিনি ${text(p.marriage_info_spouse_name_bn)} এর সহিত বিবাহ বন্ধনে আবদ্ধ আছেন।`
        : "তিনি বিবাহিত।",
      present(p.marriage_info_spouse_dob) ? `স্বামী/স্ত্রীর জন্ম তারিখঃ ${bnDateIso(p.marriage_info_spouse_dob)}।` : "",
      present(p.marriage_info_spouse_nid) ? `স্বামী/স্ত্রীর জাতীয় পরিচয়পত্র নংঃ ${bnDigits(p.marriage_info_spouse_nid)}।` : "",
      present(p.marriage_info_spouse_place_bn) ? `বিবাহের স্থানঃ ${text(p.marriage_info_spouse_place_bn)}।` : "",
      present(p.marriage_info_date) ? `বিবাহের তারিখঃ ${bnDateIso(p.marriage_info_date)}।` : "",
    ),
  26: (p) =>
    joinSentences(
      run(ATTESTATIONS_BN[25]!, p),
      "উক্ত বিবাহ যৌতুক বিহীনভাবে সম্পন্ন হইয়াছে।",
    ),
  27: "পাসপোর্ট প্রদানের উদ্দেশ্যে তাহার তথ্য যাচাই করিয়া সঠিক পাওয়া গিয়াছে।",
  28: (p) =>
    joinSentences(
      "তিনি জীবিত আছেন।",
      present(p.appearance_date)
        ? `তিনি ${bnDateIso(p.appearance_date)} তারিখে এই কার্যালয়ে সশরীরে উপস্থিত হইয়াছিলেন।`
        : "",
    ),
  29: (p) => {
    const words = present(p.income_info_amount_word)
      ? text(p.income_info_amount_word)
      : present(p.income_info_amount)
        ? amountInWordsBn(Number(p.income_info_amount))
        : "";
    const subject =
      p.other_person === true
        ? present(p.other_person_name_bn)
          ? `তাহার অভিভাবক ${text(p.other_person_name_bn)} এর`
          : "তাহার অভিভাবকের"
        : "তাহার";
    return present(p.income_info_amount)
      ? `${subject} মাসিক আয় ${bnDigits(Number(p.income_info_amount).toLocaleString("en-IN"))} টাকা (কথায়ঃ ${words})।`
      : "তাহার মাসিক আয় আবেদনে উল্লিখিত অনুযায়ী।";
  },
  30: (p) =>
    joinSentences(
      present(p.declared_assets_bdt)
        ? `তাহার ঘোষিত সম্পদ ${bnDigits(Number(p.declared_assets_bdt).toLocaleString("en-IN"))} টাকা (কথায়ঃ ${amountInWordsBn(Number(p.declared_assets_bdt))})।`
        : "",
      present(p.declared_liabilities_bdt)
        ? `ঘোষিত দায় ${bnDigits(Number(p.declared_liabilities_bdt).toLocaleString("en-IN"))} টাকা (কথায়ঃ ${amountInWordsBn(Number(p.declared_liabilities_bdt))})।`
        : "",
      present(p.financial_basis) ? `আর্থিক ভিত্তিঃ ${text(p.financial_basis)}।` : "",
      "তিনি আর্থিকভাবে স্বচ্ছল বলিয়া প্রত্যয়ন করা যাইতেছে।",
    ),
  32: (p) =>
    joinSentences(
      present(p.monthly_household_income_bdt)
        ? `তাহার পরিবারের মাসিক আয় ${bnDigits(Number(p.monthly_household_income_bdt).toLocaleString("en-IN"))} টাকা (কথায়ঃ ${amountInWordsBn(Number(p.monthly_household_income_bdt))})।`
        : "",
      "তিনি আর্থিকভাবে অস্বচ্ছল বলিয়া প্রত্যয়ন করা যাইতেছে।",
    ),
  34: "তাহার কোনো সন্তান নাই; তিনি নিঃসন্তান বলিয়া প্রত্যয়ন করা যাইতেছে।",
  35: "তিনি সচ্চরিত্রের অধিকারী; তাহার আচরণ সম্পর্কে কোনো অভিযোগ জানা নাই।",
  36: (p) =>
    present(p.noc_org_name_bn ?? p.noc_org_name)
      ? `${text(p.noc_org_name_bn ?? p.noc_org_name)} এর কার্যক্রমে এই কার্যালয়ের কোনো আপত্তি নাই।`
      : "আবেদনে উল্লিখিত প্রতিষ্ঠানের কার্যক্রমে এই কার্যালয়ের কোনো আপত্তি নাই।",
  // CAPTURED pattern; only the marriage reason phrase is sampled — the rest are authored.
  37: (p) => {
    const reason = text(p.application_voter_area_transfer_reason);
    const phrase =
      reason === "marriage"
        ? "বৈবাহিক সূত্রে"
        : reason === "employment"
          ? "চাকরির কারণে"
          : reason === "relocation"
            ? "বসবাসের স্থান পরিবর্তনের কারণে"
            : "";
    return joinSentences(
      `${phrase} তিনি অত্র এলাকায় স্থায়ীভাবে বসবাস করছেন এবং বাংলাদেশের নাগরিক।`,
      "তাহার পূর্বের ভোটার এলাকা পরিবর্তন করে অত্র এলাকার ভোটার হিসেবে নিবন্ধন করা যায়।",
    );
  },
  38: (p) =>
    joinSentences(
      "তিনি একজন প্রতিবন্ধী ব্যক্তি।",
      present(p.support_needs) ? `তাহার প্রয়োজনীয় সহায়তাঃ ${text(p.support_needs)}।` : "",
    ),
  39: (p) =>
    present(p.spi_name_bn)
      ? `আবেদনে উল্লিখিত ${text(p.spi_name_bn)} এবং তিনি একই ব্যক্তি বলিয়া প্রত্যয়ন করা যাইতেছে।`
      : "আবেদনে উল্লিখিত নামসমূহ একই ব্যক্তির বলিয়া প্রত্যয়ন করা যাইতেছে।",
  40: (p) =>
    present(p.community_name)
      ? `তিনি ${text(p.community_name)} উপজাতি সম্প্রদায়ের সদস্য।`
      : "তিনি আবেদনে উল্লিখিত উপজাতি সম্প্রদায়ের সদস্য।",
  43: "তাহার নাম ভোটার তালিকা হইতে বাদ পড়িয়াছে; তাহাকে পুনরায় ভোটার তালিকায় অন্তর্ভুক্ত করা যায় বলিয়া প্রত্যয়ন করা যাইতেছে।",
  44: "তিনি পুনরায় বিবাহ বন্ধনে আবদ্ধ হন নাই বলিয়া প্রত্যয়ন করা যাইতেছে।",
  45: (p) =>
    present(p.residence_since)
      ? `তিনি ${bnDateIso(p.residence_since)} হইতে অত্র এলাকায় স্থায়ীভাবে বসবাস করিতেছেন।`
      : "তিনি অত্র এলাকার একজন স্থায়ী বাসিন্দা।",
};

export const ATTESTATIONS_EN: Record<number, Attestation> = {
  2: "The persons listed in this certificate are members of the same family.",
  5: (p) =>
    present(p.authority_delegation_letter_name_en ?? p.authority_delegation_letter_name)
      ? `Under the submitted letter of authority, ${text(p.authority_delegation_letter_name_en ?? p.authority_delegation_letter_name)} is recognised as the representative.`
      : "Under the submitted letter of authority, the nominated person is recognised as the representative.",
  6: (p) => {
    const mouza =
      text(p.electricity_connection_mouza_name) ||
      text(p.electricity_connection_mouza_name_bn);
    return joinSentences(
      "This office has no objection to a new electricity connection being provided in this name.",
      present(mouza)
        ? `Land details: Mouza: ${mouza}${present(p.electricity_connection_khatiyan_no) ? `, Khatiyan No: ${text(p.electricity_connection_khatiyan_no)}` : ""}${present(p.electricity_connection_daag_no) ? `, Daag No: ${text(p.electricity_connection_daag_no)}` : ""}.`
        : "",
    );
  },
  8: "The person is not a Rohingya citizen; the person is a citizen of Bangladesh and a permanent resident of this area.",
  9: (p) =>
    joinSentences(
      "The voter information has been verified and found correct.",
      present(p.voter_application_no) ? `Voter application no: ${text(p.voter_application_no)}.` : "",
    ),
  10: (p) =>
    joinSentences(
      present(p.unemployed_since)
        ? `The person has been unemployed since ${enDateIso(p.unemployed_since)}.`
        : "The person is currently unemployed.",
      present(p.last_occupation) ? `Last occupation: ${text(p.last_occupation)}.` : "",
    ),
  11: (p) =>
    present(p.claimed_nationality)
      ? `The person's nationality is ${text(p.claimed_nationality)}.`
      : "The person holds Bangladeshi nationality.",
  12: (p) => {
    const basis = `${text(p.citizenship_basis)} ${text(p.citizenship_basis_bn)}`;
    return /জন্ম|birth/i.test(basis) || !basis.trim()
      ? "The person is a permanent resident of this area and a citizen of Bangladesh by birth."
      : "The person is a permanent resident of this area and a citizen of Bangladesh.";
  },
  13: (p) =>
    present(p.application_husband_name_en ?? p.application_husband_name)
      ? `The person has remarried to ${text(p.application_husband_name_en ?? p.application_husband_name)}.`
      : "The person has remarried.",
  14: "The person is landless and owns no land.",
  15: "The person is eligible to be registered as a new voter in the voter list of this area.",
  16: (p) =>
    joinSentences(
      present(p.deceased_spouse_name) ? `The person's spouse ${text(p.deceased_spouse_name)} has died.` : "",
      present(p.spouse_death_date) ? `Date of death: ${enDateIso(p.spouse_death_date)}.` : "",
      "The person is a widow.",
    ),
  17: (p) =>
    present(p.profession_en ?? p.profession)
      ? `The person's occupation is ${text(p.profession_en ?? p.profession)}.`
      : "The person's occupation is as stated in the application.",
  18: (p) =>
    present(p.community_name)
      ? `The person is a member of the ${text(p.community_name)} community.`
      : "The person is a member of the community stated in the application.",
  19: (p) =>
    present(p.consent_applicant_name)
      ? `${text(p.consent_applicant_name)}, as guardian, has given consent in this matter.`
      : "As guardian, the person has given consent in this matter.",
  20: (p) =>
    joinSentences(
      "The person is a valiant freedom fighter.",
      present(p.freedom_fighter_id_number) ? `Freedom fighter ID no: ${text(p.freedom_fighter_id_number)}.` : "",
      present(p.freedom_fighter_batch) ? `Batch: ${text(p.freedom_fighter_batch)}.` : "",
      present(p.freedom_fighter_certificate_number) ? `Freedom fighter certificate no: ${text(p.freedom_fighter_certificate_number)}.` : "",
      present(p.freedom_fighter_certificate_given_date) ? `Certificate date: ${enDateIso(p.freedom_fighter_certificate_given_date)}.` : "",
      present(p.freedom_fighter_muktibarta_number) ? `Muktibarta no: ${text(p.freedom_fighter_muktibarta_number)}.` : "",
      present(p.freedom_fighter_indian_gazette) ? `Indian gazette: ${text(p.freedom_fighter_indian_gazette)}.` : "",
      present(p.freedom_fighter_gazette_number) ? `Gazette no: ${text(p.freedom_fighter_gazette_number)}.` : "",
      present(p.other_freedom_fighter_name)
        ? `The person is related to the fellow freedom fighter ${text(p.other_freedom_fighter_name)}${present(p.other_freedom_fighter_relation) ? ` (${text(p.other_freedom_fighter_relation)})` : ""}.`
        : "",
    ),
  21: (p) =>
    present(p.farming_activity)
      ? `The person is a farmer engaged in ${text(p.farming_activity)}.`
      : "The person is a farmer by occupation.",
  22: "The person is unmarried and has never been married.",
  23: (p) => {
    // CERTNO-01 catalog: figures AND words (applicant's words win, else
    // generated); the guardian variant certifies the guardian's income.
    const words = present(p.income_info_amount_word)
      ? text(p.income_info_amount_word)
      : present(p.income_info_amount)
        ? amountInWordsEn(Number(p.income_info_amount))
        : "";
    const subject =
      p.other_person === true
        ? present(p.other_person_name)
          ? `The annual income of the guardian, ${text(p.other_person_name)}, is`
          : "The guardian's annual income is"
        : "Annual income is";
    return joinSentences(
      present(p.income_info_amount)
        ? `${subject} BDT ${Number(p.income_info_amount).toLocaleString("en-IN")} (in words: ${words}).`
        : "Annual income is as stated in the application.",
      present(p.profession_en ?? p.profession) ? `Occupation: ${text(p.profession_en ?? p.profession)}.` : "",
    );
  },
  24: "The person is an orphan.",
  25: (p) =>
    joinSentences(
      present(p.marriage_info_spouse_name_en ?? p.marriage_info_spouse_name)
        ? `The person is married to ${text(p.marriage_info_spouse_name_en ?? p.marriage_info_spouse_name)}.`
        : "The person is married.",
      present(p.marriage_info_spouse_dob) ? `Spouse's date of birth: ${enDateIso(p.marriage_info_spouse_dob)}.` : "",
      present(p.marriage_info_spouse_nid) ? `Spouse's NID no: ${text(p.marriage_info_spouse_nid)}.` : "",
      present(p.marriage_info_spouse_place) ? `Place of marriage: ${text(p.marriage_info_spouse_place)}.` : "",
      present(p.marriage_info_date) ? `Date of marriage: ${enDateIso(p.marriage_info_date)}.` : "",
    ),
  26: (p) => joinSentences(run(ATTESTATIONS_EN[25]!, p), "The marriage was completed without dowry."),
  27: "The information has been verified and found correct for the purpose of passport issuance.",
  28: (p) =>
    joinSentences(
      "The person is alive.",
      present(p.appearance_date)
        ? `The person appeared in person at this office on ${enDateIso(p.appearance_date)}.`
        : "",
    ),
  29: (p) => {
    const words = present(p.income_info_amount_word)
      ? text(p.income_info_amount_word)
      : present(p.income_info_amount)
        ? amountInWordsEn(Number(p.income_info_amount))
        : "";
    const subject =
      p.other_person === true
        ? present(p.other_person_name)
          ? `The monthly income of the guardian, ${text(p.other_person_name)}, is`
          : "The guardian's monthly income is"
        : "Monthly income is";
    return present(p.income_info_amount)
      ? `${subject} BDT ${Number(p.income_info_amount).toLocaleString("en-IN")} (in words: ${words}).`
      : "Monthly income is as stated in the application.";
  },
  30: (p) =>
    joinSentences(
      present(p.declared_assets_bdt)
        ? `Declared assets: BDT ${Number(p.declared_assets_bdt).toLocaleString("en-IN")} (in words: ${amountInWordsEn(Number(p.declared_assets_bdt))}).`
        : "",
      present(p.declared_liabilities_bdt)
        ? `Declared liabilities: BDT ${Number(p.declared_liabilities_bdt).toLocaleString("en-IN")} (in words: ${amountInWordsEn(Number(p.declared_liabilities_bdt))}).`
        : "",
      present(p.financial_basis) ? `Financial basis: ${text(p.financial_basis)}.` : "",
      "The person is financially solvent.",
    ),
  32: (p) =>
    joinSentences(
      present(p.monthly_household_income_bdt)
        ? `Monthly household income is BDT ${Number(p.monthly_household_income_bdt).toLocaleString("en-IN")} (in words: ${amountInWordsEn(Number(p.monthly_household_income_bdt))}).`
        : "",
      "The person is in financial hardship.",
    ),
  34: "The person has no children.",
  35: "The person is of good character and no complaint is known against the person's conduct.",
  36: (p) =>
    present(p.noc_org_name)
      ? `This office has no objection to the activities of ${text(p.noc_org_name)}.`
      : "This office has no objection to the activities of the organisation stated in the application.",
  37: (p) => {
    const reason = text(p.application_voter_area_transfer_reason);
    const phrase =
      reason === "marriage"
        ? "By marriage,"
        : reason === "employment"
          ? "For employment,"
          : reason === "relocation"
            ? "Following a change of residence,"
            : "";
    return joinSentences(
      `${phrase} the person resides permanently in this area and is a citizen of Bangladesh.`,
      "The previous voter area may be changed so that the person is registered as a voter of this area.",
    );
  },
  38: (p) =>
    joinSentences(
      "The person is a person with a disability.",
      present(p.support_needs) ? `Support needs: ${text(p.support_needs)}.` : "",
    ),
  39: (p) =>
    present(p.spi_name_en ?? p.spi_name)
      ? `The names stated in the application, including ${text(p.spi_name_en ?? p.spi_name)}, belong to one and the same person.`
      : "The names stated in the application belong to one and the same person.",
  40: (p) =>
    present(p.community_name)
      ? `The person is a member of the ${text(p.community_name)} indigenous community.`
      : "The person is a member of the indigenous community stated in the application.",
  43: "The person's name was omitted from the voter list and may be re-included in the voter list of this area.",
  44: "The person has not remarried.",
  45: (p) =>
    present(p.residence_since)
      ? `The person has resided permanently in this area since ${enDateIso(p.residence_since)}.`
      : "The person is a permanent resident of this area.",
};

/** Services whose attestation sentence is AUTHORED (not captured) — owner approval pending. */
export const AUTHORED_ATTESTATION_SERVICES = Object.keys(ATTESTATIONS_BN)
  .map(Number)
  .filter((no) => no !== 12 && no !== 37);

/* ---------- address composition (samples' pattern; post office/postcode omitted — no dataset) ---------- */
export function addressBn(freeText: unknown, parts?: GeoNameParts): string {
  const seg: string[] = [];
  if (present(freeText)) seg.push(`গ্রাম/বাড়ীঃ ${text(freeText)}`);
  if (parts?.wardNo) seg.push(`ওয়ার্ড নম্বরঃ ${bnDigits(parts.wardNo)}`);
  if (parts?.union?.bn) seg.push(`${parts.union.bn} ইউনিয়ন`);
  if (parts?.upazila?.bn) seg.push(`থানাঃ ${parts.upazila.bn}`);
  if (parts?.upazila?.bn) seg.push(`উপজেলাঃ ${parts.upazila.bn}`);
  if (parts?.district?.bn) seg.push(`জেলাঃ ${parts.district.bn}`);
  return seg.join(", ");
}
export function addressEn(freeText: unknown, parts?: GeoNameParts): string {
  const seg: string[] = [];
  if (present(freeText)) seg.push(`Village/House: ${text(freeText)}`);
  if (parts?.wardNo) seg.push(`Ward No: ${parts.wardNo}`);
  if (parts?.union?.en) seg.push(`${parts.union.en} Union`);
  if (parts?.upazila?.en) seg.push(`Thana: ${parts.upazila.en}`);
  if (parts?.upazila?.en) seg.push(`Upazila: ${parts.upazila.en}`);
  if (parts?.district?.en) seg.push(`District: ${parts.district.en}`);
  return seg.join(", ");
}

export interface DocContext {
  input: PdfInput;
  bn: boolean;
  issued: Date;
  official: boolean;
  origin: string;
  numberDisplay: string;
  officeName: string;
  officeAddressLine: string;
}

export function officeLine(input: PdfInput, bn: boolean): string {
  const geo = input.officeGeography;
  if (geo?.upazila && geo?.district)
    return bn
      ? `${geo.upazila.bn}, ${geo.district.bn}, বাংলাদেশ`
      : `${geo.upazila.en}, ${geo.district.en}, Bangladesh`;
  const t = input.tenant;
  if (present(t.upazila) && present(t.district))
    return `${text(t.upazila)}, ${text(t.district)}, ${bn ? "বাংলাদেশ" : "Bangladesh"}`;
  return "";
}

/** Identity segments in the samples' order; each appears only when its data exists. */
function identitySegments(ctx: DocContext): string {
  const { input, bn } = ctx;
  const c = input.citizen;
  const parts: string[] = [];
  const name = bn ? c.full_name_bn : c.full_name_en;
  parts.push(`<strong>${escape(name)}</strong>`);
  const nid = input.identity?.nid;
  const birthReg = input.identity?.birthReg;
  if (bn) {
    if (present(nid)) parts.push(`জাতীয় পরিচয়পত্র নম্বরঃ <strong>${bnDigits(nid)}</strong>`);
    else if (present(birthReg)) parts.push(`জন্ম নিবন্ধন নম্বরঃ <strong>${bnDigits(birthReg)}</strong>`);
    const spouse = c.spouse_name_bn;
    if (present(spouse))
      parts.push(`${c.gender === "male" ? "স্ত্রীঃ" : "স্বামীঃ"} <strong>${escape(spouse)}</strong>`);
    if (present(c.father_name_bn)) parts.push(`পিতাঃ <strong>${escape(c.father_name_bn)}</strong>`);
    if (present(c.mother_name_bn)) parts.push(`মাতাঃ <strong>${escape(c.mother_name_bn)}</strong>`);
  } else {
    if (present(nid)) parts.push(`National ID No: <strong>${escape(nid)}</strong>`);
    else if (present(birthReg)) parts.push(`Birth Registration No: <strong>${escape(birthReg)}</strong>`);
    const spouse = c.spouse_name_en;
    if (present(spouse)) parts.push(`Spouse: <strong>${escape(spouse)}</strong>`);
    if (present(c.father_name_en)) parts.push(`Father: <strong>${escape(c.father_name_en)}</strong>`);
    if (present(c.mother_name_en)) parts.push(`Mother: <strong>${escape(c.mother_name_en)}</strong>`);
  }
  return parts.join(", ");
}

export function permanentAddress(ctx: DocContext): string {
  const { input, bn } = ctx;
  const geo = input.citizenGeography?.permanent;
  return bn
    ? addressBn(input.citizen.address_bn, geo)
    : addressEn(input.citizen.address_en, geo);
}
export function presentAddress(ctx: DocContext): string {
  const { input, bn } = ctx;
  if (input.citizen.present_same_as_permanent === false) {
    const geo = input.citizenGeography?.present;
    return bn
      ? addressBn(input.citizen.present_address_bn, geo)
      : addressEn(input.citizen.present_address_en, geo);
  }
  return permanentAddress(ctx);
}

function dataTable(headers: string[], rows: string[][]): string {
  if (!rows.length) return "";
  return `<table class="data"><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

export function selectLabel(
  schema: FormSchema | undefined,
  fieldId: string,
  childId: string | undefined,
  value: unknown,
  bn: boolean,
): string {
  const find = (fields: readonly FieldDefinition[]): FieldDefinition | undefined => {
    for (const f of fields) {
      if (f.id === fieldId) {
        if (!childId) return f;
        return (f.children ?? []).find((c) => c.id === childId);
      }
    }
    return undefined;
  };
  const field = schema ? find(schema.sections.flatMap((s) => s.fields)) : undefined;
  const option = field?.options?.find((o) => o.value === value);
  return option ? option.label[bn ? "bn" : "en"] : text(value);
}

/** Deceased-subject chassis for services 3, 4, 7, 31 — the paragraph is about the deceased. */
function deceasedParagraph(ctx: DocContext, serviceNo: number): string {
  const { input, bn } = ctx;
  const p = input.payload;
  const prefix = serviceNo === 3 || serviceNo === 4 ? "warish_info_" : "dead_info_";
  const get = (key: string) => p[`${prefix}${key}`];
  const name = bn ? get("name_bn") : get("name");
  const father = bn ? get("father_name_bn") : get("father_name");
  const mother = bn ? get("mother_name_bn") : get("mother_name");
  const address = permanentAddress(ctx);
  const identity: string[] = [`<strong>${escape(name ?? "")}</strong>`];
  if (bn) {
    if (present(father)) identity.push(`পিতাঃ <strong>${escape(father)}</strong>`);
    if (present(mother)) identity.push(`মাতাঃ <strong>${escape(mother)}</strong>`);
  } else {
    if (present(father)) identity.push(`Father: <strong>${escape(father)}</strong>`);
    if (present(mother)) identity.push(`Mother: <strong>${escape(mother)}</strong>`);
  }
  const dod = get("dod");
  const registerNo = get("register_no");
  const sentences: string[] = [];
  if (serviceNo === 7 || serviceNo === 31) {
    const place = bn ? get("place_bn") : get("place");
    const reason = bn ? get("reason_bn") : get("reason");
    if (bn) {
      sentences.push(
        `তিনি ${present(dod) ? `${bnDateIso(dod)} তারিখে ` : ""}${present(place) ? `${text(place)} এ ` : ""}মৃত্যুবরণ করিয়াছেন।`,
      );
      if (present(reason)) sentences.push(`মৃত্যুর কারণঃ ${text(reason)}।`);
      if (serviceNo === 31) sentences.push("তিনি অবিবাহিত অবস্থায় মৃত্যুবরণ করিয়াছেন।");
      if (present(registerNo)) sentences.push(`মৃত্যু নিবন্ধন নংঃ ${bnDigits(registerNo)}।`);
    } else {
      sentences.push(
        `The person died${present(dod) ? ` on ${enDateIso(dod)}` : ""}${present(place) ? ` at ${text(place)}` : ""}.`,
      );
      if (present(reason)) sentences.push(`Cause of death: ${text(reason)}.`);
      if (serviceNo === 31) sentences.push("The person died unmarried.");
      if (present(registerNo)) sentences.push(`Death registration no: ${text(registerNo)}.`);
    }
  } else {
    if (bn) {
      sentences.push(
        `তিনি মৃত্যুবরণ করিয়াছেন${present(dod) ? ` (মৃত্যুর তারিখঃ ${bnDateIso(dod)})` : ""}। তাহার ওয়ারিশগণ নিম্নরূপ:`,
      );
      if (present(registerNo)) sentences.push(`নিবন্ধন নংঃ ${bnDigits(registerNo)}।`);
    } else {
      sentences.push(
        `The person has died${present(dod) ? ` (date of death: ${enDateIso(dod)})` : ""}. The legal heirs are as follows:`,
      );
      if (present(registerNo)) sentences.push(`Registration no: ${text(registerNo)}.`);
    }
  }
  const intro = bn
    ? `এই মর্মে প্রত্যয়ন করা যাইতেছে যে, ${identity.join(", ")}, ঠিকানাঃ- ${address}।`
    : `This is to certify that ${identity.join(", ")}, of address: ${address}.`;
  if (serviceNo === 31) {
    // CERTNO-01 catalog §31: the applicant (the citizen) is identified with
    // their relation to the deceased.
    const applicant = bn ? input.citizen.full_name_bn : input.citizen.full_name_en;
    const relation = selectLabel(
      input.schema ?? getServiceSchema(31),
      "dead_info_relation",
      undefined,
      p.dead_info_relation,
      bn,
    );
    sentences.push(
      bn
        ? `আবেদনকারী ${text(applicant)}${present(relation) ? ` মৃতের ${relation}` : ""}।`
        : `The applicant, ${text(applicant)}, is the ${relation || "relative"} of the deceased.`,
    );
  }
  let table = "";
  if (serviceNo === 3 || serviceNo === 4) {
    const heirs = Array.isArray(p.heirs) ? (p.heirs as Record<string, unknown>[]) : [];
    const schema = input.schema ?? getServiceSchema(serviceNo);
    // CERTNO-01 catalog §§3–4: relation prints as its label; the NID and
    // mobile columns appear only when at least one heir carries them.
    const withNid = heirs.some((h) => present(h.warish_heir_nid));
    const withMobile = heirs.some((h) => present(h.warish_heir_mobile_no));
    const rows = heirs.map((h, i) => {
      const row = [
        bn ? bnDigits(i + 1) : String(i + 1),
        text(bn ? h.warish_heir_name_bn : h.warish_heir_name),
        selectLabel(schema, "heirs", "warish_heir_relation", h.warish_heir_relation, bn),
        bn ? bnDigits(h.warish_heir_dob) : text(h.warish_heir_dob),
        text(h.warish_heir_father_name),
      ];
      if (withNid) row.push(bn ? bnDigits(h.warish_heir_nid) : text(h.warish_heir_nid));
      if (withMobile) row.push(bn ? bnDigits(h.warish_heir_mobile_no) : text(h.warish_heir_mobile_no));
      return row;
    });
    const headers = bn
      ? ["ক্রমিক", "ওয়ারিশের নাম", "সম্পর্ক", "জন্ম তারিখ", "পিতার নাম"]
      : ["Sl", "Heir's name", "Relation", "Date of birth", "Father's name"];
    if (withNid) headers.push(bn ? "জাতীয় পরিচয়পত্র নম্বর" : "NID No");
    if (withMobile) headers.push(bn ? "মোবাইল নম্বর" : "Mobile No");
    table = dataTable(headers, rows);
    sentences.push(
      bn
        ? serviceNo === 4
          ? "উল্লিখিত ব্যক্তিগণই তাহার আইনগত উত্তরাধিকারী; তাহাদের ছাড়া আর কোনো ওয়ারিশ আছে বলিয়া জানা যায় না।"
          : "উল্লিখিত ব্যক্তিগণ ছাড়া তাহার আর কোনো ওয়ারিশ আছে বলিয়া জানা যায় না।"
        : serviceNo === 4
          ? "The persons listed are the legal successors; no other heir is known."
          : "No other heir is known besides the persons listed.",
    );
  }
  return `<p class="body-para">${intro} ${sentences.join(" ")}</p>${table}`;
}

/** The paragraph chassis — the default for attestation-type services. */
function paragraphBody(ctx: DocContext, serviceNo: number): string {
  const { input, bn } = ctx;
  const p = input.payload;
  if (serviceNo === 3 || serviceNo === 4 || serviceNo === 7 || serviceNo === 31)
    return deceasedParagraph(ctx, serviceNo);
  if (serviceNo === 47) {
    const body = text(bn ? p.certificate_details_bn : p.certificate_details_en);
    const footer = text(bn ? p.certificate_footer_bn : p.certificate_footer_en);
    return `<p class="body-para">${escape(body).replace(/\n/g, "<br>")}</p>${footer ? `<p class="free-footer">${escape(footer)}</p>` : ""}`;
  }
  if (serviceNo === 27) {
    // CERTNO-01 (owner decision D5): service 27 is a recommendation LETTER
    // addressed to the passport office, not a certificate paragraph.
    const purpose = text(p.passport_purpose);
    const closing = bn
      ? "আমি তাহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।"
      : "I wish the person every success and prosperity.";
    const letter = bn
      ? `<p class="body-para">বরাবর,<br>সহকারী পরিচালক,<br>আঞ্চলিক পাসপোর্ট অফিস।</p><p class="body-para"><strong>বিষয়ঃ পাসপোর্ট প্রদানের সুপারিশ।</strong></p><p class="body-para">এই মর্মে সুপারিশ করা যাইতেছে যে, ${identitySegments(ctx)}, তাহার <strong>স্থায়ী ঠিকানাঃ-</strong> ${escape(permanentAddress(ctx))}। <strong>বর্তমান ঠিকানাঃ-</strong> ${escape(presentAddress(ctx))}। তিনি পাসপোর্টের জন্য আবেদন করিয়াছেন${purpose ? ` (উদ্দেশ্যঃ ${escape(purpose)})` : ""}। তাহার বিরুদ্ধে কোনো ফৌজদারি অভিযোগ জানা নাই। তাহাকে পাসপোর্ট প্রদানে এই কার্যালয়ের কোনো আপত্তি নাই।</p>`
      : `<p class="body-para">To,<br>The Assistant Director,<br>Regional Passport Office.</p><p class="body-para"><strong>Subject: Recommendation for passport issuance.</strong></p><p class="body-para">This is to recommend that ${identitySegments(ctx)}, whose <strong>permanent address is:</strong> ${escape(permanentAddress(ctx))}. <strong>Present address:</strong> ${escape(presentAddress(ctx))}. The person has applied for a passport${purpose ? ` (purpose: ${escape(purpose)})` : ""}. No criminal complaint is known against the person. This office has no objection to a passport being issued to the person.</p>`;
    return `${letter}<p class="closing">${escape(closing)}</p>`;
  }
  const attestation = run(bn ? ATTESTATIONS_BN[serviceNo] : ATTESTATIONS_EN[serviceNo], p);
  const para = bn
    ? `এই মর্মে প্রত্যয়ন করা যাইতেছে যে, ${identitySegments(ctx)}, তাহার <strong>স্থায়ী ঠিকানাঃ-</strong> ${escape(permanentAddress(ctx))}। <strong>বর্তমান ঠিকানাঃ-</strong> ${escape(presentAddress(ctx))}।${attestation ? ` ${escape(attestation)}` : ""}`
    : `This is to certify that ${identitySegments(ctx)}, whose <strong>permanent address is:</strong> ${escape(permanentAddress(ctx))}. <strong>Present address:</strong> ${escape(presentAddress(ctx))}.${attestation ? ` ${escape(attestation)}` : ""}`;
  let table = "";
  if (serviceNo === 2) {
    const members = Array.isArray(p.members) ? (p.members as Record<string, unknown>[]) : [];
    const schema = input.schema ?? getServiceSchema(2);
    // CERTNO-01 catalog §2 (SONOD variant): the ID column appears only when a
    // member record carries an identity number.
    const withId = members.some((m) => present(m.warish_heir_nid));
    const rows = members.map((m, i) => {
      const row = [
        bn ? bnDigits(i + 1) : String(i + 1),
        text(bn ? m.name_bn : m.name_en),
        selectLabel(schema, "members", "relationship", m.relationship, bn),
        bn ? bnDigits(m.dob) : text(m.dob),
      ];
      if (withId) row.push(bn ? bnDigits(m.warish_heir_nid) : text(m.warish_heir_nid));
      return row;
    });
    const headers = bn
      ? ["ক্রমিক", "সদস্যের নাম", "সম্পর্ক", "জন্ম তারিখ"]
      : ["Sl", "Member name", "Relationship", "Date of birth"];
    if (withId) headers.push(bn ? "জাতীয় পরিচয়পত্র নম্বর" : "NID No");
    table = dataTable(headers, rows);
  }
  if (serviceNo === 33) {
    const corrections = Array.isArray(p.corrections)
      ? (p.corrections as Record<string, unknown>[])
      : [];
    const rows = corrections.map((c, i) => [
      bn ? bnDigits(i + 1) : String(i + 1),
      text(c.correction_category_id),
      text(c.incorrect_info),
      text(c.correct_info),
    ]);
    const intro = bn
      ? "তাহার জাতীয় পরিচয় তথ্যে নিম্নোক্ত সংশোধন প্রয়োজন বলিয়া প্রত্যয়ন করা যাইতেছে:"
      : "The following corrections to the national identity information are required:";
    table = `<p class="body-para">${escape(intro)}</p>${dataTable(
      bn ? ["ক্রমিক", "তথ্যের ধরণ", "ভুল তথ্য", "সঠিক তথ্য"] : ["Sl", "Field", "Incorrect information", "Correct information"],
      rows,
    )}`;
    return `<p class="body-para">${para}</p>${table}`;
  }
  const closing = bn
    ? "আমি তাহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।"
    : "I wish the person every success and prosperity.";
  return `<p class="body-para">${para}</p>${table}<p class="closing">${escape(closing)}</p>`;
}

/* ---------- trade licence (service 42) — the sampled 14-field form ----------
 * Owner steers: fee component rows stay BLANK (the itemised split exists
 * nowhere in the order data — only the real total prints); the validity line
 * is omitted (no validity data is carried); the signature follows the
 * chairman-only model even though the samples print two blocks. */
function tradeLicenceBody(ctx: DocContext, qrDataUrl: string, emblem: string, logo = ""): string {
  const { input, bn, issued } = ctx;
  const p = input.payload;
  const fy = fiscalYear(issued);
  const orgGeo = input.geographyNames?.["org_location"];
  const businessAddress = [
    text(bn ? p.business_address_bn : p.business_address_en),
    orgGeo ? orgGeo[bn ? "bn" : "en"] : "",
  ]
    .filter(Boolean)
    .join(", ");
  const wardNo =
    p.trade_license_org_ward_no ?? p.trade_license_org_zone_ward ?? input.citizenGeography?.permanent?.wardNo;
  const identityNo = input.identity?.nid ?? input.identity?.birthReg ?? "";
  const citizenParts = (which: "permanent" | "present") => {
    const parts =
      which === "present" && input.citizen.present_same_as_permanent !== false
        ? (input.citizenGeography?.present ?? input.citizenGeography?.permanent)
        : input.citizenGeography?.[which];
    const free = which === "permanent"
      ? (bn ? input.citizen.address_bn : input.citizen.address_en)
      : input.citizen.present_same_as_permanent === false
        ? (bn ? input.citizen.present_address_bn : input.citizen.present_address_en)
        : (bn ? input.citizen.address_bn : input.citizen.address_en);
    const rows: [string, string][] = bn
      ? [
          ["হোল্ডিং নম্বরঃ", ""],
          ["রোড নং", ""],
          ["গ্রাম/মহল্লা", text(free)],
          ["ডাকঘর", ""],
          ["পোস্ট কোড", ""],
          ["থানা", parts?.upazila?.bn ?? ""],
          ["উপজেলা", parts?.upazila?.bn ?? ""],
          ["জেলা", parts?.district?.bn ?? ""],
          ["বিভাগ", parts?.division?.bn ?? ""],
          ["দেশ", "বাংলাদেশ"],
        ]
      : [
          ["Holding No", ""],
          ["Road No", ""],
          ["Village/Area", text(free)],
          ["Post Office", ""],
          ["Post Code", ""],
          ["Police Station", parts?.upazila?.en ?? ""],
          ["Upazilla", parts?.upazila?.en ?? ""],
          ["District", parts?.district?.en ?? ""],
          ["Division", parts?.division?.en ?? ""],
          ["Country", "Bangladesh"],
        ];
    return rows.map(([label, value]) => `<div class="addr-row"><span>${escape(label)}</span><span>: ${escape(value)}</span></div>`).join("");
  };
  const field = (no: string, label: string, value: unknown, digits = false) =>
    `<tr><td class="fl">${escape(no)}. ${escape(label)}</td><td class="fv">: ${escape(digits ? bnDigits(value) : value)}</td></tr>`;
  const sub = (label: string, value: unknown, digits = false) =>
    `<tr><td class="fl sub">${escape(label)}</td><td class="fv">: ${escape(digits ? bnDigits(value) : value)}</td></tr>`;
  const total = input.order ? money(input.order.totalMinor) : "";
  const totalDisplay = bn ? bnDigits(total) : total;
  const labels = bn
    ? {
        issueTitle: "লাইসেন্স ইস্যুর বিবরণ",
        issueDate: "ইস্যুর তারিখ",
        issueTime: "ইস্যুর সময়",
        statute: "ইউনিয়ন পরিষদ আদর্শ কর তফসিল ২০১৩ মোতাবেক",
        noLabel: "ট্রেড লাইসেন্স নং",
        fields: [
          "ব্যবসা প্রতিষ্ঠানের নাম", "মালিক/স্বত্বাধিকারীর নাম", "মাতার নাম", "পিতার নাম",
          "স্পাউজের নাম (প্রযোজ্য ক্ষেত্রে)", "ব্যবসার প্রকৃতি (একক/যৌথ/অন্যান্য)", "ব্যবসার ধরণ",
          "ব্যবসা প্রতিষ্ঠানের ঠিকানা",
        ],
        zone: "(ক) অঞ্চল (প্রযোজ্য ক্ষেত্রে)", ward: "(খ) ওয়ার্ড নং",
        idA: "(ক) জন্ম নিবন্ধন/এনআইডি/পাসপোর্ট নং", idB: "(খ) টিআইএন", idC: "(গ) বিআইএন",
        idD: "(ঘ) টেলিফোন/মোবাইল নম্বর", idE: "(ঙ) ই-মেইল",
        fyA: "(ক) অর্থ বছর", fyB: "(খ) ব্যবসা শুরুর তারিখ",
        presentHead: "মালিক/স্বত্বাধিকারীর বর্তমান ঠিকানা", permanentHead: "মালিক/স্বত্বাধিকারীর স্থায়ী ঠিকানা",
        serial: "আদর্শ কর তফসিল, ২০১৩ এর ক্রমিক নং",
        feeHead: "ট্রেড লাইসেন্স ফি (নতুন/নবায়ন)",
        feesL: ["নতুন", "নবায়ন", "বকেয়া", "সারচার্জ", "সংশোধন ফি"],
        feesR: ["সাইনবোর্ড (পরিচিতিমূলক)", "পেশা ব্যবসা ও বৃত্তির উপর কর", "ভ্যাট", "সর্বমোট"],
        nums: ["১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯", "১০", "১১", "১২", "১৩", "১৪"],
      }
    : {
        issueTitle: "License Issue Details",
        issueDate: "Date of Issue",
        issueTime: "Issue Time",
        statute: "According to Union Parishad Model Tax Schedule 2013",
        noLabel: "Trade License No",
        fields: [
          "Business Organization Name", "Owner's/Proprietor's Name", "Mother's Name", "Father's Name",
          "Spouse's Name (If applicable)", "Nature of Business (Individual/Joint/Others)", "Business Type",
          "Address of Business Organization",
        ],
        zone: "(a) Zone (If applicable)", ward: "(b) Ward No",
        idA: "(a) Birth Registration/NID/Passport", idB: "(b) TIN", idC: "(c) BIN",
        idD: "(d) Telephone/Mobile Number", idE: "(e) E-mail",
        fyA: "(a) Fiscal Year", fyB: "(b) Business Starting Date",
        presentHead: "Present Address of Owner/Proprietor", permanentHead: "Permanent Address of Owner/Proprietor",
        serial: "Serial No. of Model Taxation Schedule, 2013",
        feeHead: "Trade License Fee (New/Renewal)",
        feesL: ["New", "Renewal", "Arrear", "Surcharge", "Amendment Fee"],
        feesR: ["Signboard Fee", "Taxes on Profession & Trades", "VAT", "Total"],
        nums: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"],
      };
  const n = labels.nums;
  const businessType = selectLabel(input.schema ?? getServiceSchema(42), "business_type", undefined, p.business_type, bn);
  return `
  <div class="tl-top">
    <img class="qr-tl" alt="" src="${escape(qrDataUrl)}">
    <div class="tl-head">
      ${logo ? `<div class="head-name">${logo}<h1>${escape(ctx.officeName)}</h1></div>` : `<h1>${escape(ctx.officeName)}</h1>`}
      <div class="office-address">${escape(ctx.officeAddressLine)}</div>
      ${emblem}
      <h2 class="doc-title">${escape(bn ? input.service.name_bn : input.service.name_en)}</h2>
      <div class="tl-no">${escape(labels.noLabel)}: ${numberStripHtml(input.number, bn)}</div>
    </div>
    ${input.citizenPhoto ? `<img class="citizen-photo tl-photo" alt="" src="${input.citizenPhoto}">` : `<div class="tl-spacer"></div>`}
  </div>
  <div class="tl-issue"><strong>${escape(labels.issueTitle)}</strong><br>${escape(labels.issueDate)}: ${escape(bn ? bnDate(issued) : enDate(issued))}<br>${escape(labels.issueTime)}: ${escape(bn ? bnDigits(issueTime(issued)) : issueTime(issued))}</div>
  <div class="statute">${escape(labels.statute)}</div>
  <table class="fields">
    ${field(n[0]!, labels.fields[0]!, bn ? p.business_name_bn : p.business_name_en)}
    ${field(n[1]!, labels.fields[1]!, bn ? p.proprietor_name_bn : p.proprietor_name_en)}
    ${field(n[2]!, labels.fields[2]!, bn ? p.proprietor_mother_name_bn : p.proprietor_mother_name)}
    ${field(n[3]!, labels.fields[3]!, bn ? p.proprietor_father_name_bn : p.proprietor_father_name)}
    ${field(n[4]!, labels.fields[4]!, bn ? p.proprietor_spouse_name_bn : p.proprietor_spouse_name)}
    ${field(n[5]!, labels.fields[5]!, bn ? p.trade_license_org_type_bn : p.trade_license_org_type)}
    ${field(n[6]!, labels.fields[6]!, businessType)}
    ${field(n[7]!, labels.fields[7]!, businessAddress)}
    <tr><td class="fl">${n[8]}.</td><td class="fv subpair"><div><span>${escape(labels.zone)}</span><span>: ${escape(bn ? bnDigits(text(p.trade_license_org_zone_bn) || text(p.trade_license_org_zone)) : text(p.trade_license_org_zone))}</span></div><div><span>${escape(labels.ward)}</span><span>: ${escape(bn ? bnDigits(wardNo) : wardNo)}</span></div></td></tr>
    <tr><td class="fl">${n[9]}.</td><td class="fv subpair"><div><span>${escape(labels.idA)}</span><span>: ${escape(bn ? bnDigits(identityNo) : identityNo)}</span></div><div><span>${escape(labels.idB)}</span><span>: ${escape(bn ? bnDigits(text(p.trade_license_tin_no)) : text(p.trade_license_tin_no))}</span></div></td></tr>
    <tr><td class="fl"></td><td class="fv subpair"><div><span>${escape(labels.idC)}</span><span>: ${escape(bn ? bnDigits(text(p.trade_license_bin_no)) : text(p.trade_license_bin_no))}</span></div><div><span>${escape(labels.idD)}</span><span>: ${escape(bn ? bnDigits(text(p.mobile)) : text(p.mobile))}</span></div></td></tr>
    ${sub(labels.idE, p.trade_license_email)}
    <tr><td class="fl">${n[10]}.</td><td class="fv subpair"><div><span>${escape(labels.fyA)}</span><span>: ${escape(bn ? bnDigits(`${fy.start} - ${fy.end}`) : `${fy.start} - ${fy.end}`)}</span></div><div><span>${escape(labels.fyB)}</span><span>: ${escape(bn ? bnDateIso(p.start_date) : enDateIso(p.start_date))}</span></div></td></tr>
    <tr><td class="fl">${n[11]}.</td><td class="fv addr-heads"><span>${escape(labels.presentHead)}</span><span>${escape(labels.permanentHead)}</span></td></tr>
    <tr><td class="fl"></td><td class="fv addr-cols"><div>${citizenParts("present")}</div><div>${citizenParts("permanent")}</div></td></tr>
    ${field(n[12]!, labels.serial, "")}
    <tr><td class="fl">${n[13]}. ${escape(labels.feeHead)}</td><td class="fv"></td></tr>
    <tr><td colspan="2"><table class="fees"><tr>
      <td>${labels.feesL.map((label) => `<div class="fee-row"><span>${escape(label)}</span><span></span></div>`).join("")}</td>
      <td>${labels.feesR.map((label, i) => `<div class="fee-row${i === 3 ? " total" : ""}"><span>${escape(label)}</span><span>${i === 3 ? escape(totalDisplay) : ""}</span></div>`).join("")}</td>
    </tr></table></td></tr>
  </table>`;
}

/* ---------- generic numbered-form layout for the unsampled FORM services (1, 41, 46) ---------- */
function genericFormBody(ctx: DocContext): string {
  const { input, bn } = ctx;
  const schema = input.schema ?? getServiceSchema(input.service.service_no!);
  const renderFields = (
    fields: readonly FieldDefinition[],
    values: Record<string, unknown>,
    prefix = "",
  ): string =>
    fields
      .filter(
        (f) =>
          isFieldVisible(f, values) &&
          values[f.id] !== undefined &&
          !["delivery_language", "confirmation", "supporting_documents", "attachments"].includes(f.id) &&
          !(bn && (f.id.endsWith("_en") || /\(English\)$/i.test(f.label.en))) &&
          !(!bn && (f.id.endsWith("_bn") || /\(Bangla\)$/i.test(f.label.bn))),
      )
      .map((f) => {
        const value = values[f.id];
        const label = f.label[bn ? "bn" : "en"];
        if (f.type === "repeatable")
          return `<div class="gf-section"><h4>${escape(label)}</h4>${(value as Record<string, unknown>[]).map((row) => `<div class="gf-row">${renderFields(f.children ?? [], row, `${prefix}${f.id}.`)}</div>`).join("")}</div>`;
        let out: unknown = value;
        if (f.type === "geography")
          out = input.geographyNames?.[`${prefix}${f.id}`]?.[bn ? "bn" : "en"] ?? "";
        else if (f.type === "checkbox") out = bn ? (value ? "হ্যাঁ" : "না") : value ? "Yes" : "No";
        else if (f.type === "select")
          out = f.options?.find((o) => o.value === value)?.label[bn ? "bn" : "en"] ?? value;
        else if (bn && (f.type === "date" || f.type === "number")) out = bnDigits(value);
        return `<div class="gf-field"><span>${escape(label)}</span><span>: ${escape(out)}</span></div>`;
      })
      .join("");
  const sections = schema.sections
    .map((section) => {
      const body = renderFields(section.fields, input.payload);
      return body ? `<div class="gf-section"><h4>${escape(section.title[bn ? "bn" : "en"])}</h4>${body}</div>` : "";
    })
    .join("");
  const total = input.order
    ? `<div class="gf-field total"><span>${bn ? "সর্বমোট ফি" : "Total fee"}</span><span>: ${escape(bn ? bnDigits(money(input.order.totalMinor)) : money(input.order.totalMinor))}</span></div>`
    : "";
  return `<div class="generic-form">${sections}${total}</div>`;
}

/* ---------- CERTNO-01 shared pieces: digit strip, photo, form meta line ---------- */

/**
 * The certificate number printed one digit per box. Applies when the number
 * (after an optional DEMO- marker) is exactly 16 digits; any other stored
 * number (legacy issues) prints as plain text exactly as before.
 */
export function numberStripHtml(number: string, bn: boolean): string {
  const match = /^(DEMO-)?(\d{16})$/.exec(number);
  if (!match) return escape(bn ? bnDigits(number) : latinDigits(number));
  const digits = match[2]!
    .split("")
    .map((d) => `<i>${escape(bn ? bnDigits(d) : d)}</i>`)
    .join("");
  return `${match[1] ? `<span class="numstrip-prefix">DEMO-</span>` : ""}<span class="numstrip">${digits}</span>`;
}

/** The citizen photo, top-right — or nothing at all when the citizen has none. */
export function citizenPhotoHtml(input: PdfInput, extraClass = ""): string {
  return input.citizenPhoto
    ? `<img class="citizen-photo${extraClass ? ` ${extraClass}` : ""}" alt="" src="${input.citizenPhoto}">`
    : "";
}

/** Number + issue-date line for the FORM layouts (the paragraph chassis has its own). */
function formMetaLine(ctx: DocContext): string {
  const { bn, issued } = ctx;
  return `<div class="numline"><span class="numline-no">${bn ? "নং:-" : "No:"} ${numberStripHtml(ctx.input.number, bn)}</span><span>${bn ? "তারিখ:-" : "Date:"} ${escape(bn ? bnDate(issued) : enDate(issued))}</span></div>`;
}

/* ---------- service 1: holding-tax receipt (আদায় রশিদ) — CERTNO-01 catalog §1 ----------
 * The application data carries one holding, one tax year and the property
 * description; the amount is the order total. The year-wise table therefore
 * has the single assessed year — no year is ever invented. */
function taxReceiptBody(ctx: DocContext): string {
  const { input, bn } = ctx;
  const p = input.payload;
  const totalTaka = input.order ? Number(input.order.totalMinor) / 100 : null;
  const totalFig = totalTaka !== null ? totalTaka.toLocaleString("en-IN") : "";
  const totalWords =
    totalTaka !== null ? (bn ? amountInWordsBn(totalTaka) : amountInWordsEn(totalTaka)) : "";
  const row = (label: string, value: string) =>
    `<div class="gf-field"><span>${escape(label)}</span><span>: ${escape(value)}</span></div>`;
  const yearRow =
    present(p.tax_year) || totalTaka !== null
      ? `<tr><td>${escape(bn ? bnDigits(p.tax_year) : text(p.tax_year))}</td><td>${totalTaka !== null ? escape(bn ? bnDigits(totalFig) : totalFig) : ""}</td><td>${totalTaka !== null ? escape(bn ? bnDigits(totalFig) : totalFig) : ""}</td></tr>`
      : "";
  return `<div class="generic-form">
    ${citizenPhotoHtml(input)}
    ${formMetaLine(ctx)}
    ${row(bn ? "করদাতার নাম" : "Taxpayer", bn ? input.citizen.full_name_bn : input.citizen.full_name_en)}
    ${row(bn ? "হোল্ডিং নম্বর" : "Holding No", bn ? bnDigits(p.holding_reference) : text(p.holding_reference))}
    ${row(bn ? "সম্পত্তির বিবরণ" : "Property description", text(p.property_description))}
    <table class="data"><thead><tr><th>${bn ? "করের বছর" : "Tax year"}</th><th>${bn ? "ধার্যকৃত কর (টাকা)" : "Assessed tax (BDT)"}</th><th>${bn ? "আদায়কৃত (টাকা)" : "Collected (BDT)"}</th></tr></thead><tbody>${yearRow}<tr><td><strong>${bn ? "সর্বমোট" : "Total"}</strong></td><td></td><td><strong>${escape(bn ? bnDigits(totalFig) : totalFig)}</strong></td></tr></tbody></table>
    ${totalTaka !== null ? `<p class="body-para">${bn ? `কথায়ঃ ${escape(totalWords)} টাকা মাত্র।` : `In words: ${escape(totalWords)} Taka only.`}</p>` : ""}
  </div>`;
}

/* ---------- service 41: premises licence on the trade-licence layout (owner decision D4) ---------- */
function premisesLicenceBody(ctx: DocContext): string {
  const { input, bn, issued } = ctx;
  const p = input.payload;
  const fy = fiscalYear(issued);
  const orgGeo = input.geographyNames?.["org_location"];
  const field = (label: string, value: unknown, digits = false) =>
    `<tr><td class="fl">${escape(label)}</td><td class="fv">: ${escape(digits ? bnDigits(value) : value)}</td></tr>`;
  const total = input.order ? money(input.order.totalMinor) : "";
  return `<div class="tl-doc">
    ${citizenPhotoHtml(input)}
    ${formMetaLine(ctx)}
    <table class="fields">
      ${field(bn ? "লাইসেন্সধারী" : "Licensee", bn ? p.primises_license_proprietor_bn : p.primises_license_proprietor)}
      ${field(bn ? "প্রতিষ্ঠানের নাম" : "Establishment", bn ? p.primises_license_org_name_bn : p.primises_license_org_name)}
      ${field(bn ? "প্রতিষ্ঠানের ধরণ" : "Business type", bn ? p.primises_license_org_type_bn : p.primises_license_org_type)}
      ${field(bn ? "প্রাঙ্গণের ঠিকানা" : "Premises address", bn ? p.primises_license_org_area_holding_bn : p.primises_license_org_area_holding)}
      ${orgGeo ? field(bn ? "এলাকা" : "Area", orgGeo[bn ? "bn" : "en"]) : ""}
      ${field(bn ? "মূলধন (টাকা)" : "Capital (BDT)", bn ? bnDigits(p.primises_license_capital) : p.primises_license_capital)}
      ${field(bn ? "টিআইএন" : "TIN", p.primises_license_tin_no, true)}
      ${field(bn ? "ওয়ার্ড নং" : "Ward No", p.primises_license_org_ward_no, true)}
      ${total ? field(bn ? "সর্বমোট ফি (টাকা)" : "Total fee (BDT)", bn ? bnDigits(total) : total) : ""}
    </table>
    <p class="body-para">${bn ? `মেয়াদঃ ${bnDigits(fy.start)} সালের ১লা জুলাই হইতে ${bnDigits(fy.end)} সালের ৩০শে জুন পর্যন্ত।` : `Validity: 1 July ${fy.start} to 30 June ${fy.end}.`}</p>
  </div>`;
}

/* ---------- service 46: transport permit QR card — CERTNO-01 catalog §46 ---------- */
function transportCardBody(ctx: DocContext, qrDataUrl: string): string {
  const { input, bn } = ctx;
  const p = input.payload;
  const line = (label: string, value: string) =>
    value ? `<div class="tcard-line"><span>${escape(label)}</span><span>: ${escape(value)}</span></div>` : "";
  return `<div class="tcard">
    <img class="qr-tcard" alt="" src="${escape(qrDataUrl)}">
    <div class="tcard-main">
      <div class="tcard-office">${escape(ctx.officeName)}</div>
      <div class="tcard-title">${escape(bn ? input.service.name_bn : input.service.name_en)}</div>
      ${line(bn ? "লাইসেন্স নং" : "Licence No", bn ? bnDigits(p.transport_license_no) : text(p.transport_license_no))}
      ${line(bn ? "যানবাহন" : "Vehicle", text(bn ? p.transport_license_transport_name_bn : p.transport_license_transport_name))}
      ${line(bn ? "ইঞ্জিন নং" : "Engine No", bn ? bnDigits(p.engine_no) : text(p.engine_no))}
      ${line(bn ? "মালিক" : "Proprietor", text(bn ? input.citizen.full_name_bn : input.citizen.full_name_en))}
      <div class="tcard-no">${numberStripHtml(input.number, bn)}</div>
    </div>
    ${citizenPhotoHtml(input, "tcard-photo")}
  </div>`;
}

/* ---------- document assembly ---------- */
export function renderCertificateHtmlV7(input: PdfInput, qrDataUrl: string): string {
  const official = process.env.ISSUANCE_MODE === "official";
  const bn = input.payload.delivery_language !== "en"; // samples are single-language; bilingual renders Bangla (flagged)
  const serviceNo = input.service.service_no ?? 0;
  const format = certificatePageFormat(serviceNo);
  const issued = input.issuedAt ? new Date(input.issuedAt) : new Date();
  const origin = (() => {
    try {
      return new URL(input.verificationUrl).origin;
    } catch {
      return input.verificationUrl.replace(/\/verify\/.*$/, "");
    }
  })();
  const ctx: DocContext = {
    input,
    bn,
    issued,
    official,
    origin,
    numberDisplay: bn ? bnDigits(input.number) : latinDigits(input.number),
    officeName: bn ? input.tenant.name_bn : input.tenant.name_en,
    officeAddressLine: officeLine(input, bn),
  };
  const verifyUrl = `${origin}/verify?searchText=${ctx.numberDisplay}`;
  // CERTASSETS-01: artwork and chairman identity for the document come from
  // the one engine-agnostic bundle (template-assets.ts) — office-profile
  // uploads outrank the legacy filesystem drop-ins. CERTNO-01: the bundle's
  // seal/watermark fields are no longer printed — the centre watermark is
  // the bundle's government emblem (see the emblem-wm render below) and the
  // seal appears nowhere. Artwork prints only in official mode; the chairman
  // name/designation print in every mode, as before.
  const bundle: CertificateAssetsBundle = certificateAssetsBundle(
    input.tenant.id,
    input.assets,
    input.issuer,
  );
  const emblemUrl = official ? bundle.emblem : null;
  const emblem = emblemUrl ? `<img class="emblem" alt="" src="${emblemUrl}">` : "";
  const logo = official && bundle.logo
    ? `<img class="office-logo" alt="" src="${bundle.logo}">`
    : "";
  const headName = logo
    ? `<div class="head-name">${logo}<h1>${escape(ctx.officeName)}</h1></div>`
    : `<h1>${escape(ctx.officeName)}</h1>`;
  const title =
    serviceNo === 47
      ? text(bn ? input.payload.certificate_type_bn : input.payload.certificate_type_en) ||
        (bn ? input.service.name_bn : input.service.name_en)
      : serviceNo === 35
        ? // CERTNO-01 (owner decision D2): service 35 prints the combined title.
          bn
          ? "নাগরিকত্ব ও চারিত্রিক সনদপত্র"
          : "Citizenship and Character Certificate"
        : bn
          ? input.service.name_bn
          : input.service.name_en;
  const isTrade = serviceNo === 42;
  const formHeader = `<header class="up-head">${emblem}${headName}<div class="office-address">${escape(ctx.officeAddressLine)}</div><h2 class="doc-title">${escape(title)}</h2></header>`;
  const body = FORM_SERVICES.has(serviceNo)
    ? isTrade
      ? tradeLicenceBody(ctx, qrDataUrl, emblem, logo)
      : serviceNo === 1
        ? `${formHeader}${taxReceiptBody(ctx)}`
        : serviceNo === 41
          ? `${formHeader}${premisesLicenceBody(ctx)}`
          : serviceNo === 46
            ? transportCardBody(ctx, qrDataUrl)
            : `${formHeader}${genericFormBody(ctx)}`
    : `${formHeader}
       <div class="numline"><span class="numline-no">${bn ? "সনদ নং:-" : "Certificate No:"} ${numberStripHtml(input.number, bn)}</span><span>${bn ? "ইস্যুর তারিখ:-" : "Date of Issue:"} ${escape(bn ? bnDate(issued) : enDate(issued))}</span></div>
       ${citizenPhotoHtml(input)}
       ${paragraphBody(ctx, serviceNo)}`;
  const issuerName = bn
    ? bundle.chairmanNameBn || bundle.chairmanNameEn || ""
    : bundle.chairmanNameEn || bundle.chairmanNameBn || "";
  const signImg = official && bundle.signature
    ? `<img class="sign-img" alt="" src="${bundle.signature}">`
    : "";
  const signature = `<aside class="sign-block">
    ${issuerName ? `<div class="sign-name">${escape(issuerName)}</div>` : ""}
    ${signImg}
    <div class="sign-line"></div>
    <div class="sign-title">${escape(bn ? bundle.chairmanDesignationBn : bundle.chairmanDesignationEn)}</div>
    <div class="sign-office">${escape(ctx.officeName)}</div>
    ${ctx.officeAddressLine ? `<div class="sign-address">${escape(ctx.officeAddressLine)}</div>` : ""}
  </aside>`;
  const verifyLine = isTrade && !bn
    ? `Issued from: ${verifyUrl}`
    : bn
      ? `যাচাইকরণ: ${verifyUrl}`
      : `Verification: ${verifyUrl}`;
  const foot =
    serviceNo === 46
      ? // The transport card is self-contained (QR + number on the card).
        ""
      : isTrade
        ? `${signature}<footer class="doc-foot tl-foot"><div class="verify-line">${escape(verifyLine)}</div></footer>`
        : `${signature}<footer class="doc-foot"><img class="qr" alt="" src="${escape(qrDataUrl)}"><div class="verify-line">${escape(verifyLine)}</div></footer>`;
  const bannerBits = "";
  const honesty = "";
  // CERTNO-01: the centre watermark is the Government of Bangladesh emblem —
  // large and faint, the same for every office. The office seal is not
  // printed anywhere on the document.
  const sealImg = official && bundle.emblem
    ? `<img class="emblem-wm" alt="" src="${bundle.emblem}">`
    : "";
  const pageSize = format.size.includes("mm")
    ? format.size
    : format.orientation === "landscape"
      ? `${format.size} landscape`
      : format.size;
  return `<!doctype html><html lang="${bn ? "bn" : "en"}"><head><meta charset="UTF-8"><style>
@page{size:${pageSize};margin:${serviceNo === 46 ? "3mm" : isTrade ? "8mm" : "11mm"}}
*{box-sizing:border-box}
body{font-family:'Nirmala UI','Noto Sans Bengali',sans-serif;color:#101418;margin:0;font-size:14.5px;line-height:1.75}
.frame{position:fixed;inset:0;border:1.1px solid #1a1a1a;outline:2.6px solid #1a1a1a;outline-offset:2.6px;z-index:2;pointer-events:none}
.emblem-wm{position:fixed;left:50%;top:54%;transform:translate(-50%,-50%);width:105mm;opacity:.07;z-index:0}
.numline-no{display:flex;align-items:center;gap:2mm}
.numstrip{display:inline-flex;gap:1mm}
.numstrip i{font-style:normal;border:.7px solid #333;width:5mm;height:6.2mm;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12.5px;line-height:1}
.numstrip-prefix{font-weight:700}
.citizen-photo{float:right;width:26mm;height:32mm;object-fit:cover;border:.6px solid #555;margin:1mm 0 3mm 4mm}
.citizen-photo.tl-photo{float:none;flex:none;margin:0}
.tcard{display:flex;gap:3mm;align-items:flex-start;padding:1mm}
.qr-tcard{width:17mm;height:17mm;flex:none}
.tcard-main{flex:1;font-size:9.5px;line-height:1.45}
.tcard-office{font-weight:700;font-size:10.5px}
.tcard-title{font-weight:700}
.tcard-line{display:flex;gap:1.5mm}
.tcard-line span:first-child{flex:none;font-weight:600}
.tcard-no{margin-top:1mm}
.tcard .numstrip i{width:3.6mm;height:4.6mm;font-size:9px;border-width:.5px}
.citizen-photo.tcard-photo{float:none;width:16mm;height:20mm;margin:0}
.head-name{display:flex;align-items:center;justify-content:center;gap:4mm}
.office-logo{height:13mm;max-width:20mm;object-fit:contain}
.sign-img{display:block;height:11mm;max-width:42mm;object-fit:contain;margin:0 auto .5mm}
.draft-wm{position:fixed;left:24%;top:42%;transform:rotate(-30deg);font:bold 68px sans-serif;color:rgba(179,38,30,.09);z-index:0}
main{position:relative;z-index:1;padding:5mm 6mm}
.draft-banner{border:2px solid #b3261e;color:#b3261e;padding:6px;text-align:center;font:bold 14px sans-serif;margin-bottom:4mm}
.up-head{text-align:center}
.emblem{width:15mm;height:15mm;object-fit:contain;display:block;margin:0 auto 1.5mm}
h1{font-size:21px;margin:0;line-height:1.4}
.office-address{font-size:13.5px}
.doc-title{font-size:19px;margin:3.5mm 0 0;line-height:1.4}
.numline{display:flex;justify-content:space-between;font-weight:600;margin:4.5mm 0 2.5mm}
.body-para{text-align:justify;margin:0}
.closing{margin:5mm 0 0}
.free-footer{font-size:12px;margin-top:4mm}
table.data{width:100%;border-collapse:collapse;margin-top:4mm;font-size:12.5px;line-height:1.5}
table.data th,table.data td{border:1px solid #5b6b60;padding:1.1mm 2mm;text-align:left}
.sign-block{margin:11mm 0 0 auto;width:64mm;text-align:center;font-size:13px;line-height:1.55}
.sign-name{font-weight:700;font-size:14.5px}
.sign-line{border-top:1.6px dotted #333;margin:1.6mm 5mm 1.6mm}
.sign-office{font-weight:600}
.doc-foot{display:flex;align-items:flex-end;gap:6mm;margin-top:7mm}
.qr{width:21mm;height:21mm;flex:none}
.verify-line{flex:1;text-align:center;font-size:11.5px;overflow-wrap:anywhere}
.honesty{font-size:10px;text-align:center;color:#444;margin-top:3mm}
.tl-top{display:flex;align-items:flex-start;gap:4mm}
.qr-tl{width:19mm;height:19mm;flex:none}
.tl-head{flex:1;text-align:center}
.tl-head h1{font-size:19.5px}
.tl-spacer{width:19mm;flex:none}
.tl-no{font-weight:700;margin-top:1.5mm}
.tl-issue{font-size:12px;line-height:1.5;margin-top:1mm}
.statute{border:1.6px solid #1a1a1a;text-align:center;font-weight:700;padding:1.2mm;margin:3mm 0;font-size:13.5px}
table.fields{width:100%;border-collapse:collapse;font-size:12.8px;line-height:1.5}
table.fields td{padding:.55mm 1mm;vertical-align:top}
td.fl{width:64mm;font-weight:600}
td.fl.sub{font-weight:400;padding-left:9mm}
td.fv{overflow-wrap:anywhere}
.addr-heads span{display:inline-block;width:49%;font-weight:700}
.addr-cols{display:flex;gap:4mm}
.addr-cols>div{flex:1}
.addr-row{display:flex;gap:2mm}
.addr-row span:first-child{width:30mm;flex:none}
table.fees{width:100%;border-collapse:collapse}
table.fees td{width:50%;vertical-align:top;padding:0 3mm 0 0}
td.subpair{display:flex;gap:5mm}
td.subpair>div{flex:1;display:flex;gap:2mm;min-width:0}
td.subpair>div span:first-child{flex:none}
td.subpair>div span:last-child{flex:1;min-width:16mm;overflow-wrap:normal}
.tl-doc .statute{margin:1.6mm 0;padding:1mm}
.tl-doc h1{font-size:19px}
.tl-doc .doc-title{font-size:17px;margin-top:2mm}
.tl-doc table.fields{font-size:11.6px;line-height:1.32}
.tl-doc table.fields td{padding:.3mm 1mm}
.tl-doc .addr-row{line-height:1.32}
.tl-doc .fee-row{padding:.25mm 0}
.tl-doc .sign-block{margin-top:2mm}
.tl-doc .doc-foot{margin-top:1mm}
.tl-doc .verify-line{font-size:11px}
.tl-doc .tl-issue{margin-top:.5mm;line-height:1.35}
.fee-row{display:flex;justify-content:space-between;border-bottom:.6px dotted #888;padding:.4mm 0}
.fee-row.total{font-weight:700}
.generic-form{font-size:12.8px;line-height:1.55;margin-top:3mm}
.gf-section h4{margin:3mm 0 1mm;font-size:13px}
.gf-field{display:flex;gap:2mm}
.gf-field span:first-child{width:58mm;flex:none;font-weight:600}
.gf-field.total{font-weight:700;margin-top:2mm}
.gf-row{border-top:.6px dotted #999;padding:1mm 0}
.tl-foot{margin-top:5mm}
.card-doc{padding:2mm 3mm}
</style></head><body><div class="frame"></div>${sealImg}${bannerBits}<main data-template="7" data-delivery-language="${bn ? "bn" : "en"}"${isTrade ? ' class="tl-doc"' : serviceNo === 46 ? ' class="card-doc"' : ""}>${body}${foot}${honesty}</main></body></html>`;
}
