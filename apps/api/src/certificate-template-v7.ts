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
import {
  DEMO_BANNER_BN,
  DEMO_BANNER_EN,
  DEMO_NOTICE_BN,
  DEMO_NOTICE_EN,
  isDemoIssuance,
} from "./demo-notice.js";

/**
 * Template 7 (Phase Y) — the official Union Parishad document format, modelled
 * on owner-supplied Belabo UP documents issued through the incumbent system
 * (Prottoyon). The FORMAT follows those documents; the product identity stays
 * Astra's: the verification line and QR use Astra's own origin, and no
 * Prottoyon branding appears anywhere.
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
 * Md's order of 25 Nov 2026 ("sob gulo certificate e prottoyon er provide
 * kora certificate er design er moto format e hobe") — ALL certificates in
 * Prottoyon's design/format — SUPERSEDES CERTNO-01 on both points below:
 *  - the certificate number prints PLAIN (no one-digit-per-box strip);
 *  - the centre watermark is the issuing office's own UP SEAL, resolved
 *    per tenant (template-assets.ts) from that office's profile SEAL
 *    setting first, then the deployment asset dir — never hardcoded, never
 *    a shared default, never the Government emblem; with no seal asset the
 *    document renders with NO watermark. (Md re-confirmed the per-UP
 *    profile-first resolution 25 Nov 2026, 12:12 — this reverses the
 *    drop-in-only reading of his 11:46 order. Operational dependency: the
 *    production profile seal is currently the DigitalUnion platform logo,
 *    which the owner removes via the new Remove option and replaces with
 *    the real seal; see template-assets.ts.)
 * The Prottoyon references also show NO government line and NO office logo
 * anywhere on the certificate — header is emblem + office name + address +
 * title only — so neither prints here (the stored logo is untouched; it
 * stays in the system for other uses). Orientation follows the references:
 * the 7 landscape references print landscape, the 4 portrait references
 * print portrait; services with no reference keep the portrait default.
 */
export const TEMPLATE_V7 = 7;

/**
 * CERT-PAPER (Md's order, 25 Nov 2026 15:59): certificates print on a
 * warm cream/ivory "government paper" tone instead of plain white.
 * The 15 Prottoyon reference PDFs measure pure white (#FFFFFF) at every
 * empty sample point (200 DPI), so this is the classic Bangladeshi
 * government-certificate paper colour, kept subtle and print-friendly.
 * Both engines and the QR light colour use this one value.
 */
export const CERT_PAPER_BG = "#FCF9EC";

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
 * WS-SHELL-GAPS (25 Nov 2026): ordinal day suffixes, verified against the
 * Prottoyon reference certificates — NOT the task brief's first draft.
 * The brief said 19–31→শে, but the references print ১৯ই (character
 * certificate 348634592312 and parent-consent 67428662626, both visually
 * confirmed at 2x zoom: /tmp/ref-19a.png) and ২২শে/২৩শে/২৮শে
 * (/tmp/ref-28.png shows ২৮শে; the wording note
 * notes/01-wording-services-12-15-19-22-25-33-35-37.md §8 records the same
 * split: শে after ২২/২৩/২৮, ই after ১০/১৭/১৮/১৯). The boundary is 20:
 * 1→লা, 2–3→রা, 4→ঠা, 5–19→ই, 20–31→শে — standard Bangla usage
 * (cf. ২০শে ফেব্রুয়ারি). Used ONLY for the certificate issue-date display
 * (the numline); bnDate/enDate stay suffix-free everywhere else
 * (CERT-REFINE-01 A5). The trade licence body also uses these helpers
 * (issue block + business start date) — its local closures were removed
 * at the fix/cert-trade merge.
 */
export function bnOrd(day: number): string {
  const d = Math.trunc(day);
  if (d === 1) return "১লা";
  if (d === 2) return "২রা";
  if (d === 3) return "৩রা";
  if (d === 4) return "৪ঠা";
  if (d >= 5 && d <= 19) return `${bnDigits(d)}ই`;
  if (d >= 20 && d <= 31) return `${bnDigits(d)}শে`;
  return bnDigits(d);
}
export function enOrd(day: number): string {
  const d = Math.trunc(day);
  const suffix =
    d % 100 >= 11 && d % 100 <= 13
      ? "th"
      : d % 10 === 1
        ? "st"
        : d % 10 === 2
          ? "nd"
          : d % 10 === 3
            ? "rd"
            : "th";
  return `${d}${suffix}`;
}
/** Ordinal issue-date display: "২২শে নভেম্বর ২০২৬" / "22nd November 2026". */
export function ordDate(when: Date, bn: boolean): string {
  const p = dhakaParts(when);
  return bn
    ? `${bnOrd(p.day)} ${BN_MONTHS[p.month - 1]} ${bnDigits(p.year)}`
    : `${enOrd(p.day)} ${EN_MONTHS[p.month - 1]} ${p.year}`;
}
export function ordDateIso(iso: unknown, bn: boolean): string {
  const raw = text(iso);
  if (!raw) return "";
  const parsed = new Date(`${raw.slice(0, 10)}T00:00:00+06:00`);
  return Number.isNaN(parsed.getTime()) ? bnDigits(raw) : ordDate(parsed, bn);
}
/**
 * WS-TABLES: the Prottoyon heir/member tables (services 2/3) print DOB as
 * DD-MM-YYYY with dashes — verified on the Warish 3 / Family 2 references.
 * The A5 slash form above stays for every other table.
 */
export function bnDateDash(iso: unknown): string {
  const raw = text(iso);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return match ? bnDigits(`${match[3]}-${match[2]}-${match[1]}`) : bnDigits(raw);
}
export function enDateDash(iso: unknown): string {
  const raw = text(iso);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : raw;
}
/**
 * CERT-REFINE-01 (A9): a free-text value is inserted into a sentence that
 * appends its own punctuation — strip any trailing danda/full stop the
 * applicant typed so the document never prints "।।" or "..".
 */
export const cleanText = (value: unknown) =>
  text(value).replace(/[\s।.]+$/u, "");
/* QR-MOVE (Md's order 25 Nov 2026 15:00): the A1 government header line
 * constants (GOVT_LINE_BN/EN) are REMOVED. Owner ruling: NO government
 * line on any certificate — the Prottoyon references have none, and the
 * svc46 compact card was the last layout still printing it. */
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
/** Service 33 correction field keys → printed labels (CERT-REFINE-01 §B svc33 fixed map).
 * WS-WORDING (25 Nov 2026): the Prottoyon reference prints "নিজের নাম" (not
 * "নাম") for row 1 and "নিজের নাম ইংরেজি" / "পিতার নাম ইংরেজি" for the
 * English-name rows — the schema's correction_category_id options carry no
 * English-name categories at all, so without these entries the template
 * printed the raw ids (name_en, father_name_en). The map is AUTHORITATIVE:
 * correctionFieldLabel reads it first, so a schema option label ("নাম")
 * can never override the reference wording again. */
export const CORRECTION_FIELD_LABELS: Record<string, { bn: string; en: string }> = {
  name: { bn: "নিজের নাম", en: "Own name" },
  name_en: { bn: "নিজের নাম ইংরেজি", en: "Own name (English)" },
  father_name: { bn: "পিতার নাম", en: "Father name" },
  father_name_en: { bn: "পিতার নাম ইংরেজি", en: "Father name (English)" },
  mother_name: { bn: "মাতার নাম", en: "Mother name" },
  mother_name_en: { bn: "মাতার নাম ইংরেজি", en: "Mother name (English)" },
  parent_name: { bn: "পিতা/মাতার নাম", en: "Parent name" },
  date_of_birth: { bn: "জন্ম তারিখ", en: "Date of birth" },
  address: { bn: "ঠিকানা", en: "Address" },
  spouse_name: { bn: "স্বামী/স্ত্রীর নাম", en: "Spouse name" },
  spouse_name_en: { bn: "স্বামী/স্ত্রীর নাম ইংরেজি", en: "Spouse name (English)" },
  other: { bn: "অন্যান্য", en: "Other" },
};
/** Service 33 field label: the fixed map first, then the schema option label, then the raw id. */
export function correctionFieldLabel(
  categoryId: unknown,
  schema: FormSchema | undefined,
  bn: boolean,
): string {
  const id = text(categoryId);
  const fixed = CORRECTION_FIELD_LABELS[id]?.[bn ? "bn" : "en"];
  if (fixed) return fixed;
  const fromSchema = selectLabel(schema, "corrections", "correction_category_id", id, bn);
  return fromSchema !== id ? fromSchema : id;
}
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
  // Md's order of 25 Nov 2026: Prottoyon's format, per reference. The 7
  // landscape references print A4 landscape, the 4 portrait references
  // print A4 portrait; services with no reference keep the portrait
  // default (CERT-REFINE-01 A8's one-portrait-shell is superseded for the
  // referenced services only — service 12 was A4 landscape before A8).
  // Landscape — reference PNGs in astra-logs/cert-design/reference/:
  // 12 citizenship (4290682504, 4651330442), 15 new voter (18291732956),
  // 19 guardian consent (67428662626), 22 unmarried (587738215248),
  // 25 married (3601703867), 35 character (348634592312),
  // 37 voter area transfer (1220470350).
  12: { size: "A4", orientation: "landscape" },
  15: { size: "A4", orientation: "landscape" },
  19: { size: "A4", orientation: "landscape" },
  22: { size: "A4", orientation: "landscape" },
  25: { size: "A4", orientation: "landscape" },
  35: { size: "A4", orientation: "landscape" },
  37: { size: "A4", orientation: "landscape" },
  // Portrait references (explicit, same as the default — listed so the
  // orientation of every referenced service is decided in one place):
  // 2 family (75147645374), 3 warish / legal heirs (78620469944),
  // 33 national data correction (63764535005), 42 trade licence
  // (942679765637).
  2: { size: "A4", orientation: "portrait" },
  3: { size: "A4", orientation: "portrait" },
  33: { size: "A4", orientation: "portrait" },
  42: { size: "A4", orientation: "portrait" },
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

/** Services whose attestation sentence is AUTHORED (not captured) — owner approval pending.
 * WS-WORDING (25 Nov 2026): 12/15/22/35/37 now print verbatim Prottoyon
 * bodies in Bangla, so their BN entries in ATTESTATIONS_BN below are dead
 * (kept as the authored record; English still uses ATTESTATIONS_EN). */
export const AUTHORED_ATTESTATION_SERVICES = Object.keys(ATTESTATIONS_BN)
  .map(Number)
  .filter((no) => ![12, 15, 22, 35, 37].includes(no));

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

function dataTable(
  headers: string[],
  rows: string[][],
  opts?: {
    widths?: number[];
    aligns?: readonly string[];
    headAligns?: readonly string[];
  },
): string {
  if (!rows.length) return "";
  const th = (h: string, i: number) => {
    const style: string[] = [];
    if (opts?.widths?.[i] !== undefined) style.push(`width:${opts.widths[i]}%`);
    const ha = opts?.headAligns?.[i] ?? opts?.aligns?.[i];
    if (ha) style.push(`text-align:${ha}`);
    return `<th${style.length ? ` style="${style.join(";")}"` : ""}>${escape(h)}</th>`;
  };
  const td = (c: string, i: number) => {
    const a = opts?.aligns?.[i];
    return `<td${a ? ` style="text-align:${a}"` : ""}>${escape(c)}</td>`;
  };
  return `<table class="data"><thead><tr>${headers.map(th).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map(td).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

/* ---------- Prottoyon table format (services 2/3): 5-column heir/member table ---------- */
// Reference renders (Prottoyon, Belabo UP): ক্রমিক নং | নাম | জন্ম তারিখ | বয়স
// | সম্পর্ক. Measured column widths (% of table width): 9.4 / 41.4 / 12.6 /
// 7.0 / 29.6; header cells centred; body cells centred except নাম (left).
// The ক্রমিক share is widened 9.4 → 12 (taken from নাম) so the header
// prints on one line at this template's 12.5px table font — the reference
// fits it in 9.4% only because its table font is smaller.
export const HEIR_TABLE_WIDTHS = [12, 39, 13, 7, 29];
// REFINE (25 Nov 2026): সম্পর্ক body cells are LEFT-aligned on the
// references (pixel-measured on 78620469944: values start at the
// column's left edge; only the header is centred) — was "center".
export const HEIR_TABLE_ALIGNS = ["center", "left", "center", "center", "left"] as const;
export const HEIR_TABLE_HEAD_ALIGNS = ["center", "center", "center", "center", "center"] as const;
export const HEIR_TABLE_HEADERS_BN = ["ক্রমিক নং", "নাম", "জন্ম তারিখ", "বয়স", "সম্পর্ক"];
export const HEIR_TABLE_HEADERS_EN = ["Sl No", "Name", "Date of birth", "Age", "Relationship"];

/**
 * WS-TABLES: the বয়স column. A stored numeric age wins (`warish_heir_age`,
 * else `age`) — the reference ages are NOT derivable from DOB + issue date
 * (Family: all +1 vs completed years; Warish: mixed +1/+0), so they are
 * stored values in the reference data. Without one, fall back to completed
 * years at the issue date (Dhaka calendar).
 */
export function tableAge(
  row: Record<string, unknown>,
  dobKey: string,
  issued: Date,
  bn: boolean,
): string {
  const stored = row.warish_heir_age ?? row.age;
  const n =
    typeof stored === "number"
      ? stored
      : /^\d+$/.test(text(stored))
        ? Number(text(stored))
        : Number.NaN;
  if (Number.isInteger(n) && n >= 0) return bn ? bnDigits(n) : String(n);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(row[dobKey]));
  if (!m) return "";
  const p = dhakaParts(issued);
  let age = p.year - Number(m[1]);
  if (p.month < Number(m[2]) || (p.month === Number(m[2]) && p.day < Number(m[3]))) age -= 1;
  if (age < 0) age = 0;
  return bn ? bnDigits(age) : String(age);
}

/** WS-TABLES: gendered relation labels as printed on the reference — পুত্র / কন্যা, স্বামী / স্ত্রী, পিতা / মাতা, ভাই / বোন — when the row carries a gender; otherwise the schema label. A value that is not a known code prints verbatim. */
const GENDERED_RELATION: Record<
  string,
  { bn: { male: string; female: string }; en: { male: string; female: string } }
> = {
  child: {
    bn: { male: "পুত্র", female: "কন্যা" },
    en: { male: "Son", female: "Daughter" },
  },
  spouse: {
    bn: { male: "স্বামী", female: "স্ত্রী" },
    en: { male: "Husband", female: "Wife" },
  },
  parent: {
    bn: { male: "পিতা", female: "মাতা" },
    en: { male: "Father", female: "Mother" },
  },
  sibling: {
    bn: { male: "ভাই", female: "বোন" },
    en: { male: "Brother", female: "Sister" },
  },
};
export function tableRelation(
  row: Record<string, unknown>,
  schema: FormSchema | undefined,
  fieldId: string,
  childId: string | undefined,
  bn: boolean,
): string {
  const value = text(row.warish_heir_relation ?? row.relationship);
  const gender = text(row.gender ?? row.warish_heir_gender);
  const g = GENDERED_RELATION[value];
  if (g && (gender === "male" || gender === "female"))
    return bn ? g.bn[gender] : g.en[gender];
  if (["self", "spouse", "child", "parent", "sibling", "other"].includes(value))
    return selectLabel(schema, fieldId, childId, value, bn);
  return cleanText(value);
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

/* ---------- WS-WORDING (25 Nov 2026): Prottoyon verbatim bodies ----------
 * Services 12/15/19/22/25/33/35/37 + the 2/3 intros, transcribed from the
 * Prottoyon reference certificates (notes/01-wording-services-12-15-19-22-
 * 25-33-35-37.md §§1–7; notes/01-ws-tables-s02-s03-evidence.md §1.3/§1.4).
 * Register: older "যাইতেছে"; "তাহার" with NO chandrabindu everywhere in
 * the new wording; "আমার জানা মতে" two words. These bodies apply to BANGLA
 * documents only (bn === true); English documents keep the existing
 * chassis — the Prottoyon references are Bangla-only and no English
 * wording was supplied. Pronouns are preserved per service: তিনি for
 * 12/15/19/22/33, সে for 35, and 25 switches mid-reference (তিনি … সে
 * বিবাহিত। তিনি …) — verbatim, not normalised.
 * Address rule (D5/D6): the present address prints on all 8 services even
 * when identical to the permanent one; the composition uses AVAILABLE data
 * only (free-text village — which carries the post office — + geography
 * ward/union/upazila/district). There is NO post-office/thana/postcode
 * field in the citizen record or GeoNameParts, so no থানাঃ segment prints;
 * that is a data gap, not a template omission. */
/** The standard closing blessing, corrected spelling (তাহার, no chandrabindu). */
export const WORDING_BLESSING_BN =
  "আমি তাহার উজ্জ্বল ভবিষ্যৎ ও সর্বাঙ্গীণ মঙ্গল কামনা করছি।";
export const WORDING_BLESSING_EN =
  "I wish the certificate holder every success and prosperity.";
/** Services carrying the standard closing blessing (was [12, 15, 21, 22, 27, 45]; 19/25/33/35/37 were missing). */
export const WORDING_BLESSING_SERVICES = new Set([12, 15, 19, 21, 22, 25, 27, 33, 35, 37, 45]);
/** The older-register opening shared by all ten verbatim bodies. */
export const WORDING_INTRO_BN = "এই মর্মে প্রত্যয়ন করা যাইতেছে যে,";
/** Spouse label by the applicant's gender: স্ত্রী for a male applicant, স্বামী for a female one. */
export function wordingSpouseLabel(gender: unknown): string {
  return gender === "male" ? "স্ত্রী" : "স্বামী";
}
/** "মৃত " before a name, once — the warish subject is deceased by
 * definition; a name that already carries it is left alone. */
export function deceasedName(name: unknown): string {
  const v = text(name);
  return !v || v === "মৃত" || v.startsWith("মৃত ") ? v : `মৃত ${v}`;
}
/**
 * WS-WORDING service 19: the guardian's name. The service-19 schema (v5)
 * carries NO guardian-name field (the guardian was the citizen in the old
 * model; consent_applicant is only a parent/guardian CODE and
 * consent_child_relation only the relation). The template accepts a
 * free-text guardian name when the payload carries one
 * (consent_guardian_name_bn/en — the field the form must capture; NO
 * schema change is made in this task) and otherwise prints no name: the
 * clause stays grammatical without it, and attributing consent to the
 * wrong parent would be worse than a missing name. (GAP-19-GUARDIAN-NAME.)
 */
export function consentGuardianName(p: Record<string, unknown>, bn: boolean): string {
  return cleanText(
    bn
      ? (p.consent_guardian_name_bn ?? p.consent_guardian_name)
      : (p.consent_guardian_name_en ?? p.consent_guardian_name_bn ?? p.consent_guardian_name),
  );
}
/**
 * WS-WORDING service 19: the consent-purpose phrase. A free-text purpose
 * wins verbatim (consent_guardian_purpose_bn/en, alias
 * consent_subject_other_bn/en — the field the form must capture for
 * purposes outside the closed select). Otherwise the schema's
 * consent_subject code maps to "{label} বিষয়ে" — education/travel only;
 * "other" has no phrase of its own and prints as "অন্যান্য বিষয়ে". The
 * reference purpose "পুলিশ বাহিনীতে যোগদানে" has NO option in the schema
 * (education/travel/other only). (GAP-19-PURPOSE.)
 */
export function consentGuardianPurpose(
  p: Record<string, unknown>,
  schema: FormSchema | undefined,
  bn: boolean,
): string {
  const free = cleanText(
    bn
      ? (p.consent_guardian_purpose_bn ?? p.consent_subject_other_bn)
      : (p.consent_guardian_purpose_en ??
        p.consent_subject_other_en ??
        p.consent_guardian_purpose_bn ??
        p.consent_subject_other_bn),
  );
  if (free) return free;
  const subject = text(p.consent_subject);
  if (!subject) return "";
  const label = selectLabel(schema, "consent_subject", undefined, subject, bn);
  return bn ? `${label} বিষয়ে` : `in respect of ${label}`;
}
/**
 * WS-WORDING service 37: the transfer-reason phrase. A free-text reason
 * wins verbatim — either the companion key
 * (application_voter_area_transfer_reason_other_bn/en) or a non-code value
 * stored in application_voter_area_transfer_reason itself (e.g. "জমি ক্রয়
 * করা সূত্রে"). Known codes map as before (marriage/employment/
 * relocation); "other" with no free text prints no phrase. NO new schema
 * option is created in this task: the land-purchase reason has no code,
 * and an unknown snake_case code would print raw — the form must add the
 * code or store the Bangla phrase. (GAP-37-REASON.)
 */
export function transferReasonPhrase(p: Record<string, unknown>, bn: boolean): string {
  const other = cleanText(
    bn
      ? p.application_voter_area_transfer_reason_other_bn
      : (p.application_voter_area_transfer_reason_other_en ??
        p.application_voter_area_transfer_reason_other_bn),
  );
  if (other) return other;
  const reason = text(p.application_voter_area_transfer_reason);
  if (bn) {
    if (reason === "marriage") return "বৈবাহিক সূত্রে";
    if (reason === "employment") return "চাকরির কারণে";
    if (reason === "relocation") return "বসবাসের স্থান পরিবর্তনের কারণে";
  } else {
    if (reason === "marriage") return "By marriage,";
    if (reason === "employment") return "For employment,";
    if (reason === "relocation") return "Following a change of residence,";
  }
  return reason === "other" ? "" : reason;
}

/* ---------- WS-WORDING HTML bodies (Chromium engine; BN only) ----------
 * One builder per reference template. Identity order varies by service
 * (12: name → birth-reg → [spouse] → father → mother; 25/33/37: name →
 * spouse → father → mother; 15/19/22/35: name → father → mother); the
 * resident clause and both addresses follow the identity list. Values are
 * bold, as in the existing chassis; the reference's own punctuation
 * (ঠিকানাঃ- with hyphen, তাহার without chandrabindu) is verbatim. */
type WordingIdentitySpec = ("birthReg" | "spouse" | "father" | "mother")[];
function wordingIdentityHtml(
  ctx: DocContext,
  spec: WordingIdentitySpec,
  opts?: { fatherLabel?: string; spouseName?: string },
): string {
  const { input } = ctx;
  const c = input.citizen;
  const parts: string[] = [`<strong>${escape(c.full_name_bn)}</strong>`];
  for (const seg of spec) {
    if (seg === "birthReg") {
      if (present(input.identity?.birthReg))
        parts.push(`জন্ম নিবন্ধন নম্বরঃ <strong>${bnDigits(input.identity!.birthReg)}</strong>`);
    } else if (seg === "spouse") {
      const spouseName = opts?.spouseName ?? text(c.spouse_name_bn);
      if (present(spouseName))
        parts.push(`${wordingSpouseLabel(c.gender)}ঃ <strong>${escape(spouseName)}</strong>`);
    } else if (seg === "father") {
      if (present(c.father_name_bn))
        parts.push(`${opts?.fatherLabel ?? "পিতাঃ"} <strong>${escape(c.father_name_bn)}</strong>`);
    } else if (seg === "mother") {
      if (present(c.mother_name_bn))
        parts.push(`মাতাঃ <strong>${escape(c.mother_name_bn)}</strong>`);
    }
  }
  return parts.join(", ");
}
/** "তাহার স্থায়ী ঠিকানাঃ- …। বর্তমান ঠিকানাঃ- …।" — present prints even when identical (D5). */
function wordingAddressClause(ctx: DocContext): string {
  return `তাহার স্থায়ী ঠিকানাঃ- ${escape(permanentAddress(ctx))}। বর্তমান ঠিকানাঃ- ${escape(presentAddress(ctx))}।`;
}
/**
 * WS-WORDING bodies for 12/15/22/33/35/37 (BN). Returns the body HTML
 * WITHOUT the closing blessing — paragraphBody appends it. Service 33
 * includes its 3-column table (no serial column); the intro is the
 * paragraph's own closing sentence.
 */
function wordingBodyHtml(ctx: DocContext, serviceNo: number): string {
  const { input } = ctx;
  const p = input.payload;
  const head = (identity: string) => `${WORDING_INTRO_BN} ${identity}, ${wordingAddressClause(ctx)}`;
  switch (serviceNo) {
    case 12:
      return `<p class="body-para">${head(wordingIdentityHtml(ctx, ["birthReg", "spouse", "father", "mother"]))} তিনি অত্র এলাকার একজন স্থায়ী বাসিন্দা এবং জন্মসূত্রে বাংলাদেশী নাগরিক।</p>`;
    case 15:
      return `<p class="body-para">${head(wordingIdentityHtml(ctx, ["father", "mother"]))} তিনি অত্র ইউনিয়নের স্থায়ী বাসিন্দা এবং বাংলাদেশের নাগরিক। তাহাকে অত্র ইউনিয়ন পরিষদ হইতে নাগরিক সনদ এবং ট্যাক্স রশিদ প্রদান করা হইয়াছে এবং আমার জানা মতে তিনি ইতিপূর্বে কোথাও ভোটার হন নাই। তাই তাহাকে নতুন ভোটার হিসেবে নিবন্ধন করে জাতীয় পরিচয় পত্র দেওয়া যেতে পারে মর্মে সুপারিশ করা হইলো।</p>`;
    case 22:
      return `<p class="body-para">${head(wordingIdentityHtml(ctx, ["father", "mother"]))} তিনি অত্র এলাকার একজন স্থায়ী বাসিন্দা। আমার জানা মতে, বর্তমানে তিনি অবিবাহিত।</p>`;
    case 33: {
      // The resident clause follows the mother's name with NO comma, BEFORE
      // the addresses — unlike every other service.
      const identity = wordingIdentityHtml(ctx, ["spouse", "father", "mother"]);
      const para =
        `${WORDING_INTRO_BN} ${identity} অত্র এলাকার একজন স্থায়ী বাসিন্দা। ${wordingAddressClause(ctx)} ` +
        "আবেদনকারীর প্রদত্ত তথ্য মতে, তাহার জাতীয় পরিচয়পত্রে নিম্নোক্ত তথ্য ভুল লিপিবদ্ধ করা হয় এবং তাহার আবেদনের প্রেক্ষিতে তা সঠিকভাবে লিপিবদ্ধ করার সুপারিশ করা হলঃ";
      const corrections = Array.isArray(p.corrections)
        ? (p.corrections as Record<string, unknown>[])
        : [];
      const schema = input.schema ?? getServiceSchema(33);
      const rows = corrections.map((c) => [
        correctionFieldLabel(c.correction_category_id, schema, true),
        text(c.incorrect_info),
        text(c.correct_info),
      ]);
      // Reference widths (measured on the reference PNG): ধরণ ≈29%,
      // ভুল তথ্য ≈33%, সুপারিশকৃত সঠিক তথ্য ≈38%; first column centred.
      const table = dataTable(["ধরণ", "ভুল তথ্য", "সুপারিশকৃত সঠিক তথ্য"], rows, {
        widths: [29, 33, 38],
        aligns: ["center", "left", "left"],
        headAligns: ["center", "center", "center"],
      });
      return `<p class="body-para">${para}</p>${table}`;
    }
    case 35:
      return `<p class="body-para">${head(wordingIdentityHtml(ctx, ["father", "mother"]))} সে অত্র এলাকার একজন স্থায়ী বাসিন্দা এবং জন্মসূত্রে বাংলাদেশের নাগরিক। আমার জানা মতে, তাহার স্বভাব চরিত্র ভাল এবং বর্তমানে সে অবিবাহিত।</p>`;
    case 37: {
      const reason = transferReasonPhrase(p, true);
      return `<p class="body-para">${head(wordingIdentityHtml(ctx, ["spouse", "father", "mother"]))}${reason ? ` ${reason}` : ""} তিনি অত্র এলাকায় স্থায়ীভাবে বসবাস করছেন এবং বাংলাদেশের নাগরিক। তাহার পূর্বের ভোটার এলাকা পরিবর্তন করে অত্র এলাকার ভোটার হিসেবে নিবন্ধন করা যায়।</p>`;
    }
    default:
      return "";
  }
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
  } else if (!(bn && serviceNo === 3)) {
    // WS-WORDING: BN service 3 prints the reference intro instead of the
    // death/register sentences (see the intro branch below).
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
  // WS-WORDING service 3 (BN): the verbatim reference intro — "মৃত {name},
  // পিতা/স্বামীঃ {father}, মাতাঃ {mother} অত্র এলাকার একজন স্থায়ী
  // বাসিন্দা।" + both addresses + the list ending. The মৃত prefix on the
  // SUBJECT is template-added (deceased by definition, guarded against a
  // stored prefix); the parents print as stored — no schema field records
  // their deceased status, so the proof fixture carries the reference's
  // printed "মৃত …" as data (see the implementation note).
  const wIntroParts: string[] = [`<strong>${escape(deceasedName(name))}</strong>`];
  if (bn && present(father))
    wIntroParts.push(`পিতা/স্বামীঃ <strong>${escape(text(father))}</strong>`);
  if (bn && present(mother))
    wIntroParts.push(`মাতাঃ <strong>${escape(text(mother))}</strong>`);
  const intro =
    bn && serviceNo === 3
      ? `${WORDING_INTRO_BN} ${wIntroParts.join(", ")} অত্র এলাকার একজন স্থায়ী বাসিন্দা। ${wordingAddressClause(ctx)} উল্লিখিত ব্যক্তির ওয়ারিশগণের তালিকা নিম্নরূপঃ`
      : bn
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
    if (serviceNo === 3) {
      // WS-TABLES (Prottoyon parity): the 5-column heir table — ক্রমিক নং |
      // নাম | জন্ম তারিখ | বয়স | সম্পর্ক. No father-name, NID or mobile
      // column; dates print DD/MM/YYYY; বয়স is the stored age when the row
      // carries one, else completed years at the issue date (tableAge).
      const rows = heirs.map((h, i) => [
        bn ? bnDigits(i + 1) : String(i + 1),
        text(bn ? h.warish_heir_name_bn : h.warish_heir_name),
        bn ? bnDateDash(h.warish_heir_dob) : enDateDash(h.warish_heir_dob),
        tableAge(h, "warish_heir_dob", ctx.issued, bn),
        tableRelation(h, schema, "heirs", "warish_heir_relation", bn),
      ]);
      table = dataTable(bn ? HEIR_TABLE_HEADERS_BN : HEIR_TABLE_HEADERS_EN, rows, {
        widths: HEIR_TABLE_WIDTHS,
        aligns: HEIR_TABLE_ALIGNS,
        headAligns: HEIR_TABLE_HEAD_ALIGNS,
      });
    } else {
      // Service 4 keeps the CERT-REFINE-01 §§3–4 column set until its own
      // Prottoyon reference is confirmed — do not fold it into the
      // service-3 table above.
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
    }
    if (bn && serviceNo === 3) {
      // WS-WORDING: no total line ("মোট ওয়ারিশ: … জন।" goes); the
      // reference's own after-table lines, blessing and falsity caveat.
      after = `<p class="body-para">উল্লিখিত ব্যক্তি/ব্যক্তিগণ ছাড়া আর কোনো ওয়ারিশান নাই। সকল প্রকার দেনাপাওনা/সম্পত্তি/বিষয় নিষ্পত্তি করার ব্যাপারে কেবলমাত্র উল্লিখিত ব্যক্তি/ব্যক্তিগণই ওয়ারিশান হিসেবে বিবেচিত হইবে।</p><p class="closing">আমি সকল ওয়ারিশগণের মঙ্গল কামনা করিতেছি।</p><p class="body-para">বিঃদ্রঃ আবেদনকারী যদি ইচ্ছাকৃতভাবে কোন ওয়ারিশ বাদ দিয়ে থাকেন বা কোন ভুল তথ্য প্রদান করিয়া থাকেন তাহলে তিনি দায়ী থাকিবেন। তাহার জন্য বেলাবো ইউনিয়ন পরিষদ কার্যালয় কোন ভাবেই দায়ী থাকিবেন না এবং উক্ত সনদ বাতিল বলিয়া গণ্য করা হইবে।</p>`;
    } else {
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
  }
  return `<p class="body-para">${intro}${sentences.length ? ` ${sentences.join(" ")}` : ""}</p>${table}${after}`;
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
  // WS-TABLES (Prottoyon parity): the 5-column member table — ক্রমিক নং | নাম
  // | জন্ম তারিখ | বয়স | সম্পর্ক. No ID/birth-reg column; বয়স is the stored
  // age when the row carries one, else completed years at the issue date.
  const rows = members.map((m, i) => [
    bn ? bnDigits(i + 1) : String(i + 1),
    text(bn ? m.name_bn : m.name_en),
    bn ? bnDateDash(m.dob) : enDateDash(m.dob),
    tableAge(m, "dob", ctx.issued, bn),
    tableRelation(m, schema, "members", "relationship", bn),
  ]);
  const headers = bn ? HEIR_TABLE_HEADERS_BN : HEIR_TABLE_HEADERS_EN;
  const tableHtml = dataTable(headers, rows, {
    widths: HEIR_TABLE_WIDTHS,
    aligns: HEIR_TABLE_ALIGNS,
    headAligns: HEIR_TABLE_HEAD_ALIGNS,
  });
  if (bn) {
    // WS-WORDING: verbatim reference intro — "{name}, পিতা/স্বামীঃ {father},
    // মাতাঃ {mother} অত্র এলাকার একজন স্থায়ী বাসিন্দা।" + both addresses +
    // the list ending — then the reference's own after-table lines. No
    // children-counts line, no same-family line, no total line.
    const intro = `${WORDING_INTRO_BN} ${wordingIdentityHtml(ctx, ["father", "mother"], { fatherLabel: "পিতা/স্বামীঃ" })} অত্র এলাকার একজন স্থায়ী বাসিন্দা। ${wordingAddressClause(ctx)} উল্লিখিত ব্যক্তির পরিবারের সদস্যগণের তালিকা নিম্নরূপঃ`;
    return (
      `<p class="body-para">${intro}</p>${tableHtml}` +
      `<p class="body-para">উল্লিখিত সদস্য/সদস্যগণ ছাড়া আর কোনো সদস্য নাই। আবেদনকারী যদি ইচ্ছাকৃতভাবে কোন সদস্য বাদ দিয়ে থাকেন তাহলে অনুমোদনকারী কোন ভাবেই দায়ী থাকিবেন না এবং উক্ত সনদ বাতিল বলিয়া গণ্য করা হইবে।</p>` +
      `<p class="closing">আমি সকল সদস্যগণের মঙ্গল কামনা করিতেছি।</p>`
    );
  }
  // CERT-REFINE-01 (A3): service 2 is on the status-sentence list.
  const status = bn ? STATUS_SENTENCE_BN : STATUS_SENTENCE_EN;
  const intro = bn
    ? `এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, ${identitySegments(ctx)}, তাঁহার <strong>স্থায়ী ঠিকানাঃ</strong> ${escape(permanentAddress(ctx))}। ${escape(status)}`
    : `This is to certify that ${identitySegments(ctx)}, <strong>permanent address:</strong> ${escape(permanentAddress(ctx))}. ${escape(status)}`;
  const closing = bn
    ? "আমি উক্ত পরিবারের সর্বাঙ্গীণ মঙ্গল কামনা করছি।"
    : "I wish the family every prosperity.";
  // The base same-family attestation is retained (cholito register).
  const familyLine = bn
    ? "এই সনদে উল্লিখিত ব্যক্তিগণ একই পরিবারের সদস্য বলে প্রত্যয়ন করা যাচ্ছে।"
    : "The persons listed in this certificate are members of the same family.";
  return `<p class="body-para">${counts ? `${intro} ${escape(counts)}` : intro}</p>${tableHtml}<p class="body-para">${escape(familyLine)}</p><p class="closing">${escape(closing)}</p>`;
}

/** CERT-REFINE-01 §19: consent certificate — guardian block, child block, consent clause, guardian signature block. */
function consentBody(ctx: DocContext): string {
  const { input, bn } = ctx;
  const p = input.payload;
  const schema = input.schema ?? getServiceSchema(19);
  if (bn) {
    // WS-WORDING (D9): the Prottoyon model — the applicant IS the child
    // (the citizen record), and the guardian consents. Single paragraph;
    // no child-detail grid, no first-person clause. The guardian signature
    // block renders bottom-left in the shell (renderCertificateHtmlV7),
    // not here. {guardian_purpose} maps from the schema's consent subject
    // (no police-joining option exists — GAP-19-PURPOSE); the guardian
    // name has no schema field either (GAP-19-GUARDIAN-NAME).
    const guardianName = consentGuardianName(p, true);
    const purpose = consentGuardianPurpose(p, schema, true);
    const clause =
      `তাহার অভিভাবক${guardianName ? ` ${escape(guardianName)}` : ""} স্বজ্ঞানে/স্বেচ্ছায় তাহাকে${purpose ? ` ${escape(purpose)}` : ""} অনুমতি/সম্মতি প্রদান করিল। এ বিষয়ে তাহার অভিভাবক ও তার পরিবারের কারও কোনো আপত্তি নেই।`;
    return `<p class="body-para">${WORDING_INTRO_BN} ${wordingIdentityHtml(ctx, ["father", "mother"])}, ${wordingAddressClause(ctx)} তিনি অত্র এলাকার একজন স্থায়ী বাসিন্দা। ${clause}</p><p class="closing">${escape(WORDING_BLESSING_BN)}</p>`;
  }
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
  if (bn && serviceNo === 25) {
    // WS-WORDING (D10): single-paragraph married attestation — no
    // groom/bride blocks. Spouse NID/DOB/marriage date inline, dates
    // DD-MM-YYYY in Bengali digits with hyphens. The pronoun switch
    // (তিনি … সে বিবাহিত। তিনি …) is verbatim. The closing sentence
    // prints only when a marriage date is recorded; without one the
    // attestation ends at "সে বিবাহিত।" rather than printing empty slots.
    const spouseName = text(c.spouse_name_bn) || text(p.marriage_info_spouse_name_bn);
    const spouseNid = text(p.marriage_info_spouse_nid);
    const spouseDob = present(p.marriage_info_spouse_dob)
      ? bnDateDash(p.marriage_info_spouse_dob)
      : "";
    const marriageDate = present(p.marriage_info_date)
      ? bnDateDash(p.marriage_info_date)
      : "";
    const identity = wordingIdentityHtml(ctx, ["spouse", "father", "mother"], {
      spouseName,
    });
    let body =
      `${WORDING_INTRO_BN} ${identity}, ${wordingAddressClause(ctx)} ` +
      "তিনি অত্র এলাকার একজন স্থায়ী বাসিন্দা। আমার জানা মতে, বর্তমানে সে বিবাহিত।";
    if (marriageDate) {
      body +=
        ` তিনি ${escape(spouseName)}` +
        `${spouseNid ? `, জাতীয় পরিচয়পত্র নম্বরঃ ${bnDigits(spouseNid)}` : ""}` +
        `${spouseDob ? `, জন্ম তারিখঃ ${spouseDob}` : ""} এর সাথে, ${marriageDate} তারিখে বিবাহ বন্ধনে আবদ্ধ হন।`;
    }
    return `<p class="body-para">${body}</p><p class="closing">${escape(WORDING_BLESSING_BN)}</p>`;
  }
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
  // WS-WORDING: the standard blessing (corrected তাহার spelling, no
  // chandrabindu) prints on [12, 15, 19, 21, 22, 25, 27, 33, 35, 37, 45]
  // — 19/25/33/35/37 were missing it. Computed up front: the BN wording
  // branch below and the 33/37 branches both append it.
  const closing = WORDING_BLESSING_SERVICES.has(serviceNo)
    ? bn
      ? WORDING_BLESSING_BN
      : WORDING_BLESSING_EN
    : "";
  const closingHtml = closing ? `<p class="closing">${escape(closing)}</p>` : "";
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
    const closing27 = bn ? WORDING_BLESSING_BN : WORDING_BLESSING_EN;
    const letter = bn
      ? `<p class="letter-addr">বরাবর,<br>সহকারী পরিচালক,<br>আঞ্চলিক পাসপোর্ট অফিস।</p><p class="body-para"><strong>বিষয়ঃ পাসপোর্ট প্রদানের সুপারিশ।</strong></p><p class="body-para">এই মর্মে সুপারিশ করা যাচ্ছে যে, ${identitySegments(ctx)}, তাঁহার <strong>স্থায়ী ঠিকানাঃ</strong> ${escape(permanentAddress(ctx))}। <strong>বর্তমান ঠিকানাঃ</strong> ${escape(presentAddress(ctx))}। তিনি পাসপোর্টের জন্য আবেদন করেছেন${purpose ? ` (উদ্দেশ্যঃ ${escape(purpose)})` : ""}। তাঁহার বিরুদ্ধে কোনো ফৌজদারি অভিযোগ জানা নাই। তাঁহাকে পাসপোর্ট প্রদানে এই কার্যালয়ের কোনো আপত্তি নাই।</p>`
      : `<p class="letter-addr">To,<br>The Assistant Director,<br>Regional Passport Office.</p><p class="body-para"><strong>Subject: Recommendation for passport issuance.</strong></p><p class="body-para">This is to recommend that ${identitySegments(ctx)}, <strong>permanent address:</strong> ${escape(permanentAddress(ctx))}. <strong>Present address:</strong> ${escape(presentAddress(ctx))}. The person has applied for a passport${purpose ? ` (purpose: ${escape(purpose)})` : ""}. No criminal complaint is known against the person. This office has no objection to a passport being issued to the person.</p>`;
    return `${letter}<p class="closing">${escape(closing27)}</p>`;
  }
  if (bn && [12, 15, 22, 33, 35, 37].includes(serviceNo)) {
    // WS-WORDING: verbatim Prottoyon bodies. Services 19/25 branch inside
    // consentBody/marriageBody and 2/3 inside familyBody/deceasedParagraph;
    // English keeps the generic chassis below.
    return `${wordingBodyHtml(ctx, serviceNo)}${closingHtml}`;
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
    // English path only — Bangla returns early through wordingBodyHtml
    // above (3-column table, no serial column, reference headers).
    const corrections = Array.isArray(p.corrections)
      ? (p.corrections as Record<string, unknown>[])
      : [];
    const schema = input.schema ?? getServiceSchema(33);
    // WS-WORDING: the fixed label map is authoritative (correctionFieldLabel),
    // so English-name rows never print raw ids (name_en, father_name_en).
    const rows = corrections.map((c, i) => {
      const fieldLabel = correctionFieldLabel(c.correction_category_id, schema, bn);
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
 * the order total); the validity line prints (no grant sentence — the
 * reference has none).
 * Prottoyon reference (942679765637, Md's order 25 Nov 2026): the header is
 * a three-column row — QR top-left with the issue block under it, centred
 * emblem + office name + title, photo top-right; the licence number is a
 * full-width centred line below the header; the statute line is plain
 * left-aligned text (no bordered bar); fields 1–14 plus the validity
 * sentence sit inside one bordered box. The QR therefore renders here, in
 * the header — NOT in the footer. */
function tradeLicenceBody(ctx: DocContext, emblem: string, qrDataUrl: string, emblemUrl: string | null = null): string {
  const { input, bn, issued } = ctx;
  const p = input.payload;
  const fy = fiscalYear(issued);
  // TRADE-42 (Prottoyon match, 25 Nov 2026): the reference prints ordinal
  // dates — ১লা, ১০ই, ২৪শে, ৩০শে — where CERT-REFINE-01 A5 prints plain
  // dates everywhere else. Ordinals come from the shared helpers
  // (bnOrd/enOrd/ordDate/ordDateIso — corrected boundary 5–19→ই, 20–31→শে
  // per the ১৯ই reference); the local closures were removed at merge.
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
  // TRADE-42 (Prottoyon match): the owner address blocks print all ten
  // rows — holding, road, village, post office, postcode, thana, upazila,
  // district, division, country — with blank values where the system holds
  // no data. DATA GAPS (no dataset): holding no., road no., post office,
  // postcode, thana — the citizen record carries no post-office/thana
  // fields and the office postcode is not in PdfInput. Unlike the
  // CERT-REFINE-01 rule, blank rows are NOT omitted here: the reference
  // prints them blank.
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
          ["হোল্ডিং নম্বর", ""],
          ["রোড নং", ""],
          ["গ্রাম/মহল্লা", text(free)],
          ["ডাকঘর", ""],
          ["পোস্ট কোড", ""],
          ["থানা", ""],
          ["উপজেলা", parts?.upazila?.bn ?? ""],
          ["জেলা", parts?.district?.bn ?? ""],
          ["বিভাগ", parts?.division?.bn ?? ""],
          ["দেশ", "বাংলাদেশ"],
        ]
      : [
          ["Holding No.", ""],
          ["Road No.", ""],
          ["Village/Area", text(free)],
          ["Post Office", ""],
          ["Post Code", ""],
          ["Police Station", ""],
          ["Upazila", parts?.upazila?.en ?? ""],
          ["District", parts?.district?.en ?? ""],
          ["Division", parts?.division?.en ?? ""],
          ["Country", "Bangladesh"],
        ];
    return rows
      .map(([label, value]) => `<div class="addr-row"><span>${escape(label)}</span><span>: ${escape(value)}</span></div>`)
      .join("");
  };
  // TRADE-42 (Prottoyon match): numbered rows use the danda separator
  // ("১।") as on the reference, not a period. `pair` is one labelled
  // sub-item inside a shared-value cell (rows 9–11).
  const numSep = bn ? "।" : ".";
  const field = (no: string, label: string, value: unknown, digits = false) =>
    `<tr><td class="fl">${escape(no)}${numSep} ${escape(label)}</td><td class="fv">: ${escape(digits ? bnDigits(value) : value)}</td></tr>`;
  const pair = (label: string, value: unknown, digits = false) =>
    `<div><span>${escape(label)}</span><span>: ${escape(digits ? bnDigits(value) : value)}</span></div>`;
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
        // TRADE-42 (Prottoyon match): the address column heads name the
        // owner, as on the reference; row 13 is the tax-schedule serial.
        presentHead: "মালিক/স্বত্বাধিকারীর বর্তমান ঠিকানা", permanentHead: "মালিক/স্বত্বাধিকারীর স্থায়ী ঠিকানা",
        serial: "আদর্শ কর তফসিল, ২০১৩ এর ক্রমিক নং",
        feeHead: "ট্রেড লাইসেন্স ফি (নতুন/নবায়ন)",
        fees: ["নতুন", "নবায়ন", "বকেয়া", "সারচার্জ", "সংশোধন ফি", "সাইনবোর্ড (পরিচিতিমূলক)", "পেশা ব্যবসা ও বৃত্তির উপর কর", "ভ্যাট"],
        total: "সর্বমোট",
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
        serial: "Serial No. of Model Tax Schedule, 2013",
        feeHead: "Trade License Fee (New/Renewal)",
        fees: ["New", "Renewal", "Arrear", "Surcharge", "Amendment Fee", "Signboard Fee", "Taxes on Profession & Trades", "VAT"],
        total: "Total",
        nums: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"],
      };
  const n = labels.nums;
  const businessType = selectLabel(input.schema ?? getServiceSchema(42), "business_type", undefined, p.business_type, bn);
  // TRADE-42 (Prottoyon match): all eight fee rows print, with 0.00 for
  // lines with no captured amount — the reference prints every row
  // including the zero ones. Component amounts print in Latin digits
  // (200.00) while the total prints in Bangla digits (৫৩০.০০) in Bangla
  // mode — exactly as Prottoyon prints them. The total is the component
  // sum when any component was captured, else the order total, else 0.00.
  // Fee components are system-captured (QAFIX-08: fees are system-set
  // only); the issuance gate blocks service 42 without components or an
  // order, so a real issue always has a real total.
  const feeKeys = [
    "trade_fee_new", "trade_fee_renewal", "trade_fee_arrear", "trade_fee_surcharge",
    "trade_fee_amendment", "trade_fee_signboard", "trade_fee_profession_tax", "trade_fee_vat",
  ];
  const feeValues = feeKeys.map((key) => (present(p[key]) ? Number(p[key]) : 0));
  const hasFeeComponents = feeKeys.some((key) => present(p[key]));
  const totalTaka = hasFeeComponents
    ? feeValues.reduce((acc, v) => acc + v, 0)
    : input.order
      ? Number(input.order.totalMinor) / 100
      : 0;
  const compFmt = (v: number) => v.toLocaleString("en-IN", { minimumFractionDigits: 2 });
  const totalFmt = (v: number) => (bn ? bnDigits(compFmt(v)) : compFmt(v));
  const feeRowHtml = (label: string, value: number) =>
    `<div class="fee-row"><span>${escape(label)}</span><span>${escape(compFmt(value))}</span></div>`;
  const feeTable = `<div class="tl-fees"><div class="tl-fees-col">${labels.fees
    .slice(0, 5)
    .map((label, i) => feeRowHtml(label, feeValues[i]!))
    .join("")}</div><div class="tl-fees-col">${labels.fees
    .slice(5)
    .map((label, i) => feeRowHtml(label, feeValues[5 + i]!))
    .join("")}</div></div><div class="fee-row total"><span>${escape(labels.total)}</span><span>${escape(totalFmt(totalTaka))}</span></div>`;
  // TRADE-42 (Prottoyon match): the validity line is the reference's
  // verbatim wording — ordinal dates, "ইং" after the years, no "মেয়াদ:"
  // prefix, no trailing danda. The grant sentence does NOT exist on the
  // reference and is removed.
  const validity = bn
    ? `অত্র ট্রেড লাইসেন্স এর মেয়াদ ${bnOrd(1)} ${BN_MONTHS[6]} ${bnDigits(fy.start)}ইং হইতে ${bnOrd(30)} ${BN_MONTHS[5]} ${bnDigits(fy.end)}ইং তারিখ পর্যন্ত`
    : `This Trade Licence is valid from ${enOrd(1)} ${EN_MONTHS[6]} ${fy.start} to ${enOrd(30)} ${EN_MONTHS[5]} ${fy.end}.`;
  return `
  <div class="tl-top">
    <div class="tl-left">
      ${qrDataUrl ? qrWithEmblem(qrDataUrl, emblemUrl, "qr-tl") : `<div class="tl-spacer"></div>`}
      <div class="tl-issue"><strong>${escape(labels.issueTitle)}</strong><br>${escape(labels.issueDate)}: ${escape(ordDate(issued, bn))}<br>${escape(labels.issueTime)}: ${escape(bn ? bnDigits(issueTime(issued)) : issueTime(issued))}</div>
    </div>
    <div class="tl-head">
      <h1>${escape(ctx.officeName)}</h1>
      <div class="office-address">${escape(ctx.officeAddressLine)}</div>
      ${emblem}
      <h2 class="doc-title">${escape(bn ? input.service.name_bn : input.service.name_en)}</h2>
    </div>
    <div class="tl-right">
      ${input.citizenPhoto ? `<img class="citizen-photo tl-photo" alt="" src="${input.citizenPhoto}">` : ""}
    </div>
  </div>
  <div class="tl-no">${escape(labels.noLabel)}: ${plainNumberHtml(input.number, bn)}</div>
  <div class="tl-form-box">
  <div class="statute">${escape(labels.statute)}</div>
  <table class="fields">
    ${field(n[0]!, labels.fields[0]!, bn ? p.business_name_bn : p.business_name_en)}
    ${field(n[1]!, labels.fields[1]!, bn ? p.proprietor_name_bn : p.proprietor_name_en)}
    ${field(n[2]!, labels.fields[2]!, bn ? p.proprietor_mother_name_bn : p.proprietor_mother_name)}
    ${field(n[3]!, labels.fields[3]!, bn ? p.proprietor_father_name_bn : p.proprietor_father_name)}
    ${field(n[4]!, labels.fields[4]!, bn ? p.proprietor_spouse_name_bn : p.proprietor_spouse_name)}
    ${field(n[5]!, labels.fields[5]!, orgTypeLabel(p, bn))}
    ${field(n[6]!, labels.fields[6]!, businessType)}
    ${field(n[7]!, labels.fields[7]!, businessAddress)}
    <tr><td class="fl">${n[8]}${numSep}</td><td class="fv subpair">${pair(labels.zone, bn ? bnDigits(text(p.trade_license_org_zone_bn) || text(p.trade_license_org_zone)) : text(p.trade_license_org_zone))}${pair(labels.ward, bn ? bnDigits(wardNo) : wardNo)}</td></tr>
    <tr><td class="fl">${n[9]}${numSep}</td><td class="fv">${pair(labels.idA, bn ? bnDigits(identityNo) : identityNo)}</td></tr>
    <tr><td class="fl"></td><td class="fv subpair">${pair(labels.idB, bn ? bnDigits(text(p.trade_license_tin_no)) : text(p.trade_license_tin_no))}${pair(labels.idC, bn ? bnDigits(text(p.trade_license_bin_no)) : text(p.trade_license_bin_no))}</td></tr>
    <tr><td class="fl"></td><td class="fv subpair">${pair(labels.idD, bn ? bnDigits(text(p.mobile)) : text(p.mobile))}${pair(labels.idE, p.trade_license_email)}</td></tr>
    <tr><td class="fl">${n[10]}${numSep}</td><td class="fv subpair">${pair(labels.fyA, bn ? bnDigits(`${fy.start}–${fy.end}`) : `${fy.start}–${fy.end}`)}${pair(labels.fyB, ordDateIso(p.start_date, bn))}</td></tr>
    <tr><td colspan="2"><div class="addr-cols"><div class="addr-block"><div class="addr-head">${n[11]}${numSep} ${escape(labels.presentHead)}</div>${citizenParts("present")}</div><div class="addr-block"><div class="addr-head">${escape(labels.permanentHead)}</div>${citizenParts("permanent")}</div></div></td></tr>
    ${field(n[12]!, labels.serial, "")}
    <tr><td class="fl">${n[13]}${numSep}</td><td class="fv">${escape(labels.feeHead)}</td></tr>
    <tr><td colspan="2">${feeTable}</td></tr>
  </table>
  <p class="validity">${escape(validity)}</p>
  </div>`;
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

/* ---------- CERTNO-01 superseded (Md's order, 25 Nov 2026): plain number ---------- */

/**
 * The certificate number printed PLAIN, exactly as stored (Bengali digits
 * on the Bangla version, English digits on the English version). Md's order
 * of 25 Nov 2026 supersedes CERTNO-01's one-digit-per-box strip: every
 * certificate prints the plain number. (A DEMO- marker, when present on a
 * demo-mode number, prints as plain text too.)
 */
export function plainNumberHtml(number: string, bn: boolean): string {
  return escape(bn ? bnDigits(number) : latinDigits(number));
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
  return `<div class="numline"><span class="numline-no">${bn ? "রসিদ নং:" : "Receipt No:"} ${plainNumberHtml(ctx.input.number, bn)}</span><span>${bn ? "তারিখ:" : "Date:"} ${escape(bn ? bnDate(issued) : enDate(issued))}</span></div>`;
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
 * CERT-REFINE-01 §46: compact permit card on the standard A4 portrait
 * page (CERT-REFINE-02 R2-05 retired the landscape card page). The
 * vehicle class and the engine number (from the schema's
 * transport_license_engine_no) print; the fiscal-year validity line
 * closes the text zone.
 * QR-MOVE (Md's order 25 Nov 2026 15:00): three zones — QR top-LEFT,
 * text centre, citizen photo top-RIGHT — matching every other
 * certificate. The small government line this card used to print above
 * the office name is REMOVED (owner ruling: no government line on any
 * certificate; this card was the last layout still printing it). */
function transportCardBody(ctx: DocContext, qrDataUrl: string, emblemUrl: string | null = null): string {
  const { input, bn, issued } = ctx;
  const p = input.payload;
  const fy = fiscalYear(issued);
  const schema = input.schema ?? getServiceSchema(46);
  const line = (label: string, value: string) =>
    value ? `<div class="tcard-line"><span>${escape(label)}</span><span>: ${escape(value)}</span></div>` : "";
  const vehicleClass = selectLabel(schema, "transport_vehicle_class", undefined, p.transport_vehicle_class, bn);
  const vehicleName = text(bn ? p.transport_license_transport_name_bn : p.transport_license_transport_name);
  return `<div class="tcard">
    ${qrWithEmblem(qrDataUrl, emblemUrl, "qr-tcard")}
    <div class="tcard-main">
      <div class="tcard-office">${escape(ctx.officeName)}</div>
      <div class="tcard-title">${escape(bn ? input.service.name_bn : input.service.name_en)}</div>
      ${line(bn ? "লাইসেন্স নং" : "Licence No", text(p.transport_license_no))}
      ${vehicleName && vehicleName !== vehicleClass ? line(bn ? "যানবাহন" : "Vehicle", vehicleName) : ""}
      ${line(bn ? "যানবাহনের ধরণ" : "Vehicle type", vehicleClass !== text(p.transport_vehicle_class) || present(p.transport_vehicle_class) ? vehicleClass : "")}
      ${line(bn ? "ইঞ্জিন নং" : "Engine No", text(p.transport_license_engine_no))}
      ${line(bn ? "মালিক" : "Proprietor", text(bn ? input.citizen.full_name_bn : input.citizen.full_name_en))}
      ${line(bn ? "ইস্যুর তারিখ" : "Issue date", bn ? bnDate(issued) : enDate(issued))}
      <div class="tcard-line"><span>${bn ? "মেয়াদ" : "Validity"}</span><span>: ${escape(bn ? bnDigits(`${fy.start}-${fy.end} অর্থবছর`) : `FY ${fy.start}-${fy.end}`)}</span></div>
      <div class="tcard-no">${plainNumberHtml(input.number, bn)}</div>
    </div>
    ${citizenPhotoHtml(input, "tcard-photo")}
  </div>`;
}

/**
 * WS-SHELL-GAPS (25 Nov 2026): QR centre emblem. The Prottoyon references
 * (citizenship + trade licence) print a small red govt emblem in the
 * centre of every QR (see /tmp/ref-qr.png, /tmp/ref-trade-qr.png). The
 * emblem is 20% of the QR width and circular (border-radius clips the
 * square emblem asset to the roundel). Safe only because pdf.ts now encodes
 * the QR at error-correction level H (~30% recoverable). Without an emblem
 * asset (demo mode) the QR renders bare, as before.
 */
function qrWithEmblem(qrDataUrl: string, emblemUrl: string | null, qrClass: string): string {
  const wrapClass =
    qrClass === "qr-tl"
      ? "qr-wrap qr-wrap-tl"
      : qrClass === "qr-tcard"
        ? "qr-wrap qr-wrap-tcard"
        : "qr-wrap";
  return emblemUrl
    ? `<span class="${wrapClass}"><img class="${qrClass}" alt="" src="${escape(qrDataUrl)}"><img class="qr-emblem" alt="" src="${emblemUrl}"></span>`
    : `<img class="${qrClass}" alt="" src="${escape(qrDataUrl)}">`;
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
  // CERTASSETS-01 (as re-confirmed by Md's order of 25 Nov 2026, 12:12):
  // artwork and chairman identity for the document come from the one
  // engine-agnostic bundle (template-assets.ts). The seal/watermark in
  // that bundle resolve per tenant from the office's profile SEAL setting
  // first, then the deployment drop-ins. The office logo is NOT
  // printed on certificates (Prottoyon references show no logo anywhere),
  // so bundle.logo is deliberately unused here. Artwork prints only in
  // official mode; the chairman name/designation print in every mode, as
  // before.
  const bundle: CertificateAssetsBundle = certificateAssetsBundle(
    input.tenant.id,
    input.assets,
    input.issuer,
  );
  const emblemUrl = official ? bundle.emblem : null;
  // REFINE (25 Nov 2026): the reference emblem disc measures ~22.6 mm on
  // landscape certs vs ~17.7 mm on portrait (pixel-measured); the asset's
  // disc is ~84% of the image box, so landscape renders the image at
  // 27 mm and portrait keeps 22 mm.
  const emblem = emblemUrl
    ? `<img class="emblem${format.orientation === "landscape" ? " emblem-l" : ""}" alt="" src="${emblemUrl}">`
    : "";
  const title =
    serviceNo === 47
      ? text(bn ? input.payload.certificate_type_bn : input.payload.certificate_type_en) ||
        (bn ? input.service.name_bn : input.service.name_en)
      : serviceNo === 33
        ? // WS-WORDING (D21): the reference title, as a per-service
          // template override — NOT a catalog change. English keeps the
          // catalog name (no English reference was supplied).
          bn
          ? "জাতীয় পরিচয়পত্র তথ্য সংশোধন"
          : input.service.name_en
        : serviceNo === 35
          ? // WS-WORDING (D12): the reference title is exactly "চারিত্রিক
            // সনদ" — this overrides the CERTNO-01 decision D2 combined
            // title for Bangla. English keeps the combined title (no
            // English reference was supplied).
            bn
            ? "চারিত্রিক সনদ"
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
  // Prottoyon reference header (Md's order 25 Nov 2026): emblem → office
  // name → address → title. No government line, no office logo — neither
  // appears on any Prottoyon reference certificate.
  // QR-MOVE (Md's order 25 Nov 2026 15:00): the QR sits in the TOP-LEFT
  // corner on every certificate (the trade licence already did).
  // PHOTO-CORNER (Md's order 25 Nov 2026 15:20): the citizen photo sits
  // in the TOP-RIGHT CORNER — in the header row's right column, level
  // with the QR — NOT beside the body text. The header row mirrors the
  // trade licence's three-column header — QR left, centred header,
  // photo right — with EQUAL-WIDTH side columns (35mm) so the header
  // stays page-centred; the 21mm QR hugs the left edge of its column.
  // The body then flows full-width under the header. The footer keeps
  // only the verify line, left-aligned at the bottom-left (Md's order
  // 25 Nov 2026 15:21).
  const headerQr = qrDataUrl ? qrWithEmblem(qrDataUrl, emblemUrl, "qr") : "";
  const formHeader = `<div class="head-row"><div class="head-side">${headerQr}</div><header class="up-head">${emblem}<h1>${escape(ctx.officeName)}</h1><div class="office-address">${escape(ctx.officeAddressLine)}</div><h2 class="doc-title">${escape(title)}</h2></header><div class="head-side head-side-r">${citizenPhotoHtml(input)}</div></div>`;
  const body = FORM_SERVICES.has(serviceNo)
    ? isTrade
      ? tradeLicenceBody(ctx, emblem, qrDataUrl, emblemUrl)
      : serviceNo === 1
        ? `${formHeader}${taxReceiptBody(ctx)}`
        : serviceNo === 41
          ? `${formHeader}${premisesLicenceBody(ctx)}`
          : serviceNo === 46
            ? transportCardBody(ctx, qrDataUrl, emblemUrl)
            : `${formHeader}${genericFormBody(ctx)}`
    : `${formHeader}
       <div class="numline"><span class="numline-no">${bn ? "সনদ নং:-" : "Certificate No:-"} ${plainNumberHtml(input.number, bn)}</span><span>${bn ? "ইস্যুর তারিখ:-" : "Date of Issue:-"} ${escape(ordDate(issued, bn))}</span></div>
       ${paragraphBody(ctx, serviceNo)}`;
  const issuerName = bn
    ? bundle.chairmanNameBn || bundle.chairmanNameEn || ""
    : bundle.chairmanNameEn || bundle.chairmanNameBn || "";
  const signImg = official && bundle.signature
    ? `<img class="sign-img" alt="" src="${bundle.signature}">`
    : "";
  // WS-SHELL-GAPS (25 Nov 2026): Prottoyon reference order — the dotted
  // rule sits ABOVE the bold name (the chairman signs on the line), then
  // title → office → address, and NO তারিখ line under the block. Verified
  // on both reference crops (/tmp/ref-cit-sign.png, /tmp/ref-warish-sign.png).
  // The trade licence's footer inherits this shared aside.
  // WS-WORDING service 19 (D9/D22): the guardian's signature block sits
  // bottom-LEFT, beside the chairman block on the right — name only, bold,
  // no dotted rule, no title (verified on the reference crop: the guardian
  // name's baseline aligns with the chairman's name). It renders only when
  // a guardian name is known; without one the chairman block stands alone.
  const guardianSignName =
    serviceNo === 19 && bn ? consentGuardianName(input.payload, true) : "";
  const signatureAside = `<aside class="sign-block">
    ${signImg}
    <div class="sign-line"></div>
    ${issuerName ? `<div class="sign-name">${escape(issuerName)}</div>` : ""}
    <div class="sign-title">${escape(bn ? bundle.chairmanDesignationBn : bundle.chairmanDesignationEn)}</div>
    <div class="sign-office">${escape(ctx.officeName)}</div>
    ${ctx.officeAddressLine ? `<div class="sign-address">${escape(ctx.officeAddressLine)}</div>` : ""}
  </aside>`;
  const signature = guardianSignName
    ? `<div class="dual-sign"><aside class="guardian-sign-left"><div class="sign-name">${escape(guardianSignName)}</div></aside>${signatureAside}</div>`
    : signatureAside;
  // CERT-REFINE-01 (A6): one verify label in both languages and both layouts.
  const verifyLine = bn ? `যাচাইকরণ: ${verifyUrl}` : `Verification: ${verifyUrl}`;
  const foot =
    serviceNo === 46
      ? // The transport card is self-contained (QR + number on the card).
        ""
      : isTrade
        ? // TRADE-42 (Prottoyon match): the QR sits top-left in the header,
          // so the foot carries only the verify line; the two signature
          // blocks (administrative officer left, chairman right) sit side
          // by side above it, as on the reference — the admin block carries
          // the same dotted rule above its label as the chairman block
          // (pixel-verified on the trade reference, row 1128).
          `<div class="tl-sign-row"><aside class="sign-block tl-admin"><div class="sign-line"></div><div>${escape(bn ? "প্রশাসনিক কর্মকর্তা" : "Administrative Officer")}</div></aside>${signature}</div><footer class="doc-foot tl-foot"><div class="verify-line">${escape(verifyLine)}</div></footer>`
        : // QR-MOVE (Md's order 25 Nov 2026 15:00): the QR moved to the
          // top-left header corner; the foot carries only the verify
          // line — left-aligned at the bottom-left (Md's order 25 Nov
          // 2026 15:21; was centred since QR-MOVE).
          `${signature}<footer class="doc-foot"><div class="verify-line">${escape(verifyLine)}</div></footer>`;
  // W-001 (Phase 4, integrated): a demo document says so on its face, in
  // both languages. Official mode stays clean (owner instruction 16 Nov 2026:
  // production output carries no demo content of any kind).
  const demo = isDemoIssuance();
  const bannerBits = demo
    ? `<div class="draft-wm">DEMO</div><div class="draft-banner">${escape(DEMO_BANNER_BN)}<br>${escape(DEMO_BANNER_EN)}</div>`
    : "";
  const honesty = demo
    ? `<p class="honesty">${escape(DEMO_NOTICE_BN)} ${escape(DEMO_NOTICE_EN)}</p>`
    : "";
  // Md's order of 25 Nov 2026 (supersedes CERTNO-01; per-UP resolution
  // re-confirmed 25 Nov 2026, 12:12): the centre watermark is the issuing
  // office's own UP SEAL (bundle.watermark — profile SEAL first per
  // tenant, then the deployment drop-in). The pre-faded drop-in
  // (seal-watermark.png) prints at full opacity; a full-strength seal
  // (watermarkDerived) is faded to .08 (.05 on the
  // trade licence, per CERT-REFINE-01 §42). With no seal asset there is
  // NO watermark — never the Government emblem, never the platform logo.
  const sealImg = official && bundle.watermark
    ? `<img class="seal-wm" alt="" src="${bundle.watermark}"${bundle.watermarkDerived ? ` style="opacity:${isTrade ? ".05" : ".08"}"` : ""}>`
    : "";
  const pageSize = format.size.includes("mm")
    ? format.size
    : format.orientation === "landscape"
      ? `${format.size} landscape`
      : format.size;
  return `<!doctype html><html lang="${bn ? "bn" : "en"}"><head><meta charset="UTF-8"><style>
@page{size:${pageSize};margin:${serviceNo === 46 ? "3mm" : isTrade ? "8mm" : "11mm"};background:${CERT_PAPER_BG}}
*{box-sizing:border-box}
html,body{background:${CERT_PAPER_BG}}
body{font-family:'Nirmala UI','Noto Sans Bengali',sans-serif;color:#101418;margin:0;font-size:14.5px;line-height:1.75}
.frame{position:fixed;inset:0;border:2.2px solid #1a1a1a;z-index:2;pointer-events:none}
/* GATE FIX (25 Nov 2026): the second frame line used to be an outline
 * (outline-offset 2.6px outward) — but with inset:0 the outline falls
 * outside the page and Chromium clips it in print, so every certificate
 * printed a SINGLE frame line while the reference has TWO
 * (pixel-measured on the trade reference: two 3px lines ~1.15mm apart).
 * The inner div below provides the second line explicitly, 4px in.
 * (No brand word in this comment: the rendered HTML must not contain it.)
 * REFINE (25 Nov 2026): both lines 1.1px -> 2.2px (~0.58mm) — the
 * reference lines measure ~0.69mm each with a ~0.46mm gap; ours printed
 * visibly thinner (0.38/0.25mm at 200 DPI). 2.2px lines + the 4px inset
 * give a ~0.48mm gap. */
.frame-inner{position:fixed;inset:4px;border:2.2px solid #1a1a1a;z-index:2;pointer-events:none}
.seal-wm{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:72mm;z-index:0}
.numline-no{display:flex;align-items:center;gap:2mm}
.citizen-photo{float:right;width:35mm;height:31mm;object-fit:cover;border:.6px solid #555;margin:1mm 0 3mm 4mm}
.citizen-photo.tl-photo{float:none;flex:none;margin:0}
.tcard{display:flex;gap:3mm;align-items:flex-start;padding:1mm}
.qr-tcard{width:17mm;height:17mm;flex:none}
.tcard-main{flex:1;font-size:9.5px;line-height:1.45}
.tcard-office{font-weight:700;font-size:10.5px}
.tcard-title{font-weight:700}
.tcard-line{display:flex;gap:1.5mm}
.tcard-line span:first-child{flex:none;font-weight:600}
.tcard-no{margin-top:1mm}
.citizen-photo.tcard-photo{float:none;flex:none;width:16mm;height:20mm;margin:0}
.group-head{font-weight:700;background:#f0f0f0;padding:1mm 2mm}
.addr-block{margin:1mm 0}
.addr-head{font-weight:700;margin-bottom:.5mm}
.validity{font-weight:600;margin:3mm 0 0}
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
.sign-img{display:block;height:11mm;max-width:42mm;object-fit:contain;margin:0 auto .5mm}
.draft-wm{position:fixed;left:24%;top:42%;transform:rotate(-30deg);font:bold 68px sans-serif;color:rgba(179,38,30,.09);z-index:0}
main{position:relative;z-index:1;padding:5mm 6mm 0;display:flex;flex-direction:column}
/* REFINE (25 Nov 2026): bottom-anchored signature + footer, as on the
 * references (the signature block sits at ~78-85% of the page height
 * with the whitespace between body and signature, never floating
 * mid-page). main is a flex column stretched to just inside the frame;
 * .foot-wrap's auto top margin absorbs the slack on short bodies and
 * collapses to the signature's own 11mm gap on long ones (min-height
 * only stretches — a body taller than the page still flows to page 2
 * exactly as before). Heights = page content height minus ~5mm so the
 * verify line clears the inner frame line: portrait A4 275-5,
 * landscape 188-5 (11mm margins), trade 281-5 (8mm margins). The
 * transport card (46) is not anchored. */
.anchor-p{min-height:271mm}
.anchor-l{min-height:184mm}
.anchor-t{min-height:277mm}
.foot-wrap{margin-top:auto}
.draft-banner{border:2px solid #b3261e;color:#b3261e;padding:6px;text-align:center;font:bold 14px sans-serif;margin-bottom:4mm}
/* QR-MOVE (Md's order 25 Nov 2026 15:00) + PHOTO-CORNER (15:20):
 * three-column header row — QR top-left (21mm, same size as the old
 * footer QR), centred header, citizen photo top-right corner (35mm,
 * the reference size) — mirroring the trade licence's header. The side
 * columns are EQUAL width (35mm) so the header stays page-centred; the
 * QR hugs its column's left edge. The QR span is blockified so the 21mm
 * rule applies (the trade gate-fix lesson: an inline span ignores
 * width/height). */
.head-row{display:flex;align-items:flex-start}
.head-row .up-head{flex:1}
.head-side{width:35mm;flex:none}
.head-side-r{display:flex;justify-content:flex-end}
.head-side .citizen-photo{float:none;margin:0}
.head-row .qr-wrap{display:block}
.up-head{text-align:center}
.emblem{width:22mm;height:22mm;object-fit:contain;display:block;margin:0 auto 1.5mm;border-radius:50%}
.emblem-l{width:27mm;height:27mm}
h1{font-size:21px;margin:0;line-height:1.4}
.office-address{font-size:13.5px}
.doc-title{font-size:19px;margin:3.5mm 0 0;line-height:1.4}
.numline{display:flex;flex-wrap:wrap;column-gap:9mm;row-gap:1.5mm;justify-content:space-between;font-weight:700;margin:4.5mm 0 2.5mm}
.numline>span:last-child{margin-left:auto}
.body-para{text-align:justify;margin:0}
.closing{margin:5mm 0 0}
.free-footer{font-size:12px;margin-top:4mm}
/* REFINE (25 Nov 2026): the reference heir/member tables are ~95% of
 * the text width (left-aligned with the body, ending short of the
 * right edge) with ~4.85mm rows and a smaller table font than ours
 * was (pixel-measured on 78620469944: 732px table in a 768px text
 * width; 21px row pitch at 110 DPI). 11px/1.4 + .5mm padding lands
 * rows at ~5.1mm. */
table.data{width:95%;border-collapse:collapse;margin-top:4mm;font-size:11px;line-height:1.4}
table.data th,table.data td{border:1px solid #5b6b60;padding:.5mm 2mm;text-align:left}
.sign-block{margin:11mm 0 0 auto;width:64mm;text-align:center;font-size:13px;line-height:1.55}
.sign-name{font-weight:700;font-size:14.5px}
.sign-line{border-top:1.6px dotted #333;margin:1.6mm 5mm 1.6mm}
.sign-office{font-weight:600}
.dual-sign{display:flex;justify-content:space-between;align-items:flex-start;margin-top:11mm}
.dual-sign .sign-block{margin-top:0}
.guardian-sign-left{width:64mm;text-align:center;margin-top:3mm}
/* GATE FIX (25 Nov 2026): 7mm -> 2mm. The verbatim wording bodies run
 * taller than the old authored ones, and the warish certificate (service
 * 3) spilled its verify line alone onto page 2. The footer sits just
 * below the signature on the reference; 2mm keeps it there and frees the
 * ~5mm the long bodies need. */
.doc-foot{display:flex;align-items:flex-end;gap:6mm;margin-top:2mm}
.qr{width:21mm;height:21mm;flex:none}
.qr-wrap{position:relative;width:21mm;height:21mm;flex:none}
.qr-wrap .qr,.qr-wrap .qr-tl,.qr-wrap .qr-tcard{width:100%;height:100%}
.qr-wrap-tl{width:19mm;height:19mm}
.qr-wrap-tcard{width:17mm;height:17mm}
.qr-emblem{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:20%;height:20%;border-radius:50%;background:${CERT_PAPER_BG};object-fit:contain}
.verify-line{flex:1;text-align:left;font-size:11.5px;overflow-wrap:anywhere}
.honesty{font-size:10px;text-align:center;color:#444;margin-top:3mm}
.tl-top{display:flex;align-items:flex-start;gap:4mm}
.qr-tl{width:19mm;height:19mm;flex:none}
.tl-head{flex:1;text-align:center}
.tl-head h1{font-size:19.5px}
.tl-spacer{width:19mm;flex:none}
.tl-no{font-weight:700;margin-top:1.5mm;text-align:center}
.tl-issue{font-size:12px;line-height:1.5;margin-top:1mm}
.statute{text-align:left;font-weight:700;padding:0;margin:3mm 0;font-size:13.5px}
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
td.subpair>div{flex:auto;display:flex;gap:2mm;min-width:0}
td.subpair>div span:first-child{flex:none}
td.subpair>div span:last-child{flex:1;min-width:16mm;overflow-wrap:normal}
.tl-doc .statute{margin:0 0 1mm;padding:0;border:none;font-size:12px}
.tl-doc .validity{font-size:13px;font-weight:700}
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
/* REFINE (25 Nov 2026): no dotted leader under trade fee rows — the
 * reference fee block prints plain "label : value" rows. */
.fee-row{display:flex;justify-content:space-between;padding:.4mm 0}
.fee-row.total{font-weight:700}
.generic-form{font-size:12.8px;line-height:1.55;margin-top:3mm}
.gf-section h4{margin:3mm 0 1mm;font-size:13px}
.gf-field{display:flex;gap:2mm}
.gf-field span:first-child{width:58mm;flex:none;font-weight:600}
.gf-field.total{font-weight:700;margin-top:2mm}
.gf-row{border-top:.6px dotted #999;padding:1mm 0}
.tl-foot{margin-top:5mm}
.card-doc{padding:2mm 3mm}
/* TRADE-42 (25 Nov 2026): three-column trade header
 * (QR + issue block | centred header | photo) with equal-width side
 * columns so the header stays page-centred; one bordered box around the
 * statute, the numbered rows and the validity line; two-column fee block;
 * side-by-side signature row. Placed last so these rules win the
 * specificity ties against the .tl-doc overrides above. */
.tl-left{flex:none;width:58mm}
/* GATE FIX (25 Nov 2026): the trade QR span is an inline element inside the
 * block .tl-left, so its width/height were ignored and the QR rendered at
 * its intrinsic 180px (~48mm) — the ~8mm that spilled the trade licence to
 * 2 pages (the paragraph certs' QR sits in the flex .doc-foot, where the
 * span is blockified and the 21mm rule applies). Blockify it here so the
 * 19mm .qr-wrap-tl rule takes effect; trade-only, no other layout touched. */
.tl-left .qr-wrap{display:block;width:19mm;height:19mm}
.tl-right{flex:none;width:58mm;display:flex;justify-content:flex-end}
.tl-left .tl-issue{margin-top:2mm}
.tl-form-box{border:1.6px solid #1a1a1a;padding:1mm 3mm}
.tl-doc table.fields td.fl{width:72mm}
.tl-fees{display:flex;gap:8mm}
.tl-fees-col{flex:1}
.tl-sign-row{display:flex;justify-content:space-between;align-items:flex-start;margin-top:3mm}
.tl-sign-row .sign-block{margin-top:0}
.tl-admin{margin:0}
</style></head><body><div class="frame"></div><div class="frame-inner"></div>${sealImg}${bannerBits}<main data-template="7" data-delivery-language="${bn ? "bn" : "en"}"${isTrade ? ' class="tl-doc anchor-t"' : serviceNo === 46 ? ' class="card-doc"' : format.orientation === "landscape" ? ' class="anchor-l"' : ' class="anchor-p"'}><div class="body-wrap">${body}</div><div class="foot-wrap">${foot}</div>${honesty}</main></body></html>`;
}
