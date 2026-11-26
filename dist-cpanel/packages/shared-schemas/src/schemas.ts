import type {
  FieldDefinition,
  FormSchema,
  FormSection,
  LocalizedText,
} from "./types.js";
import { deepFreeze } from "./engine.js";
import {
  createSyntheticPayload,
  expandedOperationalSchemas,
  buildTradeLicenseV2,
  buildFamilyV2,
  buildGeographySelectorVersion,
  buildConditionalGroupVersion,
  buildCertRefineVersion,
  buildFamilyCertRefine,
  buildQaFixVersion,
  buildQaFix2Version,
  qaFix2Services,
  buildQaFix3Version,
  qaFix3Services,
  buildQaFix4Version,
  qaFix4Services,
  buildQaFix5Version,
  qaFix5Services,
  buildQaFix6Version,
  qaFix6Services,
  buildQaFix7Version,
  qaFix7Services,
  buildQaFix8Version,
  qaFix8Services,
  buildQaFix9Version,
  qaFix9Services,
  certRefineServices,
  conditionalGroupServices,
  geographySelectorServices,
} from "./expanded-schemas.js";
export {
  geographySelectorServices,
  conditionalGroupServices,
  legacyLocationFieldIds,
  groupControllerIds,
} from "./expanded-schemas.js";

const label = (bn: string, en: string): LocalizedText => ({ bn, en });
const stringField = (
  id: string,
  bn: string,
  en: string,
  required = true,
  maxLength = 200,
): FieldDefinition => ({
  id,
  type: "text",
  label: label(bn, en),
  constraints: { required, minLength: required ? 2 : undefined, maxLength },
});
const addressField = (id: string, bn: string, en: string): FieldDefinition => ({
  ...stringField(id, bn, en, true, 1000),
  type: "textarea",
});
const confirmation: FieldDefinition = {
  id: "confirmation",
  type: "checkbox",
  label: label(
    "প্রদত্ত তথ্য সঠিক এবং আমি এই আবেদন জমা দিচ্ছি।",
    "I confirm the information is correct and I submit this application.",
  ),
  constraints: { required: true, mustBeTrue: true },
};
const attachments: FieldDefinition = {
  id: "attachments",
  type: "repeatable",
  label: label("সহায়ক নথি", "Supporting documents"),
  constraints: { maxRows: 5 },
  children: [
    stringField("description", "নথির বিবরণ", "Document description", true, 150),
    {
      id: "file",
      type: "attachment",
      label: label("নথি", "Document"),
      constraints: {
        required: true,
        acceptedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
        maxBytes: 2_097_152,
      },
    },
  ],
};
const evidence = (serviceNo: number): FormSchema["evidence"] => ({
  status: "proposed",
  source: `audit/evidence/s-${String(serviceNo).padStart(2, "0")}.json`,
  limitation: "Complete all required fields before submitting.",
});

export const permanentResidentV1: FormSchema = deepFreeze({
  serviceNo: 45,
  version: 1,
  title: label("স্থায়ী বাসিন্দা সনদ", "Permanent resident certificate"),
  stage: "operational_demo",
  evidence: evidence(45),
  sections: [
    {
      id: "residency",
      title: label("বাসিন্দার তথ্য", "Residence details"),
      fields: [
        addressField(
          "permanent_address_bn",
          "স্থায়ী ঠিকানা (বাংলা)",
          "Permanent address (Bangla)",
        ),
        addressField(
          "permanent_address_en",
          "স্থায়ী ঠিকানা (ইংরেজি)",
          "Permanent address (English)",
        ),
        {
          id: "residence_since",
          type: "date",
          label: label("বসবাস শুরুর তারিখ", "Resident since"),
          constraints: { required: true },
        },
        stringField(
          "purpose_bn",
          "আবেদনের উদ্দেশ্য (বাংলা)",
          "Purpose (Bangla)",
          true,
          500,
        ),
        stringField(
          "purpose_en",
          "আবেদনের উদ্দেশ্য (ইংরেজি)",
          "Purpose (English)",
          true,
          500,
        ),
      ],
    },
    {
      id: "delivery",
      title: label("ভাষা ও ঘোষণা", "Language and declaration"),
      fields: [
        {
          id: "delivery_language",
          type: "select",
          label: label("সনদের ভাষা", "Certificate language"),
          constraints: { required: true },
          options: [
            { value: "bn", label: label("বাংলা", "Bangla") },
            { value: "en", label: label("ইংরেজি", "English") },
            { value: "bilingual", label: label("দ্বিভাষিক", "Bilingual") },
          ],
        },
        confirmation,
      ],
    },
  ],
});

export const familyV1: FormSchema = deepFreeze({
  serviceNo: 2,
  version: 1,
  title: label("পারিবারিক সনদ", "Family certificate"),
  stage: "operational_demo",
  evidence: evidence(2),
  sections: [
    {
      id: "household",
      title: label("পরিবারের বিবরণ", "Household"),
      fields: [
        stringField(
          "household_name_bn",
          "পরিবার প্রধানের নাম (বাংলা)",
          "Household head name (Bangla)",
        ),
        stringField(
          "household_name_en",
          "পরিবার প্রধানের নাম (ইংরেজি)",
          "Household head name (English)",
        ),
      ],
    },
    {
      id: "family",
      title: label("পরিবারের সদস্য", "Family members"),
      fields: [
        {
          id: "members",
          type: "repeatable",
          label: label("সদস্য তালিকা", "Members"),
          constraints: { required: true, minRows: 1, maxRows: 30 },
          evidence: {
            status: "inferred",
            source: "audit/evidence/s-02.json",
            fieldNames: [
              "warish_heir_name[]",
              "warish_heir_name_bn[]",
              "warish_heir_relation[]",
              "warish_heir_dob[]",
              "warish_heir_mobile_no[]",
            ],
          },
          children: [
            stringField(
              "name_bn",
              "সদস্যের নাম (বাংলা)",
              "Member name (Bangla)",
            ),
            stringField(
              "name_en",
              "সদস্যের নাম (ইংরেজি)",
              "Member name (English)",
            ),
            {
              id: "relationship",
              type: "select",
              label: label("সম্পর্ক", "Relationship"),
              constraints: { required: true },
              options: [
                { value: "self", label: label("নিজ", "Self") },
                { value: "spouse", label: label("স্বামী/স্ত্রী", "Spouse") },
                { value: "child", label: label("সন্তান", "Child") },
                { value: "parent", label: label("পিতা/মাতা", "Parent") },
                { value: "sibling", label: label("ভাই/বোন", "Sibling") },
                { value: "other", label: label("অন্যান্য", "Other") },
              ],
            },
            {
              id: "dob",
              type: "date",
              label: label("জন্ম তারিখ", "Date of birth"),
              constraints: { required: true },
            },
            {
              id: "is_minor",
              type: "checkbox",
              label: label("অপ্রাপ্তবয়স্ক", "Minor"),
              constraints: { required: true },
            },
            {
              ...stringField(
                "guardian_name_bn",
                "অভিভাবকের নাম (বাংলা)",
                "Guardian name (Bangla)",
              ),
              visibleWhen: { field: "is_minor", equals: true },
            },
            {
              ...stringField(
                "mobile",
                "মোবাইল নম্বর",
                "Mobile number",
                false,
                11,
              ),
              constraints: { pattern: "^01[0-9]{9}$", maxLength: 11 },
            },
            attachments,
          ],
        },
        confirmation,
      ],
    },
  ],
});

export const tradeLicenseV1: FormSchema = deepFreeze({
  serviceNo: 42,
  version: 1,
  title: label("ট্রেড লাইসেন্স", "Trade license"),
  stage: "operational_demo",
  evidence: evidence(42),
  sections: [
    {
      id: "business",
      title: label("প্রতিষ্ঠানের বিবরণ", "Business details"),
      fields: [
        stringField(
          "business_name_bn",
          "প্রতিষ্ঠানের নাম (বাংলা)",
          "Business name (Bangla)",
        ),
        stringField(
          "business_name_en",
          "প্রতিষ্ঠানের নাম (ইংরেজি)",
          "Business name (English)",
        ),
        {
          id: "business_type",
          type: "select",
          label: label("ব্যবসার ধরন", "Business type"),
          constraints: { required: true },
          options: [
            { value: "retail", label: label("খুচরা", "Retail") },
            { value: "service", label: label("সেবা", "Service") },
            { value: "manufacturing", label: label("উৎপাদন", "Manufacturing") },
            { value: "other", label: label("অন্যান্য", "Other") },
          ],
        },
        {
          id: "start_date",
          type: "date",
          label: label("ব্যবসা শুরুর তারিখ", "Business starting date"),
          constraints: { required: true },
        },
      ],
    },
    {
      id: "location",
      title: label("ব্যবসার ঠিকানা", "Business location"),
      fields: [
        addressField(
          "business_address_bn",
          "ব্যবসার ঠিকানা (বাংলা)",
          "Business address (Bangla)",
        ),
        addressField(
          "business_address_en",
          "ব্যবসার ঠিকানা (ইংরেজি)",
          "Business address (English)",
        ),
      ],
    },
    {
      id: "proprietor",
      title: label("স্বত্বাধিকারীর তথ্য", "Proprietor"),
      fields: [
        stringField(
          "proprietor_name_bn",
          "স্বত্বাধিকারীর নাম (বাংলা)",
          "Proprietor name (Bangla)",
        ),
        stringField(
          "proprietor_name_en",
          "স্বত্বাধিকারীর নাম (ইংরেজি)",
          "Proprietor name (English)",
        ),
        {
          ...stringField("mobile", "মোবাইল নম্বর", "Mobile number", true, 11),
          constraints: {
            required: true,
            pattern: "^01[0-9]{9}$",
            maxLength: 11,
          },
        },
      ],
    },
    {
      id: "renewal",
      title: label("পূর্বের লাইসেন্স ও নথি", "Previous license and documents"),
      fields: [
        {
          id: "has_previous_license",
          type: "checkbox",
          label: label("পূর্বের লাইসেন্স রয়েছে", "I have a previous license"),
          constraints: { required: true },
        },
        {
          ...stringField(
            "previous_license_number",
            "পূর্বের লাইসেন্স নম্বর",
            "Previous license number",
            true,
            40,
          ),
          visibleWhen: { field: "has_previous_license", equals: true },
          evidence: {
            status: "inferred",
            source: "audit/evidence/s-42.json form 2",
            fieldNames: ["application_no"],
          },
        },
        attachments,
        confirmation,
      ],
    },
  ],
});

export const tradeLicenseV2: FormSchema = buildTradeLicenseV2(tradeLicenseV1);
export const familyV2: FormSchema = buildFamilyV2(familyV1);

/** Versions superseded by the geography selector release; retained for applications pinned to them. */
export const geographySupersededSchemas: readonly FormSchema[] = deepFreeze(
  [tradeLicenseV2, ...expandedOperationalSchemas].filter((schema) =>
    geographySelectorServices.includes(schema.serviceNo),
  ),
);
export const geographySelectorSchemas: readonly FormSchema[] = deepFreeze(
  geographySupersededSchemas.map(buildGeographySelectorVersion),
);
/** Versions superseded by the Phase 4 conditional-group release; retained for applications pinned to them. */
export const conditionalSupersededSchemas: readonly FormSchema[] = deepFreeze(
  expandedOperationalSchemas.filter((schema) =>
    conditionalGroupServices.includes(schema.serviceNo),
  ),
);
export const conditionalSchemas: readonly FormSchema[] = deepFreeze(
  conditionalSupersededSchemas.map(buildConditionalGroupVersion),
);
const preRefineLatest = (schema: FormSchema) =>
  geographySelectorSchemas.find((item) => item.serviceNo === schema.serviceNo) ??
  conditionalSchemas.find((item) => item.serviceNo === schema.serviceNo) ??
  schema;
/** Versions superseded by the CERT-REFINE-01 release; retained for applications pinned to them. */
export const certRefineSupersededSchemas: readonly FormSchema[] = deepFreeze(
  [familyV2, tradeLicenseV2, ...expandedOperationalSchemas]
    .map(preRefineLatest)
    .filter((schema) => certRefineServices.includes(schema.serviceNo)),
);
export const certRefineSchemas: readonly FormSchema[] = deepFreeze(
  certRefineSupersededSchemas.map((schema) =>
    schema.serviceNo === 2
      ? buildFamilyCertRefine(schema)
      : buildCertRefineVersion(schema),
  ),
);
const latest = (schema: FormSchema) =>
  certRefineSchemas.find((item) => item.serviceNo === schema.serviceNo) ??
  preRefineLatest(schema);

/** Versions superseded by the QAFIX-01 release; retained for applications pinned to them. */
export const qaFixSupersededSchemas: readonly FormSchema[] = deepFreeze(
  [permanentResidentV1, familyV2, tradeLicenseV2, ...expandedOperationalSchemas].map(
    latest,
  ),
);
export const qaFixSchemas: readonly FormSchema[] = deepFreeze(
  qaFixSupersededSchemas.map(buildQaFixVersion),
);
const latestWithQaFix = (schema: FormSchema) =>
  qaFixSchemas.find((item) => item.serviceNo === schema.serviceNo) ??
  latest(schema);

/** Versions superseded by the QAFIX-02 template-repair release; retained for applications pinned to them. */
export const qaFix2SupersededSchemas: readonly FormSchema[] = deepFreeze(
  qaFixSchemas.filter((schema) => qaFix2Services.includes(schema.serviceNo)),
);
export const qaFix2Schemas: readonly FormSchema[] = deepFreeze(
  qaFix2SupersededSchemas.map(buildQaFix2Version),
);
const latestWithQaFix2 = (schema: FormSchema) =>
  qaFix2Schemas.find((item) => item.serviceNo === schema.serviceNo) ??
  latestWithQaFix(schema);

/** Versions superseded by the QAFIX-03 repair release; retained for applications pinned to them. */
export const qaFix3SupersededSchemas: readonly FormSchema[] = deepFreeze(
  [permanentResidentV1, familyV2, tradeLicenseV2, ...expandedOperationalSchemas]
    .map(latestWithQaFix2)
    .filter((schema) => qaFix3Services.includes(schema.serviceNo)),
);
export const qaFix3Schemas: readonly FormSchema[] = deepFreeze(
  qaFix3SupersededSchemas.map(buildQaFix3Version),
);
const latestWithQaFix3 = (schema: FormSchema) =>
  qaFix3Schemas.find((item) => item.serviceNo === schema.serviceNo) ??
  latestWithQaFix2(schema);

/** Versions superseded by the QAFIX-04 repair release; retained for applications pinned to them. */
export const qaFix4SupersededSchemas: readonly FormSchema[] = deepFreeze(
  [permanentResidentV1, familyV2, tradeLicenseV2, ...expandedOperationalSchemas]
    .map(latestWithQaFix3)
    .filter((schema) => qaFix4Services.includes(schema.serviceNo)),
);
export const qaFix4Schemas: readonly FormSchema[] = deepFreeze(
  qaFix4SupersededSchemas.map(buildQaFix4Version),
);
const latestWithQaFix4 = (schema: FormSchema) =>
  qaFix4Schemas.find((item) => item.serviceNo === schema.serviceNo) ??
  latestWithQaFix3(schema);

/** Versions superseded by the QAFIX-05 repair release; retained for applications pinned to them. */
export const qaFix5SupersededSchemas: readonly FormSchema[] = deepFreeze(
  [permanentResidentV1, familyV2, tradeLicenseV2, ...expandedOperationalSchemas]
    .map(latestWithQaFix4)
    .filter((schema) => qaFix5Services.includes(schema.serviceNo)),
);
export const qaFix5Schemas: readonly FormSchema[] = deepFreeze(
  qaFix5SupersededSchemas.map(buildQaFix5Version),
);
const latestWithQaFix5 = (schema: FormSchema) =>
  qaFix5Schemas.find((item) => item.serviceNo === schema.serviceNo) ??
  latestWithQaFix4(schema);

/** Versions superseded by the QAFIX-06 repair release; retained for applications pinned to them. */
export const qaFix6SupersededSchemas: readonly FormSchema[] = deepFreeze(
  [permanentResidentV1, familyV2, tradeLicenseV2, ...expandedOperationalSchemas]
    .map(latestWithQaFix5)
    .filter((schema) => qaFix6Services.includes(schema.serviceNo)),
);
export const qaFix6Schemas: readonly FormSchema[] = deepFreeze(
  qaFix6SupersededSchemas.map(buildQaFix6Version),
);
const latestWithQaFix6 = (schema: FormSchema) =>
  qaFix6Schemas.find((item) => item.serviceNo === schema.serviceNo) ??
  latestWithQaFix5(schema);

/** Versions superseded by the QAFIX-07 repair release; retained for applications pinned to them. */
export const qaFix7SupersededSchemas: readonly FormSchema[] = deepFreeze(
  [permanentResidentV1, familyV2, tradeLicenseV2, ...expandedOperationalSchemas]
    .map(latestWithQaFix6)
    .filter((schema) => qaFix7Services.includes(schema.serviceNo)),
);
export const qaFix7Schemas: readonly FormSchema[] = deepFreeze(
  qaFix7SupersededSchemas.map(buildQaFix7Version),
);
const latestWithQaFix7 = (schema: FormSchema) =>
  qaFix7Schemas.find((item) => item.serviceNo === schema.serviceNo) ??
  latestWithQaFix6(schema);

/** Versions superseded by the QAFIX-08 repair release; retained for applications pinned to them. */
export const qaFix8SupersededSchemas: readonly FormSchema[] = deepFreeze(
  [permanentResidentV1, familyV2, tradeLicenseV2, ...expandedOperationalSchemas]
    .map(latestWithQaFix7)
    .filter((schema) => qaFix8Services.includes(schema.serviceNo)),
);
export const qaFix8Schemas: readonly FormSchema[] = deepFreeze(
  qaFix8SupersededSchemas.map(buildQaFix8Version),
);
const latestWithQaFix8 = (schema: FormSchema) =>
  qaFix8Schemas.find((item) => item.serviceNo === schema.serviceNo) ??
  latestWithQaFix7(schema);

/** Versions superseded by the QAFIX-09 repair release; retained for applications pinned to them. */
export const qaFix9SupersededSchemas: readonly FormSchema[] = deepFreeze(
  [permanentResidentV1, familyV2, tradeLicenseV2, ...expandedOperationalSchemas]
    .map(latestWithQaFix8)
    .filter((schema) => qaFix9Services.includes(schema.serviceNo)),
);
export const qaFix9Schemas: readonly FormSchema[] = deepFreeze(
  qaFix9SupersededSchemas.map(buildQaFix9Version),
);
const latestWithQaFix9 = (schema: FormSchema) =>
  qaFix9Schemas.find((item) => item.serviceNo === schema.serviceNo) ??
  latestWithQaFix8(schema);

export const operationalSchemas: readonly FormSchema[] = deepFreeze(
  [permanentResidentV1, familyV2, tradeLicenseV2, ...expandedOperationalSchemas].map(
    latestWithQaFix9,
  ),
);

/**
 * QAFIX-02 (§3.4, §4 item 3): one-line distinguishing descriptions shown
 * where the citizen starts a service. Services 3 and 4 are near-duplicates
 * (the same deceased + heirs data), and citizens picked the wrong one
 * because nothing said how they differ: 3 certifies WHO the legal heirs
 * are; 4 establishes succession TO the deceased's property and assets.
 * QAFIX-03 (§3.12) adds services 11 and 12 under the same rule: 11
 * certifies the nationality a person declares; 12 certifies Bangladeshi
 * citizenship and permanent residence.
 * The catalogue has no description surface, so the service's start screen
 * renders these (ServiceFlow); the remaining services adopt the same map
 * as their §4 item 3 detail pages are written. No DEMO wording, no new
 * claims — each line only restates what the certificate itself certifies.
 */
export const serviceDescriptions: Readonly<Record<number, LocalizedText>> =
  deepFreeze({
    3: {
      bn: "মৃত ব্যক্তির আইনি ওয়ারিশদের নাম ও পরিচয় নিশ্চিত করে — ব্যাংক, ভূমি রেকর্ড ও অন্যান্য অফিসে ওয়ারিশানা প্রমাণ হিসেবে ব্যবহৃত হয়।",
      en: "Names and certifies the legal heirs of a deceased person — used as proof of heirship for banks, land records and other offices.",
    },
    4: {
      bn: "মৃত ব্যক্তির সম্পত্তি ও সম্পদের আইনি উত্তরাধিকার প্রতিষ্ঠা করে এবং যারা উত্তরাধিকার পাবেন তাদের নাম উল্লেখ করে।",
      en: "Establishes legal succession to a deceased person's property and assets, naming the successors who inherit them.",
    },
    // QAFIX-03 (§3.12, §4 item 3): services 11 and 12 are near-duplicates
    // and nothing said how they differ — 11 certifies the nationality a
    // person DECLARES (and its basis); 12 certifies the legal fact of
    // Bangladeshi citizenship and permanent residence in this area.
    11: {
      bn: "ব্যক্তির ঘোষিত জাতীয়তা প্রত্যয়ন করে — তিনি কোন জাতীয়তার দাবি করেন এবং কোন ভিত্তিতে তা করেন।",
      en: "Certifies the person's declared nationality — the national identity they claim and the basis on which they claim it.",
    },
    12: {
      bn: "ব্যক্তি বাংলাদেশের নাগরিক এবং অত্র এলাকার স্থায়ী বাসিন্দা — এ মর্মে প্রত্যয়ন করে।",
      en: "Certifies that the person is a citizen of Bangladesh and a permanent resident of this area.",
    },
  });

/** Initial example payloads for local form testing. */
export const demoPayloads: Readonly<
  Record<number, Readonly<Record<string, unknown>>>
> = deepFreeze({
  ...Object.fromEntries(
    expandedOperationalSchemas.map(latestWithQaFix9).map((schema) => [
      schema.serviceNo,
      createSyntheticPayload(schema),
    ]),
  ),
  45: {
    permanent_address_bn: "স্থানীয় গ্রাম, স্থানীয় ইউনিয়ন",
    permanent_address_en: "Sample Village, Local Union",
    residence_since: "2020-01-01",
    // QAFIX-09: the v3 form asks which saved address the
    // certificate carries; the fixture names the permanent one.
    address_source: "permanent",
    purpose: "বাসিন্দা সনদ",
    purpose_language: "bn",
    delivery_language: "bilingual",
    confirmation: true,
  },
  2: {
    household_name_bn: "স্থানীয় পরিবার",
    household_name_en: "Sample Household",
    members: [
      {
        name_bn: "পরিবারের সদস্য",
        name_en: "Sample Member",
        relationship: "self",
        dob: "1990-01-01",
        is_minor: false,
      },
    ],
    address_source: "permanent",
    purpose: "পারিবারিক সনদ",
    purpose_language: "bn",
    delivery_language: "bilingual",
    confirmation: true,
  },
  42: {
    business_name_bn: "স্থানীয় দোকান",
    business_name_en: "Sample Shop",
    business_type: "retail",
    start_date: "2025-01-01",
    business_address_bn: "স্থানীয় বাজার, স্থানীয় ইউনিয়ন",
    business_address_en: "Sample Market, Local Union",
    proprietor_name_bn: "দোকানের মালিক",
    proprietor_name_en: "Sample Proprietor",
    mobile: "01000000000",
    has_previous_license: false,
    confirmation: true,
    address_source: "permanent",
    purpose: "ট্রেড লাইসেন্স",
    purpose_language: "bn",
    delivery_language: "bilingual",
  },
});

/** New mutable copies prevent edits in one application from changing another fixture. */
export function getDemoPayload(serviceNo: number): Record<string, unknown> {
  if (!demoPayloads[serviceNo])
    throw new RangeError(`Unknown service ${serviceNo}.`);
  return structuredClone(demoPayloads[serviceNo]);
}
