import {
  type FormSchema,
  type FieldDefinition,
  isFieldVisible,
  getServiceSchema,
} from "@astra/shared-schemas";
import { renderCertificateHtmlV7 } from "./certificate-template-v7.js";
/** New issues use the current template version. Existing stored PDFs and metadata are never rewritten. */
// Template 6 (Phase W): one signature block — the Chairman approves and issues; there is
// no secretary verification step. (Template 5 had separate Secretary/Chairman blocks.)
// Template 7 (Phase Y): the official Union Parishad document format — see
// certificate-template-v7.ts. Template 6 remains selectable for re-renders.
export const DEMO_TEMPLATE_VERSION = 7;
export const TEMPLATE_V6 = 6;
export type CertificateLanguage = "bn" | "en" | "bilingual";
/** One geography level's dataset names; `union` is the stem (no "ইউনিয়ন"/"Union" suffix). */
export interface GeoNameParts {
  division?: { bn: string; en: string };
  district?: { bn: string; en: string };
  upazila?: { bn: string; en: string };
  union?: { bn: string; en: string };
  ward?: { bn: string; en: string };
  wardNo?: number | null;
}
export interface CertificateIssuer {
  nameBn?: string | null;
  nameEn?: string | null;
  accountType?: string | null;
}
export interface PdfInput {
  number: string;
  verificationUrl: string;
  tenant: {
    id?: string;
    name_bn: string;
    name_en: string;
    division?: string | null;
    district?: string | null;
    upazila?: string | null;
  };
  service: { service_no?: number; name_bn: string; name_en: string };
  citizen: {
    full_name_bn: string;
    full_name_en: string;
    address_bn: string;
    address_en: string;
    father_name_bn?: string | null;
    father_name_en?: string | null;
    mother_name_bn?: string | null;
    mother_name_en?: string | null;
    spouse_name_bn?: string | null;
    spouse_name_en?: string | null;
    gender?: string | null;
    /** PAR-06: present address; absent or true means the registered address is also the present one. */
    present_same_as_permanent?: boolean;
    present_address_bn?: string | null;
    present_address_en?: string | null;
  };
  payload: Record<string, unknown>;
  schema?: FormSchema;
  /** Dataset names for geography fields keyed by payload path; codes alone never reach the document. */
  geographyNames?: Record<string, { bn: string; en: string }>;
  renewalNumber?: string;
  /** Phase Y (template 7): issuance timestamp; the document's issue date/time derive from it. */
  issuedAt?: string;
  /** Phase Y: the approving Chairman who issued — printed in the signature block. */
  issuer?: CertificateIssuer;
  /** Phase Y: the application's order snapshot; the trade licence prints its real total. */
  order?: { totalMinor?: number; renewal?: boolean } | null;
  /** Phase Y: decrypted citizen identity numbers for print (NID segment / licence field 10a). */
  identity?: { nid?: string | null; birthReg?: string | null };
  /** Phase Y: resolved dataset names for the citizen's registered addresses. */
  citizenGeography?: { permanent?: GeoNameParts; present?: GeoNameParts };
  /** Phase Y: resolved dataset names for the office's own location (header address line). */
  officeGeography?: {
    upazila?: { bn: string; en: string };
    district?: { bn: string; en: string };
  };
  /**
   * CERTASSETS-01: the issuing office's profile artwork as data URLs,
   * resolved at issuance from office_certificate_assets (see
   * certificate-assets.ts). Profile artwork outranks the legacy filesystem
   * drop-ins in template-assets.ts; a null/absent kind renders exactly as
   * before (no logo, blank signature line, drop-in or no seal watermark).
   */
  assets?: {
    logo?: string | null;
    seal?: string | null;
    signature?: string | null;
  };
}
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
const bnDigits = (value: unknown) =>
  String(value ?? "").replace(/\d/g, (digit) => "০১২৩৪৫৬৭৮৯"[Number(digit)]!);

function approvedSchemaData(
  schema: FormSchema,
  payload: Record<string, unknown>,
  lang: string,
  geographyNames: Record<string, { bn: string; en: string }> = {},
) {
  const bn = lang === "bn";
  function fields(
    items: readonly FieldDefinition[],
    values: Record<string, unknown>,
    root: Record<string, unknown>,
    prefix = "",
  ): string {
    return items
      .filter(
        (f) =>
          isFieldVisible(f, values) &&
          values[f.id] !== undefined &&
          !["delivery_language", "confirmation"].includes(f.id) &&
          !(
            lang === "en" &&
            (f.id.endsWith("_bn") || /\(Bangla\)$/i.test(f.label.en))
          ) &&
          !(
            lang === "bn" &&
            (f.id.endsWith("_en") || /\(English\)$/i.test(f.label.en))
          ),
      )
      .map((f) => {
        const value = values[f.id],
          label = f.label[bn ? "bn" : "en"];
        if (f.type === "repeatable")
          return `<section class="repeatable"><h4>${escape(label)}</h4>${(value as Record<string, unknown>[]).map((row, i) => `<div class="member"><strong>${bn ? "তথ্য" : "Entry"} ${bn ? bnDigits(i + 1) : i + 1}</strong><dl>${fields(f.children ?? [], row, root, `${prefix}${f.id}[${i}].`)}</dl></div>`).join("")}</section>`;
        let output: unknown = value;
        if (f.type === "attachment")
          output = bn
            ? "সংযুক্ত ব্যক্তিগত নথি"
            : "Private supporting document attached";
        else if (f.type === "geography")
          output =
            geographyNames[`${prefix}${f.id}`]?.[bn ? "bn" : "en"] ??
            (bn ? "এলাকা যাচাই করা যায়নি" : "Location could not be resolved");
        else if (f.type === "checkbox")
          output = bn ? (value ? "হ্যাঁ" : "না") : value ? "Yes" : "No";
        else if (f.type === "select")
          output =
            f.options?.find((o) => o.value === value)?.label[
              bn ? "bn" : "en"
            ] ?? value;
        else if ((f.type === "date" || f.type === "number") && bn)
          output = bnDigits(value);
        return `<div class="field" data-field="${escape(f.id)}"><dt>${escape(label)}</dt><dd>${escape(output)}</dd></div>`;
      })
      .join("");
  }
  return schema.sections
    .map((section) => {
      const body = fields(section.fields, payload, payload);
      return body
        ? `<section class="form-section"><h4>${escape(section.title[bn ? "bn" : "en"])}</h4><dl>${body}</dl></section>`
        : "";
    })
    .join("");
}

/** Only the selected approved language values enter the document body. */
function renderCertificateHtmlV6(
  input: PdfInput,
  qrDataUrl: string,
): string {
  // The template renders clean product text in every mode.
  const selected = input.payload.delivery_language;
  const language: CertificateLanguage =
    selected === "bn" || selected === "en" ? selected : "bilingual";
  const isResident =
    input.service.service_no === 45 || "residence_since" in input.payload;
  const languages = language === "bilingual" ? ["bn", "en"] : [language];
  const renderedDataLength = languages.reduce(
    (sum, lang) =>
      sum +
      String(input.citizen[lang === "bn" ? "full_name_bn" : "full_name_en"])
        .length +
      String(input.payload[`permanent_address_${lang}`] ?? "").length +
      String(input.payload[`purpose_${lang}`] ?? "").length,
    0,
  );
  const fontSize = renderedDataLength > 2400 ? "12.5px" : "14px";
  const lineHeight = renderedDataLength > 2400 ? "1.45" : "1.6";
  const heading = languages
    .map(
      (lang) =>
        `<div lang="${lang}" class="office-language"><h1>${escape(input.tenant[lang === "bn" ? "name_bn" : "name_en"])}</h1><h2>${escape(input.service[lang === "bn" ? "name_bn" : "name_en"])}</h2></div>`,
    )
    .join("");
  const details = languages
    .map((lang) => {
      const bn = lang === "bn";
      const name = input.citizen[bn ? "full_name_bn" : "full_name_en"];
      // The form's address_source chooses which registered citizen address the document states.
      const source = input.payload.address_source;
      const separatePresent = input.citizen.present_same_as_permanent === false;
      const usePresent = source === "present" && separatePresent;
      const address = isResident
        ? input.payload[bn ? "permanent_address_bn" : "permanent_address_en"]
        : (input.payload[bn ? "business_address_bn" : "business_address_en"] ??
          (usePresent
            ? input.citizen[bn ? "present_address_bn" : "present_address_en"]
            : input.citizen[bn ? "address_bn" : "address_en"]));
      const citizenAddressLabel =
        source === "present"
          ? usePresent
            ? bn
              ? "বর্তমান ঠিকানা"
              : "Present address"
            : bn
              ? "বর্তমান ও স্থায়ী ঠিকানা"
              : "Present and permanent address"
          : source === "permanent"
            ? separatePresent
              ? bn
                ? "স্থায়ী ঠিকানা"
                : "Permanent address"
              : bn
                ? "স্থায়ী ও বর্তমান ঠিকানা"
                : "Permanent and present address"
            : bn
              ? "নিবন্ধিত নাগরিকের ঠিকানা"
              : "Registered citizen address";
      const row = (label: string, value: unknown, key: string) =>
        `<div class="field" data-field="${key}"><dt>${label}</dt><dd>${escape(value)}</dd></div>`;
      const approvedFields =
        row(bn ? "নাগরিকের নাম" : "Applicant name", name, `name_${lang}`) +
        row(
          isResident
            ? bn
              ? "স্থায়ী ঠিকানা"
              : "Permanent address"
            : input.service.service_no === 42
              ? bn
                ? "ব্যবসার ঠিকানা"
                : "Business address"
              : citizenAddressLabel,
          address,
          `permanent_address_${lang}`,
        ) +
        (isResident
          ? row(
              bn ? "বসবাস শুরুর তারিখ" : "Resident since",
              bn
                ? bnDigits(input.payload.residence_since)
                : input.payload.residence_since,
              "residence_since",
            ) +
            row(
              bn ? "আবেদনের উদ্দেশ্য" : "Application purpose",
              input.payload[bn ? "purpose_bn" : "purpose_en"],
              `purpose_${lang}`,
            )
          : approvedSchemaData(
              input.schema ?? getServiceSchema(input.service.service_no!),
              input.payload,
              lang,
              input.geographyNames,
            ));
      const declaration = isResident
        ? bn
          ? "উপরের তথ্য অনুমোদিত আবেদন থেকে নেওয়া হয়েছে।"
          : "The details above come from the approved application."
        : bn
          ? "উপরের তথ্য এই সেবার অনুমোদিত আবেদন থেকে নেওয়া হয়েছে।"
          : "These service-specific details come from the approved application.";
      const renewal = input.renewalNumber
        ? `<p class="renewal">${bn ? "নবায়নের পূর্ববর্তী নথি" : "Renewal of certificate"}: ${escape(input.renewalNumber)}</p>`
        : "";
      return `<section lang="${lang}" class="language-section" data-language="${lang}"><h3>${bn ? "অনুমোদিত তথ্য" : "Approved details"}</h3>${renewal}<dl>${approvedFields}</dl><p class="declaration">${declaration}</p></section>`;
    })
    .join("");
  // Phase W: the Chairman alone verifies, approves and issues, and signs the printed copy by hand.
  const signatureLabels =
    language === "en"
      ? [["Approved and issued by", "Chairman"]]
      : language === "bn"
        ? [["অনুমোদন ও ইস্যুকারী", "চেয়ারম্যান"]]
        : [["অনুমোদন ও ইস্যুকারী / Approved and issued by", "চেয়ারম্যান / Chairman"]];
  const signatures = `<section class="signatures">${signatureLabels
    .map(([role, title]) => `<div class="signature"><div class="sign-line"></div><strong>${role}</strong><span>${title}</span></div>`)
    .join("")}</section>`;
  const today = new Date().toISOString().slice(0, 10);
  const footer =
    language === "bn"
      ? `অবস্থা যাচাই · সংস্করণ ${bnDigits(TEMPLATE_V6)} · ইস্যুর তারিখ ${bnDigits(today)}`
      : language === "en"
        ? `Verify status · Template ${TEMPLATE_V6} · Issued ${today}`
        : `অবস্থা যাচাই / Verify status · Template ${TEMPLATE_V6} · Issued ${today}`;
  const watermark = "";
  const banner = "";
  return `<!doctype html><html lang="${language === "en" ? "en" : "bn"}"><head><meta charset="UTF-8"><style>
@page{size:A4;margin:17mm 19mm}*{box-sizing:border-box}body{font-family:'Nirmala UI','Noto Sans Bengali',sans-serif;color:#132d39;line-height:${lineHeight};font-size:${fontSize};margin:0}.office{text-align:center;display:flex;justify-content:center;gap:20px;margin:15px 0 8px}.office-language{flex:1}h1{font-size:21px;line-height:1.4;margin:0 0 7px}h2{font-size:18px;line-height:1.5;margin:0}h3{font-size:15px;margin:0 0 9px}.number{font-family:monospace;font-size:12px;text-align:center}.content{display:grid;grid-template-columns:${language === "bilingual" ? "1fr 1fr" : "1fr"};gap:24px;margin:17px 0;border-top:2px solid #16786d;padding-top:14px}.language-section{min-width:0}dl{margin:0}.field{margin:0 0 12px;break-inside:avoid}dt{font-weight:bold;font-size:12px;color:#3d5863}dd{margin:3px 0 0;overflow-wrap:anywhere;white-space:pre-wrap}.declaration{font-size:11px;line-height:1.5;margin:13px 0 0}.signatures{display:flex;justify-content:center;gap:40px;margin:22px 0 14px;break-inside:avoid}.signature{flex:0 1 320px;text-align:center;font-size:11px;display:flex;flex-direction:column;gap:2px}.sign-line{border-top:1px solid #4b5563;margin:34px 12px 6px}.verification{display:flex;align-items:center;gap:14px;border-top:1px solid #bdcbd1;padding-top:11px;break-inside:avoid}.qr{width:116px;height:116px;flex:none}.footer{font-size:10px;line-height:1.5;color:#4b5563;overflow-wrap:anywhere}.url{font-family:monospace;font-size:8px;display:block;margin-top:6px}.watermark{position:fixed;left:27%;top:42%;transform:rotate(-30deg);font:bold 72px sans-serif;color:rgba(179,38,30,.08);z-index:-1}
h4{font-size:12px;line-height:1.4;margin:7px 0 4px;break-after:avoid}h5{font-size:11px;margin:5px 0 3px;break-after:avoid}.declaration{break-inside:avoid}.generic{font-size:12.5px;line-height:1.45}.generic .field{margin-bottom:5px}.generic dt{font-size:10.5px}.generic dd{margin-top:1px}.generic .member>strong{font-size:11px}.generic .member{margin:4px 0 7px}.generic .content{margin:12px 0;padding-top:10px;gap:20px}.generic .declaration{font-size:10px;margin:7px 0 0;line-height:1.45}.generic .office{margin:12px 0 7px}.generic .qr{width:100px;height:100px}.generic .verification{padding-top:8px}.generic .form-section{margin:0}.generic h3{font-size:13px;margin-bottom:6px}
</style></head><body class="${isResident ? "resident" : "generic"}">${watermark}${banner}<header class="office">${heading}</header><div class="number">${escape(input.number)}</div><main class="content" data-delivery-language="${language}">${details}</main>${signatures}<section class="verification"><img class="qr" alt="${language === "bn" ? "অবস্থা যাচাইয়ের QR" : "Public verification QR"}" src="${escape(qrDataUrl)}"><div class="footer">${footer}<span class="url">${escape(input.verificationUrl)}</span></div></section></body></html>`;
}

/**
 * Render a certificate document. New issues use the current template version
 * (DEMO_TEMPLATE_VERSION); a stored certificate's version can be passed to
 * re-render exactly the template it was issued with — template 6 stays
 * selectable and byte-stable.
 */
export function renderCertificateHtml(
  input: PdfInput,
  qrDataUrl: string,
  version: number = DEMO_TEMPLATE_VERSION,
): string {
  if (version === TEMPLATE_V6) return renderCertificateHtmlV6(input, qrDataUrl);
  return renderCertificateHtmlV7(input, qrDataUrl);
}
