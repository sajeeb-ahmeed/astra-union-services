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
/**
 * CERT-REFINE-01 (A5): long dates print WITHOUT the ordinal suffix — modern
 * official usage is "১৮ নভেম্বর ২০২৬", not "১৮ই নভেম্বর ২০২৬".
 */
export function bnDate(when: Date): string {
  const p = dhakaParts(when);
  return `${bnDigits(p.day)} ${BN_MONTHS[p.month - 1]} ${bnDigits(p.year)}`;
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
/** CERT-REFINE-01 (A5): table dates print DD/MM/YYYY in both languages. */
export function bnDateSlash(iso: unknown): string {
  const raw = text(iso);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return match ? bnDigits(`${match[3]}/${match[2]}/${match[1]}`) : bnDigits(raw);
}
export function enDateSlash(iso: unknown): string {
  const raw = text(iso);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw;
}
/**
 * CERT-REFINE-01 (A9): a free-text value is inserted into a sentence that
 * appends its own punctuation — strip any trailing danda/full stop the
 * applicant typed so the document never prints "।।" or "..".
 */
export const cleanText = (value: unknown) =>
  text(value).replace(/[\s।.]+$/u, "");
/** CERT-REFINE-01: the A1 government header line, printed above the office name. */
export const GOVT_LINE_BN = "গণপ্রজাতন্ত্রী বাংলাদেশ সরকার";
export const GOVT_LINE_EN = "Government of the People's Republic of Bangladesh";
/** Relationship option labels (the shared relationship select's stable value set). */
export const RELATIONSHIP_LABELS: Record<string, { bn: string; en: string }> = {
  self: { bn: "নিজ", en: "Self" },
  spouse: { bn: "স্বামী/স্ত্রী", en: "Spouse" },
  child: { bn: "সন্তান", en: "Child" },
  parent: { bn: "পিতা/মাতা", en: "Parent" },
  sibling: { bn: "ভাই/বোন", en: "Sibling" },
  other: { bn: "অন্যান্য", en: "Other" },
  // QAFIX-05 (§4 item 9): the guardian list (services 19/24) adds these
  // codes; the certificate prints their labels, never the raw codes.
  grandparent: { bn: "দাদা/দাদি/নানা/নানি", en: "Grandparent" },
  uncle: { bn: "চাচা/মামা", en: "Uncle" },
  aunt: { bn: "চাচি/মামি/খালা", en: "Aunt" },
  guardian: { bn: "অভিভাবক", en: "Guardian" },
};
export const relationshipLabel = (value: unknown, bn: boolean) => {
  const entry = RELATIONSHIP_LABELS[text(value)];
  return entry ? (bn ? entry.bn : entry.en) : cleanText(value);
};
/** Delegation subject labels (service 5's subject select value set). */
export const DELEGATION_SUBJECT_LABELS: Record<string, { bn: string; en: string }> = {
  document_collection: { bn: "নথি সংগ্রহ", en: "document collection" },
  representation: { bn: "প্রতিনিধিত্ব", en: "representation" },
  other: { bn: "অন্যান্য", en: "other" },
};
/** Marital-status labels (the shared marital status select value set). */
export const MARITAL_LABELS: Record<string, { bn: string; en: string }> = {
  unmarried: { bn: "অবিবাহিত", en: "Unmarried" },
  married: { bn: "বিবাহিত", en: "Married" },
  widowed: { bn: "বিধবা/বিপত্নীক", en: "Widowed" },
  divorced: { bn: "তালাকপ্রাপ্ত", en: "Divorced" },
};
/**
 * QAFIX-03 (§4 item 9): declared-nationality labels for service 11. From
 * schema v5 the declared nationality is a closed select; the certificate
 * prints the chosen value's label in the document's own language.
 * Payloads pinned to earlier versions carry free text instead — the
 * attestation falls back to printing that text verbatim.
 */
export const NATIONALITY_LABELS: Record<string, { bn: string; en: string }> = {
  bangladeshi: { bn: "বাংলাদেশি", en: "Bangladeshi" },
  indian: { bn: "ভারতীয়", en: "Indian" },
  pakistani: { bn: "পাকিস্তানি", en: "Pakistani" },
  nepali: { bn: "নেপালি", en: "Nepali" },
  myanmar: { bn: "বার্মিজ", en: "Myanmar" },
  chinese: { bn: "চীনা", en: "Chinese" },
  british: { bn: "ব্রিটিশ", en: "British" },
  american: { bn: "মার্কিন", en: "American" },
  other: { bn: "অন্যান্য", en: "Other" },
};
/**
 * QAFIX-04 (§4 item 9): standard-occupation labels for service 17.
 * From schema v4 the profession is a closed select; the certificate
 * prints the chosen value's label in the document's own language.
 * Payloads pinned to earlier versions carry free text instead — the
 * attestation falls back to printing that text verbatim. Must stay in
 * sync with qaFix4ProfessionOptions (expanded-schemas.ts).
 */
export const PROFESSION_LABELS: Record<string, { bn: string; en: string }> = {
  farmer: { bn: "কৃষক", en: "Farmer" },
  teacher: { bn: "শিক্ষক", en: "Teacher" },
  doctor: { bn: "চিকিৎসক", en: "Doctor" },
  engineer: { bn: "প্রকৌশলী", en: "Engineer" },
  business: { bn: "ব্যবসায়ী", en: "Businessperson" },
  government_employee: { bn: "সরকারি চাকরিজীবী", en: "Government employee" },
  private_employee: { bn: "বেসরকারি চাকরিজীবী", en: "Private-sector employee" },
  lawyer: { bn: "আইনজীবী", en: "Lawyer" },
  journalist: { bn: "সাংবাদিক", en: "Journalist" },
  shopkeeper: { bn: "দোকানদার", en: "Shopkeeper" },
  driver: { bn: "চালক", en: "Driver" },
  rickshaw_puller: { bn: "রিকশাচালক", en: "Rickshaw puller" },
  day_labourer: { bn: "দিনমজুর", en: "Day labourer" },
  fisherman: { bn: "জেলে", en: "Fisherman" },
  weaver: { bn: "তাঁতি", en: "Weaver" },
  artisan: { bn: "কারিগর", en: "Artisan" },
  homemaker: { bn: "গৃহিণী", en: "Homemaker" },
  student: { bn: "ছাত্র/ছাত্রী", en: "Student" },
  retired: { bn: "অবসরপ্রাপ্ত", en: "Retired" },
  other: { bn: "অন্যান্য", en: "Other" },
};
/**
 * QAFIX-04 (§4 item 9): recognised-community labels for service 18.
 * From schema v4 the community is a closed select; the certificate
 * prints the chosen value's label in the document's own language.
 * Payloads pinned to earlier versions carry free text instead — the
 * attestation falls back to printing that text verbatim (with the
 * trailing "সম্প্রদায়" / " community" stripped as before). Must stay
 * in sync with qaFix4CommunityOptions (expanded-schemas.ts).
 */
export const COMMUNITY_LABELS: Record<string, { bn: string; en: string }> = {
  chakma: { bn: "চাকমা", en: "Chakma" },
  marma: { bn: "মারমা", en: "Marma" },
  tripura: { bn: "ত্রিপুরা", en: "Tripura" },
  tanchangya: { bn: "তঞ্চঙ্গ্যা", en: "Tanchangya" },
  barua: { bn: "বড়ুয়া", en: "Barua" },
  mro: { bn: "ম্রো", en: "Mro" },
  bawm: { bn: "বম", en: "Bawm" },
  khumi: { bn: "খুমি", en: "Khumi" },
  chak: { bn: "চাক", en: "Chak" },
  pankho: { bn: "পাংখো", en: "Pankho" },
  lushei: { bn: "লুসাই", en: "Lushei" },
  khyang: { bn: "খিয়াং", en: "Khyang" },
  garo: { bn: "গারো", en: "Garo" },
  hajong: { bn: "হাজং", en: "Hajong" },
  koch: { bn: "কোচ", en: "Koch" },
  rajbanshi: { bn: "রাজবংশী", en: "Rajbanshi" },
  santal: { bn: "সাঁওতাল", en: "Santal" },
  oraon: { bn: "ওরাঁও", en: "Oraon" },
  munda: { bn: "মুন্ডা", en: "Munda" },
  khasi: { bn: "খাসি", en: "Khasi" },
  manipuri: { bn: "মণিপুরি", en: "Manipuri" },
  muslim: { bn: "মুসলিম", en: "Muslim" },
  hindu: { bn: "হিন্দু", en: "Hindu" },
  buddhist: { bn: "বৌদ্ধ", en: "Buddhist" },
  christian: { bn: "খ্রিস্টান", en: "Christian" },
  other: { bn: "অন্যান্য", en: "Other" },
};

/**
 * QAFIX-08 (§4 item 9): organisation-type labels for service 42.
 * From schema v6 the type is a closed select in
 * `trade_license_org_type`; the licence prints the chosen value's
 * label in the document's own language. Payloads pinned to
 * earlier versions carry the free-text pair instead — the caller
 * falls back to printing that pair verbatim. Must stay in sync
 * with qaFix8OrgTypeOptions (expanded-schemas.ts).
 */
export const ORG_TYPE_LABELS: Record<string, { bn: string; en: string }> = {
  proprietorship: { bn: "একক মালিকানা", en: "Sole proprietorship" },
  partnership: { bn: "অংশীদারি", en: "Partnership" },
  private_limited: { bn: "প্রাইভেট লিমিটেড কোম্পানি", en: "Private limited company" },
  public_limited: { bn: "পাবলিক লিমিটেড কোম্পানি", en: "Public limited company" },
  cooperative: { bn: "সমবায় সমিতি", en: "Cooperative society" },
  other: { bn: "অন্যান্য", en: "Other" },
};

/** The organisation type as printed on a trade licence (QAFIX-08). */
export function orgTypeLabel(
  p: Record<string, unknown>,
  bn: boolean,
): string {
  const label = ORG_TYPE_LABELS[text(p.trade_license_org_type)];
  if (label) return bn ? label.bn : label.en;
  return cleanText(bn ? p.trade_license_org_type_bn : p.trade_license_org_type);
}
/** Service 33 correction field keys → printed labels (CERT-REFINE-01 §B svc33 fixed map). */
export const CORRECTION_FIELD_LABELS: Record<string, { bn: string; en: string }> = {
  name: { bn: "নাম", en: "Name" },
  father_name: { bn: "পিতার নাম", en: "Father name" },
  mother_name: { bn: "মাতার নাম", en: "Mother name" },
  parent_name: { bn: "পিতা/মাতার নাম", en: "Parent name" },
  date_of_birth: { bn: "জন্ম তারিখ", en: "Date of birth" },
  address: { bn: "ঠিকানা", en: "Address" },
  spouse_name: { bn: "স্বামী/স্ত্রীর নাম", en: "Spouse name" },
  other: { bn: "অন্যান্য", en: "Other" },
};
/**
 * CERT-REFINE-01 (A3): the residence/citizenship/personally-known status
 * sentence, inserted immediately after the identity block for the services
 * whose real format carries it (QA list: 2, 8, 10, 11, 12, 14, 17, 22, 35,
 * 40, 45). Services 8 and 12 already carry the substance in their captured
 * clauses, and service 2 has its own family structure — the chassis inserts
 * the sentence for the remaining listed services.
 */
export const STATUS_SENTENCE_SERVICES = new Set([8, 10, 11, 14, 17, 22, 35, 40, 45]);
export const STATUS_SENTENCE_BN =
  "তিনি অত্র ইউনিয়নের স্থায়ী বাসিন্দা এবং জন্মসূত্রে বাংলাদেশের নাগরিক। তিনি আমার ব্যক্তিগতভাবে পরিচিত।";
export const STATUS_SENTENCE_EN =
  "The person is a permanent resident of this union and a citizen of Bangladesh by birth, and is personally known to me.";
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

/** CERT-REFINE-02 (R2-15): the EN death sentences take the plan's forms.
 * "The person died on … at Own residence, …" becomes "The death occurred
 * on … at the deceased's own residence, …" — only the known place value
 * is rewritten; any other place prints as stored. The cause "Old-age
 * illness" reads "old-age-related illness". */
export function deathPlaceEn(place: unknown): string {
  return text(place).replace(/^Own residence\b/, "the deceased's own residence");
}
export function deathCauseEn(reason: unknown): string {
  const v = text(reason);
  return v === "Old-age illness" ? "old-age-related illness" : v;
}

/** CERT-REFINE-02 (R2-16): the passport purpose is a free-text field, so
 * localisation is by value: the standard purposes map to fixed BN/EN
 * labels (normalised match); any other value prints exactly as stored —
 * arbitrary free text cannot be translated safely. */
const PASSPORT_PURPOSES: Record<string, { bn: string; en: string }> = {
  // QAFIX-06 (service 27): the fixed select values the repaired form
  // offers. The issuance-phrase entries below stay for payloads pinned
  // to earlier schema versions, whose purpose was free text.
  travel: { bn: "ভ্রমণ", en: "travel" },
  employment: { bn: "বিদেশে কর্মসংস্থান", en: "employment abroad" },
  hajj: { bn: "হজ্জ", en: "Hajj" },
  umrah: { bn: "ওমরাহ", en: "Umrah" },
  study: { bn: "শিক্ষা", en: "study" },
  treatment: { bn: "চিকিৎসা", en: "medical treatment" },
  business: { bn: "ব্যবসা", en: "business" },
  other: { bn: "অন্যান্য", en: "other" },
  "new passport issuance": { bn: "নতুন পাসপোর্ট প্রদান", en: "new passport issuance" },
  "passport issuance": { bn: "পাসপোর্ট প্রদান", en: "passport issuance" },
  "passport renewal": { bn: "পাসপোর্ট নবায়ন", en: "passport renewal" },
  "passport reissue": { bn: "পাসপোর্ট পুনঃপ্রদান", en: "passport reissue" },
  "reissue of passport": { bn: "পাসপোর্ট পুনঃপ্রদান", en: "passport reissue" },
  "lost passport replacement": {
    bn: "হারানো পাসপোর্টের বদলি প্রদান",
    en: "replacement of a lost passport",
  },
};
export function passportPurposeLabel(raw: unknown, bn: boolean): string {
  const v = text(raw);
  const hit = PASSPORT_PURPOSES[v.trim().toLowerCase()];
  return hit ? (bn ? hit.bn : hit.en) : v;
}

/* ---------- amount in words (CERTNO-01: figures AND words on money documents) ----------
 * South-Asian grouping (thousand / lakh / crore) in both languages. Words are
 * always generated per render in the document's own language (CERT-REFINE-01
 * A10); an applicant-supplied word string is never printed. */
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
  // CERT-REFINE-01 (A8): ONE shell — A4 portrait for every certificate and
  // attestation. Service 12 (was A4 landscape) and service 37 (was US
  // Letter) move to the shared shell.
  // CERT-REFINE-02 (R2-05): service 46's landscape card is retired too —
  // the vehicle licence is a standard A4 portrait certificate, so no
  // per-service format remains.
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
/** CERT-REFINE-01: attestations may read citizen context (gender) for gendered wording (svc10). */
export interface AttestContext {
  gender?: string | null;
}
type AttestFn = (
  payload: Record<string, unknown>,
  ctx?: AttestContext,
) => string;
type Attestation = string | AttestFn;
const run = (
  a: Attestation | undefined,
  payload: Record<string, unknown>,
  ctx?: AttestContext,
) => (typeof a === "function" ? a(payload, ctx) : (a ?? ""));
const joinSentences = (...parts: string[]) => parts.filter((p) => p.trim()).join(" ");

/* Disability type labels — mirrors the DSS-based select options on service 38. */
export const DISABILITY_LABELS: Record<string, { bn: string; en: string }> = {
  physical: { bn: "শারীরিক", en: "Physical" },
  intellectual: { bn: "বুদ্ধিবৃত্তিক", en: "Intellectual" },
  hearing: { bn: "শ্রবণ", en: "Hearing" },
  visual: { bn: "দৃষ্টি", en: "Visual" },
  speech: { bn: "বাক", en: "Speech" },
  autism: { bn: "অটিজম", en: "Autism" },
  down_syndrome: { bn: "ডাউন সিনড্রোম", en: "Down Syndrome" },
  cerebral_palsy: { bn: "সেরিব্রাল পালসি", en: "Cerebral Palsy" },
  multiple: { bn: "বহুমাত্রিক", en: "Multiple" },
  other: { bn: "অন্যান্য", en: "Other" },
};
/* CERT-REFINE-01 §38: the operational schema's type field carries the legacy
 * id application_autistic_type; payloads never populate a disability_type key.
 * Read the operational key first so the type — the document's core fact —
 * actually prints. */
export const disabilityTypeOf = (p: Record<string, unknown>): string =>
  text(p.application_autistic_type) || text(p.disability_type);

/**
 * CERT-REFINE-01 corpus. Register: cholito throughout (A4); free-text
 * insertions pass through cleanText so a typed trailing danda never doubles
 * (A9); every value slot reads the certificate language's own field (A9).
 * Services 2, 19, 25, 26 and 39 are built structurally by the chassis and
 * have no generic attestation entry.
 */
export const ATTESTATIONS_BN: Record<number, Attestation> = {
  5: (p) => {
    const name = cleanText(p.authority_delegation_letter_name_bn);
    const subject =
      DELEGATION_SUBJECT_LABELS[text(p.authority_delegation_letter_subject)]?.bn;
    if (!name)
      return "তাঁহার দাখিলকৃত ক্ষমতা অর্পণ পত্র অনুযায়ী মনোনীত ব্যক্তি তাঁহার প্রতিনিধি হিসেবে স্বীকৃত।";
    return `তাঁহার দাখিলকৃত ক্ষমতা অর্পণ পত্র অনুযায়ী ${name}${present(p.authority_delegation_relationship) ? ` (আবেদনকারীর ${relationshipLabel(p.authority_delegation_relationship, true)})` : ""} কে${subject ? ` ${subject} সংক্রান্ত কাজে` : ""} তাঁহার প্রতিনিধি হিসেবে স্বীকৃতি দেওয়া যাচ্ছে।`;
  },
  6: (p) =>
    joinSentences(
      "তাঁহার নামে নতুন বিদ্যুৎ সংযোগ প্রদানের বিষয়ে এই কার্যালয়ের কোনো আপত্তি নাই।",
      present(p.electricity_connection_mouza_name_bn)
        ? `জমির বিবরণঃ মৌজাঃ ${cleanText(p.electricity_connection_mouza_name_bn)}${present(p.electricity_connection_khatiyan_no) ? `, খতিয়ান নংঃ ${bnDigits(p.electricity_connection_khatiyan_no)}` : ""}${present(p.electricity_connection_daag_no) ? `, দাগ নংঃ ${bnDigits(p.electricity_connection_daag_no)}` : ""}।`
        : "",
      present(p.electricity_connection_holding_no)
        ? `হোল্ডিং নম্বরঃ ${bnDigits(p.electricity_connection_holding_no)}।`
        : "",
    ),
  8: "তিনি রোহিঙ্গা নাগরিক নন; তিনি বাংলাদেশের নাগরিক এবং অত্র এলাকার স্থায়ী বাসিন্দা।",
  9: (p) =>
    joinSentences(
      "তাঁহার ভোটার তথ্য যাচাই করে সঠিক পাওয়া গেছে।",
      present(p.voter_application_no)
        ? `ভোটার আবেদন নংঃ ${bnDigits(p.voter_application_no)}।`
        : "",
    ),
  10: (p, c) => {
    const youth =
      c?.gender === "female" ? "যুবতী" : c?.gender === "male" ? "যুবক" : "যুবক/যুবতী";
    const since = present(p.unemployed_since)
      ? `তিনি ${bnDateIso(p.unemployed_since)} হতে বেকার আছেন`
      : "তিনি বর্তমানে বেকার আছেন";
    const occupation = present(p.last_occupation)
      ? `তাঁহার সর্বশেষ পেশা ছিল ${cleanText(p.last_occupation)}`
      : "";
    return joinSentences(
      `তিনি একজন শিক্ষিত বেকার ${youth}।`,
      occupation ? `${since}; ${occupation}।` : `${since}।`,
      "তাঁহার স্বভাব-চরিত্র ভালো; তিনি রাষ্ট্রবিরোধী কোনো কার্যকলাপের সহিত জড়িত নন।",
    );
  },
  11: (p) => {
    // QAFIX-03: from schema v5 the value is a select code with a label
    // map; pinned payloads carry free text and print it verbatim.
    const nat = NATIONALITY_LABELS[text(p.claimed_nationality)];
    return joinSentences(
      nat
        ? `তিনি জাতীয়তায় ${nat.bn}।`
        : present(p.claimed_nationality)
          ? `তিনি জাতীয়তায় ${cleanText(p.claimed_nationality)}।`
          : "তিনি জাতীয়তায় বাংলাদেশি।",
      MARITAL_LABELS[text(p.marital_status)]
        ? `বৈবাহিক অবস্থাঃ ${MARITAL_LABELS[text(p.marital_status)].bn}।`
        : "",
    );
  },
  // CERT-REFINE-01 §12: the captured basis-based wording is kept (A3-aligned).
  12: (p) => {
    const basis = `${text(p.citizenship_basis)} ${text(p.citizenship_basis_bn)}`;
    return /জন্ম|birth/i.test(basis) || !basis.trim()
      ? "তিনি অত্র এলাকার একজন স্থায়ী বাসিন্দা এবং জন্মসূত্রে বাংলাদেশী নাগরিক।"
      : "তিনি অত্র এলাকার একজন স্থায়ী বাসিন্দা এবং বাংলাদেশের নাগরিক।";
  },
  13: (p) => {
    const name = cleanText(p.application_husband_name_bn);
    const date = present(p.remarriage_date)
      ? ` ${bnDateIso(p.remarriage_date)} তারিখে`
      : "";
    return name
      ? `তিনি ${name} এর সহিত${date} পুনরায় বিবাহ বন্ধনে আবদ্ধ হয়েছেন (কাবিননামা/বিবাহ নিবন্ধন অনুযায়ী)।`
      : "তিনি পুনরায় বিবাহ বন্ধনে আবদ্ধ হয়েছেন।";
  },
  14: "তিনি ভূমিহীন; তাঁহার নিজের বা তাঁহার পরিবারের কোনো সদস্যের নামে কোনো জমি নাই।",
  15: "তিনি অত্র এলাকার স্থায়ী বাসিন্দা এবং জন্মসূত্রে বাংলাদেশের নাগরিক। তিনি পূর্বে কখনো কোনো এলাকার ভোটার হন নি।",
  16: (p) =>
    joinSentences(
      present(p.deceased_spouse_name)
        ? `তাঁহার স্বামী ${cleanText(p.deceased_spouse_name)} মৃত্যুবরণ করেছেন।`
        : "",
      present(p.spouse_death_date)
        ? `মৃত্যুর তারিখঃ ${bnDateIso(p.spouse_death_date)}।`
        : "",
      "তিনি বিধবা।",
      "স্বামীর মৃত্যুর পর তিনি সন্তানদের সহিত বসবাস করিতেছেন।",
    ),
  17: (p) => {
    // QAFIX-04: from schema v4 the value is a select code with a label
    // map; pinned payloads carry free text and print it verbatim.
    const prof = PROFESSION_LABELS[text(p.profession)];
    const value = prof
      ? prof.bn
      : present(p.profession_bn)
        ? cleanText(p.profession_bn)
        : "";
    return value
      ? `তিনি পেশায় একজন ${value}।`
      : "তাঁহার পেশা আবেদনে উল্লিখিত অনুযায়ী প্রত্যয়ন করা যাচ্ছে।";
  },
  18: (p) => {
    // QAFIX-04: from schema v4 the value is a select code with a label
    // map; pinned payloads carry free text and print it verbatim (the
    // trailing "সম্প্রদায়" stripped as before).
    const label = COMMUNITY_LABELS[text(p.community_name)];
    const name = label
      ? label.bn
      : cleanText(p.community_name).replace(/\s*সম্প্রদায়$/u, "");
    return name
      ? `তিনি ${name} সম্প্রদায়ের সদস্য।`
      : "তিনি আবেদনে উল্লিখিত সম্প্রদায়ের সদস্য।";
  },
  20: (p) =>
    joinSentences(
      "তিনি একজন বীর মুক্তিযোদ্ধা।",
      // CERT-REFINE-02 (R2-16): external registration numbers print
      // EXACTLY as issued — no digit-script conversion inside identifier
      // strings ("FF-778899", never "FF-৭৭৮৮৯৯"). The batch number is a
      // plain serial count, not an identifier string, and keeps Bengali
      // digits like the NID.
      present(p.freedom_fighter_id_number)
        ? `মুক্তিযোদ্ধা পরিচিতি নংঃ ${text(p.freedom_fighter_id_number)}।`
        : "",
      present(p.freedom_fighter_batch_number)
        ? `ব্যাচ নংঃ ${bnDigits(p.freedom_fighter_batch_number)}।`
        : "",
      present(p.freedom_fighter_certificate_number)
        ? `সনদ নংঃ ${text(p.freedom_fighter_certificate_number)}।`
        : "",
      present(p.freedom_fighter_certificate_given_date)
        ? `সনদের তারিখঃ ${bnDateIso(p.freedom_fighter_certificate_given_date)}।`
        : "",
      present(p.freedom_fighter_muktibarta_number) ? `মুক্তিবার্তা নংঃ ${text(p.freedom_fighter_muktibarta_number)}।` : "",
      present(p.freedom_fighter_gazette_number) ? `গেজেট নংঃ ${text(p.freedom_fighter_gazette_number)}।` : "",
      present(p.other_freedom_fighter_name_bn)
        ? `${cleanText(p.other_freedom_fighter_name_bn)} এর সহিত সম্পর্কঃ ${relationshipLabel(p.other_freedom_fighter_relation, true)}।`
        : "",
    ),
  21: (p) =>
    present(p.farming_activity)
      ? `তিনি পেশায় একজন কৃষক। তিনি ${cleanText(p.farming_activity)} চাষের সহিত জড়িত।`
      : "তিনি পেশায় একজন কৃষক।",
  22: "আমার জানামতে এবং স্থানীয় তদন্ত অনুযায়ী তিনি অবিবাহিত; তিনি কখনো বিবাহ বন্ধনে আবদ্ধ হন নাই।",
  23: (p) => {
    const subject =
      // QAFIX-05: the earner is chosen from the income_earner select;
      // the other_person fallback keeps pinned v4 payloads rendering.
      p.income_earner === "other_person" || p.other_person === true
        ? present(p.other_person_name_bn)
          ? `তাঁহার অভিভাবক ${cleanText(p.other_person_name_bn)} এর`
          : "তাঁহার অভিভাবকের"
        : "আবেদনকারীর নিজের";
    return joinSentences(
      present(p.income_info_amount)
        ? `${subject} বার্ষিক আয় ${bnDigits(Number(p.income_info_amount).toLocaleString("en-IN"))} টাকা (${amountInWordsBn(Number(p.income_info_amount))} টাকা মাত্র)।`
        : `${subject} বার্ষিক আয় আবেদনে উল্লিখিত অনুযায়ী।`,
      present(p.profession_bn) ? `তাঁহার পেশাঃ ${cleanText(p.profession_bn)}।` : "",
    );
  },
  24: (p) => {
    const father = cleanText(p.orphan_father_name_bn);
    const mother = cleanText(p.orphan_mother_name_bn);
    const fDate = present(p.orphan_father_death_date)
      ? ` গত ${bnDateIso(p.orphan_father_death_date)} তারিখে`
      : "";
    const mDate = present(p.orphan_mother_death_date)
      ? ` গত ${bnDateIso(p.orphan_mother_death_date)} তারিখে`
      : "";
    const parts: string[] = [];
    if (father && mother)
      parts.push(`তাঁহার পিতা মৃত ${father}${fDate} এবং মাতা মৃত ${mother}${mDate} মৃত্যুবরণ করেছেন।`);
    else if (father)
      parts.push(`তাঁহার পিতা মৃত ${father}${fDate} মৃত্যুবরণ করেছেন।`);
    else if (mother)
      parts.push(`তাঁহার মাতা মৃত ${mother}${mDate} মৃত্যুবরণ করেছেন।`);
    const guardian = cleanText(p.orphan_guardian_name_bn);
    if (guardian)
      parts.push(
        `বর্তমানে তিনি তাঁহার অভিভাবক ${guardian}${present(p.orphan_guardian_relation) ? ` (${relationshipLabel(p.orphan_guardian_relation, true)})` : ""} এর তত্ত্বাবধানে আছেন।`,
      );
    parts.push("তিনি এতিম।");
    return parts.join(" ");
  },
  28: (p) =>
    joinSentences(
      present(p.appearance_date)
        ? `তিনি সুস্থ শরীরে জীবিত আছেন এবং ${bnDateIso(p.appearance_date)} তারিখে এই কার্যালয়ে সশরীরে উপস্থিত হয়েছিলেন।`
        : "তিনি সুস্থ শরীরে জীবিত আছেন।",
      "তিনি আমার ব্যক্তিগতভাবে পরিচিত।",
    ),
  29: (p) => {
    const otherPerson =
      // QAFIX-06: the earner is chosen from the income_earner select;
      // the other_person fallback keeps pinned v4 payloads rendering.
      p.income_earner === "other_person" || p.other_person === true;
    const subject = otherPerson
      ? present(p.other_person_name_bn)
        ? `তাঁহার অভিভাবক ${cleanText(p.other_person_name_bn)} এর`
        : "তাঁহার অভিভাবকের"
      : "আবেদনকারীর নিজের";
    // QAFIX-06: an other-person certificate prints THAT person's
    // monthly amount when the repaired form captured it; pinned
    // payloads carry only the shared amount.
    const amount =
      otherPerson && present(p.other_person_income_amount)
        ? p.other_person_income_amount
        : p.income_info_amount;
    return joinSentences(
      present(amount)
        ? `${subject} মাসিক আয় ${bnDigits(Number(amount).toLocaleString("en-IN"))} টাকা (${amountInWordsBn(Number(amount))} টাকা মাত্র)।`
        : `${subject} মাসিক আয় আবেদনে উল্লিখিত অনুযায়ী।`,
      present(p.profession_bn) ? `তাঁহার পেশাঃ ${cleanText(p.profession_bn)}।` : "",
    );
  },
  30: (p) =>
    joinSentences(
      present(p.declared_assets_bdt)
        ? `তাঁহার ঘোষিত সম্পদ ${bnDigits(Number(p.declared_assets_bdt).toLocaleString("en-IN"))} টাকা (কথায়ঃ ${amountInWordsBn(Number(p.declared_assets_bdt))} টাকা মাত্র)।`
        : "",
      present(p.declared_liabilities_bdt)
        ? `ঘোষিত দায় ${bnDigits(Number(p.declared_liabilities_bdt).toLocaleString("en-IN"))} টাকা (কথায়ঃ ${amountInWordsBn(Number(p.declared_liabilities_bdt))} টাকা মাত্র)।`
        : "",
      present(p.financial_basis)
        ? `আর্থিক ভিত্তিঃ ${cleanText(p.financial_basis)}।`
        : "",
      "তিনি আর্থিকভাবে স্বচ্ছল বলে প্রত্যয়ন করা যাচ্ছে।",
    ),
  32: (p) =>
    joinSentences(
      present(p.monthly_household_income_bdt)
        ? `তাঁহার পরিবারের মাসিক আয় ${bnDigits(Number(p.monthly_household_income_bdt).toLocaleString("en-IN"))} টাকা (কথায়ঃ ${amountInWordsBn(Number(p.monthly_household_income_bdt))} টাকা মাত্র)।`
        : "",
      present(p.earner_occupation_bn)
        ? `তাঁহার পরিবারের উপার্জনক্ষম ব্যক্তির পেশাঃ ${cleanText(p.earner_occupation_bn)}।`
        : "",
      "তিনি আর্থিকভাবে অস্বচ্ছল; তিনি যেকোনো সমাজকল্যাণমূলক সংস্থা বা সরকারি তহবিল হতে সাহায্য পাওয়ার যোগ্য দাবিদার।",
    ),
  34: "তাঁহাদের কোনো সন্তান নাই।",
  35: "তিনি সচ্চরিত্রের অধিকারী; তাঁহার স্বভাব-চরিত্র ভালো। তিনি রাষ্ট্রবিরোধী কোনো কার্যকলাপের সহিত জড়িত নন এবং তাঁহার আচরণ সম্পর্কে কোনো অভিযোগ জানা নাই।",
  36: (p) => {
    const org = cleanText(p.noc_org_name_bn ?? p.noc_org_name);
    const role = cleanText(p.noc_role_bn);
    const activity = cleanText(p.noc_activity_bn);
    if (!org)
      return "আবেদনে উল্লিখিত প্রতিষ্ঠানের কার্যক্রমে এই কার্যালয়ের কোনো আপত্তি নাই।";
    return `${org} এর${role ? ` ${role} হিসেবে` : ""}${activity ? ` ${activity}` : ""} কার্যক্রমে এই কার্যালয়ের কোনো আপত্তি নাই।`;
  },
  // CERT-REFINE-01 §37: the captured reason-based clause is kept (A4 register);
  // the fields line is added by the chassis.
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
      `${phrase ? `${phrase} ` : ""}তিনি অত্র এলাকায় স্থায়ীভাবে বসবাস করছেন এবং বাংলাদেশের নাগরিক।`,
      "তাঁহার পূর্বের ভোটার এলাকা পরিবর্তন করে অত্র এলাকার ভোটার হিসেবে নিবন্ধন করা যায়।",
    );
  },
  38: (p) =>
    joinSentences(
      "তিনি একজন প্রতিবন্ধী ব্যক্তি।",
      DISABILITY_LABELS[disabilityTypeOf(p)]
        ? `প্রতিবন্ধিতার ধরণঃ ${DISABILITY_LABELS[disabilityTypeOf(p)]!.bn}।`
        : "",
      present(p.support_needs)
        ? `তাঁহার প্রয়োজনীয় সহায়তাঃ ${cleanText(p.support_needs)}।`
        : "",
    ),
  40: (p) => {
    // QAFIX-08: from schema v5 the value is a select code resolved
    // through COMMUNITY_LABELS (as service 18 since QAFIX-04);
    // pinned payloads carry free text and print it verbatim (the
    // trailing "সম্প্রদায়" stripped as on service 18).
    const label = COMMUNITY_LABELS[text(p.community_name)];
    const name = label
      ? label.bn
      : cleanText(p.community_name).replace(/\s*সম্প্রদায়$/u, "");
    return name
      ? `তিনি ${name} ক্ষুদ্র নৃ-গোষ্ঠী সম্প্রদায়ের সদস্য।`
      : "তিনি আবেদনে উল্লিখিত ক্ষুদ্র নৃ-গোষ্ঠী সম্প্রদায়ের সদস্য।";
  },
  43: (p) =>
    joinSentences(
      present(p.omission_details)
        ? `বাদ পড়ার কারণ: ${cleanText(p.omission_details)}।`
        : "",
      present(p.omission_details)
        ? `তাঁহার নাম ${cleanText(p.omission_details)} কারণে ভোটার তালিকা হইতে বাদ পড়িয়াছে।`
        : "তাঁহার নাম ভোটার তালিকা হইতে বাদ পড়িয়াছে।",
      "তিনি অত্র এলাকার স্থায়ী বাসিন্দা এবং বাংলাদেশের নাগরিক; তাঁহাকে পুনরায় ভোটার তালিকায় অন্তর্ভুক্ত করা যায়।",
    ),
  44: (p) => {
    const name = cleanText(p.previous_spouse_name);
    if (!name) return "তিনি পুনরায় বিবাহ বন্ধনে আবদ্ধ হন নাই বলে প্রত্যয়ন করা যাচ্ছে।";
    // QAFIX-09: from schema v5 the applicant states how the previous
    // marriage ended; a divorce prints the divorce sentence with the
    // divorce date. Pinned payloads carry no marriage_end_type and
    // print the historical death sentences byte-identically.
    if (text(p.marriage_end_type) === "divorce")
      return joinSentences(
        `তাঁহার পূর্বের স্বামী/স্ত্রী ${name} এর সহিত তাঁহার বিবাহ বিচ্ছেদ ঘটে${present(p.divorce_date) ? ` (গত ${bnDateIso(p.divorce_date)} তারিখে)` : ""}।`,
        "বিবাহ বিচ্ছেদের পর হইতে তিনি অদ্যাবধি পুনরায় বিবাহ বন্ধনে আবদ্ধ হন নাই।",
      );
    return joinSentences(
      `তাঁহার স্বামী মৃত ${name}${present(p.spouse_death_date) ? ` গত ${bnDateIso(p.spouse_death_date)} তারিখে` : ""} মৃত্যুবরণ করেন।`,
      "স্বামীর মৃত্যুর পর তিনি অদ্যাবধি পুনরায় বিবাহ বন্ধনে আবদ্ধ হন নাই এবং সন্তানদের সহিত বসবাস করিতেছেন।",
    );
  },
  45: (p) =>
    present(p.residence_since)
      ? `তিনি ${bnDateIso(p.residence_since)} হতে অত্র এলাকায় স্থায়ীভাবে বসবাস করছেন।`
      : "তিনি অত্র এলাকার একজন স্থায়ী বাসিন্দা।",
};

export const ATTESTATIONS_EN: Record<number, Attestation> = {
  5: (p) => {
    const name = cleanText(p.authority_delegation_letter_name_en ?? p.authority_delegation_letter_name);
    const subject =
      DELEGATION_SUBJECT_LABELS[text(p.authority_delegation_letter_subject)]?.en;
    const relation = present(p.authority_delegation_relationship)
      ? relationshipLabel(p.authority_delegation_relationship, false).toLowerCase()
      : "";
    if (!name)
      return "Under the submitted letter of authority, the nominated person is recognised as the applicant's representative.";
    return `Under the submitted letter of authority, ${name}${relation ? ` (the applicant's ${relation})` : ""} is recognised as the applicant's representative${subject ? ` for ${subject} matters` : ""}.`;
  },
  6: (p) =>
    joinSentences(
      "This office has no objection to providing a new electricity connection in the person's name.",
      present(p.electricity_connection_mouza_name)
        ? `Land details: Mouza: ${cleanText(p.electricity_connection_mouza_name)}${present(p.electricity_connection_khatiyan_no) ? `, Khatian No: ${p.electricity_connection_khatiyan_no}` : ""}${present(p.electricity_connection_daag_no) ? `, Dag No: ${p.electricity_connection_daag_no}` : ""}.`
        : "",
      present(p.electricity_connection_holding_no)
        ? `Holding No: ${p.electricity_connection_holding_no}.`
        : "",
    ),
  8: "The person is not a Rohingya citizen; the person is a citizen of Bangladesh and a permanent resident of this area.",
  9: (p) =>
    joinSentences(
      "The voter information has been verified and found correct.",
      present(p.voter_application_no)
        ? `Voter Application No: ${p.voter_application_no}.`
        : "",
    ),
  10: (p, c) => {
    const youth =
      c?.gender === "female"
        ? "young woman"
        : c?.gender === "male"
          ? "young man"
          : "young person";
    const since = present(p.unemployed_since)
      ? `has been unemployed since ${enDateIso(p.unemployed_since)}`
      : "is currently unemployed";
    const occupation = present(p.last_occupation_en)
      ? `the person's last occupation was ${cleanText(p.last_occupation_en)}`
      : "";
    return joinSentences(
      `The person is an educated unemployed ${youth}.`,
      occupation ? `The person ${since}; ${occupation}.` : `The person ${since}.`,
      "The person's character is good; the person is not involved in any anti-state activity.",
    );
  },
  11: (p) => {
    // QAFIX-03: from schema v5 the value is a select code with a label
    // map; pinned payloads carry the free-text pair and print it verbatim.
    const nat = NATIONALITY_LABELS[text(p.claimed_nationality)];
    return joinSentences(
      nat
        ? `The person's nationality is ${nat.en}.`
        : present(p.claimed_nationality_en)
          ? `The person's nationality is ${cleanText(p.claimed_nationality_en)}.`
          : present(p.claimed_nationality)
            ? `The person's nationality is ${cleanText(p.claimed_nationality)}.`
            : "The person's nationality is Bangladeshi.",
      MARITAL_LABELS[text(p.marital_status)]
        ? `Marital status: ${MARITAL_LABELS[text(p.marital_status)].en}.`
        : "",
    );
  },
  // CERT-REFINE-01 §12: the captured basis-based wording is kept (A3-aligned).
  12: (p) => {
    const basis = `${text(p.citizenship_basis)} ${text(p.citizenship_basis_bn)}`;
    return /জন্ম|birth/i.test(basis) || !basis.trim()
      ? "The person is a permanent resident of this area and a citizen of Bangladesh by birth."
      : "The person is a permanent resident of this area and a citizen of Bangladesh.";
  },
  13: (p) => {
    const name = cleanText(p.application_husband_name_en ?? p.application_husband_name);
    const date = present(p.remarriage_date)
      ? ` on ${enDateIso(p.remarriage_date)}`
      : "";
    return name
      ? `The person has remarried to ${name}${date} (as per the kabinnama/marriage registration).`
      : "The person has remarried.";
  },
  14: "The person is landless; neither the person nor any member of the person's family owns any land.",
  15: "The person is a permanent resident of this area and a citizen of Bangladesh by birth. The person has never been a voter in any area before.",
  16: (p) =>
    joinSentences(
      present(p.deceased_spouse_name_en)
        ? `The person's spouse ${cleanText(p.deceased_spouse_name_en)} has died.`
        : "",
      present(p.spouse_death_date)
        ? `Date of death: ${enDateIso(p.spouse_death_date)}.`
        : "",
      "The person is a widow.",
      "After the spouse's death, the person has been living with the children.",
    ),
  17: (p) => {
    // QAFIX-04: from schema v4 the value is a select code with a label
    // map; pinned payloads carry free text and print it verbatim.
    const prof = PROFESSION_LABELS[text(p.profession)];
    const value = prof
      ? prof.en
      : present(p.profession_en)
        ? cleanText(p.profession_en)
        : "";
    return value
      ? `The person is a ${value} by profession.`
      : "The person's profession is certified as stated in the application.";
  },
  18: (p) => {
    // QAFIX-04: from schema v4 the value is a select code with a label
    // map; pinned payloads carry free text and print it verbatim (the
    // trailing " community" stripped as before).
    const label = COMMUNITY_LABELS[text(p.community_name)];
    const name = label
      ? label.en
      : cleanText(p.community_name_en).replace(/\s+community$/i, "");
    return name
      ? `The person is a member of the ${name} community.`
      : "The person is a member of the community stated in the application.";
  },
  20: (p) =>
    joinSentences(
      "The person is a valiant freedom fighter.",
      present(p.freedom_fighter_id_number)
        ? `Freedom fighter ID no: ${p.freedom_fighter_id_number}.`
        : "",
      present(p.freedom_fighter_batch_number)
        ? `Batch no: ${p.freedom_fighter_batch_number}.`
        : "",
      present(p.freedom_fighter_certificate_number)
        ? `Certificate no: ${p.freedom_fighter_certificate_number}.`
        : "",
      present(p.freedom_fighter_certificate_given_date)
        ? `Certificate date: ${enDateIso(p.freedom_fighter_certificate_given_date)}.`
        : "",
      present(p.freedom_fighter_muktibarta_number) ? `Muktibarta no: ${p.freedom_fighter_muktibarta_number}.` : "",
      present(p.freedom_fighter_gazette_number) ? `Gazette no: ${p.freedom_fighter_gazette_number}.` : "",
      present(p.other_freedom_fighter_name ?? p.other_freedom_fighter_name_bn)
        ? `Relationship with ${cleanText(p.other_freedom_fighter_name ?? p.other_freedom_fighter_name_bn)}: ${relationshipLabel(p.other_freedom_fighter_relation, false)}.`
        : "",
    ),
  21: (p) =>
    present(p.farming_activity_en)
      ? `The person is a farmer by occupation. The person is engaged in the cultivation of ${cleanText(p.farming_activity_en)}.`
      : "The person is a farmer by occupation.",
  22: "To my knowledge and according to local enquiry, the person is unmarried and has never been married.",
  23: (p) => {
    const subject =
      // QAFIX-05: the earner is chosen from the income_earner select;
      // the other_person fallback keeps pinned v4 payloads rendering.
      p.income_earner === "other_person" || p.other_person === true
        ? present(p.other_person_name_en ?? p.other_person_name)
          ? `The annual income of the guardian, ${cleanText(p.other_person_name_en ?? p.other_person_name)}, is`
          : "The guardian's annual income is"
        : "The applicant's own annual income is";
    return joinSentences(
      present(p.income_info_amount)
        ? `${subject} BDT ${Number(p.income_info_amount).toLocaleString("en-IN")} (in words: ${amountInWordsEn(Number(p.income_info_amount))} Taka only).`
        : "The person's annual income is as stated in the application.",
      present(p.profession_en ?? p.profession)
        ? `Occupation: ${cleanText(p.profession_en ?? p.profession)}.`
        : "",
    );
  },
  24: (p) => {
    const father = cleanText(p.orphan_father_name_en);
    const mother = cleanText(p.orphan_mother_name_en);
    const parts: string[] = [];
    if (father)
      parts.push(
        `The person's father, the late ${father}, died${present(p.orphan_father_death_date) ? ` on ${enDateIso(p.orphan_father_death_date)}` : ""}.`,
      );
    if (mother)
      parts.push(
        `The person's mother, the late ${mother}, died${present(p.orphan_mother_death_date) ? ` on ${enDateIso(p.orphan_mother_death_date)}` : ""}.`,
      );
    const guardian = cleanText(p.orphan_guardian_name_en);
    if (guardian)
      parts.push(
        `The person is currently under the care of the guardian, ${guardian}${present(p.orphan_guardian_relation) ? ` (${relationshipLabel(p.orphan_guardian_relation, false)})` : ""}.`,
      );
    parts.push("The person is an orphan.");
    return parts.join(" ");
  },
  28: (p) =>
    joinSentences(
      present(p.appearance_date)
        ? `The person is alive and in good health and appeared in person at this office on ${enDateIso(p.appearance_date)}.`
        : "The person is alive and in good health.",
      "The person is personally known to me.",
    ),
  29: (p) => {
    const otherPerson =
      // QAFIX-06: the earner is chosen from the income_earner select;
      // the other_person fallback keeps pinned v4 payloads rendering.
      p.income_earner === "other_person" || p.other_person === true;
    const subject = otherPerson
      ? present(p.other_person_name_en ?? p.other_person_name)
        ? `The monthly income of the guardian, ${cleanText(p.other_person_name_en ?? p.other_person_name)}, is`
        : "The guardian's monthly income is"
      : "The applicant's own monthly income is";
    // QAFIX-06: an other-person certificate prints THAT person's
    // monthly amount when the repaired form captured it; pinned
    // payloads carry only the shared amount.
    const amount =
      otherPerson && present(p.other_person_income_amount)
        ? p.other_person_income_amount
        : p.income_info_amount;
    return joinSentences(
      present(amount)
        ? `${subject} BDT ${Number(amount).toLocaleString("en-IN")} (in words: ${amountInWordsEn(Number(amount))} Taka only).`
        : "The person's monthly income is as stated in the application.",
      present(p.profession_en ?? p.profession)
        ? `Occupation: ${cleanText(p.profession_en ?? p.profession)}.`
        : "",
    );
  },
  30: (p) =>
    joinSentences(
      present(p.declared_assets_bdt)
        ? `Declared assets: BDT ${Number(p.declared_assets_bdt).toLocaleString("en-IN")} (in words: ${amountInWordsEn(Number(p.declared_assets_bdt))} Taka only).`
        : "",
      present(p.declared_liabilities_bdt)
        ? `Declared liabilities: BDT ${Number(p.declared_liabilities_bdt).toLocaleString("en-IN")} (in words: ${amountInWordsEn(Number(p.declared_liabilities_bdt))} Taka only).`
        : "",
      present(p.financial_basis_en)
        ? `Financial basis: ${cleanText(p.financial_basis_en)}.`
        : "",
      "The person is financially solvent.",
    ),
  32: (p) =>
    joinSentences(
      present(p.monthly_household_income_bdt)
        ? `Monthly household income is BDT ${Number(p.monthly_household_income_bdt).toLocaleString("en-IN")} (in words: ${amountInWordsEn(Number(p.monthly_household_income_bdt))} Taka only).`
        : "",
      present(p.earner_occupation_en)
        ? `Occupation of the family's earning member: ${cleanText(p.earner_occupation_en)}.`
        : "",
      "The person is in financial hardship and is a deserving claimant of assistance from any social-welfare organisation or government fund.",
    ),
  34: "The couple has no children.",
  35: "The person is of good character; the person's character is good. The person is not involved in any anti-state activity, and no complaint is known about the person's conduct.",
  36: (p) => {
    const org = cleanText(p.noc_org_name);
    const role = cleanText(p.noc_role_en);
    const activity = cleanText(p.noc_activity_en);
    if (!org)
      return "This office has no objection to the activities of the organisation stated in the application.";
    return `This office has no objection to the ${activity ? `${activity} ` : ""}activities of ${org}${role ? `, in which the person serves as ${role}` : ""}.`;
  },
  // CERT-REFINE-01 §37: the captured reason-based clause is kept; the
  // fields line is added by the chassis.
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
      phrase
        ? `${phrase} the person resides permanently in this area and is a citizen of Bangladesh.`
        : "The person resides permanently in this area and is a citizen of Bangladesh.",
      "The previous voter area may be changed so that the person is registered as a voter of this area.",
    );
  },
  38: (p) =>
    // CERT-REFINE-02 (R2-15): one sentence, the type in parentheses; the
    // support-needs sentence is retained.
    joinSentences(
      DISABILITY_LABELS[disabilityTypeOf(p)]
        ? `The certificate holder is a person with a disability (disability type: ${DISABILITY_LABELS[disabilityTypeOf(p)]!.en}).`
        : "The certificate holder is a person with a disability.",
      present(p.support_needs_en)
        ? `Support needs: ${cleanText(p.support_needs_en)}.`
        : "",
    ),
  40: (p) => {
    // QAFIX-08: the code resolves through COMMUNITY_LABELS; pinned
    // payloads print their English free text verbatim (the trailing
    // " community" stripped as before).
    const label = COMMUNITY_LABELS[text(p.community_name)];
    const name = label
      ? label.en
      : cleanText(p.community_name_en).replace(/\s+community$/i, "");
    return name
      ? `The person is a member of the ${name} ethnic minority community.`
      : "The person is a member of the ethnic minority community stated in the application.";
  },
  43: (p) =>
    joinSentences(
      present(p.omission_details_en)
        ? `Reason for omission: ${cleanText(p.omission_details_en)}.`
        : "",
      present(p.omission_details_en)
        ? `The person's name was omitted from the voter list due to ${cleanText(p.omission_details_en)}.`
        : "The person's name was omitted from the voter list.",
      "The person is a permanent resident of this area and a citizen of Bangladesh; the person may be re-included in the voter list.",
    ),
  44: (p) => {
    const name = cleanText(p.previous_spouse_name_en);
    // QAFIX-09: the divorce branch (schema v5); pinned payloads take
    // the historical death sentences below, byte-identically.
    if (text(p.marriage_end_type) === "divorce") {
      if (!name) return "The person has not remarried since the divorce.";
      return joinSentences(
        `The person's previous marriage, to ${name}, ended in divorce${present(p.divorce_date) ? ` on ${enDateIso(p.divorce_date)}` : ""}.`,
        "Since the divorce, the person has not remarried.",
      );
    }
    if (!name)
      return "The person has not remarried since the spouse's death.";
    return joinSentences(
      `The person's spouse, the late ${name}, died${present(p.spouse_death_date) ? ` on ${enDateIso(p.spouse_death_date)}` : ""}.`,
      "Since the spouse's death, the person has not remarried and has been living with the children.",
    );
  },
  45: (p) =>
    present(p.residence_since)
      ? `The person has been permanently residing in this area since ${enDateIso(p.residence_since)}.`
      : "The person is a permanent resident of this area.",
};

/** Services whose attestation sentence is AUTHORED (not captured) — owner approval pending. */
export const AUTHORED_ATTESTATION_SERVICES = Object.keys(ATTESTATIONS_BN)
  .map(Number)
  .filter((no) => no !== 12 && no !== 37);

/* ---------- address composition (CERT-REFINE-01 A2 order: village/house, ward, union, upazila, district; post office omitted — no dataset) ---------- */
export function addressBn(freeText: unknown, parts?: GeoNameParts): string {
  const seg: string[] = [];
  if (present(freeText)) seg.push(`গ্রাম/বাড়ীঃ ${text(freeText)}`);
  if (parts?.wardNo) seg.push(`ওয়ার্ড নম্বরঃ ${bnDigits(parts.wardNo)}`);
  if (parts?.union?.bn) seg.push(`${parts.union.bn} ইউনিয়ন`);
  if (parts?.upazila?.bn) seg.push(`উপজেলাঃ ${parts.upazila.bn}`);
  if (parts?.district?.bn) seg.push(`জেলাঃ ${parts.district.bn}`);
  return seg.join(", ");
}
export function addressEn(freeText: unknown, parts?: GeoNameParts): string {
  const seg: string[] = [];
  if (present(freeText)) seg.push(`Village/House: ${text(freeText)}`);
  if (parts?.wardNo) seg.push(`Ward No: ${parts.wardNo}`);
  if (parts?.union?.en) seg.push(`${parts.union.en} Union`);
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

/**
 * CERT-REFINE-01 (A2): the standard identity block — name, father, mother,
 * then জাতীয় পরিচয়পত্র নম্বর (জন্ম নিবন্ধন নম্বর only when no NID exists).
 * The spouse segment left the block (QA: it appears only on services whose
 * format calls for it — 15, 25, 26, 34 — handled by the chassis there).
 */
function identitySegments(ctx: DocContext): string {
  const { input, bn } = ctx;
  const c = input.citizen;
  const parts: string[] = [];
  const name = bn ? c.full_name_bn : c.full_name_en;
  parts.push(`<strong>${escape(name)}</strong>`);
  const nid = input.identity?.nid;
  const birthReg = input.identity?.birthReg;
  if (bn) {
    if (present(c.father_name_bn)) parts.push(`পিতাঃ <strong>${escape(c.father_name_bn)}</strong>`);
    if (present(c.mother_name_bn)) parts.push(`মাতাঃ <strong>${escape(c.mother_name_bn)}</strong>`);
    if (present(nid)) parts.push(`জাতীয় পরিচয়পত্র নম্বরঃ <strong>${bnDigits(nid)}</strong>`);
    else if (present(birthReg)) parts.push(`জন্ম নিবন্ধন নম্বরঃ <strong>${bnDigits(birthReg)}</strong>`);
  } else {
    if (present(c.father_name_en)) parts.push(`Father: <strong>${escape(c.father_name_en)}</strong>`);
    if (present(c.mother_name_en)) parts.push(`Mother: <strong>${escape(c.mother_name_en)}</strong>`);
    if (present(nid)) parts.push(`National ID No: <strong>${escape(nid)}</strong>`);
    else if (present(birthReg)) parts.push(`Birth Registration No: <strong>${escape(birthReg)}</strong>`);
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

/**
 * Deceased-subject chassis for services 3, 4, 7, 31 — the paragraph is about
 * the deceased. CERT-REFINE-01: cholito register; the deceased's NID (svc3/4)
 * and the registration number print inside the deceased block, before the
 * heirs table; the table carries the spec column set with DD/MM/YYYY dates;
 * a মোট ওয়ারিশ total line, the closing line and the modernised falsity
 * caveat follow the table.
 */
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
    if ((serviceNo === 3 || serviceNo === 4) && present(get("nid")))
      identity.push(`জাতীয় পরিচয়পত্র নম্বরঃ <strong>${bnDigits(get("nid"))}</strong>`);
  } else {
    if (present(father)) identity.push(`Father: <strong>${escape(father)}</strong>`);
    if (present(mother)) identity.push(`Mother: <strong>${escape(mother)}</strong>`);
    if ((serviceNo === 3 || serviceNo === 4) && present(get("nid")))
      identity.push(`National ID No: <strong>${escape(get("nid"))}</strong>`);
  }
  const dod = get("dod");
  const registerNo = get("register_no");
  const sentences: string[] = [];
  if (serviceNo === 7 || serviceNo === 31) {
    const place = bn ? get("place_bn") : get("place");
    const reason = bn ? get("reason_bn") : get("reason");
    if (bn) {
      sentences.push(
        `তিনি ${present(dod) ? `${bnDateIso(dod)} তারিখে ` : ""}${present(place) ? `${text(place)} এ ` : ""}মৃত্যুবরণ করেছেন।`,
      );
      if (present(reason)) sentences.push(`মৃত্যুর কারণঃ ${text(reason)}।`);
      if (serviceNo === 31) sentences.push("তিনি অবিবাহিত অবস্থায় মৃত্যুবরণ করেছেন।");
      if (present(registerNo)) sentences.push(`মৃত্যু নিবন্ধন নংঃ ${bnDigits(registerNo)}।`);
    } else {
      // CERT-REFINE-02 (R2-15): "The death occurred on … at the
      // deceased's own residence, …" + the mapped cause wording.
      sentences.push(
        `The death occurred${present(dod) ? ` on ${enDateIso(dod)}` : ""}${present(place) ? ` at ${deathPlaceEn(place)}` : ""}.`,
      );
      if (present(reason)) sentences.push(`Cause of death: ${deathCauseEn(reason)}.`);
      if (serviceNo === 31) sentences.push("The person died unmarried.");
      if (present(registerNo)) sentences.push(`Death registration no: ${text(registerNo)}.`);
    }
  } else {
    if (bn) {
      sentences.push(
        `তিনি মৃত্যুবরণ করেছেন${present(dod) ? ` (মৃত্যুর তারিখঃ ${bnDateIso(dod)})` : ""}। তাঁহার ওয়ারিশগণ নিম্নরূপ:`,
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
    ? `এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, ${identity.join(", ")}, ঠিকানাঃ ${address}।`
    : // CERT-REFINE-02 (R2-15): "of address: Village/House:" → "of Village/House:".
      `This is to certify that ${identity.join(", ")}, of ${address}.`;
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
  let after = "";
  if (serviceNo === 3 || serviceNo === 4) {
    const heirs = Array.isArray(p.heirs) ? (p.heirs as Record<string, unknown>[]) : [];
    const schema = input.schema ?? getServiceSchema(serviceNo);
    // CERT-REFINE-01 §§3–4: column order ক্রমিক | নাম | পিতা/স্বামীর নাম | জন্ম
    // তারিখ | জাতীয় পরিচয়পত্র নম্বর | সম্পর্ক; the NID column always shows
    // (an empty cell for an heir without one is data, not decoration), the
    // father's name renders in the certificate's own language, dates print
    // DD/MM/YYYY, and the mobile column stays conditional on data.
    const withMobile = heirs.some((h) => present(h.warish_heir_mobile_no));
    const rows = heirs.map((h, i) => {
      const row = [
        bn ? bnDigits(i + 1) : String(i + 1),
        text(bn ? h.warish_heir_name_bn : h.warish_heir_name),
        text(bn ? h.warish_heir_father_name_bn : h.warish_heir_father_name),
        bn ? bnDateSlash(h.warish_heir_dob) : enDateSlash(h.warish_heir_dob),
        bn ? bnDigits(h.warish_heir_nid) : text(h.warish_heir_nid),
        selectLabel(schema, "heirs", "warish_heir_relation", h.warish_heir_relation, bn),
      ];
      if (withMobile) row.push(bn ? bnDigits(h.warish_heir_mobile_no) : text(h.warish_heir_mobile_no));
      return row;
    });
    const headers = bn
      ? ["ক্রমিক", "ওয়ারিশের নাম", "পিতা/স্বামীর নাম", "জন্ম তারিখ", "জাতীয় পরিচয়পত্র নম্বর", "সম্পর্ক"]
      : ["Sl", "Heir's name", "Father/Husband name", "Date of birth", "NID No", "Relation"];
    if (withMobile) headers.push(bn ? "মোবাইল নম্বর" : "Mobile No");
    table = dataTable(headers, rows);
    const totalLine = bn
      ? `মোট ওয়ারিশ: ${bnDigits(heirs.length)} জন।`
      : `Total heirs: ${heirs.length}.`;
    const closingLine = bn
      ? serviceNo === 4
        ? "উল্লিখিত ব্যক্তিগণই তাঁহার আইনগত উত্তরাধিকারী; তাঁহাদের ছাড়া আর কোনো ওয়ারিশ আছে বলে জানা যায় না।"
        : "উল্লিখিত ব্যক্তিগণ ছাড়া তাঁহার আর কোনো ওয়ারিশ আছে বলে জানা যায় না।"
      : serviceNo === 4
        ? "The persons listed are the legal successors; no other heir is known."
        : "No other heir is known besides the persons listed.";
    const caveat = bn
      ? "উল্লেখ্য যে, উপরোক্ত তথ্য পরবর্তীতে ভুল প্রমাণিত হলে এই সনদ বাতিল বলে গণ্য হবে এবং এ ব্যাপারে কর্তৃপক্ষ দায়ী থাকবে না।"
      : "If the above information is later proved incorrect, this certificate shall be deemed cancelled and the authority shall bear no responsibility.";
    after = `<p class="body-para">${escape(totalLine)}</p><p class="body-para">${escape(closingLine)}</p><p class="body-para">${escape(caveat)}</p>`;
  }
  return `<p class="body-para">${intro} ${sentences.join(" ")}</p>${table}${after}`;
}

/** Spouse sentence for the services whose format carries it (15, 34) — resolved from the citizen record. */
function spouseSentence(ctx: DocContext): string {
  const { input, bn } = ctx;
  const c = input.citizen;
  if (bn) {
    if (!present(c.spouse_name_bn)) return "";
    return c.gender === "male"
      ? `তাঁহার স্ত্রীর নাম ${text(c.spouse_name_bn)}।`
      : `তাঁহার স্বামীর নাম ${text(c.spouse_name_bn)}।`;
  }
  if (!present(c.spouse_name_en)) return "";
  return `The person's spouse is ${text(c.spouse_name_en)}.`;
}

/** CERT-REFINE-01 §2: family certificate — children counts, spec table, family closing. */
function familyBody(ctx: DocContext): string {
  const { input, bn } = ctx;
  const p = input.payload;
  const members = Array.isArray(p.members)
    ? (p.members as Record<string, unknown>[])
    : [];
  const schema = input.schema ?? getServiceSchema(2);
  const children = members.filter((m) => text(m.relationship) === "child");
  const sons = children.filter((m) => text(m.gender) === "male").length;
  const daughters = children.filter((m) => text(m.gender) === "female").length;
  const genderKnown = children.length > 0 && sons + daughters === children.length;
  const counts = !children.length
    ? ""
    : bn
      ? genderKnown
        ? `তাঁহার ${bnDigits(sons)} জন পুত্র ও ${bnDigits(daughters)} জন কন্যা রয়েছে।`
        : `তাঁহার ${bnDigits(children.length)} জন সন্তান রয়েছে।`
      : genderKnown
        ? `The person has ${sons} son(s) and ${daughters} daughter(s).`
        : `The person has ${children.length} children.`;
  // CERT-REFINE-01 (A3): service 2 is on the status-sentence list.
  const status = bn ? STATUS_SENTENCE_BN : STATUS_SENTENCE_EN;
  const intro = bn
    ? `এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, ${identitySegments(ctx)}, তাঁহার <strong>স্থায়ী ঠিকানাঃ</strong> ${escape(permanentAddress(ctx))}। ${escape(status)}`
    : `This is to certify that ${identitySegments(ctx)}, <strong>permanent address:</strong> ${escape(permanentAddress(ctx))}. ${escape(status)}`;
  const rows = members.map((m, i) => [
    bn ? bnDigits(i + 1) : String(i + 1),
    text(bn ? m.name_bn : m.name_en),
    bn ? bnDigits(m.warish_heir_nid) : text(m.warish_heir_nid),
    bn ? bnDateSlash(m.dob) : enDateSlash(m.dob),
    selectLabel(schema, "members", "relationship", m.relationship, bn),
  ]);
  const headers = bn
    ? ["ক্রমিক", "নাম", "আইডি/জন্মনিবন্ধন নং", "জন্ম তারিখ", "সম্পর্ক"]
    : ["Sl", "Name", "ID/Birth Reg No", "Date of birth", "Relationship"];
  const closing = bn
    ? "আমি উক্ত পরিবারের সর্বাঙ্গীণ মঙ্গল কামনা করছি।"
    : "I wish the family every prosperity.";
  // The base same-family attestation is retained (cholito register).
  const familyLine = bn
    ? "এই সনদে উল্লিখিত ব্যক্তিগণ একই পরিবারের সদস্য বলে প্রত্যয়ন করা যাচ্ছে।"
    : "The persons listed in this certificate are members of the same family.";
  return `<p class="body-para">${counts ? `${intro} ${escape(counts)}` : intro}</p>${dataTable(headers, rows)}<p class="body-para">${escape(familyLine)}</p><p class="closing">${escape(closing)}</p>`;
}

/** CERT-REFINE-01 §19: consent certificate — guardian block, child block, consent clause, guardian signature block. */
function consentBody(ctx: DocContext): string {
  const { input, bn } = ctx;
  const p = input.payload;
  const schema = input.schema ?? getServiceSchema(19);
  const guardian = bn
    ? `অভিভাবকঃ ${identitySegments(ctx)}, তাঁহার <strong>স্থায়ী ঠিকানাঃ</strong> ${escape(permanentAddress(ctx))}।`
    : `Guardian: ${identitySegments(ctx)}, <strong>permanent address:</strong> ${escape(permanentAddress(ctx))}.`;
  const childName = text(bn ? p.consent_child_name_bn : p.consent_child_name_en);
  const relation = selectLabel(schema, "consent_child_relation", undefined, p.consent_child_relation, bn);
  const subject = selectLabel(schema, "consent_subject", undefined, p.consent_subject, bn);
  // CERT-REFINE-02 (R2-18): the child block takes the standard
  // label-value grid (label 132 pt regular, value bold, 4 pt row
  // padding) instead of loose <br> lines.
  const childRows: [string, string][] = bn
    ? [
        ["সন্তানের নাম:", childName],
        ["জন্ম তারিখ:", present(p.consent_child_dob) ? bnDateIso(p.consent_child_dob) : ""],
        ["জন্ম নিবন্ধন নম্বর:", present(p.consent_child_birth_reg) ? bnDigits(p.consent_child_birth_reg) : ""],
        ["সম্পর্ক:", relation],
      ]
    : [
        ["Child's name:", childName],
        ["Date of birth:", present(p.consent_child_dob) ? enDateIso(p.consent_child_dob) : ""],
        ["Birth registration no:", present(p.consent_child_birth_reg) ? text(p.consent_child_birth_reg) : ""],
        ["Relationship:", relation],
      ];
  const childBlock = `<div class="consent-grid">${childRows
    .filter(([, v]) => present(v))
    .map(
      ([l, v]) =>
        `<div class="consent-row"><span>${escape(l)}</span><strong>${escape(v)}</strong></div>`,
    )
    .join("")}</div>`;
  const guardianName = text(bn ? input.citizen.full_name_bn : input.citizen.full_name_en);
  const clause = bn
    ? `আমি ${escape(guardianName)}, আমার ${relation ? `${escape(relation)} ` : ""}<strong>${escape(childName)}</strong> এর ${escape(subject)} বিষয়ে সম্মতি প্রদান করিলাম।`
    : `I, ${escape(guardianName)}, give my consent for my ${relation ? `${escape(relation)} ` : ""}<strong>${escape(childName)}</strong> in respect of ${escape(subject)}.`;
  const sign = bn
    ? `<div class="guardian-sign"><div class="sign-line"></div><div>অভিভাবকের স্বাক্ষর</div><div>নামঃ ${escape(guardianName)}</div></div>`
    : `<div class="guardian-sign"><div class="sign-line"></div><div>Guardian's signature</div><div>Name: ${escape(guardianName)}</div></div>`;
  return `<p class="body-para">${guardian}</p>${childBlock}<p class="body-para">${clause}</p>${sign}`;
}

/** CERT-REFINE-01 §§25–26: marriage certificate — groom and bride blocks, joint line, (26) dowry line. */
function marriageBody(ctx: DocContext, serviceNo: number): string {
  const { input, bn } = ctx;
  const p = input.payload;
  const c = input.citizen;
  // CERT-REFINE-02 (R2-17): each party box gets a #F2F2F2 heading band;
  // inside, a fixed 118 pt label column with bold 11.5 pt values; the
  // closing lines form one standalone paragraph with the date bold.
  const block = (title: string, lines: [string, string][]) =>
    `<div class="person-block"><div class="person-title">${escape(title)}</div><div class="person-rows">${lines
      .filter(([, v]) => present(v))
      .map(([l, v]) => `<div class="person-row"><span>${escape(l)}</span><strong>${escape(v)}</strong></div>`)
      .join("")}</div></div>`;
  const citizenLines: [string, string][] = bn
    ? [
        ["নামঃ", text(c.full_name_bn)],
        ["পিতাঃ", text(c.father_name_bn)],
        ["মাতাঃ", text(c.mother_name_bn)],
        ["ঠিকানাঃ", permanentAddress(ctx)],
        ["জন্ম তারিখঃ", present(c.date_of_birth) ? bnDateIso(c.date_of_birth) : ""],
        ["জাতীয় পরিচয়পত্র নম্বরঃ", bnDigits(input.identity?.nid ?? "")],
      ]
    : [
        ["Name:", text(c.full_name_en)],
        ["Father:", text(c.father_name_en)],
        ["Mother:", text(c.mother_name_en)],
        ["Address:", permanentAddress(ctx)],
        ["Date of birth:", present(c.date_of_birth) ? enDateIso(c.date_of_birth) : ""],
        ["National ID No:", text(input.identity?.nid ?? "")],
      ];
  const spouseLines: [string, string][] = bn
    ? [
        ["নামঃ", text(p.marriage_info_spouse_name_bn)],
        ["পিতাঃ", text(p.marriage_info_spouse_father_name_bn)],
        ["মাতাঃ", text(p.marriage_info_spouse_mother_name_bn)],
        ["ঠিকানাঃ", text(p.marriage_info_spouse_address_bn)],
        ["জন্ম তারিখঃ", present(p.marriage_info_spouse_dob) ? bnDateIso(p.marriage_info_spouse_dob) : ""],
        ["জাতীয় পরিচয়পত্র নম্বরঃ", bnDigits(p.marriage_info_spouse_nid ?? "")],
      ]
    : [
        ["Name:", text(p.marriage_info_spouse_name)],
        ["Father:", text(p.marriage_info_spouse_father_name_en)],
        ["Mother:", text(p.marriage_info_spouse_mother_name_en)],
        ["Address:", text(p.marriage_info_spouse_address_en)],
        ["Date of birth:", present(p.marriage_info_spouse_dob) ? enDateIso(p.marriage_info_spouse_dob) : ""],
        ["National ID No:", text(p.marriage_info_spouse_nid ?? "")],
      ];
  const citizenIsGroom = c.gender !== "female";
  const groom = citizenIsGroom ? citizenLines : spouseLines;
  const bride = citizenIsGroom ? spouseLines : citizenLines;
  const jointDate = present(p.marriage_info_date)
    ? bn
      ? bnDateIso(p.marriage_info_date)
      : enDateIso(p.marriage_info_date)
    : "";
  const joint = bn
    ? `বিবাহের তারিখঃ <strong>${escape(jointDate)}</strong>${present(p.marriage_info_spouse_place_bn) ? `, বিবাহের স্থানঃ ${escape(text(p.marriage_info_spouse_place_bn))}` : ""}।`
    : `Date of marriage: <strong>${escape(jointDate)}</strong>${present(p.marriage_info_spouse_place) ? `, Place of marriage: ${escape(text(p.marriage_info_spouse_place))}` : ""}.`;
  const intro = bn ? "এই মর্মে প্রত্যয়ন করা যাচ্ছে যে," : "This is to certify that";
  const dowry =
    serviceNo === 26
      ? bn
        ? " উক্ত বিবাহ যৌতুক বিহীনভাবে সম্পন্ন হয়েছে।"
        : " The said marriage was completed without dowry."
      : "";
  return `<p class="body-para">${escape(intro)}</p>${block(bn ? "বর" : "Groom", groom)}${block(bn ? "কনে" : "Bride", bride)}<p class="marriage-closing">${joint}${dowry}</p>`;
}

/** CERT-REFINE-01 §39: same-person declaration — the variant names print in the clause. */
function samePersonBody(ctx: DocContext): string {
  const { input, bn } = ctx;
  const p = input.payload;
  const name = text(bn ? input.citizen.full_name_bn : input.citizen.full_name_en);
  const v1 = text(bn ? p.spi_name_bn : p.spi_name_en);
  const v2 = text(bn ? p.spi_name_2_bn : p.spi_name_2_en);
  const intro = bn
    ? `এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, ${identitySegments(ctx)}, তাঁহার <strong>স্থায়ী ঠিকানাঃ</strong> ${escape(permanentAddress(ctx))}।`
    : `This is to certify that ${identitySegments(ctx)}, <strong>permanent address:</strong> ${escape(permanentAddress(ctx))}.`;
  // CERT-REFINE-01 §39: the spec's declaration — correct name, the variants
  // as they appear in documents, and the same-person statement.
  const clause =
    present(v2) && v2 !== name
      ? bn
        ? `আবেদনকারীর সঠিক নাম: <strong>${escape(name)}</strong>। বিভিন্ন নথিতে তাঁহার নাম ${escape(v1)} এবং ${escape(v2)} হিসেবে উল্লেখিত হয়েছে। উল্লিখিত সকল নাম একই ব্যক্তির।`
        : `The applicant's correct name is <strong>${escape(name)}</strong>. The names ${escape(v1)} and ${escape(v2)} appearing in various documents all belong to one and the same person.`
      : bn
        ? `আবেদনকারীর সঠিক নাম: <strong>${escape(name)}</strong>। বিভিন্ন নথিতে তাঁহার নাম ${escape(v1)} হিসেবে উল্লেখিত হয়েছে। উল্লিখিত সকল নাম একই ব্যক্তির।`
        : `The applicant's correct name is <strong>${escape(name)}</strong>. The name ${escape(v1)} appearing in various documents belongs to one and the same person.`;
  return `<p class="body-para">${intro}</p><p class="body-para">${clause}</p>`;
}

/** The paragraph chassis — the default for attestation-type services. */
function paragraphBody(ctx: DocContext, serviceNo: number): string {
  const { input, bn } = ctx;
  const p = input.payload;
  if (serviceNo === 3 || serviceNo === 4 || serviceNo === 7 || serviceNo === 31)
    return deceasedParagraph(ctx, serviceNo);
  if (serviceNo === 2) return familyBody(ctx);
  if (serviceNo === 19) return consentBody(ctx);
  if (serviceNo === 25 || serviceNo === 26) return marriageBody(ctx, serviceNo);
  if (serviceNo === 39) return samePersonBody(ctx);
  if (serviceNo === 47) {
    const body = text(bn ? p.certificate_details_bn : p.certificate_details_en);
    const footer = text(bn ? p.certificate_footer_bn : p.certificate_footer_en);
    // CERT-REFINE-01 §47: the A2 identity paragraph prints above the narrative.
    const intro = bn
      ? `<p class="body-para">এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, ${identitySegments(ctx)}, তাঁহার <strong>স্থায়ী ঠিকানাঃ</strong> ${escape(permanentAddress(ctx))}।</p>`
      : `<p class="body-para">This is to certify that ${identitySegments(ctx)}, <strong>permanent address:</strong> ${escape(permanentAddress(ctx))}.</p>`;
    return `${intro}<p class="body-para">${escape(body).replace(/\n/g, "<br>")}</p>${footer ? `<p class="free-footer">${escape(footer)}</p>` : ""}`;
  }
  if (serviceNo === 27) {
    // CERTNO-01 (owner decision D5): service 27 is a recommendation LETTER
    // addressed to the passport office, not a certificate paragraph — it
    // keeps BOTH addresses per the owner-approved letter format; the
    // register fixes of CERT-REFINE-01 (A4) still apply.
    // CERT-REFINE-02 (R2-16): the purpose localises by value (the field
    // is free text; standard purposes map, others print as stored).
    // (R2-18): the addressee lines take the letter-addr style (12 pt,
    // 4 pt spacing); the subject line stays bold.
    const purpose = passportPurposeLabel(p.passport_purpose, bn);
    const closing = bn
      ? "আমি তাঁহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।"
      : "I wish the certificate holder every success and prosperity.";
    const letter = bn
      ? `<p class="letter-addr">বরাবর,<br>সহকারী পরিচালক,<br>আঞ্চলিক পাসপোর্ট অফিস।</p><p class="body-para"><strong>বিষয়ঃ পাসপোর্ট প্রদানের সুপারিশ।</strong></p><p class="body-para">এই মর্মে সুপারিশ করা যাচ্ছে যে, ${identitySegments(ctx)}, তাঁহার <strong>স্থায়ী ঠিকানাঃ</strong> ${escape(permanentAddress(ctx))}। <strong>বর্তমান ঠিকানাঃ</strong> ${escape(presentAddress(ctx))}। তিনি পাসপোর্টের জন্য আবেদন করেছেন${purpose ? ` (উদ্দেশ্যঃ ${escape(purpose)})` : ""}। তাঁহার বিরুদ্ধে কোনো ফৌজদারি অভিযোগ জানা নাই। তাঁহাকে পাসপোর্ট প্রদানে এই কার্যালয়ের কোনো আপত্তি নাই।</p>`
      : `<p class="letter-addr">To,<br>The Assistant Director,<br>Regional Passport Office.</p><p class="body-para"><strong>Subject: Recommendation for passport issuance.</strong></p><p class="body-para">This is to recommend that ${identitySegments(ctx)}, <strong>permanent address:</strong> ${escape(permanentAddress(ctx))}. <strong>Present address:</strong> ${escape(presentAddress(ctx))}. The person has applied for a passport${purpose ? ` (purpose: ${escape(purpose)})` : ""}. No criminal complaint is known against the person. This office has no objection to a passport being issued to the person.</p>`;
    return `${letter}<p class="closing">${escape(closing)}</p>`;
  }
  const attestation = run(
    bn ? ATTESTATIONS_BN[serviceNo] : ATTESTATIONS_EN[serviceNo],
    p,
    { gender: input.citizen.gender },
  );
  // CERT-REFINE-01 (A3): the residence/citizenship/personally-known sentence
  // follows the identity block for the listed services.
  const status = STATUS_SENTENCE_SERVICES.has(serviceNo)
    ? bn
      ? STATUS_SENTENCE_BN
      : STATUS_SENTENCE_EN
    : "";
  const spouse = serviceNo === 15 || serviceNo === 34 ? spouseSentence(ctx) : "";
  // CERT-REFINE-01 §9: the subject's NID prints as its own sentence.
  const nidLine =
    serviceNo === 9 && present(input.identity?.nid)
      ? bn
        ? `জাতীয় পরিচয়পত্র/ভোটার নম্বর: ${bnDigits(input.identity?.nid)}।`
        : `National ID/Voter No: ${text(input.identity?.nid)}.`
      : "";
  const extras = [status, spouse, nidLine].filter(Boolean).join(" ");
  const para = bn
    ? `এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, ${identitySegments(ctx)}, তাঁহার <strong>স্থায়ী ঠিকানাঃ</strong> ${escape(permanentAddress(ctx))}।${extras ? ` ${escape(extras)}` : ""}${attestation ? ` ${escape(attestation)}` : ""}`
    : `This is to certify that ${identitySegments(ctx)}, <strong>permanent address:</strong> ${escape(permanentAddress(ctx))}.${extras ? ` ${escape(extras)}` : ""}${attestation ? ` ${escape(attestation)}` : ""}`;
  // CERT-REFINE-01 §20: the service narrative prints as its own paragraph,
  // under the spec's label.
  const narrative =
    serviceNo === 20 &&
    present(bn ? p.freedom_fighter_service_narrative_bn : p.freedom_fighter_service_narrative_en)
      ? `<p class="body-para">${bn ? "মুক্তিযুদ্ধে অংশগ্রহণের বিবরণ:" : "Details of participation in the Liberation War:"} ${escape(text(bn ? p.freedom_fighter_service_narrative_bn : p.freedom_fighter_service_narrative_en))}</p>`
      : "";
  if (serviceNo === 33) {
    const corrections = Array.isArray(p.corrections)
      ? (p.corrections as Record<string, unknown>[])
      : [];
    const schema = input.schema ?? getServiceSchema(33);
    // CERT-REFINE-01 §33: the field column prints the correction field's
    // label (schema label first, the fixed label map as fallback).
    const rows = corrections.map((c, i) => {
      const fromSchema = selectLabel(schema, "corrections", "correction_category_id", c.correction_category_id, bn);
      const fieldLabel =
        fromSchema !== text(c.correction_category_id)
          ? fromSchema
          : (CORRECTION_FIELD_LABELS[text(c.correction_category_id)]?.[bn ? "bn" : "en"] ?? fromSchema);
      return [
        bn ? bnDigits(i + 1) : String(i + 1),
        fieldLabel,
        text(c.incorrect_info),
        text(c.correct_info),
      ];
    });
    const intro = bn
      ? "তাঁহার জাতীয় পরিচয় তথ্যে নিম্নোক্ত সংশোধন প্রয়োজন বলে প্রত্যয়ন করা যাচ্ছে:"
      : "The following corrections to the national identity information are required:";
    const table = `<p class="body-para">${escape(intro)}</p>${dataTable(
      bn ? ["ক্রমিক", "তথ্যের ধরণ", "ভুল তথ্য", "সঠিক তথ্য"] : ["Sl", "Field", "Incorrect information", "Correct information"],
      rows,
    )}`;
    return `<p class="body-para">${para}</p>${table}`;
  }
  // CERT-REFINE-02 (R2-12): the well-wish prints ONLY on the retained
  // services (12, 15, 21, 22, 27, 45) — mirror of the react-pdf chassis.
  const closing = [12, 15, 21, 22, 27, 45].includes(serviceNo)
    ? bn
      ? "আমি তাঁহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।"
      : "I wish the certificate holder every success and prosperity."
    : "";
  const closingHtml = closing ? `<p class="closing">${escape(closing)}</p>` : "";
  if (serviceNo === 37) {
    // CERT-REFINE-01 §37: the previous voter area, the residing-since date
    // and the NID print as a fields line under the recommendation clause.
    const fields = bn
      ? `পূর্বের ভোটার এলাকাঃ ${escape(text(p.previous_voter_area))}${present(p.voter_transfer_residing_since) ? `, অত্র এলাকায় বসবাসের শুরু: ${escape(bnDateIso(p.voter_transfer_residing_since))}` : ""}${present(input.identity?.nid) ? `, জাতীয় পরিচয়পত্র নম্বরঃ ${bnDigits(input.identity?.nid)}` : ""}।`
      : `Previous voter area: ${escape(text(p.previous_voter_area_en ?? p.previous_voter_area))}${present(p.voter_transfer_residing_since) ? `, residing at the present address since: ${escape(enDateIso(p.voter_transfer_residing_since))}` : ""}${present(input.identity?.nid) ? `, National ID No: ${escape(text(input.identity?.nid))}` : ""}.`;
    return `<p class="body-para">${para}</p><p class="body-para">${fields}</p>${closingHtml}`;
  }
  return `<p class="body-para">${para}</p>${narrative}${closingHtml}`;
}

/* ---------- trade licence (service 42) — the sampled form ----------
 * CERT-REFINE-01 §42: the owner's address blocks STACK vertically (the
 * side-by-side columns collided); empty address rows are omitted; the
 * always-empty serial row is gone; section headings are unnumbered; the fee
 * rows print the itemised components captured on the application (absent
 * components are omitted; the total is the component sum, falling back to
 * the order total); the validity and grant lines print; the QR moves to the
 * bottom-left footer (assembly) so it can never overlap the office name. */
function tradeLicenceBody(ctx: DocContext, emblem: string, logo = ""): string {
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
          ["গ্রাম/মহল্লা", text(free)],
          ["উপজেলা", parts?.upazila?.bn ?? ""],
          ["জেলা", parts?.district?.bn ?? ""],
          ["বিভাগ", parts?.division?.bn ?? ""],
          ["দেশ", "বাংলাদেশ"],
        ]
      : [
          ["Village/Area", text(free)],
          ["Upazila", parts?.upazila?.en ?? ""],
          ["District", parts?.district?.en ?? ""],
          ["Division", parts?.division?.en ?? ""],
          ["Country", "Bangladesh"],
        ];
    // CERT-REFINE-01: rows with no value are omitted — no blank labelled rows.
    return rows
      .filter(([, value]) => present(value))
      .map(([label, value]) => `<div class="addr-row"><span>${escape(label)}</span><span>: ${escape(value)}</span></div>`)
      .join("");
  };
  const field = (no: string, label: string, value: unknown, digits = false) =>
    `<tr><td class="fl">${escape(no)}. ${escape(label)}</td><td class="fv">: ${escape(digits ? bnDigits(value) : value)}</td></tr>`;
  const sub = (label: string, value: unknown, digits = false) =>
    `<tr><td class="fl sub">${escape(label)}</td><td class="fv">: ${escape(digits ? bnDigits(value) : value)}</td></tr>`;
  const groupHead = (label: string) =>
    `<tr><td colspan="2" class="group-head">${escape(label)}</td></tr>`;
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
        presentHead: "বর্তমান ঠিকানা", permanentHead: "স্থায়ী ঠিকানা",
        groups: ["ব্যবসা সংক্রান্ত তথ্য", "জাতীয়তা ও যোগাযোগ", "অর্থ বছর ও ব্যবসা শুরুর তারিখ", "মালিকের ঠিকানা"],
        feeHead: "ট্রেড লাইসেন্স ফি (নতুন/নবায়ন)",
        fees: ["নতুন", "নবায়ন", "বকেয়া", "সারচার্জ", "সংশোধন ফি", "সাইনবোর্ড (পরিচিতিমূলক)", "পেশা ব্যবসা ও বৃত্তির উপর কর", "ভ্যাট"],
        total: "সর্বমোট",
        nums: ["১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯", "১০", "১১"],
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
        presentHead: "Present Address", permanentHead: "Permanent Address",
        groups: ["Business Information", "Nationality and Contact", "Fiscal Year and Business Start Date", "Owner's Address"],
        feeHead: "Trade License Fee (New/Renewal)",
        fees: ["New", "Renewal", "Arrear", "Surcharge", "Amendment Fee", "Signboard Fee", "Taxes on Profession & Trades", "VAT"],
        total: "Total",
        nums: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"],
      };
  const n = labels.nums;
  const businessType = selectLabel(input.schema ?? getServiceSchema(42), "business_type", undefined, p.business_type, bn);
  // CERT-REFINE-01: fee components from the application payload; the total
  // is their sum, falling back to the order total when none were captured.
  const feeKeys = [
    "trade_fee_new", "trade_fee_renewal", "trade_fee_arrear", "trade_fee_surcharge",
    "trade_fee_amendment", "trade_fee_signboard", "trade_fee_profession_tax", "trade_fee_vat",
  ];
  const feeRows = feeKeys
    .map((key, i) => ({ label: labels.fees[i]!, value: present(p[key]) ? Number(p[key]) : null }))
    .filter((r) => r.value !== null && r.value > 0);
  const componentSum = feeRows.reduce((acc, r) => acc + (r.value ?? 0), 0);
  const totalTaka = feeRows.length
    ? componentSum
    : input.order
      ? Number(input.order.totalMinor) / 100
      : null;
  const feeFmt = (v: number) => {
    const s = v.toLocaleString("en-IN", { minimumFractionDigits: 2 });
    return bn ? bnDigits(s) : s;
  };
  const feeTable = `<table class="fees">${feeRows
    .map((r) => `<tr><td>${escape(r.label)}</td><td class="fee-val">${escape(feeFmt(r.value ?? 0))}</td></tr>`)
    .join("")}${totalTaka !== null ? `<tr class="total"><td>${escape(labels.total)}</td><td class="fee-val">${escape(feeFmt(totalTaka))}</td></tr>` : ""}</table>`;
  // CERT-REFINE-01 §42: validity + grant, the spec's verbatim wording.
  const validity = bn
    ? `মেয়াদ: ১ জুলাই ${bnDigits(fy.start)} থেকে ৩০ জুন ${bnDigits(fy.end)} পর্যন্ত।`
    : `Validity: 1 July ${fy.start} to 30 June ${fy.end}.`;
  const grant = bn
    ? "উল্লিখিত ব্যবসা প্রতিষ্ঠানকে ব্যবসা পরিচালনার জন্য এই লাইসেন্স প্রদান করা হলো।"
    : "The licence is hereby granted to the above business to carry on its trade.";
  return `
  <div class="tl-top">
    <div class="tl-head">
      <div class="govt-line sm">${escape(bn ? GOVT_LINE_BN : GOVT_LINE_EN)}</div>
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
    ${groupHead(labels.groups[0]!)}
    ${field(n[0]!, labels.fields[0]!, bn ? p.business_name_bn : p.business_name_en)}
    ${field(n[1]!, labels.fields[1]!, bn ? p.proprietor_name_bn : p.proprietor_name_en)}
    ${field(n[2]!, labels.fields[2]!, bn ? p.proprietor_mother_name_bn : p.proprietor_mother_name)}
    ${field(n[3]!, labels.fields[3]!, bn ? p.proprietor_father_name_bn : p.proprietor_father_name)}
    ${field(n[4]!, labels.fields[4]!, bn ? p.proprietor_spouse_name_bn : p.proprietor_spouse_name)}
    ${field(n[5]!, labels.fields[5]!, orgTypeLabel(p, bn))}
    ${field(n[6]!, labels.fields[6]!, businessType)}
    ${field(n[7]!, labels.fields[7]!, businessAddress)}
    <tr><td class="fl">${n[8]}.</td><td class="fv subpair"><div><span>${escape(labels.zone)}</span><span>: ${escape(bn ? bnDigits(text(p.trade_license_org_zone_bn) || text(p.trade_license_org_zone)) : text(p.trade_license_org_zone))}</span></div><div><span>${escape(labels.ward)}</span><span>: ${escape(bn ? bnDigits(wardNo) : wardNo)}</span></div></td></tr>
    ${groupHead(labels.groups[1]!)}
    <tr><td class="fl">${n[9]}.</td><td class="fv subpair"><div><span>${escape(labels.idA)}</span><span>: ${escape(bn ? bnDigits(identityNo) : identityNo)}</span></div><div><span>${escape(labels.idB)}</span><span>: ${escape(bn ? bnDigits(text(p.trade_license_tin_no)) : text(p.trade_license_tin_no))}</span></div></td></tr>
    <tr><td class="fl"></td><td class="fv subpair"><div><span>${escape(labels.idC)}</span><span>: ${escape(bn ? bnDigits(text(p.trade_license_bin_no)) : text(p.trade_license_bin_no))}</span></div><div><span>${escape(labels.idD)}</span><span>: ${escape(bn ? bnDigits(text(p.mobile)) : text(p.mobile))}</span></div></td></tr>
    ${sub(labels.idE, p.trade_license_email)}
    ${groupHead(labels.groups[2]!)}
    <tr><td class="fl">${n[10]}.</td><td class="fv subpair"><div><span>${escape(labels.fyA)}</span><span>: ${escape(bn ? bnDigits(`${fy.start} - ${fy.end}`) : `${fy.start} - ${fy.end}`)}</span></div><div><span>${escape(labels.fyB)}</span><span>: ${escape(bn ? bnDateIso(p.start_date) : enDateIso(p.start_date))}</span></div></td></tr>
    ${groupHead(labels.groups[3]!)}
    <tr><td colspan="2"><div class="addr-block"><div class="addr-head">${escape(labels.presentHead)}</div>${citizenParts("present")}</div><div class="addr-block"><div class="addr-head">${escape(labels.permanentHead)}</div>${citizenParts("permanent")}</div></td></tr>
    <tr><td colspan="2" class="group-head">${escape(labels.feeHead)}</td></tr>
    <tr><td colspan="2">${feeTable}</td></tr>
  </table>
  <p class="validity">${escape(validity)}</p>
  <p class="grant">${escape(grant)}</p>`;
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
  return `<div class="numline"><span class="numline-no">${bn ? "রসিদ নং:" : "Receipt No:"} ${numberStripHtml(ctx.input.number, bn)}</span><span>${bn ? "তারিখ:" : "Date:"} ${escape(bn ? bnDate(issued) : enDate(issued))}</span></div>`;
}

/* ---------- service 1: holding-tax receipt (আদায় রশিদ) — CERTNO-01 catalog §1 ----------
 * CERT-REFINE-01 §1: the receipt carries the receipt fields (রসিদ নং — the
 * certificate number, no distinct receipt sequence exists in the data model
 * — তারিখ, taxpayer identity incl. father/husband and mother, village, ward,
 * holding), the property description from the language pair, the year table
 * (অর্থবছর | ধার্যকৃত | আদায়কৃত | বকেয়া) with the total row, the amount in
 * words, the collection date and the collector's signature line. */
function taxReceiptBody(ctx: DocContext): string {
  const { input, bn, issued } = ctx;
  const p = input.payload;
  const c = input.citizen;
  const totalTaka = input.order ? Number(input.order.totalMinor) / 100 : null;
  const totalFig = totalTaka !== null ? totalTaka.toLocaleString("en-IN") : "";
  const totalWords =
    totalTaka !== null ? (bn ? amountInWordsBn(totalTaka) : amountInWordsEn(totalTaka)) : "";
  const row = (label: string, value: string) =>
    present(value)
      ? `<div class="gf-field"><span>${escape(label)}</span><span>: ${escape(value)}</span></div>`
      : "";
  const taxYearRaw = text(p.tax_year);
  const yearLabel = /^\d{4}$/.test(taxYearRaw)
    ? `${taxYearRaw}-${Number(taxYearRaw) + 1}`
    : taxYearRaw;
  const ward = input.citizenGeography?.permanent?.wardNo ?? "";
  const village = text(bn ? c.address_bn : c.address_en);
  const property = bn
    ? text(p.property_description_bn ?? p.property_description)
    : text(p.property_description_en ?? p.property_description);
  const fatherOrHusband = bn ? c.father_name_bn : c.father_name_en;
  return `<div class="generic-form">
    ${citizenPhotoHtml(input)}
    ${row(bn ? "রসিদ নং" : "Receipt No", bn ? bnDigits(input.number) : latinDigits(input.number))}
    ${row(bn ? "তারিখ" : "Date", bn ? bnDate(issued) : enDate(issued))}
    ${row(bn ? "করদাতার নাম" : "Taxpayer", text(bn ? c.full_name_bn : c.full_name_en))}
    ${row(bn ? "পিতা/স্বামীর নাম" : "Father/Husband name", text(fatherOrHusband))}
    ${row(bn ? "মাতা" : "Mother", text(bn ? c.mother_name_bn : c.mother_name_en))}
    ${row(bn ? "গ্রাম" : "Village", village)}
    ${row(bn ? "ওয়ার্ড নং" : "Ward No", bn ? bnDigits(ward) : text(ward))}
    ${row(bn ? "হোল্ডিং নম্বর" : "Holding No", bn ? bnDigits(p.holding_reference) : text(p.holding_reference))}
    ${row(bn ? "অর্থবছর" : "Fiscal year", bn ? bnDigits(yearLabel) : yearLabel)}
    ${row(bn ? "সম্পত্তির বিবরণ" : "Property description", property)}
    <table class="data"><thead><tr><th>${bn ? "অর্থবছর" : "Fiscal year"}</th><th>${bn ? "ধার্যকৃত কর (টাকা)" : "Assessed (BDT)"}</th><th>${bn ? "আদায়কৃত (টাকা)" : "Collected (BDT)"}</th><th>${bn ? "বকেয়া (টাকা)" : "Arrear (BDT)"}</th></tr></thead><tbody><tr><td>${escape(bn ? bnDigits(yearLabel) : yearLabel)}</td><td>${escape(bn ? bnDigits(totalFig) : totalFig)}</td><td>${escape(bn ? bnDigits(totalFig) : totalFig)}</td><td>${escape(bn ? "০" : "0")}</td></tr><tr><td><strong>${bn ? "সর্বমোট" : "Total"}</strong></td><td><strong>${escape(bn ? bnDigits(totalFig) : totalFig)}</strong></td><td><strong>${escape(bn ? bnDigits(totalFig) : totalFig)}</strong></td><td><strong>${escape(bn ? "০" : "0")}</strong></td></tr></tbody></table>
    ${totalTaka !== null ? `<p class="body-para">${bn ? `কথায়ঃ ${escape(totalWords)} টাকা মাত্র।` : `In words: ${escape(totalWords)} Taka only.`}</p>` : ""}
    <div class="guardian-sign"><div class="sign-line"></div><div>${bn ? "আদায়কারীর স্বাক্ষর" : "Collector's signature"}</div></div>
  </div>`;
}

/* ---------- service 41: premises licence on the trade-licence layout (owner decision D4) ----------
 * CERT-REFINE-01 §41: the TIN row prints only when a TIN exists; the capital
 * carries thousand separators; the fee block prints লাইসেন্স ফি / ভ্যাট /
 * সর্বমোট from the captured components (falling back to the order total);
 * the validity line is cholito and suffix-free; the grant line closes it. */
function premisesLicenceBody(ctx: DocContext): string {
  const { input, bn, issued } = ctx;
  const p = input.payload;
  const fy = fiscalYear(issued);
  const orgGeo = input.geographyNames?.["org_location"];
  // CERT-REFINE-02 (R2-21): the premises grid — label column 150 pt,
  // the colon at a fixed x (its own 18 pt cell), values from 168 pt.
  const field = (label: string, value: unknown, digits = false) =>
    `<tr><td class="fl">${escape(label)}</td><td class="fc">:</td><td class="fv">${escape(digits ? bnDigits(value) : value)}</td></tr>`;
  const capital = present(p.primises_license_capital)
    ? Number(p.primises_license_capital).toLocaleString("en-IN")
    : "";
  const feeLicence = present(p.premises_fee_licence) ? Number(p.premises_fee_licence) : null;
  const feeVat = present(p.premises_fee_vat) ? Number(p.premises_fee_vat) : null;
  const feeTotal =
    feeLicence !== null || feeVat !== null
      ? (feeLicence ?? 0) + (feeVat ?? 0)
      : input.order
        ? Number(input.order.totalMinor) / 100
        : null;
  const feeFmt = (v: number) => {
    const s = v.toLocaleString("en-IN", { minimumFractionDigits: 2 });
    return bn ? bnDigits(s) : s;
  };
  return `<div class="tl-doc">
    ${citizenPhotoHtml(input)}
    ${formMetaLine(ctx)}
    <table class="fields premises">
      ${field(bn ? "লাইসেন্সধারী" : "Licensee", bn ? p.primises_license_proprietor_bn : p.primises_license_proprietor)}
      ${field(bn ? "প্রতিষ্ঠানের নাম" : "Establishment", bn ? p.primises_license_org_name_bn : p.primises_license_org_name)}
      ${field(bn ? "প্রতিষ্ঠানের ধরণ" : "Business type", bn ? p.primises_license_org_type_bn : p.primises_license_org_type)}
      ${field(bn ? "প্রাঙ্গণের ঠিকানা" : "Premises address", bn ? p.primises_license_org_area_holding_bn : p.primises_license_org_area_holding)}
      ${orgGeo ? field(bn ? "এলাকা" : "Area", orgGeo[bn ? "bn" : "en"]) : ""}
      ${field(bn ? "মূলধন (টাকা)" : "Capital (BDT)", bn ? bnDigits(capital) : capital)}
      ${present(p.primises_license_tin_no) ? field(bn ? "টিআইএন" : "TIN", p.primises_license_tin_no, true) : ""}
      ${field(bn ? "ওয়ার্ড নং" : "Ward No", p.primises_license_org_ward_no, true)}
      ${feeLicence !== null ? field(bn ? "লাইসেন্স ফি (টাকা)" : "Licence fee (BDT)", feeFmt(feeLicence)) : ""}
      ${feeVat !== null ? field(bn ? "ভ্যাট (টাকা)" : "VAT (BDT)", feeFmt(feeVat)) : ""}
      ${feeTotal !== null ? field(bn ? "সর্বমোট ফি (টাকা)" : "Total fee (BDT)", feeFmt(feeTotal)) : ""}
    </table>
    <p class="premises-closing"><strong>${bn ? `মেয়াদ: ১ জুলাই ${bnDigits(fy.start)} থেকে ৩০ জুন ${bnDigits(fy.end)} পর্যন্ত।` : `Validity: 1 July ${fy.start} to 30 June ${fy.end}.`}</strong> ${bn ? "উল্লিখিত প্রাঙ্গণে ব্যবসা পরিচালনার জন্য এই লাইসেন্স প্রদান করা হলো।" : "This licence is granted for carrying on business at the premises stated above."}</p>
  </div>`;
}

/* ---------- service 46: transport permit QR card — CERTNO-01 catalog §46 ----------
 * CERT-REFINE-01 §46: two zones — the text zone (left) carries the small
 * government line and office name clear of everything; the right column
 * stacks the citizen photo with the QR BELOW it; the vehicle class and the
 * engine number (from the schema's transport_license_engine_no) print; the
 * fiscal-year validity line closes the text zone. */
function transportCardBody(ctx: DocContext, qrDataUrl: string): string {
  const { input, bn, issued } = ctx;
  const p = input.payload;
  const fy = fiscalYear(issued);
  const schema = input.schema ?? getServiceSchema(46);
  const line = (label: string, value: string) =>
    value ? `<div class="tcard-line"><span>${escape(label)}</span><span>: ${escape(value)}</span></div>` : "";
  const vehicleClass = selectLabel(schema, "transport_vehicle_class", undefined, p.transport_vehicle_class, bn);
  const vehicleName = text(bn ? p.transport_license_transport_name_bn : p.transport_license_transport_name);
  return `<div class="tcard">
    <div class="tcard-main">
      <div class="tcard-govt">${escape(bn ? GOVT_LINE_BN : GOVT_LINE_EN)}</div>
      <div class="tcard-office">${escape(ctx.officeName)}</div>
      <div class="tcard-title">${escape(bn ? input.service.name_bn : input.service.name_en)}</div>
      ${line(bn ? "লাইসেন্স নং" : "Licence No", text(p.transport_license_no))}
      ${vehicleName && vehicleName !== vehicleClass ? line(bn ? "যানবাহন" : "Vehicle", vehicleName) : ""}
      ${line(bn ? "যানবাহনের ধরণ" : "Vehicle type", vehicleClass !== text(p.transport_vehicle_class) || present(p.transport_vehicle_class) ? vehicleClass : "")}
      ${line(bn ? "ইঞ্জিন নং" : "Engine No", text(p.transport_license_engine_no))}
      ${line(bn ? "মালিক" : "Proprietor", text(bn ? input.citizen.full_name_bn : input.citizen.full_name_en))}
      ${line(bn ? "ইস্যুর তারিখ" : "Issue date", bn ? bnDate(issued) : enDate(issued))}
      <div class="tcard-line"><span>${bn ? "মেয়াদ" : "Validity"}</span><span>: ${escape(bn ? bnDigits(`${fy.start}-${fy.end} অর্থবছর`) : `FY ${fy.start}-${fy.end}`)}</span></div>
      <div class="tcard-no">${numberStripHtml(input.number, bn)}</div>
    </div>
    <div class="tcard-side">
      ${citizenPhotoHtml(input, "tcard-photo")}
      <img class="qr-tcard" alt="" src="${escape(qrDataUrl)}">
    </div>
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
  // CERT-REFINE-01 (A6): the printed URL carries Latin digits in BOTH
  // languages, and the QR payload is this same URL (pdf.ts encodes it).
  const verifyUrl = `${origin}/verify?searchText=${latinDigits(input.number)}`;
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
        : serviceNo === 1
          ? // CERT-REFINE-01 §1: the receipt's own title.
            bn
            ? "আদায় রশিদ (হোল্ডিং ট্যাক্স)"
            : "Collection Receipt (Holding Tax)"
          : serviceNo === 27
            ? // CERT-REFINE-01 §27: the letter's own title.
              bn
              ? "পাসপোর্ট সুপারিশ পত্র"
              : "Passport Recommendation Letter"
            : serviceNo === 40
              ? // CERT-REFINE-01 §40: the ethnic-minority certificate title.
                bn
                ? "ক্ষুদ্র নৃ-গোষ্ঠী সনদ"
                : "Ethnic Minority Community Certificate"
              : bn
                ? input.service.name_bn
                : input.service.name_en;
  const isTrade = serviceNo === 42;
  // CERT-REFINE-01 (A1): emblem → government line → office name → address.
  const formHeader = `<header class="up-head">${emblem}<div class="govt-line">${escape(bn ? GOVT_LINE_BN : GOVT_LINE_EN)}</div>${headName}<div class="office-address">${escape(ctx.officeAddressLine)}</div><h2 class="doc-title">${escape(title)}</h2></header>`;
  const body = FORM_SERVICES.has(serviceNo)
    ? isTrade
      ? tradeLicenceBody(ctx, emblem, logo)
      : serviceNo === 1
        ? `${formHeader}${taxReceiptBody(ctx)}`
        : serviceNo === 41
          ? `${formHeader}${premisesLicenceBody(ctx)}`
          : serviceNo === 46
            ? transportCardBody(ctx, qrDataUrl)
            : `${formHeader}${genericFormBody(ctx)}`
    : `${formHeader}
       <div class="numline"><span class="numline-no">${bn ? "সনদ নং:" : "Certificate No:"} ${numberStripHtml(input.number, bn)}</span><span>${bn ? "ইস্যুর তারিখ:" : "Date of Issue:"} ${escape(bn ? bnDate(issued) : enDate(issued))}</span></div>
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
    <div class="sign-date">${bn ? "তারিখ:" : "Date:"} ${escape(bn ? bnDate(issued) : enDate(issued))}</div>
  </aside>`;
  // CERT-REFINE-01 (A6): one verify label in both languages and both layouts.
  const verifyLine = bn ? `যাচাইকরণ: ${verifyUrl}` : `Verification: ${verifyUrl}`;
  const foot =
    serviceNo === 46
      ? // The transport card is self-contained (QR + number on the card).
        ""
      : isTrade
        ? // CERT-REFINE-01 §42: the QR sits at the bottom-left, clear of the header.
          `${signature}<footer class="doc-foot tl-foot"><img class="qr" alt="" src="${escape(qrDataUrl)}"><div class="verify-line">${escape(verifyLine)}</div></footer>`
        : `${signature}<footer class="doc-foot"><img class="qr" alt="" src="${escape(qrDataUrl)}"><div class="verify-line">${escape(verifyLine)}</div></footer>`;
  const bannerBits = "";
  const honesty = "";
  // CERTNO-01: the centre watermark is the Government of Bangladesh emblem —
  // large and faint, the same for every office. The office seal is not
  // printed anywhere on the document.
  // CERT-REFINE-01 §42: the trade licence watermark sits at the lighter 0.05.
  const sealImg = official && bundle.emblem
    ? `<img class="emblem-wm" alt="" src="${bundle.emblem}"${isTrade ? ` style="opacity:.05"` : ""}>`
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
.govt-line{text-align:center;font-weight:700;font-size:13.5px}
.govt-line.sm{font-size:11.5px}
.tcard-govt{font-size:8.5px;font-weight:700}
.tcard-side{display:flex;flex-direction:column;gap:1.5mm;align-items:center;flex:none}
.group-head{font-weight:700;background:#f0f0f0;padding:1mm 2mm}
.addr-block{margin:1mm 0}
.addr-head{font-weight:700;margin-bottom:.5mm}
.validity{font-weight:600;margin:3mm 0 0}
.grant{margin:1mm 0 0}
.person-block{border:.7px solid #555;margin:10pt 0;padding:0}
.person-title{font-weight:700;background:#F2F2F2;padding:4pt 8pt;font-size:11pt}
.person-rows{padding:6pt}
.person-row{display:flex;padding:2.5pt 0}
.person-row span{width:118pt;flex:none;font-size:10.5pt}
.person-row strong{font-size:11.5pt}
.consent-grid{margin:1mm 0}
.consent-row{display:flex;padding:4pt 0}
.consent-row span{width:132pt;flex:none}
.marriage-closing{font-size:12pt;margin:10pt 0 0;text-align:justify}
.letter-addr{font-size:12pt;line-height:1.33;text-align:justify;margin:0}
.premises-closing{font-size:11.5pt;margin:10pt 0 0;text-align:justify}
table.fields.premises{table-layout:fixed}
table.fields.premises td.fl{width:150pt}
table.fields.premises td.fc{width:18pt}
.guardian-sign{width:64mm;margin:10mm 0 0 auto;text-align:center;font-size:13px;line-height:1.55}
table.fees{width:100%;border-collapse:collapse}
table.fees td{padding:.5mm 1mm;border-bottom:.6px dotted #888}
table.fees td.fee-val{text-align:right;width:34mm}
table.fees tr.total td{font-weight:700;border-bottom:none}
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
.numline{display:flex;flex-wrap:wrap;column-gap:9mm;row-gap:1.5mm;justify-content:space-between;font-weight:600;margin:4.5mm 0 2.5mm}
.numline>span:last-child{margin-left:auto}
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
