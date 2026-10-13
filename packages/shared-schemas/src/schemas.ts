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
    "প্রদত্ত তথ্য সঠিক এবং এটি পরীক্ষামূলক আবেদন",
    "I confirm the information is correct and this is a demo application.",
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
  limitation:
    "Independent demonstration validation. Reference evidence covers initial UI metadata only; all original successful submission, validation, approval, payment and issuance paths remain unverified.",
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

export const operationalSchemas: readonly FormSchema[] = deepFreeze([
  permanentResidentV1,
  familyV2,
  tradeLicenseV2,
  ...expandedOperationalSchemas,
]);

/** Initial payloads are synthetic. They are never lifted from source evidence. */
export const demoPayloads: Readonly<
  Record<number, Readonly<Record<string, unknown>>>
> = deepFreeze({
  ...Object.fromEntries(
    expandedOperationalSchemas.map((schema) => [
      schema.serviceNo,
      createSyntheticPayload(schema),
    ]),
  ),
  45: {
    permanent_address_bn: "নমুনা গ্রাম, পরীক্ষামূলক ইউনিয়ন",
    permanent_address_en: "Sample Village, Demo Union",
    residence_since: "2020-01-01",
    purpose_bn: "পরীক্ষামূলক বাসিন্দা সনদ",
    purpose_en: "Demonstration of resident certificate",
    delivery_language: "bilingual",
    confirmation: true,
  },
  2: {
    household_name_bn: "নমুনা পরিবার",
    household_name_en: "Sample Household",
    members: [
      {
        name_bn: "নমুনা সদস্য",
        name_en: "Sample Member",
        relationship: "self",
        dob: "1990-01-01",
        is_minor: false,
      },
    ],
    confirmation: true,
  },
  42: {
    business_name_bn: "নমুনা দোকান",
    business_name_en: "Sample Shop",
    business_type: "retail",
    start_date: "2025-01-01",
    business_address_bn: "নমুনা বাজার, পরীক্ষামূলক ইউনিয়ন",
    business_address_en: "Sample Market, Demo Union",
    proprietor_name_bn: "নমুনা মালিক",
    proprietor_name_en: "Sample Proprietor",
    mobile: "01000000000",
    has_previous_license: false,
    confirmation: true,
  },
});

/** New mutable copies prevent edits in one application from changing another demo fixture. */
export function getDemoPayload(serviceNo: number): Record<string, unknown> {
  if (!demoPayloads[serviceNo])
    throw new RangeError(`Unknown service ${serviceNo}.`);
  return structuredClone(demoPayloads[serviceNo]);
}
