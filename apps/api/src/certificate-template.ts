import {
  type FormSchema,
  type FieldDefinition,
  isFieldVisible,
  getServiceSchema,
} from "@astra/shared-schemas";
/** New issues use v4. Existing stored PDFs and metadata are never rewritten. */
export const DEMO_TEMPLATE_VERSION = 4;
export type CertificateLanguage = "bn" | "en" | "bilingual";
export interface PdfInput {
  number: string;
  verificationUrl: string;
  tenant: { name_bn: string; name_en: string };
  service: { service_no?: number; name_bn: string; name_en: string };
  citizen: {
    full_name_bn: string;
    full_name_en: string;
    address_bn: string;
    address_en: string;
  };
  payload: Record<string, unknown>;
  schema?: FormSchema;
  renewalNumber?: string;
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
) {
  const bn = lang === "bn";
  function fields(
    items: readonly FieldDefinition[],
    values: Record<string, unknown>,
    root: Record<string, unknown>,
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
          return `<section class="repeatable"><h4>${escape(label)}</h4>${(value as Record<string, unknown>[]).map((row, i) => `<div class="member"><strong>${bn ? "তথ্য" : "Entry"} ${bn ? bnDigits(i + 1) : i + 1}</strong><dl>${fields(f.children ?? [], row, root)}</dl></div>`).join("")}</section>`;
        let output: unknown = value;
        if (f.type === "attachment")
          output = bn
            ? "সংযুক্ত ব্যক্তিগত নথি"
            : "Private supporting document attached";
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
export function renderCertificateHtml(
  input: PdfInput,
  qrDataUrl: string,
): string {
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
      const address = isResident
        ? input.payload[bn ? "permanent_address_bn" : "permanent_address_en"]
        : (input.payload[bn ? "business_address_bn" : "business_address_en"] ??
          input.citizen[bn ? "address_bn" : "address_en"]);
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
              : bn
                ? "নিবন্ধিত নাগরিকের ঠিকানা"
                : "Registered citizen address",
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
            ));
      const declaration = isResident
        ? bn
          ? "উপরের তথ্য অনুমোদিত পরীক্ষামূলক আবেদন থেকে নেওয়া হয়েছে। এই নথি সফটওয়্যার কার্যপ্রবাহের প্রদর্শনী; আইনগত পরিচয় বা সরকারি অনুমোদনের প্রমাণ নয়।"
          : "The details above come from the approved demonstration application. This document demonstrates the software workflow and is not proof of legal identity or official authorization."
        : bn
          ? "উপরের তথ্য এই সেবার অনুমোদিত ডেমো আবেদন থেকে নেওয়া হয়েছে। এটি স্বাধীনভাবে তৈরি পরীক্ষামূলক নমুনা; নির্দিষ্ট সেবার সরকারি নিয়ম বা আইনগত বৈধতার প্রমাণ নয়।"
          : "These service-specific details come from the approved demonstration application. This independently authored template demonstrates the workflow; it does not establish official rules or legal validity.";
      const renewal = input.renewalNumber
        ? `<p class="renewal">${bn ? "নবায়নের পূর্ববর্তী নথি" : "Renewal of certificate"}: ${escape(input.renewalNumber)}</p>`
        : "";
      return `<section lang="${lang}" class="language-section" data-language="${lang}"><h3>${bn ? "অনুমোদিত ডেমো তথ্য" : "Approved demo details"}</h3>${renewal}<dl>${approvedFields}</dl><p class="declaration">${declaration}</p></section>`;
    })
    .join("");
  const today = new Date().toISOString().slice(0, 10);
  const footer =
    language === "bn"
      ? `ডেমো অবস্থা যাচাই · নমুনা সংস্করণ ${bnDigits(DEMO_TEMPLATE_VERSION)} · ইস্যুর তারিখ ${bnDigits(today)}<br>সরকারি সিল, স্বাক্ষর বা পরিচয় নম্বর নেই`
      : language === "en"
        ? `Verify demo status · Template ${DEMO_TEMPLATE_VERSION} · Issued ${today}<br>No government seal, signature or identity number`
        : `ডেমো অবস্থা যাচাই / Verify demo status · Template ${DEMO_TEMPLATE_VERSION} · Issued ${today}<br>সরকারি সিল বা স্বাক্ষর নেই / No government seal, signature or identity number`;
  return `<!doctype html><html lang="${language === "en" ? "en" : "bn"}"><head><meta charset="UTF-8"><style>
@page{size:A4;margin:17mm 19mm}*{box-sizing:border-box}body{font-family:'Nirmala UI','Noto Sans Bengali',sans-serif;color:#132d39;line-height:${lineHeight};font-size:${fontSize};margin:0}.demo{border:2px solid #b3261e;color:#b3261e;padding:8px;text-align:center;font:bold 16px sans-serif}.office{text-align:center;display:flex;justify-content:center;gap:20px;margin:15px 0 8px}.office-language{flex:1}h1{font-size:21px;line-height:1.4;margin:0 0 7px}h2{font-size:18px;line-height:1.5;margin:0}h3{font-size:15px;margin:0 0 9px}.number{font-family:monospace;font-size:12px;text-align:center}.content{display:grid;grid-template-columns:${language === "bilingual" ? "1fr 1fr" : "1fr"};gap:24px;margin:17px 0;border-top:2px solid #16786d;padding-top:14px}.language-section{min-width:0}dl{margin:0}.field{margin:0 0 12px;break-inside:avoid}dt{font-weight:bold;font-size:12px;color:#3d5863}dd{margin:3px 0 0;overflow-wrap:anywhere;white-space:pre-wrap}.declaration{font-size:11px;line-height:1.5;margin:13px 0 0}.verification{display:flex;align-items:center;gap:14px;border-top:1px solid #bdcbd1;padding-top:11px;break-inside:avoid}.qr{width:116px;height:116px;flex:none}.footer{font-size:10px;line-height:1.5;color:#4b5563;overflow-wrap:anywhere}.url{font-family:monospace;font-size:8px;display:block;margin-top:6px}.watermark{position:fixed;left:27%;top:42%;transform:rotate(-30deg);font:bold 72px sans-serif;color:rgba(179,38,30,.08);z-index:-1}
h4{font-size:12px;line-height:1.4;margin:7px 0 4px;break-after:avoid}h5{font-size:11px;margin:5px 0 3px;break-after:avoid}.declaration{break-inside:avoid}.generic{font-size:12.5px;line-height:1.45}.generic .field{margin-bottom:5px}.generic dt{font-size:10.5px}.generic dd{margin-top:1px}.generic .member>strong{font-size:11px}.generic .member{margin:4px 0 7px}.generic .content{margin:12px 0;padding-top:10px;gap:20px}.generic .declaration{font-size:10px;margin:7px 0 0;line-height:1.45}.generic .office{margin:12px 0 7px}.generic .qr{width:100px;height:100px}.generic .verification{padding-top:8px}.generic .form-section{margin:0}.generic h3{font-size:13px;margin-bottom:6px}
</style></head><body class="${isResident ? "resident" : "generic"}"><div class="watermark">DEMO</div><div class="demo">DEMO / NOT OFFICIAL<br>শুধুমাত্র প্রদর্শনী — সরকারি সনদ নয়</div><header class="office">${heading}</header><div class="number">${escape(input.number)}</div><main class="content" data-delivery-language="${language}">${details}</main><section class="verification"><img class="qr" alt="${language === "bn" ? "ডেমো অবস্থা যাচাইয়ের QR" : "Public demo verification QR"}" src="${escape(qrDataUrl)}"><div class="footer">${footer}<span class="url">${escape(input.verificationUrl)}</span></div></section></body></html>`;
}
