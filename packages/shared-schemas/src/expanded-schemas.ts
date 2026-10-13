import referenceData from "./reference-catalog.json" with { type: "json" };
import {
  deepFreeze,
  evaluatePredicate,
  flattenFields,
  isFieldVisible,
} from "./engine.js";
import type {
  FieldDefinition,
  FormSchema,
  LocalizedText,
  ReferenceField,
  ReferenceService,
} from "./types.js";

const t = (bn: string, en: string): LocalizedText => ({ bn, en });
const option = (value: string, bn: string, en: string) => ({
  value,
  label: t(bn, en),
});
const options = {
  yesNo: [option("yes", "হ্যাঁ", "Yes"), option("no", "না", "No")],
  relationship: [
    option("self", "নিজ", "Self"),
    option("spouse", "স্বামী/স্ত্রী", "Spouse"),
    option("child", "সন্তান", "Child"),
    option("parent", "পিতা/মাতা", "Parent"),
    option("sibling", "ভাই/বোন", "Sibling"),
    option("other", "অন্যান্য", "Other"),
  ],
  age: [
    option("adult", "প্রাপ্তবয়স্ক", "Adult"),
    option("minor", "অপ্রাপ্তবয়স্ক", "Minor"),
  ],
  address: [
    option("union", "ইউনিয়ন", "Union"),
    option("municipality", "পৌরসভা", "Municipality"),
    option("city_corporation", "সিটি কর্পোরেশন", "City corporation"),
  ],
  gender: [
    option("female", "নারী", "Female"),
    option("male", "পুরুষ", "Male"),
    option("other", "অন্যান্য", "Other"),
  ],
  religion: [
    option("not_specified", "উল্লেখ করতে চাই না", "Not specified"),
    option("islam", "ইসলাম", "Islam"),
    option("hinduism", "হিন্দু", "Hinduism"),
    option("buddhism", "বৌদ্ধ", "Buddhism"),
    option("christianity", "খ্রিষ্টান", "Christianity"),
    option("other", "অন্যান্য", "Other"),
  ],
  language: [
    option("bilingual", "দ্বিভাষিক", "Bilingual"),
    option("bn", "বাংলা", "Bangla"),
    option("en", "ইংরেজি", "English"),
  ],
};

/** These are product choices, not recovered source dropdown values or official classifications. */
const selectChoices: Record<string, FieldDefinition["options"]> = {
  authority_delegation_letter_type: [
    option("individual", "ব্যক্তি", "Individual"),
    option("organization", "প্রতিষ্ঠান", "Organization"),
  ],
  authority_delegation_letter_subject: [
    option("document_collection", "নথি সংগ্রহ", "Document collection"),
    option("representation", "প্রতিনিধিত্ব", "Representation"),
    option("other", "অন্যান্য", "Other"),
  ],
  electricity_connection_for: [
    option("residential", "আবাসিক", "Residential"),
    option("commercial", "বাণিজ্যিক", "Commercial"),
    option("agricultural", "কৃষি", "Agricultural"),
  ],
  community_type_id: [
    option("declared_community", "ঘোষিত সম্প্রদায়", "Declared community"),
    option("other", "অন্যান্য", "Other"),
  ],
  consent_applicant: [
    option("parent", "পিতা/মাতা", "Parent"),
    option("guardian", "অভিভাবক", "Guardian"),
  ],
  consent_subject: [
    option("education", "শিক্ষা", "Education"),
    option("travel", "ভ্রমণ", "Travel"),
    option("other", "অন্যান্য", "Other"),
  ],
  freedom_fighter_gazette_option: [
    option("civil", "বেসামরিক", "Civil"),
    option("military", "সামরিক", "Military"),
    option("other", "অন্যান্য", "Other"),
  ],
  correction_type: [
    option("nid", "জাতীয় পরিচয়পত্র", "National identity record"),
    option("voter", "ভোটার তথ্য", "Voter record"),
  ],
  correction_category_id: [
    option("name", "নাম", "Name"),
    option("parent_name", "পিতা/মাতার নাম", "Parent name"),
    option("date_of_birth", "জন্ম তারিখ", "Date of birth"),
    option("address", "ঠিকানা", "Address"),
    option("other", "অন্যান্য", "Other"),
  ],
  marital_status: [
    option("unmarried", "অবিবাহিত", "Unmarried"),
    option("married", "বিবাহিত", "Married"),
    option("widowed", "বিধবা/বিপত্নীক", "Widowed"),
    option("divorced", "তালাকপ্রাপ্ত", "Divorced"),
  ],
  land_unit: [
    option("decimal", "শতক", "Decimal"),
    option("acre", "একর", "Acre"),
    option("square_metre", "বর্গমিটার", "Square metre"),
  ],
  application_voter_area_transfer_reason: [
    option("relocation", "বাসস্থান পরিবর্তন", "Relocation"),
    option("marriage", "বিবাহ", "Marriage"),
    option("employment", "কর্মসংস্থান", "Employment"),
    option("other", "অন্যান্য", "Other"),
  ],
  application_autistic_type: [
    option("physical", "শারীরিক", "Physical"),
    option("visual", "দৃষ্টি", "Visual"),
    option("hearing", "শ্রবণ", "Hearing"),
    option("intellectual", "বুদ্ধিবৃত্তিক", "Intellectual"),
    option("multiple", "বহুমাত্রিক", "Multiple"),
    option("other", "অন্যান্য", "Other"),
  ],
  application_prottoyon_for: [
    option("education", "শিক্ষা", "Education"),
    option("employment", "কর্মসংস্থান", "Employment"),
    option("administrative", "প্রশাসনিক", "Administrative"),
    option("other", "অন্যান্য", "Other"),
  ],
};

const extraLabels: Record<string, LocalizedText> = {
  authority_delegation_letter_name_bn: t(
    "ক্ষমতা গ্রহণকারীর নাম (বাংলা)",
    "Delegate name (Bangla)",
  ),
  authority_delegation_letter_name_en: t(
    "ক্ষমতা গ্রহণকারীর নাম (ইংরেজি)",
    "Delegate name (English)",
  ),
  authority_delegation_letter_father_name_bn: t(
    "ক্ষমতা গ্রহণকারীর পিতার নাম (বাংলা)",
    "Delegate father name (Bangla)",
  ),
  authority_delegation_letter_father_name_en: t(
    "ক্ষমতা গ্রহণকারীর পিতার নাম (ইংরেজি)",
    "Delegate father name (English)",
  ),
  noc_org_division: t("বিভাগ", "Division"),
  trade_license_org_division: t("বিভাগ", "Division"),
  correction_type: t("সংশোধনের নথির ধরন", "Record to correct"),
  correction_category_id: t("সংশোধনের বিষয়", "Correction category"),
  incorrect_info: t("বিদ্যমান ভুল তথ্য", "Existing incorrect information"),
  correct_info: t("সঠিক তথ্য", "Correct information"),
  warish_heir_age_flag: t("বয়সের শ্রেণি", "Age category"),
  warish_heir_nid: t("পরিচয় নথির নমুনা পরিচিতি", "Demo identity reference"),
  warish_heir_dob: t("জন্ম তারিখ", "Date of birth"),
  warish_heir_relation: t("সম্পর্ক", "Relationship"),
  warish_heir_name: t("নাম (ইংরেজি)", "Name (English)"),
  warish_heir_name_bn: t("নাম (বাংলা)", "Name (Bangla)"),
  warish_heir_father_name: t("পিতার নাম (ইংরেজি)", "Father name (English)"),
  warish_heir_mobile_no: t("মোবাইল নম্বর", "Mobile number"),
  warish_heir_comment: t("মন্তব্য (বাংলা)", "Comment (Bangla)"),
  warish_heir_comment_en: t("মন্তব্য (ইংরেজি)", "Comment (English)"),
  dead_person_name: t(
    "সংশ্লিষ্ট মৃত ব্যক্তির নাম",
    "Related deceased person name",
  ),
  land_info_bn: t("জমির বিবরণ (বাংলা)", "Land details (Bangla)"),
  land_info_en: t("জমির বিবরণ (ইংরেজি)", "Land details (English)"),
  land_owner_info_bn: t(
    "জমির মালিকের বিবরণ (বাংলা)",
    "Land owner details (Bangla)",
  ),
  land_owner_info_en: t(
    "জমির মালিকের বিবরণ (ইংরেজি)",
    "Land owner details (English)",
  ),
  voter_application_no: t(
    "ভোটার আবেদনের নমুনা নম্বর",
    "Demo voter application reference",
  ),
  other_freedom_fighter: t(
    "অন্য মুক্তিযোদ্ধার পক্ষে আবেদন",
    "Apply in relation to another freedom fighter",
  ),
  other_person: t(
    "অন্য ব্যক্তির আয়/পেশা",
    "Income or occupation of another person",
  ),
  relation_person: t(
    "সম্পর্কিত ব্যক্তির নাম যুক্ত করুন",
    "Include a related person",
  ),
  marital_status_radio: t(
    "বৈবাহিক অবস্থা অন্তর্ভুক্ত করুন",
    "Include marital status",
  ),
  spi_is_dead: t("ব্যক্তি মৃত", "Person is deceased"),
  spi_death_date: t("মৃত্যুর তারিখ", "Date of death"),
  land_unit: t("জমির পরিমাপের একক", "Land area unit"),
};

const suffixLabels: Record<string, LocalizedText> = {
  name: t("নাম (ইংরেজি)", "Name (English)"),
  name_bn: t("নাম (বাংলা)", "Name (Bangla)"),
  father_name: t("পিতার নাম (ইংরেজি)", "Father name (English)"),
  father_name_bn: t("পিতার নাম (বাংলা)", "Father name (Bangla)"),
  mother_name: t("মাতার নাম (ইংরেজি)", "Mother name (English)"),
  mother_name_bn: t("মাতার নাম (বাংলা)", "Mother name (Bangla)"),
  spouse_name: t("স্বামী/স্ত্রীর নাম (ইংরেজি)", "Spouse name (English)"),
  spouse_name_bn: t("স্বামী/স্ত্রীর নাম (বাংলা)", "Spouse name (Bangla)"),
  gender: t("লিঙ্গ", "Gender"),
  dod: t("মৃত্যুর তারিখ", "Date of death"),
  register_no: t("নিবন্ধনের নমুনা নম্বর", "Demo registration reference"),
  register_type: t("নিবন্ধনের ধরন", "Registration type"),
  place: t("স্থান (ইংরেজি)", "Place (English)"),
  place_bn: t("স্থান (বাংলা)", "Place (Bangla)"),
  reason: t("কারণ (ইংরেজি)", "Reason (English)"),
  reason_bn: t("কারণ (বাংলা)", "Reason (Bangla)"),
  relation: t("সম্পর্ক", "Relationship"),
  religion_id: t("ধর্ম (ঐচ্ছিক)", "Religion (optional)"),
  certificate_id: t("সহায়ক নথির ধরন", "Supporting document type"),
  file: t("সহায়ক নথি", "Supporting document"),
  mouza_name_bn: t("মৌজার নাম (বাংলা)", "Mouza name (Bangla)"),
  mouza_name: t("মৌজার নাম (ইংরেজি)", "Mouza name (English)"),
  mouza_no: t("মৌজা নম্বর", "Mouza number"),
  khatiyan_no: t("খতিয়ান নম্বর", "Khatian number"),
  daag_no: t("দাগ নম্বর", "Plot number"),
  id_number: t("পরিচিতি নম্বর", "Identification reference"),
  batch_number: t("ব্যাচ নম্বর", "Batch reference"),
  certificate_number: t("সনদ নম্বর", "Certificate reference"),
  certificate_given_date: t("সনদ প্রদানের তারিখ", "Certificate issue date"),
  muktibarta_number: t("মুক্তিবার্তা নম্বর", "Muktibarta reference"),
  indian_gazette: t("ভারতীয় গেজেট নম্বর", "Indian gazette reference"),
  gazette_option: t("গেজেটের ধরন", "Gazette category"),
  gazette_number: t("গেজেট নম্বর", "Gazette reference"),
  spouse_age_flag: t("স্বামী/স্ত্রীর বয়সের শ্রেণি", "Spouse age category"),
  spouse_nid: t(
    "স্বামী/স্ত্রীর পরিচয় নথির নমুনা পরিচিতি",
    "Spouse demo identity reference",
  ),
  spouse_dob: t("স্বামী/স্ত্রীর জন্ম তারিখ", "Spouse date of birth"),
  spouse_place: t("বিবাহের স্থান (ইংরেজি)", "Marriage place (English)"),
  spouse_place_bn: t("বিবাহের স্থান (বাংলা)", "Marriage place (Bangla)"),
  date: t("বিবাহের তারিখ", "Marriage date"),
};

const englishWords: Record<string, string> = {
  bn: "(Bangla)",
  en: "(English)",
  noc: "No objection",
  primises: "Premises",
  org: "organization",
  add: "address",
  no: "number",
  nid: "identity reference",
  id: "reference",
  tin: "TIN",
  spi: "same person",
  autistic: "disability",
};
function fieldLabel(field: ReferenceField): LocalizedText {
  const id = field.name.replace(/\[\]$/, "");
  if (extraLabels[id]) return extraLabels[id];
  const suffix = id.replace(
    /^(warish_info_|dead_info_|warish_attachment_|dead_attachment_|electricity_connection_|freedom_fighter_|marriage_info_)/,
    "",
  );
  if (suffixLabels[suffix]) return suffixLabels[suffix];
  const en = id
    .split("_")
    .map((part) => englishWords[part] ?? part)
    .join(" ")
    .replace(/^./, (s) => s.toUpperCase());
  const bn = field.label_bn
    .replace(/\s*\*\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return t(bn || "আবেদনের বিবরণ", en);
}

function proposedText(
  id: string,
  bn: string,
  en: string,
  required = true,
  maxLength = 500,
): FieldDefinition {
  return {
    id,
    type: maxLength > 500 ? "textarea" : "text",
    label: t(bn, en),
    constraints: { required, minLength: required ? 2 : undefined, maxLength },
    evidence: { status: "proposed" },
  };
}
function proposedSelect(
  id: string,
  bn: string,
  en: string,
  values: NonNullable<FieldDefinition["options"]>,
): FieldDefinition {
  return {
    id,
    type: "select",
    label: t(bn, en),
    constraints: { required: true },
    options: values,
    evidence: { status: "proposed" },
  };
}
function proposedNumber(
  id: string,
  bn: string,
  en: string,
  min = 0,
  max = 1_000_000_000,
): FieldDefinition {
  return {
    id,
    type: "number",
    label: t(bn, en),
    constraints: { required: true, min, max },
    evidence: { status: "proposed" },
  };
}

const commonExclusions = new Set([
  "application_address_type",
  "application_address_office",
  "application_certificate_type",
  "application_certificate_type_en",
  "application_delivery_mode",
  "application_type",
  "application_payment_mode",
  "coupon_available",
  "application_coupon_code",
  "onlinePgw",
  "online_gateway",
]);
const optionalName =
  /spouse_name|comment|email|mobile|_nid$|register_no$|religion_id$|_tin_no$|_footer_|muktibarta|indian_gazette|batch_number|certificate_number|gazette_number|certificate_given_date|horse_power|capacity|weight|length|width|height|amount_word/;
const geographicId =
  /^(division_id|district_id|thana_id|additional_thana_id|post_office_id|municipality_id|union_id|city_corporation_id|noc_org_division|trade_license_org_division)$/;

function observedField(
  field: ReferenceField,
  serviceNo: number,
): FieldDefinition {
  const id = field.name.replace(/\[\]$/, "");
  let result: FieldDefinition = {
    id,
    type: field.type === "textarea" ? "textarea" : "text",
    label: fieldLabel(field),
    constraints: {
      required: !optionalName.test(id),
      minLength: 2,
      maxLength: field.type === "textarea" ? 2000 : 250,
    },
    evidence: {
      status: "inferred",
      source: `audit/evidence/s-${String(serviceNo).padStart(2, "0")}.json`,
      fieldNames: [field.name],
    },
  };
  if (field.type === "file")
    return {
      ...result,
      type: "attachment",
      constraints: {
        required: field.repeatable_array,
        acceptedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
        maxBytes: 2_097_152,
      },
    };
  if (
    field.type === "checkbox" ||
    [
      "other_freedom_fighter",
      "other_person",
      "relation_person",
      "marital_status_radio",
      "optradio",
    ].includes(id)
  ) {
    return {
      ...result,
      type: "checkbox",
      label:
        id === "optradio"
          ? t(
              "নিবন্ধন/সহায়ক তথ্য যুক্ত করুন",
              "Include registration or supporting information",
            )
          : result.label,
      constraints: { required: true },
    };
  }
  const choices =
    selectChoices[id] ??
    (id.endsWith("age_flag") ? options.age : undefined) ??
    (id.endsWith("relation") ? options.relationship : undefined) ??
    (id.endsWith("gender") ? options.gender : undefined) ??
    (id.endsWith("religion_id") ? options.religion : undefined) ??
    (id.endsWith("register_type")
      ? [
          option("death_record", "মৃত্যু নিবন্ধন", "Death record"),
          option("other", "অন্যান্য", "Other"),
        ]
      : undefined) ??
    (id.endsWith("certificate_id")
      ? [
          option("supporting_record", "সহায়ক রেকর্ড", "Supporting record"),
          option("declaration", "ঘোষণা", "Declaration"),
        ]
      : undefined) ??
    (id.endsWith("org_add_type") ? options.address : undefined);
  if (choices)
    result = {
      ...result,
      type: "select",
      options: choices,
      constraints: { required: !optionalName.test(id) },
    };
  if (/_dod$|_dob$|_date$/.test(id))
    result = {
      ...result,
      type: "date",
      constraints: { required: !optionalName.test(id) },
    };
  if (
    /_amount$|_capital$|_total_area$|horse_power$|_capacity$|_weight$|_length$|_width$|_height$/.test(
      id,
    )
  )
    result = {
      ...result,
      type: "number",
      constraints: {
        required: !optionalName.test(id),
        min: 0,
        max: 1_000_000_000,
      },
    };
  if (/mobile/.test(id))
    result = {
      ...result,
      constraints: { required: false, pattern: "^01[0-9]{9}$", maxLength: 11 },
    };
  if (/email/.test(id))
    result = {
      ...result,
      constraints: {
        required: false,
        pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
        maxLength: 254,
      },
    };
  if (id.endsWith("ward_no"))
    result = {
      ...result,
      type: "number",
      constraints: { required: true, min: 1, max: 99, integer: true },
    };
  if (geographicId.test(id))
    result = {
      ...result,
      type: "text",
      description: t(
        "স্বাধীন নমুনা ঠিকানা পরিচিতি; সরকারি ডিরেক্টরি সংযুক্ত নয়।",
        "Enter a demo location name/reference. No government address directory is connected.",
      ),
      constraints: {
        required: id !== "additional_thana_id",
        minLength: 2,
        maxLength: 150,
      },
    };
  if (id.startsWith("other_person_") && id !== "other_person")
    result = {
      ...result,
      visibleWhen: { field: "other_person", equals: true },
    };
  if (id.startsWith("other_freedom_fighter_") && id !== "other_freedom_fighter")
    result = {
      ...result,
      visibleWhen: { field: "other_freedom_fighter", equals: true },
    };
  if (id === "spi_death_date")
    result = { ...result, visibleWhen: { field: "spi_is_dead", equals: true } };
  if (
    [
      "spi_relation",
      "spi_relation_person_name",
      "spi_relation_person_name_bn",
    ].includes(id)
  )
    result = {
      ...result,
      visibleWhen: { field: "relation_person", equals: true },
    };
  if (id === "marital_status")
    result = {
      ...result,
      visibleWhen: { field: "marital_status_radio", equals: true },
    };
  if (id === "correct_info")
    result = {
      ...result,
      constraints: { ...result.constraints, differentFrom: "incorrect_info" },
    };
  if (id === "warish_heir_nid")
    result = {
      ...result,
      visibleWhen: { field: "warish_heir_age_flag", equals: "adult" },
    };
  return result;
}

/** Additional service-specific facts for common forms whose reference exposed only checkout controls. */
const independentServiceFields: Record<number, readonly FieldDefinition[]> = {
  1: [
    proposedText("holding_reference", "হোল্ডিং নম্বর", "Holding reference"),
    {
      ...proposedNumber("tax_year", "কর বছর", "Tax year", 2000, 2100),
      constraints: { required: true, min: 2000, max: 2100, integer: true },
    },
    proposedText(
      "property_description",
      "সম্পত্তির বিবরণ",
      "Property description",
      true,
      1000,
    ),
  ],
  10: [
    proposedText("last_occupation", "পূর্বের পেশা", "Previous occupation"),
    {
      id: "unemployed_since",
      type: "date",
      label: t("বেকারত্ব শুরুর তারিখ", "Unemployed since"),
      constraints: { required: true },
      evidence: { status: "proposed" },
    },
  ],
  11: [
    proposedText(
      "claimed_nationality",
      "ঘোষিত জাতীয়তা",
      "Declared nationality",
    ),
    proposedText(
      "nationality_basis",
      "দাবির ভিত্তি",
      "Basis of nationality declaration",
    ),
  ],
  12: [
    proposedText(
      "citizenship_basis",
      "নাগরিকত্বের দাবির ভিত্তি",
      "Basis of citizenship declaration",
    ),
  ],
  14: [
    proposedText(
      "landless_declaration",
      "ভূমিহীনতার বিবরণ",
      "Landless declaration",
      true,
      1500,
    ),
  ],
  15: [
    proposedText(
      "voter_registration_reason",
      "নতুন ভোটার নিবন্ধনের কারণ",
      "Reason for new voter registration",
    ),
  ],
  16: [
    proposedText(
      "deceased_spouse_name",
      "মৃত স্বামী/স্ত্রীর নাম",
      "Deceased spouse name",
    ),
    {
      id: "spouse_death_date",
      type: "date",
      label: t("স্বামী/স্ত্রীর মৃত্যুর তারিখ", "Spouse date of death"),
      constraints: { required: true },
      evidence: { status: "proposed" },
    },
  ],
  18: [
    proposedText(
      "community_name",
      "সম্প্রদায়ের নাম",
      "Declared community name",
    ),
  ],
  21: [
    proposedText(
      "farming_activity",
      "কৃষি কার্যক্রমের বিবরণ",
      "Farming activity",
      true,
      1000,
    ),
    proposedText("farm_location", "কৃষিজমির অবস্থান", "Farm location"),
  ],
  24: [
    proposedText(
      "guardian_or_support_details",
      "অভিভাবক/সহায়তার বিবরণ",
      "Guardian or support details",
      true,
      1000,
    ),
    proposedText(
      "orphanhood_declaration",
      "এতিম হওয়ার বিবরণ",
      "Orphanhood declaration",
      true,
      1000,
    ),
  ],
  27: [
    proposedText("passport_purpose", "পাসপোর্টের উদ্দেশ্য", "Passport purpose"),
  ],
  28: [
    {
      id: "appearance_date",
      type: "date",
      label: t("সশরীরে উপস্থিতির তারিখ", "Appearance date"),
      constraints: { required: true },
      evidence: { status: "proposed" },
    },
    proposedText("witness_details", "সাক্ষীর বিবরণ", "Witness details"),
  ],
  30: [
    proposedNumber(
      "declared_assets_bdt",
      "ঘোষিত সম্পদের মূল্য (টাকা)",
      "Declared assets (BDT)",
    ),
    proposedNumber(
      "declared_liabilities_bdt",
      "ঘোষিত দায় (টাকা)",
      "Declared liabilities (BDT)",
    ),
    proposedText(
      "financial_basis",
      "স্বচ্ছলতার বিবরণ",
      "Financial solvency basis",
      true,
      1000,
    ),
  ],
  32: [
    proposedNumber(
      "monthly_household_income_bdt",
      "মাসিক পারিবারিক আয় (টাকা)",
      "Monthly household income (BDT)",
    ),
    proposedText(
      "hardship_details",
      "অস্বচ্ছলতার বিবরণ",
      "Financial hardship details",
      true,
      1500,
    ),
  ],
  34: [
    proposedText(
      "childless_declaration",
      "নিঃসন্তান অবস্থার বিবরণ",
      "Childless declaration",
      true,
      1000,
    ),
  ],
  37: [
    proposedText(
      "previous_voter_area",
      "পূর্বের ভোটার এলাকা",
      "Previous voter area",
    ),
    proposedText("new_voter_area", "নতুন ভোটার এলাকা", "New voter area"),
  ],
  38: [
    proposedText(
      "support_needs",
      "প্রয়োজনীয় সহায়তার বিবরণ",
      "Support needs",
      true,
      1000,
    ),
  ],
  40: [
    proposedText(
      "community_name",
      "সম্প্রদায়ের নাম",
      "Declared indigenous community",
    ),
    proposedText(
      "community_affiliation",
      "সম্প্রদায়ের সাথে সম্পর্ক",
      "Community affiliation",
    ),
  ],
  43: [
    proposedText(
      "previous_voter_reference",
      "পূর্বের ভোটার তথ্যের নমুনা পরিচিতি",
      "Demo previous voter reference",
    ),
    proposedText(
      "omission_details",
      "তালিকা থেকে বাদ পড়ার বিবরণ",
      "Omission details",
      true,
      1000,
    ),
  ],
  44: [
    proposedText(
      "previous_spouse_name",
      "পূর্বের স্বামী/স্ত্রীর নাম",
      "Previous spouse name",
    ),
    proposedText(
      "non_remarriage_declaration",
      "পুনঃবিবাহ না হওয়ার ঘোষণা",
      "Non remarriage declaration",
      true,
      1000,
    ),
  ],
};

function repeatable(
  id: string,
  bn: string,
  en: string,
  fields: readonly ReferenceField[],
  serviceNo: number,
  required: boolean,
): FieldDefinition {
  const children = fields.map((field) => observedField(field, serviceNo));
  if (id === "heirs")
    children.push({
      ...proposedText(
        "guardian_name",
        "অপ্রাপ্তবয়স্কের অভিভাবকের নাম",
        "Minor guardian name",
      ),
      visibleWhen: { field: "warish_heir_age_flag", equals: "minor" },
    });
  return {
    id,
    type: "repeatable",
    label: t(bn, en),
    constraints: {
      required,
      minRows: required ? 1 : 0,
      maxRows: id === "supporting_documents" ? 5 : 30,
      ...(id === "corrections" ? { uniqueBy: "correction_category_id" } : {}),
    },
    children,
    evidence: {
      status: "inferred",
      fieldNames: fields.map((field) => field.name),
      source: `audit/evidence/s-${String(serviceNo).padStart(2, "0")}.json`,
    },
  };
}

const uploadGroup: FieldDefinition = {
  id: "supporting_documents",
  type: "repeatable",
  label: t("সহায়ক নথি", "Supporting documents"),
  constraints: { maxRows: 5 },
  evidence: { status: "proposed" },
  children: [
    proposedText(
      "description",
      "নথির বিবরণ",
      "Document description",
      true,
      150,
    ),
    {
      id: "file",
      type: "attachment",
      label: t("নথি", "Document"),
      constraints: {
        required: true,
        acceptedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
        maxBytes: 2_097_152,
      },
      evidence: { status: "proposed" },
    },
  ],
};

function buildExpandedSchema(service: ReferenceService): FormSchema {
  const no = service.service_no;
  const raw = [
    ...new Map(
      service.forms
        .flatMap((form) => form.fields)
        .filter(
          (field) =>
            field.name &&
            !["hidden", "submit", "button"].includes(field.type) &&
            !commonExclusions.has(field.name),
        )
        .map((field) => [field.name, field]),
    ).values(),
  ];
  const arrays = raw.filter((field) => field.repeatable_array);
  const fields: FieldDefinition[] = raw
    .filter((field) => !field.repeatable_array)
    .map((field) => observedField(field, no));
  const heirFields = arrays.filter(
    (field) =>
      field.name.startsWith("warish_heir_") ||
      field.name === "dead_person_name[]",
  );
  if (heirFields.length)
    fields.push(
      repeatable(
        "heirs",
        [3, 4].includes(no) ? "ওয়ারিশের তালিকা" : "সংশ্লিষ্ট ব্যক্তিদের তালিকা",
        [3, 4].includes(no) ? "Heirs" : "Related people",
        heirFields,
        no,
        true,
      ),
    );
  const correctionFields = arrays.filter((field) =>
    ["correction_category_id[]", "incorrect_info[]", "correct_info[]"].includes(
      field.name,
    ),
  );
  if (correctionFields.length)
    fields.push(
      repeatable(
        "corrections",
        "সংশোধনের তালিকা",
        "Corrections",
        correctionFields,
        no,
        true,
      ),
    );
  const documentFields = arrays.filter((field) =>
    field.name.includes("attachment_"),
  );
  if (documentFields.length)
    fields.push(
      repeatable(
        "supporting_documents",
        "সহায়ক নথি",
        "Supporting documents",
        documentFields,
        no,
        false,
      ),
    );
  const addressKind = fields.find((field) => field.id.endsWith("org_add_type"));
  if (addressKind)
    for (const kind of ["union", "municipality", "city_corporation"]) {
      const index = fields.findIndex((field) => field.id === `${kind}_id`);
      if (index >= 0)
        fields[index] = {
          ...fields[index],
          visibleWhen: { field: addressKind.id, equals: kind },
        };
    }
  fields.push(...(independentServiceFields[no] ?? []));
  if (!fields.some((field) => field.id === "supporting_documents"))
    fields.push(uploadGroup);
  return deepFreeze({
    serviceNo: no,
    version: 2,
    title: t(service.name_bn, service.name_en),
    stage: "operational_demo",
    evidence: {
      status: "proposed",
      source: service.evidence_file,
      limitation:
        "Independent executable demo form. Reference initial field metadata is observed; dropdown choices, normalized payloads, conditions, validation, service decisions and document text are independently proposed. Original successful submission, server validation, approval, payment and issuance remain unverified. No legal eligibility or government verification is inferred.",
    },
    sections: [
      {
        id: "service_details",
        title: t("সেবার তথ্য", "Service details"),
        fields,
      },
      {
        id: "application_context",
        title: t("আবেদনের উদ্দেশ্য ও ভাষা", "Purpose and language"),
        fields: [
          proposedSelect(
            "address_source",
            "প্রযোজ্য ঠিকানা",
            "Applicable citizen address",
            [
              option("permanent", "স্থায়ী ঠিকানা", "Permanent address"),
              option("present", "বর্তমান ঠিকানা", "Present address"),
            ],
          ),
          proposedText(
            "purpose_bn",
            "আবেদনের উদ্দেশ্য (বাংলা)",
            "Purpose (Bangla)",
          ),
          proposedText(
            "purpose_en",
            "আবেদনের উদ্দেশ্য (ইংরেজি)",
            "Purpose (English)",
          ),
          proposedSelect(
            "delivery_language",
            "নথির ভাষা",
            "Document language",
            options.language,
          ),
          {
            id: "confirmation",
            type: "checkbox",
            label: t(
              "প্রদত্ত তথ্য সঠিক এবং এটি পরীক্ষামূলক আবেদন",
              "I confirm the information is correct and this is a demo application.",
            ),
            constraints: { required: true, mustBeTrue: true },
            evidence: { status: "proposed" },
          },
        ],
      },
    ],
  });
}

export const expandedOperationalSchemas: readonly FormSchema[] = deepFreeze(
  (referenceData.services as unknown as readonly ReferenceService[])
    .filter((service) => ![2, 42, 45].includes(service.service_no))
    .map(buildExpandedSchema),
);

/** Complete observed trade entry metadata without changing already published v1 payloads. */
export function buildTradeLicenseV2(v1: FormSchema): FormSchema {
  const reference = referenceData.services.find(
    (service) => service.service_no === 42,
  )!;
  const mappings: Record<string, readonly string[]> = {
    business_name_bn: ["trade_license_org_name_bn"],
    business_name_en: ["trade_license_org_name"],
    business_type: ["nature_of_business"],
    start_date: ["business_starting_date"],
    business_address_bn: ["trade_license_org_area_holding_bn"],
    business_address_en: ["trade_license_org_area_holding"],
    proprietor_name_bn: ["trade_license_proprietor_bn"],
    proprietor_name_en: ["trade_license_proprietor"],
    mobile: ["trade_license_mobile"],
    previous_license_number: ["application_no"],
    attachments: ["trade_license_proven_file"],
  };
  const existingNames = new Set(Object.values(mappings).flat());
  const newFields = [
    ...new Map(
      reference.forms
        .flatMap((form) => form.fields)
        .filter(
          (field) =>
            field.name &&
            !["hidden", "submit", "button"].includes(field.type) &&
            !existingNames.has(field.name),
        )
        .map((field) => [field.name, field]),
    ).values(),
  ].map((field) => {
    const authored = observedField(field, 42);
    // Observed HTML required flags are not an approved eligibility policy. Optional additions preserve old valid payloads.
    return {
      ...authored,
      constraints: { ...authored.constraints, required: false },
    } as FieldDefinition;
  });
  const addressKind = "trade_license_org_add_type";
  for (const kind of ["union", "municipality", "city_corporation"]) {
    const index = newFields.findIndex((field) => field.id === `${kind}_id`);
    if (index >= 0)
      newFields[index] = {
        ...newFields[index],
        visibleWhen: { field: addressKind, equals: kind },
      };
  }
  const typeIndex = newFields.findIndex(
    (field) => field.id === "trade_license_type",
  );
  if (typeIndex >= 0)
    newFields[typeIndex] = {
      ...newFields[typeIndex],
      type: "select",
      options: [
        option("commercial", "বাণিজ্যিক", "Commercial"),
        option("professional", "পেশাগত", "Professional"),
        option("other", "অন্যান্য", "Other"),
      ],
    };
  const wardIndex = newFields.findIndex(
    (field) => field.id === "trade_license_org_zone_ward",
  );
  if (wardIndex >= 0)
    newFields[wardIndex] = {
      ...newFields[wardIndex],
      type: "number",
      constraints: { min: 1, max: 99, integer: true },
    };
  return deepFreeze({
    ...v1,
    version: 2,
    evidence: {
      ...v1.evidence,
      limitation: `${v1.evidence.limitation} Version 2 maps all 37 observed trade entry and renewal fields. Additional fields are optional under independently authored demo policy; original HTML required flags and directory choices do not establish official requirements.`,
    },
    sections: [
      ...v1.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) =>
          mappings[field.id]
            ? {
                ...field,
                evidence: {
                  status: "inferred" as const,
                  source: reference.evidence_file,
                  fieldNames: mappings[field.id],
                },
              }
            : field,
        ),
      })),
      {
        id: "trade_additional_details",
        title: t(
          "প্রতিষ্ঠান ও ঠিকানার অতিরিক্ত তথ্য",
          "Additional business and address details",
        ),
        fields: newFields,
      },
    ],
  });
}

/** Extend the existing member array; never split one family member into a second parallel list. */
export function buildFamilyV2(v1: FormSchema): FormSchema {
  const reference = referenceData.services.find(
    (service) => service.service_no === 2,
  )!;
  const raw = reference.forms
    .flatMap((form) => form.fields)
    .filter(
      (field) =>
        field.name && !["hidden", "submit", "button"].includes(field.type),
    );
  const subjectMappings: Record<string, string> = {
    household_name_bn: "warish_info_name_bn",
    household_name_en: "warish_info_name",
  };
  const memberMappings: Record<string, string> = {
    name_bn: "warish_heir_name_bn[]",
    name_en: "warish_heir_name[]",
    relationship: "warish_heir_relation[]",
    dob: "warish_heir_dob[]",
    is_minor: "warish_heir_age_flag[]",
    mobile: "warish_heir_mobile_no[]",
  };
  const inferred = (name: string) => ({
    status: "inferred" as const,
    source: reference.evidence_file,
    fieldNames: [name],
  });
  const mappedSubject = new Set(Object.values(subjectMappings));
  const mappedMembers = new Set(Object.values(memberMappings));
  const subjectFields = raw
    .filter(
      (field) => !field.repeatable_array && !mappedSubject.has(field.name),
    )
    .map((field) => {
      const value = observedField(field, 2);
      return {
        ...value,
        constraints: { ...value.constraints, required: false },
      };
    });
  const memberFields = raw
    .filter((field) => field.repeatable_array && !mappedMembers.has(field.name))
    .map((field) => {
      const value = observedField(field, 2);
      return {
        ...value,
        constraints: { ...value.constraints, required: false },
        ...(field.name === "warish_heir_nid[]"
          ? { visibleWhen: { field: "is_minor", equals: false } }
          : {}),
      } as FieldDefinition;
    });
  return deepFreeze({
    ...v1,
    version: 2,
    evidence: {
      ...v1.evidence,
      limitation: `${v1.evidence.limitation} Version 2 maps all 20 observed family form fields. Additional subject names, death/registration facts and member identity/comments are optional independent demo inputs; no family, identity or succession claims are verified automatically.`,
    },
    sections: [
      ...v1.sections.map((section) => ({
        ...section,
        fields: section.fields.map((field) => {
          if (subjectMappings[field.id])
            return { ...field, evidence: inferred(subjectMappings[field.id]) };
          if (field.id !== "members") return field;
          return {
            ...field,
            children: [
              ...(field.children ?? []).map((child) =>
                memberMappings[child.id]
                  ? { ...child, evidence: inferred(memberMappings[child.id]) }
                  : child,
              ),
              ...memberFields,
            ],
          };
        }),
      })),
      {
        id: "household_additional_details",
        title: t(
          "পরিবার প্রধানের অতিরিক্ত তথ্য",
          "Additional household head details",
        ),
        fields: subjectFields,
      },
    ],
  });
}

/** A deliberately synthetic fixture builder. Optional uploads are omitted because only the API can create authorized handles. */
export function createSyntheticPayload(
  schema: FormSchema,
): Record<string, unknown> {
  function build(fields: readonly FieldDefinition[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    // Resolve controllers first, then conditionals, independent of schema presentation order.
    for (const field of [
      ...fields.filter((item) => !item.visibleWhen),
      ...fields.filter((item) => item.visibleWhen),
    ]) {
      if (!isFieldVisible(field, result)) continue;
      const required =
        field.constraints?.required ||
        (field.requiredWhen && evaluatePredicate(field.requiredWhen, result));
      if (!required) continue;
      if (field.type === "repeatable")
        result[field.id] = Array.from(
          { length: Math.max(1, field.constraints?.minRows ?? 1) },
          () => build(field.children ?? []),
        );
      else if (field.type === "attachment")
        throw new Error(
          `Required attachment ${field.id} requires a real API upload.`,
        );
      else if (field.type === "checkbox")
        result[field.id] = !!field.constraints?.mustBeTrue;
      else if (field.type === "select")
        result[field.id] = field.options?.[0]?.value;
      else if (field.type === "number")
        result[field.id] = Math.max(
          field.constraints?.min ?? 0,
          field.id === "tax_year" ? 2026 : 1,
        );
      else if (field.type === "date") result[field.id] = "2020-01-01";
      else if (/mobile/.test(field.id)) result[field.id] = "01000000000";
      else if (/email/.test(field.id)) result[field.id] = "person@example.test";
      else
        result[field.id] = (
          /(_bn$|_bn_)/.test(field.id)
            ? "নমুনা পরীক্ষামূলক তথ্য"
            : field.id === "correct_info"
              ? "Corrected demonstration information"
              : "Sample demonstration information"
        ).slice(0, field.constraints?.maxLength ?? 200);
    }
    return result;
  }
  return build(flattenFields(schema));
}
