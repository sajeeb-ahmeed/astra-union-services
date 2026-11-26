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
  Predicate,
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
  warish_heir_nid: t("পরিচয় নথির পরিচিতি", "Identity reference"),
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
    "ভোটার আবেদনের নম্বর",
    "Voter application reference",
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
  register_no: t("নিবন্ধনের নম্বর", "Registration reference"),
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
    "স্বামী/স্ত্রীর পরিচয় নথির পরিচিতি",
    "Spouse identity reference",
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
        "ঠিকানার নাম বা পরিচিতি লিখুন।",
        "Enter the location name or reference.",
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
      "পূর্বের ভোটার তথ্যের পরিচিতি",
      "Previous voter reference",
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
      limitation: "Complete all required fields before submitting.",
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
              "প্রদত্ত তথ্য সঠিক এবং আমি এই আবেদন জমা দিচ্ছি।",
              "I confirm the information is correct and I submit this application.",
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
      limitation: `${v1.evidence.limitation} Version 2 maps all 37 observed trade entry and renewal fields.`,
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
      limitation: `${v1.evidence.limitation} Version 2 maps all 20 observed family form fields.`,
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

/** Services whose next version carries the Phase 4 conditional-group fixes. */
export const conditionalGroupServices: readonly number[] = deepFreeze([
  4, 7, 23, 29, 31,
]);

/**
 * Checkbox fields that only control the visibility of a following group.
 * They are form mechanics, not applicant data — the review screen skips
 * them (exported for the web review renderer, QAFIX-01 §4 item 10).
 */
export const groupControllerIds = new Set([
  "optradio",
  "other_person",
  "other_freedom_fighter",
  "relation_person",
  "marital_status_radio",
]);

/**
 * Field ids governed by the `optradio` opt-in, derived from the captured form
 * layout: the plain fields that follow `optradio` up to the next controller
 * or repeatable group (e.g. death details after "include registration
 * information", profession after it on the income certificates).
 */
function optradioGroupFieldIds(serviceNo: number): readonly string[] {
  const service = (
    referenceData.services as unknown as readonly ReferenceService[]
  ).find((item) => item.service_no === serviceNo);
  if (!service) return [];
  const ids: string[] = [];
  let active = false;
  for (const form of service.forms) {
    for (const field of form.fields) {
      const id = field.name.replace(/\[\]$/, "");
      if (id === "optradio") {
        active = true;
        continue;
      }
      if (!active) continue;
      if (field.repeatable_array || groupControllerIds.has(id)) {
        active = false;
        continue;
      }
      if (
        !["hidden", "submit", "button"].includes(field.type) &&
        !commonExclusions.has(field.name) &&
        !ids.includes(id)
      )
        ids.push(id);
    }
  }
  return ids;
}

/**
 * Phase 4: publish a new version instead of editing v2, so applications pinned
 * to v2 keep their exact schema (same rule as the geography release). The
 * opt-in group fields gain `visibleWhen` on the `optradio` toggle — until now
 * they stayed unconditionally required and blocked citizens who never opted
 * in — and, per the owner's Finding B decision, the income amount becomes
 * optional on the two income certificates (23/29).
 */
export function buildConditionalGroupVersion(
  previous: FormSchema,
): FormSchema {
  if (!conditionalGroupServices.includes(previous.serviceNo))
    throw new RangeError(
      `Service ${previous.serviceNo} has no conditional-group version.`,
    );
  const groupIds = new Set(optradioGroupFieldIds(previous.serviceNo));
  if (!groupIds.size)
    throw new Error(
      `Service ${previous.serviceNo} has no optradio group fields to condition.`,
    );
  const incomeOptional = [23, 29].includes(previous.serviceNo);
  const sections = previous.sections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => {
      let next = field;
      if (groupIds.has(field.id) && !field.visibleWhen)
        next = {
          ...next,
          visibleWhen: { field: "optradio", equals: true },
        };
      if (
        incomeOptional &&
        field.id === "income_info_amount" &&
        field.constraints?.required
      )
        next = {
          ...next,
          constraints: { ...next.constraints, required: false },
        };
      return next;
    }),
  }));
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (Phase 4) conditions the opt-in group on its toggle and makes the income amount optional where the owner decided so.`,
    },
    sections,
  });
}

/** Dataset-valid rural example location (Subil Union, Debidwar, Cumilla). Not an applicant's real address. */
export const syntheticGeography = deepFreeze({
  divisionCode: "div-02",
  districtCode: "dis-19",
  upazilaCode: "upa-089",
  unionCode: "uni-0001",
});

/** Services whose v3 replaces free-text division/district/upazila/union references with parent-validated selectors. */
export const geographySelectorServices: readonly number[] = deepFreeze([
  36, 41, 42,
]);
/** Free-text location fields of the pre-selector versions that `org_location` replaces (used for renewal upgrades). */
export const legacyLocationFieldIds: readonly string[] = deepFreeze([
  "division_id",
  "noc_org_division",
  "trade_license_org_division",
  "district_id",
  "thana_id",
  "union_id",
]);
const replacedLocationIds = new RegExp(`^(${legacyLocationFieldIds.join("|")})$`);

/**
 * PAR-05: publish a new version instead of editing v2, so applications pinned to v2 keep their exact schema.
 * Urban municipality/city-corporation, post office and additional thana fields stay as text: the supplied
 * dataset has no urban wards or postal directory.
 */
export function buildGeographySelectorVersion(previous: FormSchema): FormSchema {
  if (!geographySelectorServices.includes(previous.serviceNo))
    throw new RangeError(`Service ${previous.serviceNo} has no selector version.`);
  let inserted = false;
  const sections = previous.sections.map((section) => {
    const fields: FieldDefinition[] = [];
    for (const field of section.fields) {
      if (!replacedLocationIds.test(field.id)) {
        fields.push(field);
        continue;
      }
      if (inserted) continue;
      inserted = true;
      const addressKind = section.fields.find((item) =>
        item.id.endsWith("org_add_type"),
      );
      fields.push({
        id: "org_location",
        type: "geography",
        label: t("প্রতিষ্ঠানের প্রশাসনিক এলাকা", "Organization administrative area"),
        description: t(
          "বিভাগ থেকে উপজেলা নির্বাচন করুন; ইউনিয়ন ঠিকানার ক্ষেত্রে ইউনিয়নও নির্বাচন করুন। পৌরসভা/সিটি কর্পোরেশনের নাম নিচে লিখুন।",
          "Select division through upazila; also select the union for a union address. Enter municipality or city corporation names below.",
        ),
        constraints: {
          required: field.constraints?.required ?? false,
          geographyDepth: "upazila",
          ...(addressKind
            ? {
                geographyUnionWhen: {
                  field: addressKind.id,
                  equals: "union",
                },
              }
            : {}),
        },
        evidence: {
          status: "inferred",
          source: `audit/evidence/s-${String(previous.serviceNo).padStart(2, "0")}.json`,
          fieldNames: section.fields
            .filter((item) => replacedLocationIds.test(item.id))
            .flatMap((item) => item.evidence?.fieldNames ?? [item.id]),
        },
      });
    }
    return { ...section, fields };
  });
  if (!inserted)
    throw new Error(`Service ${previous.serviceNo} has no location fields to replace.`);
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} selects division, district, upazila and (for union addresses) union from the supplied community geography dataset; urban, postal and additional-thana references remain free text.`,
    },
    sections,
  });
}

/* ---------- CERT-REFINE-01: certificate QA refinement release ----------
 * Publishes a NEW schema version for the services whose certificates the
 * CERT-QA-01 audit found structurally incomplete (blank licence fees, the
 * five functionally-empty certificates, EN-language value pairs, the DSS
 * disability-type list). Published versions stay immutable: the previous
 * latest version of each touched service is retained in
 * certRefineSupersededSchemas and keeps validating its pinned applications.
 * Every added field is a data slot the refined templates print; optional
 * additions never invalidate an older payload. */

/** DSS disability categories, per CERT-QA-01 §B svc38 (replaces the shorter product list). */
const disabilityTypeOptions: FieldDefinition["options"] = [
  option("physical", "শারীরিক", "Physical"),
  option("intellectual", "বুদ্ধিবৃত্তিক", "Intellectual"),
  option("hearing", "শ্রবণ", "Hearing"),
  option("visual", "দৃষ্টি", "Visual"),
  option("speech", "বাক", "Speech"),
  option("autism", "অটিজম", "Autism"),
  option("down_syndrome", "ডাউন সিনড্রোম", "Down syndrome"),
  option("cerebral_palsy", "সেরিব্রাল পালসি", "Cerebral palsy"),
  option("multiple", "বহুমাত্রিক", "Multiple"),
  option("other", "অন্যান্য", "Other"),
];

const optionalText = (
  id: string,
  bn: string,
  en: string,
  maxLength = 500,
): FieldDefinition => proposedText(id, bn, en, false, maxLength);
const optionalNumber = (
  id: string,
  bn: string,
  en: string,
): FieldDefinition => ({
  id,
  type: "number",
  label: t(bn, en),
  constraints: { required: false, min: 0, max: 1_000_000_000 },
  evidence: { status: "proposed" },
});
const optionalDate = (id: string, bn: string, en: string): FieldDefinition => ({
  id,
  type: "date",
  label: t(bn, en),
  constraints: { required: false },
  evidence: { status: "proposed" },
});
const requiredDate = (id: string, bn: string, en: string): FieldDefinition => ({
  id,
  type: "date",
  label: t(bn, en),
  constraints: { required: true },
  evidence: { status: "proposed" },
});

const certRefineAdditions: Record<number, readonly FieldDefinition[]> = {
  1: [
    optionalText("property_description_bn", "সম্পত্তির বিবরণ (বাংলা)", "Property description (Bangla)", 1000),
    optionalText("property_description_en", "সম্পত্তির বিবরণ (ইংরেজি)", "Property description (English)", 1000),
  ],
  3: [optionalText("warish_info_nid", "মৃত ব্যক্তির জাতীয় পরিচয়পত্র নম্বর", "Deceased NID number", 30)],
  4: [optionalText("warish_info_nid", "মৃত ব্যক্তির জাতীয় পরিচয়পত্র নম্বর", "Deceased NID number", 30)],
  5: [
    proposedSelect(
      "authority_delegation_relationship",
      "প্রতিনিধির সহিত সম্পর্ক",
      "Relationship with the delegate",
      options.relationship,
    ),
  ],
  6: [optionalText("electricity_connection_holding_no", "হোল্ডিং নম্বর", "Holding number", 40)],
  13: [optionalDate("remarriage_date", "পুনঃবিবাহের তারিখ", "Remarriage date")],
  32: [
    optionalText("earner_occupation_bn", "উপার্জনক্ষম ব্যক্তির পেশা (বাংলা)", "Earner occupation (Bangla)"),
    optionalText("earner_occupation_en", "উপার্জনক্ষম ব্যক্তির পেশা (ইংরেজি)", "Earner occupation (English)"),
  ],
  37: [
    requiredDate("voter_transfer_residing_since", "অত্র এলাকায় বসবাসের শুরু", "Residing in this area since"),
    optionalText("previous_voter_area_en", "পূর্বের ভোটার এলাকা (ইংরেজি)", "Previous voter area (English)", 1000),
  ],
  43: [optionalText("omission_details_en", "তালিকা থেকে বাদ পড়ার বিবরণ (ইংরেজি)", "Omission details (English)", 1000)],
  10: [optionalText("last_occupation_en", "পূর্বের পেশা (ইংরেজি)", "Previous occupation (English)")],
  11: [
    optionalText("claimed_nationality_en", "ঘোষিত জাতীয়তা (ইংরেজি)", "Declared nationality (English)"),
    {
      id: "marital_status",
      type: "select",
      label: t("বৈবাহিক অবস্থা", "Marital status"),
      constraints: { required: false },
      options: selectChoices.marital_status,
      evidence: { status: "proposed" },
    },
  ],
  16: [optionalText("deceased_spouse_name_en", "মৃত স্বামী/স্ত্রীর নাম (ইংরেজি)", "Deceased spouse name (English)")],
  18: [optionalText("community_name_en", "সম্প্রদায়ের নাম (ইংরেজি)", "Community name (English)")],
  19: [
    proposedText("consent_child_name_bn", "সন্তানের নাম (বাংলা)", "Child name (Bangla)"),
    proposedText("consent_child_name_en", "সন্তানের নাম (ইংরেজি)", "Child name (English)"),
    requiredDate("consent_child_dob", "সন্তানের জন্ম তারিখ", "Child date of birth"),
    optionalText("consent_child_birth_reg", "সন্তানের জন্ম নিবন্ধন নম্বর", "Child birth registration number", 30),
    proposedSelect("consent_child_relation", "সন্তানের সহিত সম্পর্ক", "Relationship to the child", options.relationship),
  ],
  20: [
    proposedText("freedom_fighter_service_narrative_bn", "মুক্তিযুদ্ধে অংশগ্রহণের বিবরণ (বাংলা)", "Liberation War service account (Bangla)", true, 1500),
    proposedText("freedom_fighter_service_narrative_en", "মুক্তিযুদ্ধে অংশগ্রহণের বিবরণ (ইংরেজি)", "Liberation War service account (English)", true, 1500),
  ],
  21: [optionalText("farming_activity_en", "কৃষি কার্যক্রমের বিবরণ (ইংরেজি)", "Farming activity (English)", 1000)],
  24: [
    optionalText("orphan_father_name_bn", "মৃত পিতার নাম (বাংলা)", "Deceased father name (Bangla)"),
    optionalText("orphan_father_name_en", "মৃত পিতার নাম (ইংরেজি)", "Deceased father name (English)"),
    optionalDate("orphan_father_death_date", "পিতার মৃত্যুর তারিখ", "Father date of death"),
    optionalText("orphan_mother_name_bn", "মৃত মাতার নাম (বাংলা)", "Deceased mother name (Bangla)"),
    optionalText("orphan_mother_name_en", "মৃত মাতার নাম (ইংরেজি)", "Deceased mother name (English)"),
    optionalDate("orphan_mother_death_date", "মাতার মৃত্যুর তারিখ", "Mother date of death"),
    proposedText("orphan_guardian_name_bn", "অভিভাবকের নাম (বাংলা)", "Guardian name (Bangla)"),
    proposedText("orphan_guardian_name_en", "অভিভাবকের নাম (ইংরেজি)", "Guardian name (English)"),
    proposedSelect("orphan_guardian_relation", "এতিমের সহিত অভিভাবকের সম্পর্ক", "Guardian's relationship to the orphan", options.relationship),
  ],
  25: [
    optionalText("marriage_info_spouse_father_name_bn", "স্বামী/স্ত্রীর পিতার নাম (বাংলা)", "Spouse father name (Bangla)"),
    optionalText("marriage_info_spouse_father_name_en", "স্বামী/স্ত্রীর পিতার নাম (ইংরেজি)", "Spouse father name (English)"),
    optionalText("marriage_info_spouse_mother_name_bn", "স্বামী/স্ত্রীর মাতার নাম (বাংলা)", "Spouse mother name (Bangla)"),
    optionalText("marriage_info_spouse_mother_name_en", "স্বামী/স্ত্রীর মাতার নাম (ইংরেজি)", "Spouse mother name (English)"),
    optionalText("marriage_info_spouse_address_bn", "স্বামী/স্ত্রীর ঠিকানা (বাংলা)", "Spouse address (Bangla)", 1000),
    optionalText("marriage_info_spouse_address_en", "স্বামী/স্ত্রীর ঠিকানা (ইংরেজি)", "Spouse address (English)", 1000),
  ],
  26: [
    optionalText("marriage_info_spouse_father_name_bn", "স্বামী/স্ত্রীর পিতার নাম (বাংলা)", "Spouse father name (Bangla)"),
    optionalText("marriage_info_spouse_father_name_en", "স্বামী/স্ত্রীর পিতার নাম (ইংরেজি)", "Spouse father name (English)"),
    optionalText("marriage_info_spouse_mother_name_bn", "স্বামী/স্ত্রীর মাতার নাম (বাংলা)", "Spouse mother name (Bangla)"),
    optionalText("marriage_info_spouse_mother_name_en", "স্বামী/স্ত্রীর মাতার নাম (ইংরেজি)", "Spouse mother name (English)"),
    optionalText("marriage_info_spouse_address_bn", "স্বামী/স্ত্রীর ঠিকানা (বাংলা)", "Spouse address (Bangla)", 1000),
    optionalText("marriage_info_spouse_address_en", "স্বামী/স্ত্রীর ঠিকানা (ইংরেজি)", "Spouse address (English)", 1000),
  ],
  30: [optionalText("financial_basis_en", "স্বচ্ছলতার বিবরণ (ইংরেজি)", "Financial solvency basis (English)", 1000)],
  36: [
    optionalText("noc_role_bn", "প্রতিষ্ঠানে ভূমিকা/সম্পর্ক (বাংলা)", "Role or connection at the institution (Bangla)"),
    optionalText("noc_role_en", "প্রতিষ্ঠানে ভূমিকা/সম্পর্ক (ইংরেজি)", "Role or connection at the institution (English)"),
    optionalText("noc_activity_bn", "কার্যক্রমের বিবরণ (বাংলা)", "Activity description (Bangla)", 1000),
    optionalText("noc_activity_en", "কার্যক্রমের বিবরণ (ইংরেজি)", "Activity description (English)", 1000),
  ],
  38: [optionalText("support_needs_en", "প্রয়োজনীয় সহায়তার বিবরণ (ইংরেজি)", "Support needs (English)", 1000)],
  39: [
    optionalText("spi_name_2_bn", "দ্বিতীয় নামের রূপ (বাংলা)", "Second name variant (Bangla)"),
    optionalText("spi_name_2_en", "দ্বিতীয় নামের রূপ (ইংরেজি)", "Second name variant (English)"),
  ],
  40: [optionalText("community_name_en", "সম্প্রদায়ের নাম (ইংরেজি)", "Community name (English)")],
  41: [
    optionalNumber("premises_fee_licence", "লাইসেন্স ফি (টাকা)", "Licence fee (BDT)"),
    optionalNumber("premises_fee_vat", "ভ্যাট (টাকা)", "VAT (BDT)"),
  ],
  42: [
    optionalNumber("trade_fee_new", "নতুন লাইসেন্স ফি (টাকা)", "New licence fee (BDT)"),
    optionalNumber("trade_fee_renewal", "নবায়ন ফি (টাকা)", "Renewal fee (BDT)"),
    optionalNumber("trade_fee_arrear", "বকেয়া (টাকা)", "Arrear (BDT)"),
    optionalNumber("trade_fee_surcharge", "সারচার্জ (টাকা)", "Surcharge (BDT)"),
    optionalNumber("trade_fee_amendment", "সংশোধন ফি (টাকা)", "Amendment fee (BDT)"),
    optionalNumber("trade_fee_signboard", "সাইনবোর্ড ফি (টাকা)", "Signboard fee (BDT)"),
    optionalNumber("trade_fee_profession_tax", "পেশা কর (টাকা)", "Profession tax (BDT)"),
    optionalNumber("trade_fee_vat", "ভ্যাট (টাকা)", "VAT (BDT)"),
  ],
  44: [
    optionalText("previous_spouse_name_en", "পূর্বের স্বামী/স্ত্রীর নাম (ইংরেজি)", "Previous spouse name (English)"),
    requiredDate("spouse_death_date", "স্বামী/স্ত্রীর মৃত্যুর তারিখ", "Spouse date of death"),
  ],
  46: [
    proposedSelect("transport_vehicle_class", "যানবাহনের ধরণ", "Vehicle class", [
      option("rickshaw", "রিকশা", "Rickshaw"),
      option("van", "ভ্যান", "Van"),
      option("mishuk", "মিশুক", "Mishuk"),
      option("other", "অন্যান্য", "Other"),
    ]),
  ],
};

/** Services whose operational schema gains a CERT-REFINE-01 version. */
export const certRefineServices: readonly number[] = deepFreeze([
  1, 2, 3, 4, 5, 6, 10, 11, 13, 16, 18, 19, 20, 21, 24, 25, 26, 30, 32, 36,
  37, 38, 39, 40, 41, 42, 43, 44, 46,
]);

/** CERT-REFINE-01 children added inside a repeatable group (heirs: the father's name gains a Bangla pair, §B svc03/04). */
const certRefineChildAdditions: Record<
  number,
  Record<string, readonly FieldDefinition[]>
> = {
  3: {
    heirs: [
      optionalText("warish_heir_father_name_bn", "পিতার নাম (বাংলা)", "Father name (Bangla)"),
    ],
  },
  4: {
    heirs: [
      optionalText("warish_heir_father_name_bn", "পিতার নাম (বাংলা)", "Father name (Bangla)"),
    ],
  },
};

/**
 * CERT-REFINE-01: publish a new version instead of editing the current one,
 * so applications pinned to the earlier version keep their exact schema
 * (the same rule as the geography and Phase 4 releases). Adds the QA-driven
 * data slots and swaps service 38's disability-type list for the DSS list.
 */
export function buildCertRefineVersion(previous: FormSchema): FormSchema {
  if (!certRefineServices.includes(previous.serviceNo))
    throw new RangeError(
      `Service ${previous.serviceNo} has no CERT-REFINE-01 version.`,
    );
  const additions = certRefineAdditions[previous.serviceNo] ?? [];
  const childAdditions = certRefineChildAdditions[previous.serviceNo] ?? {};
  const swapDisabilityOptions = (field: FieldDefinition): FieldDefinition => {
    let next =
      previous.serviceNo === 38 && field.id === "application_autistic_type"
        ? { ...field, options: disabilityTypeOptions }
        : field;
    // CERT-REFINE-01 §43: the omission reason becomes a mandatory field.
    if (previous.serviceNo === 43 && field.id === "omission_details")
      next = {
        ...next,
        constraints: { ...next.constraints, required: true },
      };
    const extra = childAdditions[field.id];
    if (extra && field.type === "repeatable")
      next = {
        ...next,
        children: [
          ...(next.children ?? []),
          ...extra.filter(
            (child) =>
              !(next.children ?? []).some((existing) => existing.id === child.id),
          ),
        ],
      };
    return next;
  };
  const sections = previous.sections.map((section, index) => {
    const target =
      previous.serviceNo === 42
        ? index === previous.sections.length - 1
        : index === 0;
    return {
      ...section,
      fields: [
        ...section.fields.map(swapDisabilityOptions),
        ...(target ? additions : []),
      ],
    };
  });
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (CERT-REFINE-01) adds the certificate QA refinement data slots.`,
    },
    sections,
  });
}

/** CERT-REFINE-01 for the family certificate: members gain an optional gender slot (sons/daughters count, §B svc02). */
export function buildFamilyCertRefine(previous: FormSchema): FormSchema {
  if (previous.serviceNo !== 2)
    throw new RangeError("buildFamilyCertRefine applies to service 2 only.");
  const sections = previous.sections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => {
      if (field.id !== "members") return field;
      if ((field.children ?? []).some((child) => child.id === "gender"))
        return field;
      return {
        ...field,
        children: [
          ...(field.children ?? []),
          {
            id: "gender",
            type: "select",
            label: t("লিঙ্গ", "Gender"),
            constraints: { required: false },
            options: options.gender,
            evidence: { status: "proposed" },
          } as FieldDefinition,
        ],
      };
    }),
  }));
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (CERT-REFINE-01) adds the optional member gender slot.`,
    },
    sections,
  });
}

/* ---------- QAFIX-01: 47-service live-QA fix release ----------
 * Publishes a NEW schema version for EVERY service (the same rule as the
 * geography, Phase 4 and CERT-REFINE-01 releases: published versions stay
 * immutable; the previous latest of each service is retained in
 * qaFixSupersededSchemas and keeps validating its pinned applications).
 * Fixes from the 2026-11-23 live QA (§4 items 10/11/12 + §3 service 1):
 *  - the application's purpose is entered ONCE — a single `purpose` field
 *    plus a `purpose_language` choice — instead of parallel Bangla and
 *    English purpose fields the citizen had to write twice;
 *  - a Bangla field and its English companion sit beside each other
 *    (Bangla first) in every section and repeatable group — companions are
 *    never parked after the documents group;
 *  - the document-language field carries ONE label (নথির ভাষা) everywhere;
 *  - service 1 asked for the property description twice (the required
 *    field plus the optional Bangla/English companions CERT-REFINE-01
 *    appended) — the companions are removed, the single field stays;
 *  - the §4-12 spelling corrections in displayed Bangla strings.
 * Field ids, visibility rules and constraints are otherwise unchanged, so
 * validation behaviour for existing data slots is identical. */

/** Per-service fields the QA-fix version removes (duplicates of a kept field). */
const qaFixRemovedFields: Record<number, readonly string[]> = {
  1: ["property_description_bn", "property_description_en"],
};

/**
 * §4-12 spelling corrections (displayed Bangla strings only). Two of them
 * are codepoint-level: the sources write য় as the precomposed U+09DF and
 * ড় as U+09DC, while the prescribed spellings decompose them
 * (য + ় U+09AF U+09BC, ড + ় U+09A1 U+09BC) — written as escapes so the
 * two forms can never be confused in this file.
 */
const qaFixSpelling: readonly (readonly [string, string])[] = [
  ["কারন", "কারণ"],
  ["স্বত্ত্বাধিকারী", "স্বত্বাধিকারী"],
  ["সন্তান এর", "সন্তানের"],
  ["নে\u09DFার", "\u09A8\u09C7\u0993\u09AF\u09BC\u09BE\u09B0"],
  ["বাদ প\u09DCার", "বাদ প\u09A1\u09BCার"],
  ["সম্প্রদা\u09DF", "সম্প্রদা\u09AF\u09BC"],
  ["সহা\u09DF", "সহা\u09AF\u09BC"],
];
const qaFixSpell = (value: string): string => {
  let next = value;
  for (const [from, to] of qaFixSpelling) next = next.split(from).join(to);
  return next;
};

const qaFixText = (value: LocalizedText): LocalizedText => ({
  bn: qaFixSpell(value.bn),
  en: value.en,
});

/** The stem a Bangla/English companion pair shares, and which side a field is. */
function qaFixPairOf(id: string): { stem: string; side: "bn" | "en" | "base" } {
  if (id.endsWith("_bn")) return { stem: id.slice(0, -3), side: "bn" };
  if (id.endsWith("_en")) return { stem: id.slice(0, -3), side: "en" };
  return { stem: id, side: "base" };
}

/**
 * Reorder one field list so each Bangla field is immediately followed by
 * its English companion. Groups keep the position of their first member;
 * unrelated fields keep their relative order, so visibility controllers
 * stay ahead of the fields they govern.
 */
function qaFixOrderPairs(
  fields: readonly FieldDefinition[],
): FieldDefinition[] {
  const groups = new Map<string, FieldDefinition[]>();
  const order: string[] = [];
  for (const field of fields) {
    const { stem } = qaFixPairOf(field.id);
    if (!groups.has(stem)) {
      groups.set(stem, []);
      order.push(stem);
    }
    groups.get(stem)!.push(field);
  }
  const rank = (field: FieldDefinition): number => {
    const { stem, side } = qaFixPairOf(field.id);
    if (side === "bn") return 0;
    if (side === "en") return 2;
    // A base field beside a `_bn` companion is the English original
    // (e.g. proprietor_name next to proprietor_name_bn) and follows it;
    // beside only an `_en` companion it is the Bangla original
    // (e.g. previous_voter_area) and leads.
    return groups.get(stem)!.some((item) => qaFixPairOf(item.id).side === "bn")
      ? 1
      : 0;
  };
  return order.flatMap((stem) =>
    [...groups.get(stem)!].sort((a, b) => rank(a) - rank(b)),
  );
}

const qaFixPurposeFields: readonly FieldDefinition[] = [
  {
    id: "purpose",
    type: "text",
    label: t("আবেদনের উদ্দেশ্য", "Purpose of application"),
    constraints: { required: true, minLength: 2, maxLength: 500 },
    evidence: { status: "proposed" },
  },
  {
    id: "purpose_language",
    type: "select",
    label: t("উদ্দেশ্যের ভাষা", "Purpose language"),
    constraints: { required: true },
    options: [option("bn", "বাংলা", "Bangla"), option("en", "ইংরেজি", "English")],
    evidence: { status: "proposed" },
  },
];

/** Apply the QA-fix presentation changes to one field (recursing into groups). */
function qaFixField(field: FieldDefinition): FieldDefinition {
  let next: FieldDefinition = {
    ...field,
    label: qaFixText(field.label),
    ...(field.description ? { description: qaFixText(field.description) } : {}),
    ...(field.options
      ? {
          options: field.options.map((item) => ({
            ...item,
            label: qaFixText(item.label),
          })),
        }
      : {}),
  };
  if (next.id === "delivery_language")
    next = { ...next, label: t("নথির ভাষা", "Document language") };
  if (next.type === "repeatable" && next.children)
    next = { ...next, children: qaFixOrderPairs(next.children.map(qaFixField)) };
  return next;
}

/** QAFIX-01: publish the QA-fix version of a service's current schema. */
export function buildQaFixVersion(previous: FormSchema): FormSchema {
  const removed = new Set(qaFixRemovedFields[previous.serviceNo] ?? []);
  const sections = previous.sections.map((section) => {
    let fields = section.fields
      .filter((field) => !removed.has(field.id))
      .map(qaFixField);
    // Purpose once: replace the parallel Bangla/English purpose fields
    // with the single field + language choice, where the Bangla field sat.
    if (
      fields.some((field) => field.id === "purpose_bn") &&
      fields.some((field) => field.id === "purpose_en")
    ) {
      const at = Math.min(
        fields.findIndex((field) => field.id === "purpose_bn"),
        fields.findIndex((field) => field.id === "purpose_en"),
      );
      const rest = fields.filter(
        (field) => field.id !== "purpose_bn" && field.id !== "purpose_en",
      );
      fields = [
        ...rest.slice(0, at),
        ...qaFixPurposeFields,
        ...rest.slice(at),
      ];
    }
    return { ...section, fields: qaFixOrderPairs(fields) };
  });
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-01) enters the application purpose once with a language choice, seats Bangla/English companion fields beside each other, unifies the document-language label and applies the live-QA spelling corrections.`,
    },
    sections,
  });
}

/* ---------- QAFIX-02: per-service template repairs (Workstream B) ----------
 * The 2026-11-23 live QA (§3 services 2–6, §4 items 6/7) found defects the
 * QAFIX-01 presentation layer could not fix: duplicated and misplaced
 * fields on the family certificate, a core fact hidden behind an opt-in
 * toggle on the succession certificate, and the warish heir component —
 * including its required "related deceased person" field — reused whole
 * on the power-of-attorney form, whose certificate never prints it.
 * Same publication rule as every release above: a NEW version per repaired
 * service; the QAFIX-01 version stays pinned for its applications. */

/** Services whose next version carries the QAFIX-02 template repairs. */
export const qaFix2Services: readonly number[] = deepFreeze([2, 3, 4, 5]);

/**
 * One required-ness rule for a Bangla/English field pair (§3.3/§3.4,
 * §4 item 11): where the English field is required, the Bangla field is
 * required too — a pair never splits required/optional by language.
 */
function requireBanglaPairMember(field: FieldDefinition): FieldDefinition {
  return {
    ...field,
    constraints: { ...field.constraints, required: true, minLength: 2 },
  };
}

/** Map the children of a service's `heirs` repeatable through `fn`. */
function mapHeirChildren(
  previous: FormSchema,
  fn: (field: FieldDefinition) => FieldDefinition,
): FormSchema["sections"] {
  return previous.sections.map((section) => ({
    ...section,
    fields: section.fields.map((field) =>
      field.id === "heirs"
        ? { ...field, children: (field.children ?? []).map(fn) }
        : field,
    ),
  }));
}

/** The standard order-step fields every other service carries (services 3+). */
const qaFix2AddressSource: FieldDefinition = {
  id: "address_source",
  type: "select",
  label: t("প্রযোজ্য ঠিকানা", "Applicable citizen address"),
  constraints: { required: true },
  options: [
    option("permanent", "স্থায়ী ঠিকানা", "Permanent address"),
    option("present", "বর্তমান ঠিকানা", "Present address"),
  ],
  evidence: { status: "proposed" },
};
const qaFix2DeliveryLanguage: FieldDefinition = {
  id: "delivery_language",
  type: "select",
  label: t("নথির ভাষা", "Document language"),
  constraints: { required: true },
  options: options.language,
  evidence: { status: "proposed" },
};

/**
 * Service 2 (§3.2): the member row carried the warish component's
 * English-only father-name field while the head's own father name (Bangla
 * + English) already sits in the additional-details section — the label
 * "পিতার নাম (ইংরেজি)" appeared twice. The member-row leftover goes; the
 * certificate prints only the head's pair. The declaration checkbox sat
 * inside the members section; it moves to a new application-context
 * section that also gives the form the standard field set every other
 * service carries (address source, purpose entered once, document
 * language), so the review's language line reflects a real choice.
 */
function buildQaFix2Family(previous: FormSchema): FormSchema {
  let confirmation: FieldDefinition | undefined;
  const sections = previous.sections.map((section) => {
    if (section.id !== "family") return section;
    return {
      ...section,
      fields: section.fields.flatMap((field) => {
        if (field.id === "confirmation") {
          confirmation = field;
          return [];
        }
        if (field.id !== "members") return [field];
        return [
          {
            ...field,
            children: (field.children ?? []).filter(
              (child) => child.id !== "warish_heir_father_name",
            ),
          },
        ];
      }),
    };
  });
  if (!confirmation)
    throw new Error("Service 2 schema carries no declaration to relocate.");
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-02) removes the duplicated member-row father-name field, moves the declaration into a new purpose-and-language section and gives the form the standard address/purpose/language fields.`,
    },
    sections: [
      ...sections,
      {
        id: "application_context",
        title: t("আবেদনের উদ্দেশ্য ও ভাষা", "Purpose and language"),
        fields: [
          qaFix2AddressSource,
          ...qaFixPurposeFields,
          qaFix2DeliveryLanguage,
          confirmation,
        ],
      },
    ],
  });
}

/**
 * Service 3 (§3.3): field order is already Bangla-first in every section
 * (the QAFIX-01 reorder covers this schema — verified field by field), and
 * the review renders the full heir list since the QAFIX-01 review fix
 * (both probe-verified on this version). The one schema defect left: the
 * heir's father's name was required in English but optional in Bangla.
 */
function buildQaFix2Warish(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-02) makes the heir's father's name in Bangla required, matching the English field of the pair.`,
    },
    sections: mapHeirChildren(previous, (child) =>
      child.id === "warish_heir_father_name_bn"
        ? requireBanglaPairMember(child)
        : child,
    ),
  });
}

/**
 * Service 4 (§3.4): the death date — the core fact of a succession
 * certificate — was hidden behind the opt-in toggle "নিবন্ধন/সহায়ক তথ্য
 * যুক্ত করুন" (the Phase-4 conditioning grouped it with the optional
 * registration extras). §4 item 6: core evidence is NEVER checkbox-hidden.
 * The date of death is now always visible and required; the toggle keeps
 * governing only the optional extras (registration reference, religion
 * document). The heir's father's name gets the same pair rule as
 * service 3. The toggle itself stays out of the review (it is in the
 * review's controller suppression set — probe-verified).
 */
function buildQaFix2Succession(previous: FormSchema): FormSchema {
  const sections = mapHeirChildren(previous, (child) =>
    child.id === "warish_heir_father_name_bn"
      ? requireBanglaPairMember(child)
      : child,
  ).map((section) => ({
    ...section,
    fields: section.fields.map((field) => {
      if (field.id !== "warish_info_dod") return field;
      const { visibleWhen: _condition, ...alwaysVisible } = field;
      return alwaysVisible;
    }),
  }));
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-02) makes the date of death always visible (core evidence is never hidden behind the opt-in toggle) and the heir's father's name in Bangla required, matching the English field.`,
    },
    sections,
  });
}

/**
 * Service 5 (§3.5 — the QA's one BLOCKER in this range): the form reused
 * the warish heir component wholesale, including a REQUIRED "সংশ্লিষ্ট
 * মৃত ব্যক্তির নাম" (related deceased person's name) — on a power of
 * attorney, where there is no deceased person at all; citizens could only
 * proceed by typing "প্রযোজ্য নয়". The issued certificate
 * (certificate-template-v7, attestation 5) prints only the delegate's
 * name, the subject and the relationship — the heir list is never printed
 * (the heirs table renders for services 3/4 only). The whole repeatable
 * is removed; the party structure the certificate actually uses stays:
 * the grantor (the applicant; letter type individual/organization), the
 * delegate (name + father's name, Bangla and English) and the single
 * top-level relationship with the delegate — which also resolves the
 * duplicated relationship (form-level vs row-level): one remains.
 */
function buildQaFix2PowerOfAttorney(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-02) removes the warish heir list — including its required deceased-person field — which never belonged on a power of attorney and is never printed on its certificate; the form now matches the certificate's own party structure.`,
    },
    sections: previous.sections.map((section) => ({
      ...section,
      fields: section.fields.filter((field) => field.id !== "heirs"),
    })),
  });
}

/** QAFIX-02: publish the template-repair version of a service's QAFIX-01 schema. */
export function buildQaFix2Version(previous: FormSchema): FormSchema {
  switch (previous.serviceNo) {
    case 2:
      return buildQaFix2Family(previous);
    case 3:
      return buildQaFix2Warish(previous);
    case 4:
      return buildQaFix2Succession(previous);
    case 5:
      return buildQaFix2PowerOfAttorney(previous);
    default:
      throw new RangeError(
        `Service ${previous.serviceNo} has no QAFIX-02 version.`,
      );
  }
}

/* ---------- QAFIX-03: services 7–12 (Workstream C) ----------
 * The same live QA (§3 services 7–12, §4 items 6/9) found the next set of
 * defects the presentation layer cannot fix: another core fact (the death
 * date on service 7) hidden behind the opt-in toggle; a wholly wrong
 * template on the not-Rohingya attestation (land + deceased fields);
 * the deceased-person field again inside service 9's related-people list;
 * a required previous occupation on the unemployment certificate that a
 * never-employed citizen cannot answer; and free-text nationality /
 * basis-of-claim fields on services 11/12 that accept anything.
 * Same publication rule: a NEW version per repaired service; the previous
 * version stays pinned for its applications. */

/** Services whose next version carries the QAFIX-03 repairs. */
export const qaFix3Services: readonly number[] = deepFreeze([7, 8, 9, 10, 11, 12]);

/**
 * §4 item 9 — fixed selects, built at service 11 and reused by service
 * 12: facts that decide what a certificate states are chosen from a
 * closed list, never typed freehand. The basis-of-claim values are the
 * standard grounds (the service-12 certificate keys its by-birth wording
 * off the `birth` value, which its template has always matched by the
 * /জন্ম|birth/i test — the code keeps that behaviour); the nationality
 * values are the declared nationality itself, with the certificate's
 * label map (certificate-template-v7, NATIONALITY_LABELS) rendering the
 * chosen value in each document language.
 */
const qaFix3BasisOptions: FieldDefinition["options"] = [
  option("birth", "জন্মসূত্রে", "By birth"),
  option("parents", "পিতা-মাতার জাতীয়তা", "Parents' nationality"),
  option("certificate", "নাগরিকত্ব সনদ", "Citizenship certificate"),
  option("marriage", "বিবাহসূত্রে", "By marriage"),
  option("other", "অন্যান্য", "Other"),
];
const qaFix3NationalityOptions: FieldDefinition["options"] = [
  option("bangladeshi", "বাংলাদেশি", "Bangladeshi"),
  option("indian", "ভারতীয়", "Indian"),
  option("pakistani", "পাকিস্তানি", "Pakistani"),
  option("nepali", "নেপালি", "Nepali"),
  option("myanmar", "বার্মিজ", "Myanmar"),
  option("chinese", "চীনা", "Chinese"),
  option("british", "ব্রিটিশ", "British"),
  option("american", "মার্কিন", "American"),
  option("other", "অন্যান্য", "Other"),
];

/**
 * Service 7 (§3.7): the date of death — the core fact of a death
 * certificate — was hidden behind the same opt-in toggle as service 4's
 * (§4 item 6: core evidence is NEVER checkbox-hidden). The date is now
 * always visible and required; the toggle keeps governing only the
 * optional extras (registration reference, religion document). The
 * relationship field's label said only "সম্পর্ক / Relationship" without
 * saying to whom; it now names the deceased.
 */
function buildQaFix3Death(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-03) makes the date of death always visible (core evidence is never hidden behind the opt-in toggle) and names the deceased in the relationship field's label.`,
    },
    sections: previous.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        if (field.id === "dead_info_dod") {
          const { visibleWhen: _condition, ...alwaysVisible } = field;
          return alwaysVisible;
        }
        if (field.id === "dead_info_relation")
          return {
            ...field,
            label: t("মৃত ব্যক্তির সাথে সম্পর্ক", "Relationship with the deceased"),
          };
        return field;
      }),
    })),
  });
}

/**
 * Service 8 (§3.8 — a BLOCKER): the form was built on a wholly wrong
 * template — it demanded a land description, land-owner details and a
 * related-people list carrying a REQUIRED deceased person's name, none of
 * which belong on an identity attestation; citizens could only proceed by
 * typing "প্রযোজ্য নয়" in the deceased field. The issued certificate
 * (certificate-template-v7, attestation 8) reads NO payload field at all:
 * its sentence is fixed ("…রোহিঙ্গা নাগরিক নন; তিনি বাংলাদেশের নাগরিক…")
 * and the identity it certifies comes from the citizen record through the
 * paragraph chassis — the land and heir data are never printed. The whole
 * wrong structure is removed; what remains is the supporting-documents
 * step and the standard application context, matching the minimal shape
 * of the other fixed-sentence attestations (services 14/15/22).
 */
function buildQaFix3NotRohingya(previous: FormSchema): FormSchema {
  const removed = new Set([
    "land_info_bn",
    "land_info_en",
    "land_owner_info_bn",
    "land_owner_info_en",
    "heirs",
  ]);
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-03) removes the wrong template's land description, land-owner details and related-people list — including its required deceased-person field — none of which belong on this identity attestation or are printed on its certificate.`,
    },
    sections: previous.sections.map((section) => ({
      ...section,
      fields: section.fields.filter((field) => !removed.has(field.id)),
    })),
  });
}

/**
 * Service 9 (§3.9): the related-people list again carried the warish
 * component's REQUIRED "সংশ্লিষ্ট মৃত ব্যক্তির নাম" (related deceased
 * person's name) — on a voter information verification, where there is
 * no deceased person. Only that field is removed (the list itself is the
 * form's family context and stays); the parent field's observed-name
 * mapping loses the name with it. The certificate template was checked
 * for the QA's second finding (no voter/NID field on the form): the
 * issued certificate already prints the subject's NID/voter number as
 * its own sentence (certificate-template-v7, CERT-REFINE-01 §9), sourced
 * from the citizen identity record — not from a form field — so the
 * identifier is on the certificate by design and no form field is added.
 */
function buildQaFix3Voter(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-03) removes the required deceased-person field from the related-people list, which never belonged on a voter verification; the certificate's NID/voter-number line is printed from the citizen identity record, so no form field is added for it.`,
    },
    sections: previous.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        if (field.id !== "heirs") return field;
        return {
          ...field,
          evidence: field.evidence
            ? {
                ...field.evidence,
                fieldNames: (field.evidence.fieldNames ?? []).filter(
                  (name) => name !== "dead_person_name[]",
                ),
              }
            : field.evidence,
          children: (field.children ?? []).filter(
            (child) => child.id !== "dead_person_name",
          ),
        };
      }),
    })),
  });
}

/**
 * Service 10 (§3.10): "পূর্বের পেশা" (previous occupation) was REQUIRED —
 * a citizen who has never worked has no sensible answer and could not
 * apply at all. The form now opens with an explicit employment-history
 * choice; the previous-occupation pair and the unemployed-since date are
 * shown and required only when the citizen has worked before, and the
 * "কখনো কর্মরত ছিলাম না" (never employed) choice carries neither. The
 * certificate template already handles the absent facts (attestation 10
 * falls back to "তিনি বর্তমানে বেকার আছেন" when no since-date or
 * occupation is present).
 */
const qaFix3EmploymentHistory: FieldDefinition = {
  id: "employment_history",
  type: "select",
  label: t("পূর্বের কর্মসংস্থান", "Previous employment"),
  constraints: { required: true },
  options: [
    option("previously_employed", "পূর্বে কর্মরত ছিলাম", "I have been employed before"),
    option("never_employed", "কখনো কর্মরত ছিলাম না", "I have never been employed"),
  ],
  evidence: { status: "proposed" },
};

function buildQaFix3Unemployment(previous: FormSchema): FormSchema {
  const workedWhen = { field: "employment_history", equals: "previously_employed" } as const;
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-03) adds an explicit employment-history choice: the previous occupation and unemployed-since date are required only from citizens who have worked before; a never-employed citizen is no longer asked for a previous occupation they do not have.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      return {
        ...section,
        fields: [
          qaFix3EmploymentHistory,
          ...section.fields.map((field) =>
            field.id === "last_occupation" ||
            field.id === "last_occupation_en" ||
            field.id === "unemployed_since"
              ? { ...field, visibleWhen: workedWhen }
              : field,
          ),
        ],
      };
    }),
  });
}

/**
 * Service 11 (§3.11, §4 item 9): "ঘোষিত জাতীয়তা" (declared nationality)
 * and "দাবির ভিত্তি" (basis of claim) were free text — an applicant could
 * declare any nationality on any basis, and the certificate printed the
 * typed words verbatim. Both are now closed selects (the §4 item 9
 * pattern, recorded in the QAFIX-03 notes for the later forms that reuse
 * them). The Bangla/English text pair for the nationality collapses into
 * the single select — its options carry both languages, and the
 * certificate renders the chosen value from its label map in each
 * document language (the pre-QAFIX-03 free-text values of pinned
 * applications still render verbatim). The basis is never printed; it is
 * the office's assessment input and is now a fixed list there too.
 */
function buildQaFix3Nationality(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-03) makes the declared nationality and the basis of claim closed selects instead of free text, and collapses the nationality's Bangla/English text pair into the single bilingual select.`,
    },
    sections: previous.sections.map((section) => ({
      ...section,
      fields: section.fields.flatMap((field) => {
        if (field.id === "claimed_nationality_en") return [];
        if (field.id === "claimed_nationality")
          return [
            {
              ...field,
              type: "select" as const,
              constraints: { required: true },
              options: qaFix3NationalityOptions,
            },
          ];
        if (field.id === "nationality_basis")
          return [
            {
              ...field,
              type: "select" as const,
              constraints: { required: true },
              options: qaFix3BasisOptions,
            },
          ];
        return [field];
      }),
    })),
  });
}

/**
 * Service 12 (§3.12): "নাগরিকত্বের দাবির ভিত্তি" (basis of the
 * citizenship claim) was free text — the same defect as service 11's
 * basis. It becomes the shared §4 item 9 basis select built at service
 * 11, verbatim. The certificate keys its by-birth wording off this
 * value (attestation 12 tests /জন্ম|birth/i against it): the `birth`
 * code keeps that behaviour exactly, and every other code takes the
 * generic citizenship sentence, as free text did before.
 */
function buildQaFix3Citizenship(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-03) makes the basis of the citizenship claim the shared closed select instead of free text.`,
    },
    sections: previous.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) =>
        field.id === "citizenship_basis"
          ? {
              ...field,
              type: "select" as const,
              constraints: { required: true },
              options: qaFix3BasisOptions,
            }
          : field,
      ),
    })),
  });
}

/** QAFIX-03: publish the repair version of a service's current schema. */
export function buildQaFix3Version(previous: FormSchema): FormSchema {
  switch (previous.serviceNo) {
    case 7:
      return buildQaFix3Death(previous);
    case 8:
      return buildQaFix3NotRohingya(previous);
    case 9:
      return buildQaFix3Voter(previous);
    case 10:
      return buildQaFix3Unemployment(previous);
    case 11:
      return buildQaFix3Nationality(previous);
    case 12:
      return buildQaFix3Citizenship(previous);
    default:
      throw new RangeError(
        `Service ${previous.serviceNo} has no QAFIX-03 version.`,
      );
  }
}

/* ---------- QAFIX-04: services 13–18 (Workstream D) ----------
 * The same live QA (§3 services 13–18, §4 items 5/9/11) found the next
 * set: a landless certificate whose only evidence was one free-text box
 * (14); a widow attestation whose English name field is optional while
 * its Bangla half is required, with no document requirement at all
 * (16); and two more free-text facts that decide what a certificate
 * states — profession (17) and community name (18) — where §4 item 9
 * requires closed selects. Services 13 and 15 were verified without
 * change (no new version for either, the service 6 precedent), so they
 * are not in this list. Same publication rule: a NEW version per
 * repaired service; the previous version stays pinned. */

/** Services whose next version carries the QAFIX-04 repairs. */
export const qaFix4Services: readonly number[] = deepFreeze([14, 16, 17, 18]);

/**
 * Service 14 (§3.14): the form carried NO land-related field at all —
 * its whole evidence was one free-text declaration box. Template-first
 * check: the issued certificate's attestation is a FIXED sentence
 * ("তিনি ভূমিহীন; তাঁহার নিজের বা তাঁহার পরিবারের কোনো সদস্যের নামে
 * কোনো জমি নাই।") that reads no payload field, so these structured
 * facts are the office's assessment record (the same status as service
 * 11's basis of claim, which is likewise never printed): the mouza and
 * holding of the residence the applicant lives in, how long they have
 * lived there, and the land-ownership declaration itself as an active
 * must-be-true statement whose wording matches the certificate's
 * sentence. The free-text box is removed.
 */
const qaFix4LandlessFields: readonly FieldDefinition[] = deepFreeze([
  {
    id: "residence_mouza",
    type: "text",
    label: t("বর্তমান বসতবাড়ির মৌজা", "Mouza of current residence"),
    constraints: { required: true, minLength: 2, maxLength: 200 },
    evidence: { status: "proposed" },
  },
  {
    id: "residence_holding_no",
    type: "text",
    label: t("বসতবাড়ির হোল্ডিং নম্বর", "Holding number of current residence"),
    constraints: { required: false, maxLength: 100 },
    evidence: { status: "proposed" },
  },
  {
    id: "residence_duration_years",
    type: "number",
    label: t("এই বসতবাড়িতে বসবাসের মেয়াদ (বছর)", "Years lived at this residence"),
    constraints: { required: true, min: 0, max: 120 },
    evidence: { status: "proposed" },
  },
  {
    id: "land_ownership_declaration",
    type: "checkbox",
    label: t(
      "আমি ঘোষণা করছি যে আমার নিজের বা আমার পরিবারের কোনো সদস্যের নামে কোনো জমি নেই।",
      "I declare that neither I nor any member of my family owns any land.",
    ),
    constraints: { required: true, mustBeTrue: true },
    evidence: { status: "proposed" },
  },
]);

function buildQaFix4Landless(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-04) replaces the single free-text declaration box with the structured evidence of landlessness: the residence's mouza and holding number, the years lived there, and the land-ownership declaration as an active statement matching the certificate's own sentence.`,
    },
    sections: previous.sections.map((section) =>
      section.id !== "service_details"
        ? section
        : {
            ...section,
            fields: [
              ...qaFix4LandlessFields,
              ...section.fields.filter(
                (field) => field.id !== "landless_declaration",
              ),
            ],
          },
    ),
  });
}

/**
 * Service 16 (§3.16, §4 items 5/11): three findings.
 * (a) The live QA saw the English spouse-name field separated from its
 * Bangla half by the documents group; the QAFIX-01 seating already
 * renders the pair adjacent, Bangla first, on the current build (the
 * probe re-verifies the DOM order), so no reorder is needed here.
 * (b) The pair's required-ness disagreed: the Bangla name was required
 * while the English name was optional — although the certificate
 * prints each language's document from its own half and the issuance
 * gate (cert-gates LANGUAGE_PAIRS) already blocks an application that
 * carries only one side. The §4 item 11 pair rule now applies: both
 * halves required, matching service 13.
 * (c) §4 item 5 — document requirements, built here for the first
 * time: the documents step named no required document and accepted
 * none at all. The step now carries guidance naming the husband's
 * death certificate, and minRows 1 makes at least one document row
 * (description + uploaded file, both already required per row)
 * mandatory: the form seeds the row, and removing every row leaves an
 * empty list, which the engine rejects with a min_rows issue. The
 * repeatable cannot be flagged `required` itself — an absent optional
 * repeatable is the only shape the synthetic-fixture builder can
 * represent, because fixtures never fake upload handles; a
 * hand-crafted API payload that omits the documents field entirely
 * is therefore the one path minRows cannot reach, recorded here as
 * the §4 item 5 mechanism limit for the later forms that reuse it.
 */
function buildQaFix4Widow(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-04) makes the deceased spouse's English name required, matching its Bangla half, and makes the supporting-documents step require at least one uploaded document, guided as the husband's death certificate.`,
    },
    sections: previous.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        if (field.id === "deceased_spouse_name_en")
          return {
            ...field,
            constraints: { ...field.constraints, required: true },
          };
        if (field.id === "supporting_documents")
          return {
            ...field,
            description: t(
              "স্বামীর মৃত্যু সনদের স্ক্যান কপি অবশ্যই আপলোড করুন।",
              "A scanned copy of the husband's death certificate must be uploaded here.",
            ),
            constraints: { ...field.constraints, minRows: 1 },
          };
        return field;
      }),
    })),
  });
}

/**
 * §4 item 9 — fixed selects, the service-11 pattern: the standard
 * occupations for the profession certificate. The certificate renders
 * the chosen value from its label map in each document language
 * (certificate-template-v7, PROFESSION_LABELS); the two lists must
 * stay in sync (both tests assert their own side of that contract).
 */
const qaFix4ProfessionOptions: FieldDefinition["options"] = [
  option("farmer", "কৃষক", "Farmer"),
  option("teacher", "শিক্ষক", "Teacher"),
  option("doctor", "চিকিৎসক", "Doctor"),
  option("engineer", "প্রকৌশলী", "Engineer"),
  option("business", "ব্যবসায়ী", "Businessperson"),
  option("government_employee", "সরকারি চাকরিজীবী", "Government employee"),
  option("private_employee", "বেসরকারি চাকরিজীবী", "Private-sector employee"),
  option("lawyer", "আইনজীবী", "Lawyer"),
  option("journalist", "সাংবাদিক", "Journalist"),
  option("shopkeeper", "দোকানদার", "Shopkeeper"),
  option("driver", "চালক", "Driver"),
  option("rickshaw_puller", "রিকশাচালক", "Rickshaw puller"),
  option("day_labourer", "দিনমজুর", "Day labourer"),
  option("fisherman", "জেলে", "Fisherman"),
  option("weaver", "তাঁতি", "Weaver"),
  option("artisan", "কারিগর", "Artisan"),
  option("homemaker", "গৃহিণী", "Homemaker"),
  option("student", "ছাত্র/ছাত্রী", "Student"),
  option("retired", "অবসরপ্রাপ্ত", "Retired"),
  option("other", "অন্যান্য", "Other"),
];

/**
 * Service 17 (§3.17, §4 item 9): "পেশা" (profession) was free text in
 * both languages — the certificate printed the typed words verbatim in
 * each document language. The Bangla/English text pair collapses into
 * the single bilingual select (the service-11 pattern): its options
 * carry both languages, and the certificate renders the chosen value
 * from its label map in each document language (pinned free-text
 * values still print verbatim). The collapse also ends the field-order
 * complaint: there is no longer a pair to order. The new select keeps
 * the observed names `profession_bn` / `profession_en` in its
 * evidence mapping — the profession fact is the same data, captured
 * better — so the observed-field mapping test needs no removal
 * record.
 */
function buildQaFix4Profession(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-04) makes the profession a closed select of standard occupations instead of free text in both languages, collapsing the Bangla/English text pair into the single bilingual select.`,
    },
    sections: previous.sections.map((section) => ({
      ...section,
      fields: section.fields.flatMap((field) => {
        if (field.id === "profession_en") return [];
        if (field.id === "profession_bn")
          return [
            {
              id: "profession",
              type: "select" as const,
              label: t("পেশা", "Profession"),
              constraints: { required: true },
              options: qaFix4ProfessionOptions,
              evidence: {
                status: "inferred" as const,
                source: "audit/evidence/s-17.json",
                fieldNames: ["profession_bn", "profession_en"],
              },
            },
          ];
        return [field];
      }),
    })),
  });
}

/**
 * §4 item 9 — fixed selects, the service-11 pattern: the recognised
 * communities for the community certificate. The certificate renders
 * the chosen value from its label map in each document language
 * (certificate-template-v7, COMMUNITY_LABELS); the two lists must
 * stay in sync (both tests assert their own side of that contract).
 * "অন্যান্য" covers communities outside the closed list.
 */
const qaFix4CommunityOptions: FieldDefinition["options"] = [
  option("chakma", "চাকমা", "Chakma"),
  option("marma", "মারমা", "Marma"),
  option("tripura", "ত্রিপুরা", "Tripura"),
  option("tanchangya", "তঞ্চঙ্গ্যা", "Tanchangya"),
  option("barua", "বড়ুয়া", "Barua"),
  option("mro", "ম্রো", "Mro"),
  option("bawm", "বম", "Bawm"),
  option("khumi", "খুমি", "Khumi"),
  option("chak", "চাক", "Chak"),
  option("pankho", "পাংখো", "Pankho"),
  option("lushei", "লুসাই", "Lushei"),
  option("khyang", "খিয়াং", "Khyang"),
  option("garo", "গারো", "Garo"),
  option("hajong", "হাজং", "Hajong"),
  option("koch", "কোচ", "Koch"),
  option("rajbanshi", "রাজবংশী", "Rajbanshi"),
  option("santal", "সাঁওতাল", "Santal"),
  option("oraon", "ওরাঁও", "Oraon"),
  option("munda", "মুন্ডা", "Munda"),
  option("khasi", "খাসি", "Khasi"),
  option("manipuri", "মণিপুরি", "Manipuri"),
  option("muslim", "মুসলিম", "Muslim"),
  option("hindu", "হিন্দু", "Hindu"),
  option("buddhist", "বৌদ্ধ", "Buddhist"),
  option("christian", "খ্রিস্টান", "Christian"),
  option("other", "অন্যান্য", "Other"),
];

/**
 * Service 18 (§3.18, §4 item 9): "সম্প্রদায়ের নাম" (community name)
 * was free text in both languages despite the form carrying a
 * separate "type" select — the certificate printed the typed words
 * verbatim in each document language. The Bangla/English text pair
 * collapses into the single bilingual select `community_name` with
 * the closed list above; the certificate renders the chosen value
 * from its label map in each document language (pinned free-text
 * values still print verbatim, with the trailing "সম্প্রদায়" /
 * " community" stripped as before). The collapse also ends the
 * placement complaint: there is no longer a pair split across the
 * documents group. The new select keeps the observed names
 * `community_name` / `community_name_en` in its evidence mapping —
 * the community fact is the same data, captured better — so the
 * observed-field mapping test needs no removal record.
 *
 * Service 40 (Tribal) carries its OWN community_name fields in its
 * own schema and payload and is NOT touched by this change.
 */
function buildQaFix4Community(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-04) makes the community a closed select of recognised communities instead of free text in both languages, collapsing the Bangla/English text pair into the single bilingual select.`,
    },
    sections: previous.sections.map((section) => ({
      ...section,
      fields: section.fields.flatMap((field) => {
        if (field.id === "community_name_en") return [];
        if (field.id === "community_name")
          return [
            {
              id: "community_name",
              type: "select" as const,
              label: t("সম্প্রদায়ের নাম", "Community name"),
              constraints: { required: true },
              options: qaFix4CommunityOptions,
              evidence: {
                status: "inferred" as const,
                source: "audit/evidence/s-18.json",
                fieldNames: ["community_name", "community_name_en"],
              },
            },
          ];
        return [field];
      }),
    })),
  });
}

/** QAFIX-04: publish the repair version of a service's current schema. */
export function buildQaFix4Version(previous: FormSchema): FormSchema {
  switch (previous.serviceNo) {
    case 14:
      return buildQaFix4Landless(previous);
    case 16:
      return buildQaFix4Widow(previous);
    case 17:
      return buildQaFix4Profession(previous);
    case 18:
      return buildQaFix4Community(previous);
    default:
      throw new RangeError(
        `Service ${previous.serviceNo} has no QAFIX-04 version.`,
      );
  }
}

/* ---------- QAFIX-05: services 19–24 (Workstream E) ----------
 * The same live QA (§3 services 19–24, §4 items 5/6/8/9/11) found the
 * next set: a guardian-consent form that asks the child's name twice
 * (19); a freedom-fighter attestation whose gazette number is optional
 * while its gazette type is required (20); an agriculture attestation
 * with no structured land fact at all (21); an unmarried certificate
 * whose key evidence — the guardian consent letter — is not required
 * (22); an annual-income certificate whose core facts hide behind
 * optional-looking checkboxes (23); and an orphan certificate that
 * names no deceased parent (24). Services are repaired one at a time
 * below; the list grows as each lands. Same publication rule: a NEW
 * version per repaired service; the previous version stays pinned. */

/** Services whose next version carries the QAFIX-05 repairs. */
export const qaFix5Services: readonly number[] = deepFreeze([19, 20, 21, 22, 23, 24]);

/**
 * §4 item 8 — context-correct relationship lists, the shared guardian
 * list for services 19 and 24: the copied generic list offered "নিজ"
 * (self) and "স্বামী/স্ত্রী" (spouse) for a child's relationship to a
 * guardian, and had no চাচা/মামা/দাদা/নানা option, forcing "অন্যান্য"
 * for the uncles and grandparents who actually raise orphans. Service
 * 19's certificate renders the chosen value from the schema's own
 * option labels (certificate-template-v7, consentBody via selectLabel);
 * service 24's renders it from the certificate's label map
 * (RELATIONSHIP_LABELS, extended with the new codes when 24 lands) —
 * the schema list and the map must stay in sync.
 */
const qaFix5GuardianRelationOptions: FieldDefinition["options"] = [
  option("parent", "পিতা/মাতা", "Parent"),
  option("grandparent", "দাদা/দাদি/নানা/নানি", "Grandparent"),
  option("uncle", "চাচা/মামা", "Uncle"),
  option("aunt", "চাচি/মামি/খালা", "Aunt"),
  option("sibling", "ভাই/বোন", "Sibling"),
  option("guardian", "অভিভাবক", "Guardian"),
  option("other", "অন্যান্য", "Other"),
];

/**
 * Service 19 (§3.19, §4 items 7/8): three findings.
 * (a) BLOCKER — the child's name was asked TWICE: the applicant-name
 * pair (consent_applicant_name_bn/en) is labelled "সন্তানের নাম
 * (বাংলায়/ইংরেজিতে)" and a second pair (consent_child_name_bn/en)
 * labelled "সন্তানের নাম (বাংলা/ইংরেজি)" follows the documents group;
 * both pairs are required and both appear twice on review.
 * Template-first check: the issued certificate (certificate-template-v7,
 * consentBody) prints the CHILD from consent_child_name_bn/en (plus
 * DOB, birth registration and the relationship, read through the
 * schema's option labels) and the GUARDIAN from the citizen record —
 * the consent_applicant_name_* pair is never printed anywhere on it.
 * The duplicate pair is removed; the child's pair stays.
 * (b) The relationship select was the copied generic list — "নিজ" and
 * "স্বামী/স্ত্রী" make no sense as a child's relationship to a
 * guardian. It becomes the shared guardian-appropriate closed list.
 * (c) Spelling "সন্তান এর" vs "সন্তানের": already normalised by
 * QAFIX-01 (the live pair's labels read "সন্তানের" on the current
 * build; "সন্তান এর" survives only in the pinned v1 evidence) — the
 * removal of the mislabelled pair also removes the last live carrier
 * of the variant; no further change is needed.
 */
function buildQaFix5GuardianConsent(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-05) removes the duplicated child's-name pair (the applicant-name fields mislabelled as the child's name, never printed on the certificate) and replaces the copied generic relationship list with the guardian-appropriate closed list.`,
    },
    sections: previous.sections.map((section) => ({
      ...section,
      fields: section.fields
        .filter(
          (field) =>
            field.id !== "consent_applicant_name_bn" &&
            field.id !== "consent_applicant_name_en",
        )
        .map((field) =>
          field.id === "consent_child_relation"
            ? { ...field, options: qaFix5GuardianRelationOptions }
            : field,
        ),
    })),
  });
}

/**
 * Service 20 (§3.20, §4 item 6): three findings.
 * (a) The checkbox "অন্য মুক্তিযোদ্ধার পক্ষে আবেদন" was reported as a
 * dead no-op — ticking it revealed nothing, the relationship field
 * being present and required regardless. DECISION, from what the
 * certificate needs: KEEP the checkbox, with its gating. The
 * certificate prints the other freedom fighter's name and relationship
 * only when one is named (certificate-template-v7, attestation 20, both
 * languages), so the on-behalf fields must exist — but only for
 * applications made for another fighter. The gating itself is real on
 * the current build: the name pair and relationship carry
 * `visibleWhen` on the checkbox (since v1) and are required when
 * visible, and the renderer hides invisible fields (DynamicForm /
 * ServiceFlow filter on `isFieldVisible`) — the probe re-verifies
 * tick-reveals / untick-hides below. The live QA's "dead no-op" reading
 * does not reproduce on this build; the checkbox stays as the §4-6
 * compliant gate for genuinely conditional fields.
 * (b) The identity/gazette fields: the report's "all 11 optional" does
 * not match the schema history either — the freedom-fighter ID number
 * and the gazette TYPE are required in every pinned version (v1–v4),
 * and the on-behalf name pair and relationship are required when the
 * checkbox is ticked. What IS optional, and is the real gap, is the
 * GAZETTE NUMBER itself: a gazette type can be chosen without ever
 * giving its number, so the attestation carries no verifiable gazette
 * identity. The gazette number becomes required. The batch number,
 * certificate number/date, Muktibarta number and Indian gazette number
 * stay optional: they are ALTERNATIVE identifiers, each printed when
 * present, and requiring all of them would force citizens to invent
 * numbers they do not have.
 * (c) Field order: English name before Bangla, and the gazette number
 * after the documents group — both already fixed by the QAFIX-01 pair
 * seating (the name pair renders Bangla first; the gazette number
 * sits directly after its type, before the documents group). The probe
 * re-verifies the DOM order; no reorder is needed here.
 */
function buildQaFix5FreedomFighter(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-05) makes the gazette number required, completing the verifiable gazette identity (ID number and gazette type were already required); the on-behalf checkbox is kept as the gate for the other-fighter name and relationship, which are required when it is ticked.`,
    },
    sections: previous.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) =>
        field.id === "freedom_fighter_gazette_number"
          ? {
              ...field,
              constraints: { ...field.constraints, required: true },
            }
          : field,
      ),
    })),
  });
}

/**
 * Service 21 (§3.21, §4 items 9/11): three findings.
 * (a) The English description sat after the documents group, split
 * from its Bangla pair — already fixed by the QAFIX-01 pair seating
 * (the pair renders adjacent, Bangla first, ahead of the documents
 * group). The probe re-verifies the DOM order; no reorder is needed
 * here. One thing the seating did NOT fix: the pair's required-ness
 * disagreed — the Bangla description is required while the English
 * one is optional — although the issuance gate (cert-gates
 * LANGUAGE_PAIRS) already blocks an application that carries only one
 * side of the pair in official mode. The §4 item 11 pair rule now
 * applies: both halves required (the service-16 precedent).
 * (b) No land area/unit, crop or holding fields — free text only.
 * Template-first check (the Form 14 method): the issued certificate's
 * attestation prints ONLY the free-text activity — "তিনি পেশায় একজন
 * কৃষক। তিনি {farming_activity} চাষের সহিত জড়িত।" / "The person is a
 * farmer by occupation. The person is engaged in the cultivation of
 * {farming_activity_en}." — it reads no land field, so nothing added
 * to the form can be printed on the certificate. That limit is
 * recorded plainly. What the form CAN do — and now does — is hold the
 * structured evidence the office assesses, instead of free text alone:
 * the main crop, the cultivated land area with its unit (the existing
 * land-unit list: শতক/একর/বর্গমিটার), and the holding number and
 * mouza where known. The free-text pair stays, because the certificate
 * prints it; the evidence is no longer free-text-only.
 * (c) Spelling: the service list says "কৃষি প্রত্যয়ন", the flow
 * heading says "কৃষি প্রত্যয়ন" — the same word in two য় forms
 * (decomposed য + ় vs precomposed U+09DF). The display source for
 * both surfaces is the web catalog (public-service-catalog.json,
 * which the list, the flow and the SEO data all read); its service-21
 * name used the precomposed form while the SEO text already used the
 * decomposed one. The catalog name is normalised to the decomposed
 * form. The captured reference catalog keeps the precomposed form as
 * pinned evidence (the A3 rule: reference-catalog JSONs are not
 * rewritten).
 */
const qaFix5AgricultureFields: readonly FieldDefinition[] = deepFreeze([
  {
    id: "farm_crop",
    type: "text",
    label: t("প্রধান ফসল", "Main crop"),
    constraints: { required: true, minLength: 2, maxLength: 200 },
    evidence: { status: "proposed" },
  },
  {
    id: "farm_land_area",
    type: "number",
    label: t("চাষের জমির পরিমাণ", "Cultivated land area"),
    constraints: { required: true, min: 0 },
    evidence: { status: "proposed" },
  },
  {
    id: "farm_land_unit",
    type: "select",
    label: t("জমির পরিমাপের একক", "Land area unit"),
    constraints: { required: true },
    options: selectChoices.land_unit,
    evidence: { status: "proposed" },
  },
  {
    id: "farm_holding_no",
    type: "text",
    label: t("জমির হোল্ডিং নম্বর", "Land holding number"),
    constraints: { required: false, maxLength: 100 },
    evidence: { status: "proposed" },
  },
  {
    id: "farm_mouza",
    type: "text",
    label: t("জমির মৌজা", "Land mouza"),
    constraints: { required: false, maxLength: 200 },
    evidence: { status: "proposed" },
  },
]);

/**
 * Service 22 (§3.22, §4 item 5): the guardian consent letter — the
 * service's key evidence, the only named upload in the catalogue with
 * format/size guidance — was an optional top-level attachment the
 * form advanced without, and the review never listed the field. This
 * is the §4 item 5 mechanism's second concrete build (after Form 16):
 * the dedicated upload is removed and folded into the
 * supporting-documents step, which now names the consent letter with
 * its accepted formats and size limit and requires at least one row
 * (minRows: 1; the row's description and file are already required).
 * The Form 16 limit is inherited honestly: a hand-crafted API payload
 * that omits the documents field entirely cannot be reached by
 * minRows, because an absent optional repeatable skips validation by
 * engine design and fixtures never fake upload handles (a top-level
 * attachment made required would break the synthetic-fixture builder
 * instead). In the real citizen path the row is seeded and cannot be
 * emptied past the engine's check. The pinned v3 keeps the dedicated
 * field, so the removal is recorded in qaFix5RemovedObserved.
 */
/**
 * Service 23 (§3.23, §4 items 6/9/11): four findings, one rebuild.
 * (a) The core evidence hid behind optional-looking checkboxes: the
 * profession pair behind "নিবন্ধন/সহায়ক তথ্য যুক্ত করুন" (optradio)
 * and the earner's name/relationship behind "অন্য ব্যক্তির আয়/পেশা"
 * (other_person). A citizen who ticked neither submitted an income
 * certificate with no profession and no named earner. §4 item 6
 * applies: both checkboxes are removed; the profession pair is always
 * visible and required, and the earner is chosen from a required
 * select (the Form 10 pattern) — `income_earner`, self or another
 * person — which gates the relation/name fields. The select keeps the
 * removed checkbox's observed name in its evidence fieldNames (the
 * same-data-captured-better precedent from Forms 17/18).
 * (b) The certificate's core figures were NOT required. Both the
 * amount and the amount in words are now required — overriding the
 * Phase-4 Finding B for service 23 only (service 29 keeps its
 * optional amounts; the Phase-4 suite is updated accordingly).
 * (c) The "another person's income" branch offered relationship
 * "নিজ" (self) — a contradiction. The relation list drops self and
 * takes the earner-appropriate closed list; its label is fixed from
 * "সম্পর্ক (কার পেশা?)" to "সম্পর্ক (কার আয়?)" (whose income).
 * (d) The review's checkbox rows ("নিবন্ধন/সহায়ক তথ্য যুক্ত করুন
 * হ্যাঁ") are moot: both checkboxes are gone (and both were already
 * in the review's controller suppression set).
 * The certificate template is NOT changed except for the subject
 * condition, which now also matches the new select
 * (income_earner === "other_person") while keeping the pinned
 * other_person fallback; it still computes the printed words from the
 * numeric amount, so income_info_amount_word is evidence, not print.
 */
const qaFix5EarnerRelationOptions: FieldDefinition["options"] = [
  option("spouse", "স্বামী/স্ত্রী", "Spouse"),
  option("child", "সন্তান", "Child"),
  option("parent", "পিতা/মাতা", "Parent"),
  option("sibling", "ভাই/বোন", "Sibling"),
  option("guardian", "অভিভাবক", "Guardian"),
  option("other", "অন্যান্য", "Other"),
];

/**
 * Service 24 (§3.24, §4 items 6/9/11): three findings.
 * (a) All six deceased-parent name/date fields were optional — an
 * orphan certificate could be submitted with no deceased parent
 * named. Template-first: the certificate already prints father-only,
 * mother-only and both-parents attestations from the names present,
 * so the form now asks WHICH parent died first, as a required select
 * (`orphan_deceased_parent`: father / mother / both), and gates each
 * parent's name pair + death date on it — required when visible.
 * The gating uses the engine's `any` predicate (first use in a
 * schema: visible when the select is that parent OR both). There is
 * no "neither" option by design: an orphan certificate with no
 * deceased parent is not an orphan certificate.
 * (b) The relationship select was the copied generic list — "নিজ"
 * and "স্বামী/স্ত্রী" are nonsensical for a guardian of an orphan,
 * and there was no চাচা/মামা/দাদা/নানা option, forcing "অন্যান্য".
 * It takes the shared guardian list (§4 item 9); the certificate's
 * RELATIONSHIP_LABELS gains the four new codes so the relation
 * prints as its label, never the raw code.
 * (c) The English name fields sat split after the documents group.
 * The whole identity block (deceased parents + guardian) now sits
 * BEFORE the documents group, pairs adjacent, Bangla first. Spelling:
 * "সহায়তার" was already normalised by QAFIX-01; "হওয়ার" is
 * normalised to "হওয়ার" here by relabelling the declaration field
 * (the published QAFIX-01 spelling table is not edited).
 * The template attestations need no logic change — they already
 * handle father-only / mother-only / both from the names present.
 */
function buildQaFix5Orphan(previous: FormSchema): FormSchema {
  const details = previous.sections.find(
    (section) => section.id === "service_details",
  );
  if (!details) throw new Error("Service 24 carries no service_details section.");
  const byId = new Map(details.fields.map((field) => [field.id, field]));
  const take = (id: string) => {
    const field = byId.get(id);
    if (!field) throw new Error(`Service 24 carries no ${id} field.`);
    return field;
  };
  const fatherWhen = {
    any: [
      { field: "orphan_deceased_parent", equals: "father" },
      { field: "orphan_deceased_parent", equals: "both" },
    ],
  };
  const motherWhen = {
    any: [
      { field: "orphan_deceased_parent", equals: "mother" },
      { field: "orphan_deceased_parent", equals: "both" },
    ],
  };
  const gated = (id: string, when: typeof fatherWhen) => ({
    ...take(id),
    visibleWhen: when,
    constraints: { ...take(id).constraints, required: true },
  });
  const deceasedParent: FieldDefinition = {
    id: "orphan_deceased_parent",
    type: "select",
    label: t("মৃত পিতা-মাতা", "Deceased parent"),
    constraints: { required: true },
    options: [
      option("father", "পিতা", "Father"),
      option("mother", "মাতা", "Mother"),
      option("both", "পিতা ও মাতা উভয়", "Both parents"),
    ],
    evidence: { status: "proposed" },
  };
  const reordered: readonly FieldDefinition[] = deepFreeze([
    take("guardian_or_support_details"),
    {
      ...take("orphanhood_declaration"),
      label: t("এতিম হওয়ার বিবরণ", "Orphanhood declaration"),
    },
    deceasedParent,
    gated("orphan_father_name_bn", fatherWhen),
    gated("orphan_father_name_en", fatherWhen),
    gated("orphan_father_death_date", fatherWhen),
    gated("orphan_mother_name_bn", motherWhen),
    gated("orphan_mother_name_en", motherWhen),
    gated("orphan_mother_death_date", motherWhen),
    take("orphan_guardian_name_bn"),
    take("orphan_guardian_name_en"),
    {
      ...take("orphan_guardian_relation"),
      options: qaFix5GuardianRelationOptions,
    },
    take("supporting_documents"),
  ]);
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-05) asks which parent died and requires that parent's name and death date, takes the guardian relation from the guardian list, and moves the deceased-parent and guardian blocks ahead of the documents group.`,
    },
    sections: previous.sections.map((section) =>
      section.id === "service_details"
        ? { ...section, fields: reordered }
        : section,
    ),
  });
}

function buildQaFix5AnnualIncome(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-05) removes both opt-in checkboxes: the profession pair and the income figures are always visible and required, and the earner is chosen from a required select (self or another person) that gates the earner's relation and name. The earner-relation list drops "self" and its label asks whose income it is.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      return {
        ...section,
        fields: section.fields.flatMap((field) => {
          if (
            field.id === "income_info_amount" ||
            field.id === "income_info_amount_word"
          )
            return [
              {
                ...field,
                constraints: { ...field.constraints, required: true },
              },
            ];
          if (field.id === "optradio") return [];
          if (field.id === "profession_bn" || field.id === "profession_en") {
            const { visibleWhen: _condition, ...alwaysVisible } = field;
            return [alwaysVisible];
          }
          if (field.id === "other_person")
            return [
              {
                id: "income_earner",
                type: "select",
                label: t("আয় কার?", "Whose income is this?"),
                constraints: { required: true },
                options: [
                  option("self", "নিজের", "My own"),
                  option("other_person", "অন্য ব্যক্তির", "Another person"),
                ],
                evidence: { status: "proposed", fieldNames: ["other_person"] },
              },
            ];
          if (field.id === "other_person_relation")
            return [
              {
                ...field,
                label: t("সম্পর্ক (কার আয়?)", "Relationship (whose income?)"),
                options: qaFix5EarnerRelationOptions,
                visibleWhen: { field: "income_earner", equals: "other_person" },
              },
            ];
          if (
            field.id === "other_person_name_bn" ||
            field.id === "other_person_name"
          )
            return [
              {
                ...field,
                visibleWhen: { field: "income_earner", equals: "other_person" },
              },
            ];
          return [field];
        }),
      };
    }),
  });
}

function buildQaFix5Unmarried(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-05) removes the dedicated guardian-consent-letter upload and folds it into the supporting-documents step, which now names the consent letter, its accepted formats and size limit, and requires at least one uploaded document.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      return {
        ...section,
        fields: section.fields
          .filter(
            (field) => field.id !== "application_parents_consent_letter",
          )
          .map((field) =>
            field.id === "supporting_documents"
              ? {
                  ...field,
                  description: t(
                    "অভিভাবকের সম্মতিপত্রের স্ক্যান কপি অবশ্যই আপলোড করুন (PDF, PNG বা JPEG; সর্বোচ্চ 2 MiB)।",
                    "A scanned copy of the guardian's consent letter must be uploaded here (PDF, PNG or JPEG; maximum 2 MiB).",
                  ),
                  constraints: { ...field.constraints, minRows: 1 },
                }
              : field,
          ),
      };
    }),
  });
}

function buildQaFix5Agriculture(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-05) makes the English activity description required, matching its Bangla half, and adds the structured farming evidence — main crop, cultivated land area with its unit, holding number and mouza — alongside the free-text pair the certificate prints.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      const fields = section.fields.flatMap((field) => {
        if (field.id === "farming_activity_en")
          return [
            {
              ...field,
              constraints: { ...field.constraints, required: true },
            },
          ];
        if (field.id === "farm_location")
          return [field, ...qaFix5AgricultureFields];
        return [field];
      });
      return { ...section, fields };
    }),
  });
}

/** QAFIX-05: publish the repair version of a service's current schema. */
export function buildQaFix5Version(previous: FormSchema): FormSchema {
  switch (previous.serviceNo) {
    case 19:
      return buildQaFix5GuardianConsent(previous);
    case 20:
      return buildQaFix5FreedomFighter(previous);
    case 21:
      return buildQaFix5Agriculture(previous);
    case 22:
      return buildQaFix5Unmarried(previous);
    case 23:
      return buildQaFix5AnnualIncome(previous);
    case 24:
      return buildQaFix5Orphan(previous);
    default:
      throw new RangeError(
        `Service ${previous.serviceNo} has no QAFIX-05 version.`,
      );
  }
}

/* ---------- QAFIX-06: services 25–30 (Workstream F) ----------
 * The same live QA (§3 services 25–30, §4 items 5/6/9/11) found the
 * next set: a married attestation that can be submitted without
 * naming the spouse (25); a dowry-free attestation that is a verbatim
 * copy of it, with no dowry content at all (26, BLOCKER); a passport
 * letter whose purpose is free text asked alongside the application
 * purpose (27); a living-person attestation whose only witness fact
 * is one free-text box (28); a monthly-income certificate whose
 * income amount itself is optional (29, BLOCKER); and a solvency
 * certificate resting on two self-declared totals with no breakdown,
 * no income and no evidence (30). Services are repaired one at a time
 * below; the list grows as each lands. Same publication rule: a NEW
 * version per repaired service; the previous version stays pinned. */

/** Services whose next version carries the QAFIX-06 repairs. */
export const qaFix6Services: readonly number[] = deepFreeze([25, 26, 27, 28, 29, 30]);

/**
 * Services 25/26 (§3.25, §3.26, §4 items 5/6/11): the shared marriage
 * repair. Template-first check (certificate-template-v7, marriageBody,
 * mirrored in pdf-react): the certificate prints the spouse block from
 * the payload — name (BN/EN), father's name (BN/EN), mother's name
 * (BN/EN), address (BN/EN), date of birth and NID — so every printed
 * spouse fact that the form left optional could reach the chairman
 * blank. The repair:
 * (a) the spouse's name pair, both parents' name pairs and the
 *     address pair become required (the issuance gate's
 *     LANGUAGE_PAIRS already demands both halves of the parents' and
 *     address pairs in official mode; the name pair joins them);
 * (b) the spouse age class drops "minor" — a spouse on a marriage
 *     attestation is an adult; the class stays as the adult marker
 *     the observed form carried;
 * (c) the parents'/address pairs move ahead of the documents step so
 *     the whole spouse block reads in Bangla-first pairs (the live QA
 *     found them parked after the documents group);
 * (d) the documents step names the Kabin Nama (marriage certificate)
 *     and requires at least one uploaded document (§4 item 5, the
 *     Form 16/22 mechanism).
 * The spouse NID stays optional: it is an alternative identifier,
 * printed when present (the Form 20 precedent for alternative
 * identifiers).
 */
const qaFix6MarriageRequired: readonly string[] = [
  "marriage_info_spouse_name_bn",
  "marriage_info_spouse_name",
  "marriage_info_spouse_father_name_bn",
  "marriage_info_spouse_father_name_en",
  "marriage_info_spouse_mother_name_bn",
  "marriage_info_spouse_mother_name_en",
  "marriage_info_spouse_address_bn",
  "marriage_info_spouse_address_en",
];

const qaFix6MarriageOrder: readonly string[] = [
  "marriage_info_spouse_name_bn",
  "marriage_info_spouse_name",
  "marriage_info_spouse_age_flag",
  "marriage_info_spouse_nid",
  "marriage_info_spouse_dob",
  "marriage_info_spouse_father_name_bn",
  "marriage_info_spouse_father_name_en",
  "marriage_info_spouse_mother_name_bn",
  "marriage_info_spouse_mother_name_en",
  "marriage_info_spouse_address_bn",
  "marriage_info_spouse_address_en",
  "marriage_info_spouse_place_bn",
  "marriage_info_spouse_place",
  "marriage_info_date",
  "supporting_documents",
];

function qaFix6MarriageSections(
  previous: FormSchema,
): FormSchema["sections"] {
  return previous.sections.map((section) => {
    if (section.id !== "service_details") return section;
    const byId = new Map(section.fields.map((field) => [field.id, field]));
    const take = (id: string) => {
      const field = byId.get(id);
      if (!field)
        throw new Error(`Service ${previous.serviceNo} carries no ${id} field.`);
      return field;
    };
    const repair = (field: FieldDefinition): FieldDefinition => {
      if (qaFix6MarriageRequired.includes(field.id))
        return {
          ...field,
          constraints: { ...field.constraints, required: true },
        };
      if (field.id === "marriage_info_spouse_age_flag")
        return {
          ...field,
          options: field.options?.filter((opt) => opt.value !== "minor"),
        };
      if (field.id === "supporting_documents")
        return {
          ...field,
          description: t(
            "কাবিন নামার (বিবাহ সনদের) স্ক্যান কপি অবশ্যই আপলোড করুন (PDF, PNG বা JPEG; সর্বোচ্চ 2 MiB)।",
            "A scanned copy of the Kabin Nama (marriage certificate) must be uploaded here (PDF, PNG or JPEG; maximum 2 MiB).",
          ),
          constraints: { ...field.constraints, minRows: 1 },
        };
      return field;
    };
    const ordered = qaFix6MarriageOrder.map((id) => repair(take(id)));
    const rest = section.fields.filter(
      (field) => !qaFix6MarriageOrder.includes(field.id),
    );
    return { ...section, fields: [...ordered, ...rest.map(repair)] };
  });
}

/**
 * Service 25 (§3.25): the married attestation takes the shared
 * marriage repair — nothing service-specific remains.
 */
function buildQaFix6Married(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-06) requires the spouse's name, both parents' names and the spouse's address — the facts the certificate prints — seats the whole spouse block ahead of the documents step in Bangla-first pairs, drops the "minor" spouse age class, and makes the documents step name the Kabin Nama (marriage certificate) and require at least one uploaded document.`,
    },
    sections: qaFix6MarriageSections(previous),
  });
}

/**
 * Service 26 (§3.26, BLOCKER): the dowry-free attestation was a
 * verbatim copy of service 25 — no dowry content at all. It takes the
 * whole shared marriage repair and then gains the dowry-specific
 * capture the finding demands. Template-first check: the certificate
 * prints the dowry sentence as FIXED text keyed by service number
 * ("…no dowry (যৌতুক) was exchanged in this marriage." /
 * "…এই বিবাহে কোনো যৌতুক লেনদেন হয়নি।") — the template carries NO
 * payload slot for a declaration or for witnesses, so the declaration
 * and the witness rows are office evidence behind that fixed sentence
 * (the limit is recorded in the version's evidence note):
 * (a) a mandatory dowry declaration — the applicant must actively
 *     confirm that no dowry was given or received (mustBeTrue);
 * (b) a witness structure — at least two witnesses, each with a
 *     Bangla name, an English name and an NID number.
 */
const qaFix6DowryDeclaration: FieldDefinition = {
  id: "dowry_free_declaration",
  type: "checkbox",
  label: t(
    "আমরা ঘোষণা করছি যে এই বিবাহে কোনো যৌতুক দেওয়া বা নেওয়া হয়নি।",
    "We declare that no dowry was given or received in this marriage.",
  ),
  constraints: { required: true, mustBeTrue: true },
  evidence: { status: "proposed", fieldNames: ["dowry_free_declaration"] },
};

const qaFix6DowryWitnesses: FieldDefinition = {
  id: "dowry_witnesses",
  type: "repeatable",
  label: t("সাক্ষীগণ", "Witnesses"),
  description: t(
    "বিবাহের অন্তত দুইজন সাক্ষীর নাম ও জাতীয় পরিচয়পত্র নম্বর দিন।",
    "Give the names and national identity numbers of at least two witnesses to the marriage.",
  ),
  constraints: { required: true, minRows: 2, maxRows: 5 },
  evidence: { status: "proposed", fieldNames: ["dowry_witnesses"] },
  children: [
    proposedText(
      "witness_name_bn",
      "সাক্ষীর নাম (বাংলা)",
      "Witness name (Bangla)",
    ),
    proposedText(
      "witness_name_en",
      "সাক্ষীর নাম (ইংরেজি)",
      "Witness name (English)",
    ),
    proposedText(
      "witness_nid",
      "সাক্ষীর জাতীয় পরিচয়পত্র নম্বর",
      "Witness NID number",
      true,
      30,
    ),
  ],
};

function buildQaFix6DowryFree(previous: FormSchema): FormSchema {
  const married = buildQaFix6Married(previous);
  return deepFreeze({
    ...married,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-06) takes the shared marriage repair (required spouse facts, Bangla-first pairs, no "minor" spouse class, named Kabin Nama evidence) and adds the dowry-specific capture this service exists for: a mandatory declaration that no dowry was given or received, and at least two witnesses with names and NID numbers. The certificate prints the dowry sentence as fixed text keyed by service number and carries no slot for the declaration or the witnesses, so both are office evidence behind that sentence.`,
    },
    sections: married.sections.map((section) =>
      section.id === "service_details"
        ? {
            ...section,
            fields: [
              ...section.fields,
              qaFix6DowryDeclaration,
              qaFix6DowryWitnesses,
            ],
          }
        : section,
    ),
  });
}

/**
 * Service 27 (§3.27, §4 item 9): the passport recommendation letter.
 * Template-first check (certificate-template-v7, the service-27
 * letter body, mirrored in pdf-react): the letter prints the
 * applicant's identity — name, father's name, NID / birth
 * registration, date of birth — and the permanent and present
 * addresses from the CITIZEN RECORD (input.identity / the profile),
 * and from the payload it prints only the passport purpose, through
 * `passportPurposeLabel`. Two consequences:
 * (a) no identity field is added — the letter has no payload slot
 *     for one; identity arrives by the prefill engine from the
 *     citizen record (the Form 15 precedent). Recorded as a limit.
 * (b) the free-text purpose becomes a FIXED SELECT whose values the
 *     letter's label map now carries in both languages (the map
 *     keeps every legacy issuance phrase, so pinned payloads render
 *     exactly as before). The standard purpose in the application
 *     context is a different question — why the citizen is applying
 *     to this office at all — and stays; what ends is the second,
 *     free-text purpose the chairman could not rely on.
 */
const qaFix6PassportPurposeOptions: NonNullable<FieldDefinition["options"]> = [
  option("travel", "ভ্রমণ", "Travel"),
  option("employment", "বিদেশে কর্মসংস্থান", "Employment abroad"),
  option("hajj", "হজ্জ", "Hajj"),
  option("umrah", "ওমরাহ", "Umrah"),
  option("study", "শিক্ষা", "Study"),
  option("treatment", "চিকিৎসা", "Medical treatment"),
  option("business", "ব্যবসা", "Business"),
  option("other", "অন্যান্য", "Other"),
];

function buildQaFix6Passport(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-06) makes the passport purpose a fixed select (travel, employment, Hajj, Umrah, study, treatment, business, other) whose values the recommendation letter's label map renders in both languages, replacing the free-text purpose. The letter takes the applicant's identity and addresses from the citizen record and carries no payload slot for them, so no identity field is added.`,
    },
    sections: previous.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) =>
        field.id === "passport_purpose"
          ? {
              ...field,
              type: "select" as const,
              options: qaFix6PassportPurposeOptions,
              evidence: {
                status: "proposed" as const,
                fieldNames: ["passport_purpose"],
              },
            }
          : field,
      ),
    })),
  });
}

/**
 * Service 28 (§3.28): the living-person attestation. Template-first
 * check (certificate-template-v7 ATTESTATIONS[28], mirrored in
 * pdf-react): the certificate prints only the appearance date inside
 * fixed sentences — the witness is never printed, so the witness
 * capture is office evidence for the appearance the certificate
 * attests. The repair:
 * (a) the single free-text witness box becomes a structured witness:
 *     Bangla name, English name and NID number, all required (the
 *     box was a proposed, never-observed field, so it is replaced,
 *     not renamed);
 * (b) the appearance date gains guidance — the applicant appears in
 *     person at the office with the witness — and the engine's new
 *     `notFuture` constraint: an appearance cannot be recorded for a
 *     date that has not happened yet (Asia/Dhaka calendar date).
 */
function buildQaFix6LivingPerson(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-06) replaces the free-text witness box with a structured witness (Bangla name, English name and NID number, all required) and bars a future appearance date. The certificate prints only the appearance date, so the witness facts are office evidence for the appearance it attests.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      const fields: FieldDefinition[] = [];
      for (const field of section.fields) {
        if (field.id === "witness_details") continue;
        if (field.id === "appearance_date") {
          fields.push({
            ...field,
            description: t(
              "আবেদনকারীকে সাক্ষীসহ ইউনিয়ন পরিষদ কার্যালয়ে সশরীরে উপস্থিত হতে হবে; উপস্থিতির তারিখ আজ বা পূর্বের হতে হবে।",
              "The applicant must appear in person at the Union Parishad office together with the witness; the appearance date must be today or earlier.",
            ),
            constraints: { ...field.constraints, notFuture: true },
          });
          fields.push(
            proposedText(
              "witness_name_bn",
              "সাক্ষীর নাম (বাংলা)",
              "Witness name (Bangla)",
            ),
            proposedText(
              "witness_name_en",
              "সাক্ষীর নাম (ইংরেজি)",
              "Witness name (English)",
            ),
            proposedText(
              "witness_nid",
              "সাক্ষীর জাতীয় পরিচয়পত্র নম্বর",
              "Witness NID number",
              true,
              30,
            ),
          );
          continue;
        }
        fields.push(field);
      }
      return { ...section, fields };
    }),
  });
}

/**
 * Service 29 (§3.29, BLOCKER; §4 items 6/9): the monthly-income
 * certificate, repaired exactly as service 23 was in QAFIX-05, plus
 * the one capture 23 did not need. Template-first check
 * (certificate-template-v7 ATTESTATIONS[29], mirrored in pdf-react):
 * the attestation switches its subject on the earner, prints the
 * monthly amount in figures and generated words, and prints the
 * profession pair. The findings:
 * (a) the income amount itself (and its words field) was OPTIONAL —
 *     the certificate's central fact could be left blank; both
 *     become required (the range 0–1,000,000,000 is unchanged);
 * (b) the profession pair hid behind the `optradio` checkbox — whose
 *     label ("Include registration or supporting information") never
 *     described it — and the other-person block hid behind the
 *     `other_person` checkbox. Both checkboxes go (§4 item 6): the
 *     profession pair is always visible, and the earner is chosen
 *     from the required `income_earner` select (self / another
 *     person), which carries the observed `other_person` name in its
 *     evidence and gates the relation and name fields;
 * (c) the relation select offered "self" (নিজ) and its label asked
 *     whose OCCUPATION it was; it now takes the earner-relation list
 *     (no "self") and asks whose INCOME it is;
 * (d) NEW for 29: the other-person block captures THAT person's
 *     monthly amount (`other_person_income_amount`) — until now the
 *     certificate printed the applicant's amount against the other
 *     person's name. The template now resolves the amount the same
 *     way (other-person amount when present, else the shared one),
 *     and its subject condition also matches the new select while
 *     keeping the pinned `other_person` fallback.
 */
function buildQaFix6MonthlyIncome(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-06) requires the monthly income amount itself, removes both opt-in checkboxes (the profession pair is always visible; the earner is chosen from a required select that gates the other person's relation, name and monthly amount), drops "self" from the relation list, and asks whose income — not whose occupation — the relation describes.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      return {
        ...section,
        fields: section.fields.flatMap((field) => {
          if (
            field.id === "income_info_amount" ||
            field.id === "income_info_amount_word"
          )
            return [
              {
                ...field,
                constraints: { ...field.constraints, required: true },
              },
            ];
          if (field.id === "optradio") return [];
          if (field.id === "profession_bn" || field.id === "profession_en") {
            const { visibleWhen: _condition, ...alwaysVisible } = field;
            return [alwaysVisible];
          }
          if (field.id === "other_person")
            return [
              {
                id: "income_earner",
                type: "select",
                label: t("আয় কার?", "Whose income is this?"),
                constraints: { required: true },
                options: [
                  option("self", "নিজের", "My own"),
                  option("other_person", "অন্য ব্যক্তির", "Another person"),
                ],
                evidence: { status: "proposed", fieldNames: ["other_person"] },
              },
            ];
          if (field.id === "other_person_relation")
            return [
              {
                ...field,
                label: t("সম্পর্ক (কার আয়?)", "Relationship (whose income?)"),
                options: qaFix5EarnerRelationOptions,
                visibleWhen: { field: "income_earner", equals: "other_person" },
              },
            ];
          if (field.id === "other_person_name_bn")
            return [
              {
                ...field,
                visibleWhen: { field: "income_earner", equals: "other_person" },
              },
            ];
          if (field.id === "other_person_name")
            return [
              {
                ...field,
                visibleWhen: { field: "income_earner", equals: "other_person" },
              },
              {
                id: "other_person_income_amount",
                type: "number",
                label: t(
                  "অন্য ব্যক্তির মাসিক আয় (টাকা)",
                  "Other person's monthly income (BDT)",
                ),
                constraints: {
                  required: true,
                  min: 0,
                  max: 1_000_000_000,
                },
                visibleWhen: { field: "income_earner", equals: "other_person" },
                evidence: { status: "proposed" },
              },
            ];
          return [field];
        }),
      };
    }),
  });
}

/**
 * Service 30 (§3.30, §4 items 5/11): the financial solvency
 * certificate. Template-first check (certificate-template-v7
 * ATTESTATIONS[30], mirrored in pdf-react): the certificate prints
 * the two declared totals and the solvency basis (BN/EN) — nothing
 * else — so the breakdown below is the office evidence the chairman
 * judges those totals against; printing it would need a template
 * change (recorded as the limit). The repair:
 * (a) the solvency rested on two self-declared totals; the form now
 *     breaks them down — land and buildings, bank deposits,
 *     business and other assets, loans and other liabilities — and
 *     captures the monthly income, every figure required and
 *     allowed to be zero;
 * (b) the documents step names the evidence (bank statement and
 *     asset documents) and requires at least one upload (§4 item 5);
 * (c) the English basis was optional while its Bangla half was
 *     required; the pair is aligned (§4 item 11) — the issuance
 *     gate's LANGUAGE_PAIRS already demands both halves in
 *     official mode.
 */
function buildQaFix6FinancialSolvency(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-06) breaks the declared totals into land and buildings, bank deposits, business and other assets, and loans and other liabilities, captures the monthly income, requires the English solvency basis alongside its Bangla half, and makes the documents step name the bank statement and asset documents and require at least one upload. The certificate prints only the two totals and the basis, so the breakdown and the income are office evidence.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      return {
        ...section,
        fields: section.fields.flatMap((field) => {
          if (field.id === "declared_liabilities_bdt")
            return [
              field,
              proposedNumber(
                "asset_land_building_bdt",
                "জমি ও ভবনের মূল্য (টাকা)",
                "Land and buildings value (BDT)",
              ),
              proposedNumber(
                "asset_bank_bdt",
                "ব্যাংক জমার পরিমাণ (টাকা)",
                "Bank deposits (BDT)",
              ),
              proposedNumber(
                "asset_business_other_bdt",
                "ব্যবসা ও অন্যান্য সম্পদ (টাকা)",
                "Business and other assets (BDT)",
              ),
              proposedNumber(
                "liability_loans_bdt",
                "ঋণ ও অন্যান্য দায় (টাকা)",
                "Loans and other liabilities (BDT)",
              ),
              proposedNumber(
                "monthly_income_bdt",
                "মাসিক আয় (টাকা)",
                "Monthly income (BDT)",
              ),
            ];
          if (field.id === "financial_basis_en")
            return [
              {
                ...field,
                constraints: { ...field.constraints, required: true },
              },
            ];
          if (field.id === "supporting_documents")
            return [
              {
                ...field,
                description: t(
                  "ব্যাংক বিবরণী ও সম্পদের নথির স্ক্যান কপি আপলোড করুন (PDF, PNG বা JPEG; সর্বোচ্চ 2 MiB)।",
                  "Upload scanned copies of your bank statement and asset documents (PDF, PNG or JPEG; maximum 2 MiB).",
                ),
                constraints: { ...field.constraints, minRows: 1 },
              },
            ];
          return [field];
        }),
      };
    }),
  });
}

/** QAFIX-06: publish the repair version of a service's current schema. */
export function buildQaFix6Version(previous: FormSchema): FormSchema {
  switch (previous.serviceNo) {
    case 25:
      return buildQaFix6Married(previous);
    case 26:
      return buildQaFix6DowryFree(previous);
    case 27:
      return buildQaFix6Passport(previous);
    case 28:
      return buildQaFix6LivingPerson(previous);
    case 29:
      return buildQaFix6MonthlyIncome(previous);
    case 30:
      return buildQaFix6FinancialSolvency(previous);
    default:
      throw new RangeError(
        `Service ${previous.serviceNo} has no QAFIX-06 version.`,
      );
  }
}

/* ---------- QAFIX-07: services 31–36 (Workstream G) ----------
 * The same live QA (§3 services 31–36, §4 items 5/6/8/9/11) found the
 * next set: a death-while-unmarried certificate whose date of death
 * hides behind the opt-in toggle and whose relationship list offers
 * "self" and "spouse" for a person who died unmarried (31, BLOCKER);
 * a hardship certificate resting on one income number and free text,
 * with no family size and no earner's name (32); an NID-correction
 * attestation that never asks the NID number and offers only two
 * record types (33); a childless attestation that is a single
 * free-text paragraph (34); a character certificate whose marital
 * status hides behind an opt-in checkbox and which asks nothing
 * character-related (35); and a generic NOC carrying a fully required
 * land/business block with no field for what the NOC is for (36,
 * BLOCKER). Services are repaired one at a time below; the list grows
 * as each lands. Same publication rule: a NEW version per repaired
 * service; the previous version stays pinned. */

/** Services whose next version carries the QAFIX-07 repairs. */
export const qaFix7Services: readonly number[] = deepFreeze([31, 32, 33, 34, 35, 36]);

/**
 * §4 item 8 — context-correct relationship lists: the applicant's
 * relationship TO a deceased person (service 31). The copied generic
 * list offered "নিজ" (self — nobody applies for their own death
 * certificate) and "স্বামী/স্ত্রী" (spouse — impossible for a person
 * who died unmarried). The certificate renders the chosen value from
 * the schema's own option labels (certificate-template-v7,
 * deceasedParagraph via selectLabel), so the schema list is the
 * printed list.
 */
const qaFix7DeceasedRelationOptions: FieldDefinition["options"] = [
  option("parent", "পিতা/মাতা", "Parent"),
  option("child", "সন্তান", "Child"),
  option("sibling", "ভাই/বোন", "Sibling"),
  option("grandparent", "দাদা/দাদি/নানা/নানি", "Grandparent"),
  option("uncle", "চাচা/মামা", "Uncle"),
  option("aunt", "চাচি/মামি/খালা", "Aunt"),
  option("guardian", "অভিভাবক", "Guardian"),
  option("other", "অন্যান্য", "Other"),
];

/** Service 31's identity labels name the deceased (§3.31). */
const qaFix7DeceasedLabels: Readonly<Record<string, LocalizedText>> = {
  dead_info_name_bn: t("মৃত ব্যক্তির নাম (বাংলা)", "Deceased's name (Bangla)"),
  dead_info_name: t("মৃত ব্যক্তির নাম (ইংরেজি)", "Deceased's name (English)"),
  dead_info_father_name_bn: t(
    "মৃত ব্যক্তির পিতার নাম (বাংলা)",
    "Deceased's father's name (Bangla)",
  ),
  dead_info_father_name: t(
    "মৃত ব্যক্তির পিতার নাম (ইংরেজি)",
    "Deceased's father's name (English)",
  ),
  dead_info_mother_name_bn: t(
    "মৃত ব্যক্তির মাতার নাম (বাংলা)",
    "Deceased's mother's name (Bangla)",
  ),
  dead_info_mother_name: t(
    "মৃত ব্যক্তির মাতার নাম (ইংরেজি)",
    "Deceased's mother's name (English)",
  ),
  dead_info_place_bn: t("মৃত্যুর স্থান (বাংলা)", "Place of death (Bangla)"),
  dead_info_place: t("মৃত্যুর স্থান (ইংরেজি)", "Place of death (English)"),
  dead_info_reason_bn: t("মৃত্যুর কারণ (বাংলা)", "Cause of death (Bangla)"),
  dead_info_reason: t("মৃত্যুর কারণ (ইংরেজি)", "Cause of death (English)"),
};

/**
 * Service 31 (§3.31, BLOCKER; §4 items 6/8): the death-while-unmarried
 * certificate shares the dead_info_* chassis with service 7, and takes
 * the same §4 item 6 repair QAFIX-03 gave service 7, plus its own
 * findings. Template-first check (certificate-template-v7,
 * deceasedParagraph): the certificate prints the deceased's name,
 * father's name and mother's name, the date of death, the place and
 * cause, the death registration number when present, and the
 * applicant's relation to the deceased from this schema's labels.
 * (a) The date of death — the core datum — was conditioned on the
 *     opt-in toggle `optradio`; it is now always visible and required.
 *     The toggle keeps governing only the genuinely optional extras
 *     (registration reference, religion), exactly as on service 7.
 * (b) The relationship select offered "self" and "spouse"; it now
 *     carries the deceased-appropriate closed list above, and its
 *     label names the deceased (the QAFIX-03 label).
 * (c) The name/father/mother labels never said WHOSE they were; they
 *     now name the deceased, as do the place/reason labels (the
 *     template prints them as place and cause OF DEATH).
 * The registration number STAYS optional (recorded decision): it
 * prints when present, but an unregistered death is one of the cases
 * this certificate exists for — requiring the number would block
 * exactly those applications (the service 7 precedent, QAFIX-03).
 * Age at death is NOT added: the shared deceased paragraph has no
 * slot for it, so the form cannot carry it to the certificate.
 */
function buildQaFix7DeathWhileUnmarried(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-07) makes the date of death always visible (core evidence is never hidden behind the opt-in toggle), replaces the copied relationship list — which offered "self" and "spouse" for a person who died unmarried — with a deceased-appropriate closed list, and names the deceased in the identity, place and cause labels. The death registration number stays optional: it prints when present, but an unregistered death is one of the cases this certificate exists for.`,
    },
    sections: previous.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        if (field.id === "dead_info_dod") {
          const { visibleWhen: _condition, ...alwaysVisible } = field;
          return alwaysVisible;
        }
        if (field.id === "dead_info_relation")
          return {
            ...field,
            label: t(
              "মৃত ব্যক্তির সাথে সম্পর্ক",
              "Relationship with the deceased",
            ),
            options: qaFix7DeceasedRelationOptions,
          };
        const label = qaFix7DeceasedLabels[field.id];
        return label ? { ...field, label } : field;
      }),
    })),
  });
}

/**
 * Service 32 (§3.32; §4 items 5/11): the financial-hardship
 * certificate rested on ONE self-declared income number and a
 * free-text hardship description — the form never asked how many
 * people that income feeds, and the certificate attests an
 * occupation (`earner_occupation_bn` is printed by
 * certificate-template-v7, ATTESTATIONS[32]) without ever asking
 * WHOSE occupation it is. Template-first check: the certificate
 * prints the monthly household income and the earner's Bangla
 * occupation only; the family size, the dependant count and the
 * earner's name are office evidence behind those two printed facts
 * (the Form 30 pattern). Repairs:
 * (a) `household_member_count` (required, 1–100) and
 *     `dependant_count` (required, 0–100) join the income in
 *     service_details, so the chairman can judge the income against
 *     the household it supports;
 * (b) the earner's NAME pair (`earner_name_bn` / `earner_name`,
 *     BN-first, both required — §4 item 11) is seated directly
 *     before the occupation pair (which lives at the end of
 *     service_details on this form), so the printed occupation has
 *     a named owner. The occupation pair itself stays optional in
 *     both halves (aligned): an earning person may have no formal
 *     occupation to name, but the office must always know who the
 *     earner is. The name is NOT prefilled from the citizen record —
 *     the earner is not necessarily the applicant, and a wrong
 *     prefilled name would land on an attestation;
 * (c) the documents step names the evidence (income proof and
 *     hardship evidence) and demands ≥1 row (§4 item 5 mechanism).
 */
function buildQaFix7FinancialHardship(previous: FormSchema): FormSchema {
  const householdMemberCount: FieldDefinition = {
    id: "household_member_count",
    type: "number",
    label: t("পরিবারের সদস্য সংখ্যা", "Household members (family size)"),
    constraints: { required: true, min: 1, max: 100 },
  };
  const dependantCount: FieldDefinition = {
    id: "dependant_count",
    type: "number",
    label: t("নির্ভরশীল সদস্য সংখ্যা", "Dependant members"),
    constraints: { required: true, min: 0, max: 100 },
  };
  const earnerNameBn: FieldDefinition = {
    id: "earner_name_bn",
    type: "text",
    label: t("উপার্জনকারীর নাম (বাংলা)", "Earner's name (Bangla)"),
    constraints: { required: true, maxLength: 160 },
  };
  const earnerNameEn: FieldDefinition = {
    id: "earner_name",
    type: "text",
    label: t("উপার্জনকারীর নাম (ইংরেজি)", "Earner's name (English)"),
    constraints: { required: true, maxLength: 160 },
  };
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-07) seats the household size and dependant count beside the declared income, names the earning person (Bangla and English) ahead of the occupation the certificate attests, and makes the documents step name the income and hardship evidence and require at least one upload. The certificate prints only the income and the earner's occupation, so the household figures and the earner's name are office evidence.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      return {
        ...section,
        fields: section.fields.flatMap((field) => {
          if (field.id === "monthly_household_income_bdt")
            return [field, householdMemberCount, dependantCount];
          if (field.id === "earner_occupation_bn")
            return [earnerNameBn, earnerNameEn, field];
          if (field.id === "supporting_documents")
            return [
              {
                ...field,
                description: t(
                  "আয়ের প্রমাণ (বেতন রশিদ বা নিয়োগকর্তার প্রত্যয়ন) ও আর্থিক দুরবস্থার প্রমাণের স্ক্যান কপি আপলোড করুন (PDF, PNG বা JPEG; সর্বোচ্চ 2 MiB)।",
                  "Upload scanned copies of income proof (a pay slip or an employer's letter) and evidence of the financial hardship (PDF, PNG or JPEG; maximum 2 MiB).",
                ),
                constraints: { ...field.constraints, minRows: 1 },
              },
            ];
          return [field];
        }),
      };
    }),
  });
}

/**
 * §4 item 9 — the realistic record set for service 33's correction
 * type. The form shipped with two values (the NID card and "voter
 * information"); a correction attestation is routinely issued
 * against the birth registration record or a passport as well. The
 * value does not print (the certificate prints the corrections
 * table only), so the list is office classification — widening it
 * cannot disturb the printed certificate.
 */
const qaFix7CorrectionTypeOptions: FieldDefinition["options"] = [
  option("nid", "জাতীয় পরিচয়পত্র (এনআইডি)", "National ID card"),
  option("voter", "ভোটার তালিকা", "Voter roll entry"),
  option(
    "birth_certificate",
    "জন্ম নিবন্ধন সনদ",
    "Birth registration certificate",
  ),
  option("passport", "পাসপোর্ট", "Passport"),
  option("other", "অন্যান্য", "Other"),
];

/**
 * Service 33 (§3.33; §4 items 5/9): an NID-correction attestation
 * that never asked the NID number, and whose record-type select
 * offered only two values. Template-first check
 * (certificate-template-v7, the service-33 special case): the
 * certificate prints the identity from the citizen record and the
 * corrections table (category labels from this schema, incorrect →
 * correct values) — neither `correction_type` nor an NID number
 * has a printed slot, so both are office evidence: the office
 * cannot process a correction without knowing WHICH record and
 * WHICH number it concerns. Repairs:
 * (a) `nid_number` (required text, 10–17 characters — the live NID
 *     formats) heads service_details. No digit pattern: the engine's
 *     synthetic/demo payloads do not honour patterns, and the
 *     office verifies the number against the uploaded evidence;
 * (b) `correction_type` widens to the realistic record set above
 *     (the two shipped values keep their meaning);
 * (c) the documents step names the proof of the correct
 *     information and demands ≥1 row (§4 item 5 mechanism).
 * The corrections repeatable itself — the best-structured
 * component in the batch — is untouched.
 */
function buildQaFix7NidCorrection(previous: FormSchema): FormSchema {
  const nidNumber: FieldDefinition = {
    id: "nid_number",
    type: "text",
    label: t("জাতীয় পরিচয়পত্র (এনআইডি) নম্বর", "National ID (NID) number"),
    constraints: { required: true, minLength: 10, maxLength: 17 },
  };
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-07) captures the National ID number the correction concerns, widens the record-type select beyond the NID card and voter information to the birth registration certificate and passport, and makes the documents step name the proof of the correct information and require at least one upload. The certificate prints the corrections table and the citizen-record identity only, so the number and the record type are office evidence.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      return {
        ...section,
        fields: [
          nidNumber,
          ...section.fields.map((field) => {
            if (field.id === "correction_type")
              return { ...field, options: qaFix7CorrectionTypeOptions };
            if (field.id === "supporting_documents")
              return {
                ...field,
                description: t(
                  "সঠিক তথ্যের প্রমাণের (জন্ম নিবন্ধন সনদ, পাসপোর্ট বা শিক্ষাগত সনদ) স্ক্যান কপি আপলোড করুন (PDF, PNG বা JPEG; সর্বোচ্চ 2 MiB)।",
                  "Upload scanned copies of proof of the correct information (birth registration certificate, passport or academic certificate) (PDF, PNG or JPEG; maximum 2 MiB).",
                ),
                constraints: { ...field.constraints, minRows: 1 },
              };
            return field;
          }),
        ],
      };
    }),
  });
}

/**
 * Service 34 (§3.34; §4 item 5): the childless attestation was ONE
 * free-text paragraph — the citizen composed the very sentence the
 * office is supposed to attest, and no structured fact (which
 * spouse, married when) was captured at all. Template-first check
 * (certificate-template-v7): ATTESTATIONS[34] is a fixed sentence
 * and the spouse sentence is built from the CITIZEN RECORD
 * (spouseSentence) — no payload field prints, so everything below
 * is office evidence behind that fixed attestation (the Form 30
 * pattern). Repairs:
 * (a) the spouse's NAME pair (`childless_spouse_name_bn` /
 *     `childless_spouse_name`, BN-first, both required) — wired to
 *     the profile prefill engine in ServiceFlow
 *     (CITIZEN_FIELD_SOURCES), since the spouse here IS the
 *     applicant's own spouse;
 * (b) `childless_marriage_date` (required, never in the future —
 *     the engine's `notFuture` constraint, QAFIX-06);
 * (c) the free-text paragraph is replaced by a FIXED declaration
 *     checkbox (`childless_declaration_confirmed`, mustBeTrue):
 *     the citizen confirms the office's words instead of composing
 *     their own;
 * (d) the documents step names the marriage proof (Kabin Nama or
 *     marriage registration certificate) and demands ≥1 row
 *     (§4 item 5 mechanism).
 */
function buildQaFix7Childless(previous: FormSchema): FormSchema {
  const structured: readonly FieldDefinition[] = [
    {
      id: "childless_spouse_name_bn",
      type: "text",
      label: t("স্বামীর/স্ত্রীর নাম (বাংলা)", "Spouse's name (Bangla)"),
      constraints: { required: true, maxLength: 160 },
    },
    {
      id: "childless_spouse_name",
      type: "text",
      label: t("স্বামীর/স্ত্রীর নাম (ইংরেজি)", "Spouse's name (English)"),
      constraints: { required: true, maxLength: 160 },
    },
    {
      id: "childless_marriage_date",
      type: "date",
      label: t("বিবাহের তারিখ", "Marriage date"),
      constraints: { required: true, notFuture: true },
    },
    {
      id: "childless_declaration_confirmed",
      type: "checkbox",
      label: t(
        "আমি ঘোষণা করছি যে, আমাদের কোনো সন্তান নেই।",
        "I declare that we have no children.",
      ),
      constraints: { required: true, mustBeTrue: true },
    },
  ];
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-07) replaces the single free-text declaration paragraph with the spouse's name pair, the marriage date and a fixed no-children declaration the citizen confirms, and makes the documents step name the marriage proof and require at least one upload. The certificate's attestation is a fixed sentence with the spouse taken from the citizen record, so the structured facts are office evidence.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      return {
        ...section,
        fields: [
          ...structured,
          ...section.fields
            .filter((field) => field.id !== "childless_declaration")
            .map((field) =>
              field.id === "supporting_documents"
                ? {
                    ...field,
                    description: t(
                      "বিবাহের প্রমাণের (কাবিননামা বা বিবাহ নিবন্ধন সনদ) স্ক্যান কপি আপলোড করুন (PDF, PNG বা JPEG; সর্বোচ্চ 2 MiB)।",
                      "Upload a scanned copy of proof of the marriage (Kabin Nama or marriage registration certificate) (PDF, PNG or JPEG; maximum 2 MiB).",
                    ),
                    constraints: { ...field.constraints, minRows: 1 },
                  }
                : field,
            ),
        ],
      };
    }),
  });
}

/**
 * Service 35 (§3.35; §4 item 6): the character certificate's only
 * personal fact — the marital status — hid behind an opt-in
 * checkbox ("Include marital status"), and NOTHING character-
 * related was asked at all: no occupation, no residence history,
 * although the certificate's whole substance is that the office
 * knows the person. Template-first check (certificate-template-
 * v7): ATTESTATIONS[35] is a fixed sentence and the residence /
 * personally-known status sentence is built from the citizen
 * record — no payload field prints, so the facts below are office
 * evidence (the Form 30 pattern). Repairs (the Form 23/29 pattern):
 * (a) the checkbox is REMOVED and the marital status is always
 *     visible and required;
 * (b) the occupation pair (`character_occupation_bn` /
 *     `character_occupation`, BN-first, both required — §4
 *     item 11) and `residence_duration_years` (required, 0–120)
 *     give the office the two facts a character attestation is
 *     judged on: what the person does, and how long the office
 *     has been able to know them.
 */
function buildQaFix7Character(previous: FormSchema): FormSchema {
  const characterFacts: readonly FieldDefinition[] = [
    {
      id: "character_occupation_bn",
      type: "text",
      label: t("পেশা (বাংলা)", "Occupation (Bangla)"),
      constraints: { required: true, maxLength: 120 },
    },
    {
      id: "character_occupation",
      type: "text",
      label: t("পেশা (ইংরেজি)", "Occupation (English)"),
      constraints: { required: true, maxLength: 120 },
    },
    {
      id: "residence_duration_years",
      type: "number",
      label: t(
        "এলাকায় বসবাসের মেয়াদ (বছর)",
        "Years resident in the area",
      ),
      constraints: { required: true, min: 0, max: 120, integer: true },
    },
  ];
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-07) removes the opt-in checkbox that hid the marital status, captures the occupation and the years resident in the area, and leaves the marital status always visible and required. The certificate's attestation is a fixed sentence with the residence status taken from the citizen record, so these facts are office evidence.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      return {
        ...section,
        fields: section.fields.flatMap((field) => {
          if (field.id === "marital_status_radio") return [];
          if (field.id === "marital_status") {
            const { visibleWhen: _condition, ...alwaysVisible } = field;
            return [alwaysVisible, ...characterFacts];
          }
          return [field];
        }),
      };
    }),
  });
}

/**
 * §4 item 9 — service 36's NOC subject: the closed list the whole
 * form keys off. Land comes first (the union office's commonest
 * NOC, and the value the synthetic payloads take, which keeps the
 * land and address blocks visible in generated fixtures).
 */
const qaFix7NocSubjectOptions: FieldDefinition["options"] = [
  option("land", "জমি সংক্রান্ত", "Land matter"),
  option("business", "ব্যবসা/প্রতিষ্ঠান সংক্রান্ত", "Business or establishment"),
  option("employment", "চাকরি সংক্রান্ত", "Employment"),
  option("passport", "পাসপোর্ট/ভ্রমণ সংক্রান্ত", "Passport or travel"),
  option("other", "অন্যান্য", "Other"),
];

/** Service 36's land block — visible only for a land NOC. */
const qaFix7NocLandFields: readonly string[] = [
  "noc_org_mouza_name_bn",
  "noc_org_mouza_name",
  "noc_org_khatian_no",
  "noc_org_dag_no",
  "noc_org_land_classification_bn",
  "noc_org_land_classification",
  "noc_org_total_area",
  "land_unit",
  "noc_org_area_holding_bn",
  "noc_org_area_holding",
];

/** Service 36's establishment-address block — land and business. */
const qaFix7NocAddressFields: readonly string[] = [
  "noc_org_add_type",
  "org_location",
  "additional_thana_id",
  "post_office_id",
  "noc_org_ward_no",
];

/** Service 36's organisation identity — land, business, employment. */
const qaFix7NocOrgFields: readonly string[] = [
  "noc_org_name_bn",
  "noc_org_name",
  "noc_org_type_bn",
  "noc_org_type",
];

/** Service 36's field order after the QAFIX-07 repair. */
const qaFix7NocOrder: readonly string[] = [
  "noc_subject",
  "noc_proprietor_bn",
  "noc_proprietor",
  "proprietor_father_name_bn",
  "proprietor_father_name",
  "proprietor_mother_name_bn",
  "proprietor_mother_name",
  "proprietor_spouse_name_bn",
  "proprietor_spouse_name",
  "noc_email",
  "noc_mobile",
  "noc_org_name_bn",
  "noc_org_name",
  "noc_org_type_bn",
  "noc_org_type",
  ...qaFix7NocLandFields,
  "noc_org_add_type",
  "org_location",
  "additional_thana_id",
  "post_office_id",
  "municipality_id",
  "city_corporation_id",
  "noc_org_ward_no",
  "supporting_documents",
  "noc_role_bn",
  "noc_role_en",
  "noc_activity_bn",
  "noc_activity_en",
];

/**
 * Service 36 (§3.36, BLOCKER; §4 items 8/9): a generic no-objection
 * certificate carried a fully REQUIRED land/business block —
 * khatian, dag, mouza, land classification, land amount — so a
 * job or passport NOC could not be obtained without inventing
 * land details, and the form never asked what the NOC was FOR.
 * Template-first check (certificate-template-v7, ATTESTATIONS[36]):
 * the certificate prints only the organisation's name, the role
 * and the activity, and it already carries an org-less fallback
 * sentence for NOCs that name no organisation — the land data
 * never prints. Repairs:
 * (a) `noc_subject` (required fixed select, §4 item 9) heads the
 *     form: land / business / employment / passport / other;
 * (b) the land block is visible — and therefore required — only
 *     when the subject is land (the Phase-4 conditional mechanism:
 *     invisible fields are skipped by the engine);
 * (c) the establishment-address block (address type, org_location
 *     geography, thana, post office, ward, and the municipality /
 *     city-corporation references composed on top of their own
 *     branch conditions) is visible for land and business only,
 *     via the engine's `any` predicate;
 * (d) the organisation identity is visible for land, business and
 *     employment (the employer) — a passport or other NOC names
 *     no organisation, and the template's fallback sentence
 *     carries it;
 * (e) the father's pair is seated before the mother's (the
 *     BN-first standard order used by every other service);
 * (f) the proprietor labels' Bangla spelling is corrected
 *     (স্বত্বাধিকারী/প্রোপ্রাইটর; the first word was already
 *     repaired by the §4-12 map, the second was not).
 * The proprietor's identity fields themselves were already wired
 * to the profile prefill engine (CITIZEN_FIELD_SOURCES maps the
 * proprietor name, both parents and the mobile) — verified, not
 * changed. The review geography-names rendering is the systemic
 * QAFIX-01 fix (GeographyDetailText); this service's geography
 * field flows through it like every other.
 */
function buildQaFix7Noc(previous: FormSchema): FormSchema {
  const subjectField: FieldDefinition = {
    id: "noc_subject",
    type: "select",
    label: t("আপত্তি না থাকার বিষয়", "Subject of the no-objection"),
    options: qaFix7NocSubjectOptions,
    constraints: { required: true },
  };
  const subjectIs = (value: string): Predicate => ({
    field: "noc_subject",
    equals: value,
  });
  const landWhen: Predicate = subjectIs("land");
  const landOrBusinessWhen: Predicate = {
    any: [subjectIs("land"), subjectIs("business")],
  };
  const orgWhen: Predicate = {
    any: [subjectIs("land"), subjectIs("business"), subjectIs("employment")],
  };
  const proprietorLabels: Readonly<Record<string, LocalizedText>> = {
    noc_proprietor_bn: t(
      "স্বত্বাধিকারী/প্রোপ্রাইটর নাম (বাংলায়)",
      "No objection proprietor (Bangla)",
    ),
    noc_proprietor: t(
      "স্বত্বাধিকারী/প্রোপ্রাইটর নাম (ইংরেজিতে)",
      "No objection proprietor",
    ),
  };
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-07) keys the form off a required NOC subject: the land block is required only for a land NOC, the establishment address only for land and business, and the organisation identity only for land, business and employment; the father's name pair precedes the mother's, and the proprietor labels are spelled correctly. The certificate prints only the organisation, role and activity, so the subject and the land details are office evidence and form structure.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      const transformed = section.fields.map((field) => {
        let next = field;
        if (qaFix7NocLandFields.includes(field.id))
          next = { ...next, visibleWhen: landWhen };
        else if (qaFix7NocOrgFields.includes(field.id))
          next = { ...next, visibleWhen: orgWhen };
        else if (qaFix7NocAddressFields.includes(field.id))
          next = { ...next, visibleWhen: landOrBusinessWhen };
        else if (
          field.id === "municipality_id" ||
          field.id === "city_corporation_id"
        )
          next = {
            ...next,
            visibleWhen: {
              all: [landOrBusinessWhen, field.visibleWhen as Predicate],
            },
          };
        const label = proprietorLabels[field.id];
        return label ? { ...next, label } : next;
      });
      const byId = new Map(
        [subjectField, ...transformed].map((field) => [field.id, field]),
      );
      return {
        ...section,
        fields: qaFix7NocOrder.map((id) => byId.get(id)).filter(
          (field): field is FieldDefinition => !!field,
        ),
      };
    }),
  });
}

/** QAFIX-07: publish the repair version of a service's current schema. */
export function buildQaFix7Version(previous: FormSchema): FormSchema {
  switch (previous.serviceNo) {
    case 31:
      return buildQaFix7DeathWhileUnmarried(previous);
    case 32:
      return buildQaFix7FinancialHardship(previous);
    case 33:
      return buildQaFix7NidCorrection(previous);
    case 34:
      return buildQaFix7Childless(previous);
    case 35:
      return buildQaFix7Character(previous);
    case 36:
      return buildQaFix7Noc(previous);
    default:
      throw new RangeError(
        `Service ${previous.serviceNo} has no QAFIX-07 version.`,
      );
  }
}

/* ---------- QAFIX-08: services 37–42 (Workstream H) ----------
 * The same live QA (§3 services 37–42, §4 items 4/5/8/9/10/11) found
 * the last batch: a voter-transfer form whose English companion field
 * broke the pair rule (37); a disability certificate with no medical
 * evidence, no severity and no way to apply for someone else (38); a
 * same-person form whose related-person list offered "self" and whose
 * two name slots never said which was which (39); a tribal certificate
 * with free-text community, no evidence and no affiliation guidance
 * (40); a premises licence that made the citizen type the licence fee
 * and VAT (41); and a trade licence with eight citizen-typed fee
 * fields, copied parent/spouse extras and none of the standard
 * purpose/language fields (42). Services are repaired one at a time
 * below; the list grows as each lands. Same publication rule: a NEW
 * version per repaired service; the previous version stays pinned. */

/** Services whose next version carries the QAFIX-08 repairs. */
export const qaFix8Services: readonly number[] = deepFreeze([37, 38, 39, 40, 41, 42]);

/**
 * Service 37 (§3.37; §4 item 11): three of the four findings were
 * measured on the r8 build and are already repaired systemically —
 * the reason label's spelling is the §4-12 map's কারণ (verified at
 * the codepoint level: U+09A3, not U+09A8), the review renders the
 * residing-since date through the QAFIX-01 human-date path, and the
 * review's village line is the citizen's own saved profile address
 * text (the dataset name is বেলাবো; a profile saved with other text
 * renders as saved — recorded limit, no schema lever exists). The
 * identity gap resolves by the Form 15 precedent: the certificate
 * chassis prints the applicant's name, father's name and mother's
 * name from the citizen record (identitySegments) and the service-37
 * fields line prints the NID from the same record, so identity form
 * fields would duplicate the record the office already verifies;
 * date of birth is printed by the chassis for no service and the
 * mobile number is not a certificate fact.
 * The one live defect: `previous_voter_area_en` was an OPTIONAL
 * textarea beside its REQUIRED text Bangla original — the pair
 * broke §4 item 11's one-rule-per-pair, and the issuance gate
 * (cert-gates LANGUAGE_PAIRS[37]) blocks an official certificate
 * when exactly one side of this pair is present, so the optional
 * English field invited a blocked issuance. The English field now
 * mirrors the Bangla original exactly: text, required, 2–500.
 */
function buildQaFix8VoterAreaTransfer(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-08) aligns the previous-voter-area pair: the English companion is a required text field with the Bangla original's limits, instead of an optional textarea — one required-ness rule per pair, and the pair the issuance gate checks is always complete. The certificate prints the identity (name, parents, NID) from the citizen record, so no identity fields are added to the form.`,
    },
    sections: previous.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) =>
        field.id === "previous_voter_area_en"
          ? {
              ...field,
              type: "text" as const,
              constraints: { required: true, minLength: 2, maxLength: 500 },
            }
          : field,
      ),
    })),
  });
}

/**
 * §4 item 9 — the disability severity grades for service 38, in the
 * grading language of the disability identification programme
 * (মৃদু / মাঝারি / গুরুতর / অত্যন্ত গুরুতর). The value does not
 * print (the certificate carries the type only), so the list is
 * office classification — it exists so the chairman judges the
 * application against a stated grade instead of no grade at all.
 */
const qaFix8DisabilitySeverityOptions: FieldDefinition["options"] = [
  option("mild", "মৃদু", "Mild"),
  option("moderate", "মাঝারি", "Moderate"),
  option("severe", "গুরুতর", "Severe"),
  option("profound", "অত্যন্ত গুরুতর", "Profound"),
];

/**
 * Service 38 (§3.38; §4 items 5/6/11): a disability certificate
 * whose core evidence was absent — no medical certificate, no
 * severity, no diagnosis — and no way to say the applicant was
 * applying for someone else. Template-first check
 * (certificate-template-v7): ATTESTATIONS[38] prints the fixed
 * sentence, the disability TYPE from its label map
 * (DISABILITY_LABELS, read from `application_autistic_type`) and
 * the support-needs pair; the chassis identity is the citizen
 * record. Severity, diagnosis, the applicant relation and the
 * subject's name have no printed slot — they are the office
 * evidence the chairman judges before the type is attested (the
 * Form 30/32 pattern). Repairs:
 * (a) `disability_applicant_relation` — a required select (the
 *     applicant IS the person with a disability / applying for
 *     someone else) heading the form; on "someone else" the
 *     subject's name pair (`disability_subject_name_bn` /
 *     `disability_subject_name`, BN-first, both required) appears.
 *     The pair is never prefilled — the subject is another person.
 *     LIMIT: the issued certificate names the account citizen (the
 *     chassis has no subject slot); the office verifies the
 *     subject from this evidence — recorded, not hidden;
 * (b) `disability_severity` — the fixed grade select above;
 * (c) the diagnosis pair (`disability_diagnosis_bn` /
 *     `disability_diagnosis`, BN-first, both required — §4
 *     item 11) summarising the medical finding;
 * (d) `support_needs_en` becomes required, mirroring its Bangla
 *     original (the pair cert-gates checks at issuance is always
 *     complete; the pair already sits adjacently in the schema —
 *     the split placement the QA saw was the r8 build);
 * (e) the documents step names the medical/disability certificate
 *     and demands ≥1 row (§4 item 5 mechanism).
 */
function buildQaFix8Disability(previous: FormSchema): FormSchema {
  const relation: FieldDefinition = {
    id: "disability_applicant_relation",
    type: "select",
    label: t(
      "কার জন্য আবেদন করছেন",
      "Who is this application for",
    ),
    constraints: { required: true },
    options: [
      option(
        "self",
        "নিজের জন্য (আমি নিজে প্রতিবন্ধী ব্যক্তি)",
        "For myself (I am the person with a disability)",
      ),
      option(
        "other",
        "অন্য প্রতিবন্ধী ব্যক্তির পক্ষে",
        "For another person with a disability",
      ),
    ],
    evidence: { status: "proposed" },
  };
  const subjectGate = {
    field: "disability_applicant_relation",
    equals: "other",
  } as const;
  const subjectBn: FieldDefinition = {
    id: "disability_subject_name_bn",
    type: "text",
    label: t(
      "প্রতিবন্ধী ব্যক্তির নাম (বাংলা)",
      "Name of the person with a disability (Bangla)",
    ),
    constraints: { required: true, maxLength: 160 },
    visibleWhen: subjectGate,
    evidence: { status: "proposed" },
  };
  const subjectEn: FieldDefinition = {
    id: "disability_subject_name",
    type: "text",
    label: t(
      "প্রতিবন্ধী ব্যক্তির নাম (ইংরেজি)",
      "Name of the person with a disability (English)",
    ),
    constraints: { required: true, maxLength: 160 },
    visibleWhen: subjectGate,
    evidence: { status: "proposed" },
  };
  const severity: FieldDefinition = {
    id: "disability_severity",
    type: "select",
    label: t("প্রতিবন্ধিতার মাত্রা", "Severity of the disability"),
    constraints: { required: true },
    options: qaFix8DisabilitySeverityOptions,
    evidence: { status: "proposed" },
  };
  const diagnosisBn: FieldDefinition = {
    id: "disability_diagnosis_bn",
    type: "text",
    label: t(
      "চিকিৎসকের নির্ধারিত রোগ/অবস্থা (বাংলা)",
      "Diagnosed condition (Bangla)",
    ),
    constraints: { required: true, maxLength: 300 },
    evidence: { status: "proposed" },
  };
  const diagnosisEn: FieldDefinition = {
    id: "disability_diagnosis",
    type: "text",
    label: t(
      "চিকিৎসকের নির্ধারিত রোগ/অবস্থা (ইংরেজি)",
      "Diagnosed condition (English)",
    ),
    constraints: { required: true, maxLength: 300 },
    evidence: { status: "proposed" },
  };
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-08) states who the application is for (with the subject's name when it is for someone else), grades the disability's severity on a fixed scale, captures the diagnosed condition in both languages, makes the English support-needs field required like its Bangla original, and makes the documents step name the medical/disability certificate and require at least one upload. The certificate prints the disability type and the support needs only, so the relation, subject, severity and diagnosis are office evidence.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      return {
        ...section,
        fields: [
          relation,
          subjectBn,
          subjectEn,
          ...section.fields.flatMap((field) => {
            if (field.id === "application_autistic_type")
              return [field, severity, diagnosisBn, diagnosisEn];
            if (field.id === "support_needs_en")
              return [
                {
                  ...field,
                  constraints: {
                    required: true,
                    minLength: 2,
                    maxLength: 1000,
                  },
                },
              ];
            if (field.id === "supporting_documents")
              return [
                {
                  ...field,
                  description: t(
                    "প্রতিবন্ধিতার মেডিকেল সনদের (সরকারি হাসপাতালের চিকিৎসক বা প্রতিবন্ধী সেবা ও সাহায্য কেন্দ্রের প্রদত্ত সনদ) স্ক্যান কপি আপলোড করুন (PDF, PNG বা JPEG; সর্বোচ্চ 2 MiB)।",
                    "Upload a scanned copy of the medical/disability certificate (issued by a government hospital doctor or a disability service and assistance centre) (PDF, PNG or JPEG; maximum 2 MiB).",
                  ),
                  constraints: { ...field.constraints, minRows: 1 },
                },
              ];
            return [field];
          }),
        ],
      };
    }),
  });
}

/**
 * §4 item 8 — the related-person list for service 39: the copied
 * generic list offered "নিজ" (self) for a person who is by
 * definition someone else. The remaining relations are the ones a
 * related person on a same-person attestation actually bears.
 */
const qaFix8RelatedPersonOptions: FieldDefinition["options"] = [
  option("spouse", "স্বামী/স্ত্রী", "Spouse"),
  option("child", "সন্তান", "Child"),
  option("parent", "পিতা/মাতা", "Parent"),
  option("sibling", "ভাই/বোন", "Sibling"),
  option("other", "অন্যান্য", "Other"),
];

/** Service 39's name-slot labels: which slot is which (§3.39). */
const qaFix8SamePersonLabels: Readonly<Record<string, LocalizedText>> = {
  spi_name_bn: t(
    "নথিতে উল্লিখিত নাম (বাংলা)",
    "Name as written in the documents (Bangla)",
  ),
  spi_name_en: t(
    "নথিতে উল্লিখিত নাম (ইংরেজি)",
    "Name as written in the documents (English)",
  ),
  spi_name_2_bn: t(
    "নথিতে উল্লিখিত নামের অন্য রূপ (বাংলা)",
    "Other form of the name in the documents (Bangla)",
  ),
  spi_name_2_en: t(
    "নথিতে উল্লিখিত নামের অন্য রূপ (ইংরেজি)",
    "Other form of the name in the documents (English)",
  ),
};

/**
 * Service 39 (§3.39; §4 items 5/8/11): the same-person attestation
 * never explained its own name slots, and its evidence was a
 * generic optional upload. Template-first check
 * (certificate-template-v7, samePersonBody): the certificate
 * prints the applicant's CORRECT name from the citizen record,
 * then declares that the names in `spi_name_*` (the first
 * document form) and `spi_name_2_*` (a second form, when present)
 * all belong to that same person. Repairs:
 * (a) both name slots are relabelled to say they hold the name AS
 *     WRITTEN IN THE DOCUMENTS, and each pair's Bangla field
 *     carries a hint saying the correct name prints from the
 *     profile while these slots take the document spellings —
 *     the overlap the QA flagged is answered in the labels
 *     themselves;
 * (b) the second-form pair is reseated directly after the first
 *     (it was parked after the documents group — §4 item 11);
 * (c) a new required pair (`spi_variant_evidence_bn` /
 *     `spi_variant_evidence`) names WHICH documents show the
 *     variants — office evidence behind the declaration — and
 *     the documents step names those documents and demands ≥1
 *     row (§4 item 5 mechanism);
 * (d) `spi_relation` loses "self" (list above). The related
 *     person's own name pair already sits Bangla-first in the
 *     schema (the English-first order was the r8 build) and is
 *     deliberately never prefilled — the related person is
 *     someone else.
 */
function buildQaFix8SamePerson(previous: FormSchema): FormSchema {
  const evidenceBn: FieldDefinition = {
    id: "spi_variant_evidence_bn",
    type: "text",
    label: t(
      "কোন নথিতে নামের রূপগুলো আছে (বাংলা)",
      "Documents that show the name forms (Bangla)",
    ),
    description: t(
      "যে নথিগুলোতে নামের ভিন্ন রূপগুলো দেখা যায়, সেগুলোর নাম লিখুন (যেমন: এনআইডি ও জন্ম নিবন্ধন সনদ)।",
      "Name the documents in which the different forms of the name appear (for example: the NID and the birth registration certificate).",
    ),
    constraints: { required: true, maxLength: 300 },
    evidence: { status: "proposed" },
  };
  const evidenceEn: FieldDefinition = {
    id: "spi_variant_evidence",
    type: "text",
    label: t(
      "কোন নথিতে নামের রূপগুলো আছে (ইংরেজি)",
      "Documents that show the name forms (English)",
    ),
    constraints: { required: true, maxLength: 300 },
    evidence: { status: "proposed" },
  };
  const firstFormHint = t(
    "আপনার সঠিক নামটি প্রোফাইল থেকে সনদে ছাপা হবে। এখানে কোনো নথিতে (যেমন এনআইডি বা জন্ম নিবন্ধন সনদে) নামটি যেভাবে লেখা আছে, হুবহু সেভাবে লিখুন।",
    "Your correct name is printed on the certificate from your profile. Write here the name exactly as it is written in a document (such as the NID or the birth registration certificate).",
  );
  const secondFormHint = t(
    "অন্য কোনো নথিতে নামের আরেকটি রূপ বা বানান থাকলে তা লিখুন; না থাকলে ঘরটি খালি রাখুন।",
    "If another document shows a different form or spelling of the name, write it here; leave the field blank if there is none.",
  );
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-08) labels both name slots as the name as written in the documents (the correct name prints from the citizen record), reseats the second-form pair beside the first instead of after the documents group, names the documents that show the name forms in a required field pair, makes the documents step name those documents and require at least one upload, and removes "self" from the related-person list.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      const byId = new Map(
        section.fields.map((field) => [field.id, field] as const),
      );
      const relabel = (field: FieldDefinition): FieldDefinition => {
        const label = qaFix8SamePersonLabels[field.id];
        let next = label ? { ...field, label } : field;
        if (field.id === "spi_name_bn")
          next = { ...next, description: firstFormHint };
        if (field.id === "spi_name_2_bn")
          next = { ...next, description: secondFormHint };
        if (field.id === "spi_relation")
          next = { ...next, options: qaFix8RelatedPersonOptions };
        if (field.id === "supporting_documents")
          next = {
            ...next,
            description: t(
              "নামের রূপগুলো দেখা যায় এমন নথির (এনআইডি, জন্ম নিবন্ধন সনদ, পাসপোর্ট বা শিক্ষাগত সনদ) স্ক্যান কপি আপলোড করুন (PDF, PNG বা JPEG; সর্বোচ্চ 2 MiB)।",
              "Upload scanned copies of the documents in which the name forms appear (NID, birth registration certificate, passport or academic certificate) (PDF, PNG or JPEG; maximum 2 MiB).",
            ),
            constraints: { ...next.constraints, minRows: 1 },
          };
        return next;
      };
      const order = [
        "spi_name_bn",
        "spi_name_en",
        "spi_name_2_bn",
        "spi_name_2_en",
        "__evidence_bn__",
        "__evidence__",
        "spi_is_dead",
        "spi_death_date",
        "relation_person",
        "spi_relation",
        "spi_relation_person_name_bn",
        "spi_relation_person_name",
        "supporting_documents",
      ];
      return {
        ...section,
        fields: order.flatMap((id) => {
          if (id === "__evidence_bn__") return [evidenceBn];
          if (id === "__evidence__") return [evidenceEn];
          const field = byId.get(id);
          return field ? [relabel(field)] : [];
        }),
      };
    }),
  });
}

/**
 * §4 item 9 — the bases on which a person belongs to an ethnic
 * minority community (service 40). The certificate attests
 * membership only, so the basis is office evidence: it exists so
 * the chairman sees the claimed ground instead of an unexplained
 * free-text line.
 */
const qaFix8TribalAffiliationOptions: FieldDefinition["options"] = [
  option("by_birth", "জন্মসূত্রে (সম্প্রদায়ের পরিবারে জন্ম)", "By birth (born into the community)"),
  option("by_descent", "বংশানুক্রমে (পিতা/মাতার মাধ্যমে)", "By descent (through a parent)"),
  option("by_marriage", "বৈবাহিক সূত্রে", "By marriage"),
  option("other", "অন্যান্য", "Other"),
];

/**
 * Service 40 (§3.40; §4 items 5/9/11): the tribal certificate had
 * NO evidence field for tribal identity at all, took the
 * community as free text in two languages (the English one
 * optional and seated after the documents group), and asked the
 * basis of membership as unexplained free text. Repairs (the
 * service-18 pattern, QAFIX-04):
 * (a) `community_name` becomes the single bilingual select of
 *     recognised communities (the QAFIX-04 option list);
 *     `community_name_en` leaves the form — the template resolves
 *     the code through COMMUNITY_LABELS in both languages
 *     (certificate-template-v7 ATTESTATIONS[40], mirrored by the
 *     shared corpus in pdf-react) and pinned free-text payloads
 *     still print verbatim. The §4 item 11 asymmetry (an optional
 *     English twin after the documents) disappears with the twin.
 *     The field's `evidence.fieldNames` keeps both historical
 *     names, so no removal is recorded;
 * (b) `community_affiliation` becomes the fixed basis select
 *     above (office evidence; the certificate attests membership
 *     only);
 * (c) the documents step names acceptable tribal-identity proof
 *     and demands ≥1 row (§4 item 5 mechanism) — the missing
 *     evidence field the QA flagged.
 * Spelling: সম্প্রদায় is byte-identical between the form labels
 * and the review (the same decomposed য + ় sequence everywhere;
 * verified at the codepoint level) — no change.
 */
function buildQaFix8Tribal(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-08) takes the community from the fixed list of recognised communities shared with service 18 (the certificate resolves the code through its label map; older free-text applications still print verbatim), states the basis of membership as a fixed select, and makes the documents step name acceptable tribal-identity proof and require at least one upload.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      return {
        ...section,
        fields: section.fields.flatMap((field) => {
          if (field.id === "community_name_en") return [];
          if (field.id === "community_name")
            return [
              {
                ...field,
                type: "select" as const,
                constraints: { required: true },
                options: qaFix4CommunityOptions,
                evidence: {
                  status: "proposed" as const,
                  fieldNames: ["community_name", "community_name_en"],
                },
              },
            ];
          if (field.id === "community_affiliation")
            return [
              {
                ...field,
                type: "select" as const,
                constraints: { required: true },
                options: qaFix8TribalAffiliationOptions,
              },
            ];
          if (field.id === "supporting_documents")
            return [
              {
                ...field,
                description: t(
                  "উপজাতীয়/ক্ষুদ্র নৃ-গোষ্ঠী পরিচয়ের প্রমাণের (সম্প্রদায়ের নেতা বা ইউনিয়ন পরিষদের প্রত্যয়ন, পূর্বের উপজাতীয় সনদ অথবা সম্প্রদায়ের পরিচয়পত্র) স্ক্যান কপি আপলোড করুন (PDF, PNG বা JPEG; সর্বোচ্চ 2 MiB)।",
                  "Upload scanned proof of ethnic-minority identity (an attestation by the community leader or the Union Parishad, a previous tribal certificate, or a community identity card) (PDF, PNG or JPEG; maximum 2 MiB).",
                ),
                constraints: { ...field.constraints, minRows: 1 },
              },
            ];
          return [field];
        }),
      };
    }),
  });
}

/** §3.41 — each premises address component gets its own help text. */
const qaFix8PremisesHelp: Readonly<Record<string, LocalizedText>> = {
  additional_thana_id: t("থানার নাম লিখুন।", "Write the police station (thana) name."),
  post_office_id: t("ডাকঘরের নাম লিখুন।", "Write the post office name."),
  municipality_id: t("পৌরসভার নাম লিখুন।", "Write the municipality name."),
  city_corporation_id: t(
    "সিটি কর্পোরেশনের নাম লিখুন।",
    "Write the city corporation name.",
  ),
};

/**
 * Service 41 (§3.41): a premises licence whose optional extras
 * asked the citizen to type the licence fee and VAT while the
 * fee step said no fee policy exists, whose proprietor labels
 * misspell both of their Bangla words, whose four address
 * components share one copied help text, and whose capital label
 * does not say what to write. Repairs:
 * (a) `premises_fee_licence` and `premises_fee_vat` are REMOVED —
 *     fees are system-set only (the owner rule; the fee step and
 *     the certificate's fee table already fall back to the
 *     order/system total, and cert-gates' AMOUNTS_REQUIRED check
 *     accepts the order path, so no gate or template change is
 *     needed). Both names were proposed fields, never observed
 *     in a stored payload, so no removal is recorded;
 * (b) the proprietor pair's labels are corrected to
 *     স্বত্বাধিকারী/প্রোপ্রাইটর (the §4-12 spelling map's words,
 *     applied to service 36 in QAFIX-07) — the pair already sits
 *     Bangla-first in the schema (the English-first order was
 *     the r8 build) and stays prefilled from the profile;
 * (c) thana / post office / municipality / city corporation each
 *     get their own help text (map above) instead of the copied
 *     "ঠিকানার নাম বা পরিচিতি লিখুন।" under all four;
 * (d) the capital label now says what it holds: "মূলধন (টাকায়,
 *     সংখ্যায়)" / "Capital (amount in figures, BDT)" — matching
 *     the words the certificate itself prints.
 * The review complaints (raw geography codes; a draft-save
 * button on this review only) are shared-surface behaviour, not
 * schema: both are verified in the probe and recorded in the
 * evidence note.
 */
function buildQaFix8PremisesLicence(previous: FormSchema): FormSchema {
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-08) removes the citizen-typed licence fee and VAT fields (fees are system-set only; the certificate's fee table and the issuance gate both use the order/system total), corrects the proprietor labels to স্বত্বাধিকারী/প্রোপ্রাইটর, gives the thana, post office, municipality and city corporation fields their own help texts, and labels the capital as an amount in figures in BDT.`,
    },
    sections: previous.sections.map((section) => ({
      ...section,
      fields: section.fields.flatMap((field) => {
        if (
          field.id === "premises_fee_licence" ||
          field.id === "premises_fee_vat"
        )
          return [];
        if (field.id === "primises_license_proprietor_bn")
          return [
            {
              ...field,
              label: t(
                "স্বত্বাধিকারী/প্রোপ্রাইটর নাম (বাংলা)",
                "Proprietor name (Bangla)",
              ),
            },
          ];
        if (field.id === "primises_license_proprietor")
          return [
            {
              ...field,
              label: t(
                "স্বত্বাধিকারী/প্রোপ্রাইটর নাম (ইংরেজি)",
                "Proprietor name (English)",
              ),
            },
          ];
        if (field.id === "primises_license_capital")
          return [
            {
              ...field,
              label: t(
                "মূলধন (টাকায়, সংখ্যায়)",
                "Capital (amount in figures, BDT)",
              ),
            },
          ];
        const help = qaFix8PremisesHelp[field.id];
        if (help) return [{ ...field, description: help }];
        return [field];
      }),
    })),
  });
}

/**
 * §4 item 9 — the organisation types for service 42, replacing the
 * free-text pair in the optional extras. The certificate resolves
 * the code through ORG_TYPE_LABELS (certificate-template-v7.ts —
 * keep the two in sync); pinned payloads print their pair
 * verbatim via the same helper's fallback.
 */
const qaFix8OrgTypeOptions: FieldDefinition["options"] = [
  option("proprietorship", "একক মালিকানা", "Sole proprietorship"),
  option("partnership", "অংশীদারি", "Partnership"),
  option("private_limited", "প্রাইভেট লিমিটেড কোম্পানি", "Private limited company"),
  option("public_limited", "পাবলিক লিমিটেড কোম্পানি", "Public limited company"),
  option("cooperative", "সমবায় সমিতি", "Cooperative society"),
  option("other", "অন্যান্য", "Other"),
];

/** The citizen-typed fee fields service 42 loses (§3.42). */
const qaFix8TradeFeeFields: ReadonlySet<string> = new Set([
  "trade_fee_new",
  "trade_fee_renewal",
  "trade_fee_arrear",
  "trade_fee_surcharge",
  "trade_fee_amendment",
  "trade_fee_signboard",
  "trade_fee_profession_tax",
  "trade_fee_vat",
]);

/** The copied family-name fields service 42 loses (§3.42). */
const qaFix8TradeFamilyFields: ReadonlySet<string> = new Set([
  "proprietor_mother_name_bn",
  "proprietor_mother_name",
  "proprietor_father_name_bn",
  "proprietor_father_name",
  "proprietor_spouse_name_bn",
  "proprietor_spouse_name",
]);

/**
 * Service 42 (§3.42): the republic's most-filled form carried the
 * pass's worst extras — eight citizen-typed fee fields, the
 * proprietor's mother/father/spouse names copied from a family
 * form, and a free-text organisation type — while lacking the
 * standard purpose/language fields every neighbour has (its
 * review even defaulted the certificate language to Bangla
 * because the form never asked). Repairs:
 * (a) all eight `trade_fee_*` fields are REMOVED — fees are
 *     system-set only (the owner rule, as on service 41; the
 *     licence's fee table and cert-gates' TRADE_FEE_KEYS check
 *     both fall back to the order/system total, so no gate or
 *     template change is needed). The names were proposed
 *     fields, never observed, so no removal is recorded;
 * (b) the six mother/father/spouse fields are REMOVED — a trade
 *     licence attests a business, not a family (the template
 *     prints those rows only when a pinned payload carries them;
 *     its field() helper omits empty values). These names ARE
 *     observed, so the removal is recorded in the catalog test's
 *     qaFix8RemovedObserved;
 * (c) the organisation-type pair collapses into the single
 *     bilingual select `trade_license_org_type` (list above; the
 *     field's evidence.fieldNames keeps both historical names).
 *     It stays optional, as the pair was — the core `business_type`
 *     select remains the form's required classification;
 * (d) the standard application_context section is appended
 *     (address_source / purpose / purpose_language /
 *     delivery_language — the shared QAFIX-02 fields), so the
 *     review's document language is now the citizen's own choice.
 *     `confirmation` is NOT duplicated: the renewal section
 *     already carries it.
 * The praised previous-licence checkbox pattern
 * (has_previous_license → previous_license_number) is untouched.
 */
function buildQaFix8TradeLicence(previous: FormSchema): FormSchema {
  const sections = previous.sections.map((section) => {
    if (section.id !== "trade_additional_details") return section;
    return {
      ...section,
      fields: section.fields.flatMap((field) => {
        if (qaFix8TradeFeeFields.has(field.id)) return [];
        if (qaFix8TradeFamilyFields.has(field.id)) return [];
        if (field.id === "trade_license_org_type_bn") return [];
        if (field.id === "trade_license_org_type")
          return [
            {
              ...field,
              type: "select" as const,
              label: t("প্রতিষ্ঠানের ধরণ", "Type of organisation"),
              constraints: { required: false },
              options: qaFix8OrgTypeOptions,
              evidence: {
                status: "proposed" as const,
                fieldNames: [
                  "trade_license_org_type_bn",
                  "trade_license_org_type",
                ],
              },
            },
          ];
        return [field];
      }),
    };
  });
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-08) removes the eight citizen-typed fee fields (fees are system-set only) and the proprietor's mother/father/spouse name fields copied from a family form, makes the organisation type a fixed bilingual select the licence resolves through its label map, and adds the standard purpose-and-language section so the document language is the citizen's choice.`,
    },
    sections: [
      ...sections,
      {
        id: "application_context",
        title: t("আবেদনের উদ্দেশ্য ও ভাষা", "Purpose and language"),
        fields: [
          qaFix2AddressSource,
          ...qaFixPurposeFields,
          qaFix2DeliveryLanguage,
        ],
      },
    ],
  });
}

/** QAFIX-08: publish the repair version of a service's current schema. */
export function buildQaFix8Version(previous: FormSchema): FormSchema {
  switch (previous.serviceNo) {
    case 37:
      return buildQaFix8VoterAreaTransfer(previous);
    case 38:
      return buildQaFix8Disability(previous);
    case 39:
      return buildQaFix8SamePerson(previous);
    case 40:
      return buildQaFix8Tribal(previous);
    case 41:
      return buildQaFix8PremisesLicence(previous);
    case 42:
      return buildQaFix8TradeLicence(previous);
    default:
      throw new RangeError(
        `Service ${previous.serviceNo} has no QAFIX-08 version.`,
      );
  }
}

/* ---------- QAFIX-09: services 43–47 (Workstream I) ----------
 * The final batch of the same live QA (§3 services 43–47, §4 items
 * 5/6/7/9/11/12): a voter-list inclusion form that never asked the
 * voter ID, ward or omission date its certificate exists to repair
 * (43); a non-remarriage form that assumed widowhood and made the
 * citizen compose the legal declaration (44); a permanent-resident
 * form with no residence proof and no applicable-address choice
 * (45); a vehicle licence that demanded a licence number from
 * first-time applicants, carried a truncated "বাগা" label and
 * copied spouse fields (46); and a miscellaneous form whose closing
 * statement fields never said what they were (47). Services are
 * repaired one at a time below; the list grows as each lands. Same
 * publication rule: a NEW version per repaired service; the
 * previous version stays pinned. */

/** Services whose next version carries the QAFIX-09 repairs. */
export const qaFix9Services: readonly number[] = deepFreeze([43, 44, 45, 46, 47]);

/**
 * Service 43 (§3.43; §4 items 6/11/12): the certificate exists to
 * put a dropped name back on the voter list, yet the form asked
 * for none of the facts the office needs to find the dropped
 * entry — no voter ID, no serial, no ward, no date of omission —
 * and its one reference field never said WHAT to write in it.
 * Template-first check (certificate-template-v7): ATTESTATIONS[43]
 * prints only the omission-reason pair; the reference, the ID,
 * the serial, the ward and the date have no printed slot — they
 * are the office's lookup keys, the evidence the chairman judges
 * before attesting the reason (the Form 33 pattern). Repairs:
 * (a) `previous_voter_reference` gains guidance text: it is the
 *     previous voter AREA reference that complements the new
 *     identifier fields;
 * (b) `previous_voter_id` (required) and `previous_voter_serial`
 *     (optional — many citizens know one identifier, not both)
 *     capture the dropped entry's identifiers;
 * (c) `omission_ward_no` (required, 1–99) and `omission_date`
 *     (required, never in the future — the engine's `notFuture`
 *     constraint, QAFIX-06) capture where and when the name was
 *     dropped — the core facts of this certificate (§4 item 6);
 * (d) `omission_details_en` becomes required, mirroring its Bangla
 *     original — one required-ness rule per pair (§4 item 11),
 *     and the pair the issuance gate checks (cert-gates
 *     LANGUAGE_PAIRS[43]) is always complete; the pair already
 *     sits adjacently ahead of the documents group in the schema.
 * The name spelling (§4 item 12) is repaired in the catalogues,
 * not the schema: the form labels and the certificate already use
 * the decomposed ড + ় (U+09A1 U+09BC), while both catalogue
 * files carried the precomposed ড় (U+09DC) in this service's
 * name — normalised there so list, review and certificate agree.
 */
function buildQaFix9VoterListInclusion(previous: FormSchema): FormSchema {
  const voterId: FieldDefinition = {
    id: "previous_voter_id",
    type: "text",
    label: t("ভোটার আইডি নম্বর", "Voter ID number"),
    constraints: { required: true, maxLength: 30 },
  };
  const voterSerial: FieldDefinition = {
    id: "previous_voter_serial",
    type: "text",
    label: t("ভোটার সিরিয়াল নম্বর", "Voter serial number"),
    constraints: { maxLength: 30 },
  };
  const wardNo: FieldDefinition = {
    id: "omission_ward_no",
    type: "number",
    label: t("ওয়ার্ড নম্বর", "Ward number"),
    constraints: { required: true, min: 1, max: 99 },
  };
  const omissionDate: FieldDefinition = {
    id: "omission_date",
    type: "date",
    label: t("তালিকা থেকে বাদ পড়ার তারিখ", "Date of omission"),
    constraints: { required: true, notFuture: true },
  };
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-09) captures the dropped voter entry's identifiers (voter ID, serial, ward and the date of omission), tells the citizen what the previous-voter reference field is for, and makes the English omission details required like its Bangla original. The certificate prints the omission-reason pair only, so the identifiers are the office's lookup evidence.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      return {
        ...section,
        fields: section.fields.flatMap((field) => {
          if (field.id === "previous_voter_reference")
            return [
              {
                ...field,
                description: t(
                  "আগের ভোটার এলাকার নাম লিখুন — যে এলাকার ভোটার তালিকায় আপনার নাম ছিল।",
                  "Write the name of your previous voter area — the area in whose voter list your name appeared.",
                ),
              },
              voterId,
              voterSerial,
              wardNo,
              omissionDate,
            ];
          if (field.id === "omission_details_en")
            return [
              {
                ...field,
                constraints: { ...field.constraints, required: true },
              },
            ];
          return [field];
        }),
      };
    }),
  });
}

/**
 * §4 item 7 — how the previous marriage ended, for service 44.
 * The certificate's attestation branches on this value (the death
 * sentences are the historical text, unchanged for pinned
 * payloads, which carry no value and take the death branch).
 */
const qaFix9MarriageEndOptions: FieldDefinition["options"] = [
  option("spouse_death", "স্বামী/স্ত্রীর মৃত্যু", "Death of spouse"),
  option("divorce", "বিবাহ বিচ্ছেদ (তালাক)", "Divorce"),
];

/**
 * Service 44 (§3.44; §4 items 6/7/11): the form assumed
 * widowhood — the spouse's death date was REQUIRED and there was
 * no divorce path at all, so a divorced applicant could not
 * complete it truthfully — and the non-remarriage declaration was
 * a free-text textarea, forcing the citizen to compose the legal
 * declaration the office is supposed to attest. Template-first
 * check (certificate-template-v7): ATTESTATIONS[44] prints the
 * spouse's name and the death date in a fixed widowhood sentence
 * and NEVER prints the declaration text (it is office evidence);
 * the attestation now branches on the new `marriage_end_type`
 * (divorce prints a divorce sentence with the divorce date;
 * absent/pinned payloads print the historical death sentences
 * byte-identically). Repairs:
 * (a) `marriage_end_type` — a required select (death of spouse /
 *     divorce) after the spouse-name pair;
 * (b) `spouse_death_date` shows and is required only on the death
 *     path, `divorce_date` only on the divorce path (each also
 *     `notFuture`); the date block moves ahead of the documents
 *     group, where a core fact belongs (§4 item 6);
 * (c) the declaration textarea is replaced by a FIXED declaration
 *     checkbox (`non_remarriage_declaration_confirmed`,
 *     mustBeTrue — the Form 34 pattern): the citizen confirms the
 *     office's words instead of composing their own;
 * (d) `previous_spouse_name_en` becomes required, mirroring its
 *     Bangla original (§4 item 11) — the pair cert-gates checks
 *     at issuance (LANGUAGE_PAIRS[44]) is always complete, and
 *     the pair already sits adjacently in the schema.
 */
function buildQaFix9NonRemarriage(previous: FormSchema): FormSchema {
  const marriageEndType: FieldDefinition = {
    id: "marriage_end_type",
    type: "select",
    label: t("পূর্বের বিবাহের অবসান যেভাবে ঘটেছে", "How the previous marriage ended"),
    constraints: { required: true },
    options: qaFix9MarriageEndOptions,
  };
  const divorceDate: FieldDefinition = {
    id: "divorce_date",
    type: "date",
    label: t("বিবাহ বিচ্ছেদের তারিখ", "Date of divorce"),
    constraints: { required: true, notFuture: true },
    visibleWhen: { field: "marriage_end_type", equals: "divorce" },
  };
  const declaration: FieldDefinition = {
    id: "non_remarriage_declaration_confirmed",
    type: "checkbox",
    label: t(
      "আমি ঘোষণা করছি যে, পূর্বের বিবাহের অবসানের পর থেকে আমি পুনরায় বিবাহ বন্ধনে আবদ্ধ হইনি।",
      "I declare that I have not remarried since the end of my previous marriage.",
    ),
    constraints: { required: true, mustBeTrue: true },
  };
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-09) lets the applicant state how the previous marriage ended (the spouse's death or a divorce) and demands the matching date, replaces the free-text declaration with a fixed declaration the citizen confirms, and makes the English spouse name required like its Bangla original. The certificate attests the matching end-of-marriage sentence; the declaration itself is office evidence and never printed.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      // The shipped order seats the death date AFTER the documents
      // group; the repaired block (end type, both gated dates, the
      // fixed declaration) is assembled where the spouse-name pair
      // ends, ahead of the documents.
      const deathDate = section.fields.find(
        (field) => field.id === "spouse_death_date",
      );
      return {
        ...section,
        fields: section.fields.flatMap((field) => {
          if (field.id === "previous_spouse_name_en")
            return [
              {
                ...field,
                constraints: { ...field.constraints, required: true },
              },
              marriageEndType,
              ...(deathDate
                ? [
                    {
                      ...deathDate,
                      constraints: {
                        ...deathDate.constraints,
                        required: true,
                        notFuture: true,
                      },
                      visibleWhen: {
                        field: "marriage_end_type",
                        equals: "spouse_death",
                      },
                    },
                  ]
                : []),
              divorceDate,
              declaration,
            ];
          if (
            field.id === "spouse_death_date" ||
            field.id === "non_remarriage_declaration"
          )
            return [];
          return [field];
        }),
      };
    }),
  });
}

/**
 * Service 45 (§3.45; §4 items 5/6): the permanent-resident form
 * was the catalogue's outlier — hand-authored with its own
 * sections, NO supporting-documents step at all (although §4
 * item 6 names residence proof as this service's core evidence)
 * and no applicable-address select, although every sibling asks
 * which saved address the certificate should carry. Repairs:
 * (a) `address_source` — the standard application-context field
 *     (same label, guidance and options as every sibling), seated
 *     in the residency section ahead of the purpose field, the
 *     position the context block occupies elsewhere;
 * (b) `supporting_documents` — the standard upload group (same
 *     children as every sibling) closing the residency section,
 *     with §4 item 5 named-evidence guidance (residence proof:
 *     holding-tax receipt, utility bill, house/land document)
 *     and `minRows: 1`, so the step cannot be skipped silently.
 * Two findings needed no schema change and are recorded in the
 * evidence note: the delivery-language label already reads নথির
 * ভাষা in the published schema (QAFIX-01 rewrites every
 * `delivery_language` label), and the "বেলাব/Belab" village
 * prefill is the citizen's saved profile free text (the Form 37
 * limit — no schema lever exists).
 */
function buildQaFix9PermanentResident(previous: FormSchema): FormSchema {
  const addressSource: FieldDefinition = {
    id: "address_source",
    type: "select",
    label: t("প্রযোজ্য নাগরিক ঠিকানা", "Applicable citizen address"),
    description: t(
      "এই আবেদনের জন্য সনদে যেই ঠিকানা ব্যবহার করা হবে।",
      "The citizen address that will be used on the certificate for this application.",
    ),
    constraints: { required: true },
    options: [
      option("present", "বর্তমান ঠিকানা", "Present address"),
      option("permanent", "স্থায়ী ঠিকানা", "Permanent address"),
      option("both", "বর্তমান ও স্থায়ী ঠিকানা", "Present and permanent addresses"),
    ],
  };
  const supportingDocuments: FieldDefinition = {
    ...uploadGroup,
    description: t(
      "বাসস্থানের প্রমাণ আপলোড করুন — যেমন হোল্ডিং কর রসিদ, বিদ্যুৎ বা পানির বিল, অথবা বাড়ি/জমির দলিলের অনুলিপি (PDF, PNG বা JPEG; সর্বোচ্চ 2 MiB)।",
      "Upload proof of residence — for example a holding-tax receipt, an electricity or water bill, or a copy of the house or land deed (PDF, PNG or JPEG; maximum 2 MiB).",
    ),
    constraints: { ...uploadGroup.constraints, minRows: 1 },
  };
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-09) asks which saved citizen address the certificate carries and requires at least one proof-of-residence document, closing the two gaps that made this form the catalogue's outlier.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "residency") return section;
      return {
        ...section,
        fields: [
          ...section.fields.flatMap((field) =>
            field.id === "purpose" ? [addressSource, field] : [field],
          ),
          supportingDocuments,
        ],
      };
    }),
  });
}

/**
 * Service 46 (§3.46; §4 items 6/9): the vehicle-licence form
 * demanded a licence number from EVERY applicant although a
 * first-time applicant has none, carried a dimension field whose
 * Bangla label was truncated to the meaningless "বাগা", left the
 * proprietor's mobile optional (service 42's trade licence
 * requires it), asked for the proprietor's spouse's name — a
 * copied component with no bearing on a vehicle licence — and
 * offered only rickshaw/van/mishuk/other as vehicle classes.
 * Template-first check (certificate-template-v7): the transport
 * card resolves the class through the SCHEMA's options
 * (`selectLabel`), so new options print correctly with no
 * template change, and nothing prints the licence number, the
 * mobile or the spouse names. Repairs:
 * (a) `has_existing_transport_license` — a plain required
 *     checkbox (the Form 42 pattern: required to ANSWER, not
 *     required to tick) ahead of the licence number;
 *     `transport_license_no` shows and is required only when it
 *     is ticked;
 * (b) `transport_license_height` gets its full label back —
 *     "উচ্চতা সংখ্যায় (ইংরেজিতে)", matching its length/width
 *     siblings;
 * (c) `transport_license_mobile` becomes required;
 * (d) the proprietor spouse-name pair is removed;
 * (e) the vehicle-class select gains motorcycle and car ahead
 *     of "other" (§4 item 9 — closed options with labels).
 */
function buildQaFix9VehicleLicence(previous: FormSchema): FormSchema {
  const hasExistingLicense: FieldDefinition = {
    id: "has_existing_transport_license",
    type: "checkbox",
    label: t(
      "আমার আগের যানবাহন লাইসেন্স আছে",
      "I already have a vehicle licence",
    ),
    constraints: { required: true },
  };
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-09) asks for a licence number only from applicants who already hold one, restores the height field's full label, requires the proprietor's mobile, drops the copied spouse-name pair and adds motorcycle and car to the vehicle classes.`,
    },
    sections: previous.sections.map((section) => {
      if (section.id !== "service_details") return section;
      return {
        ...section,
        fields: section.fields.flatMap((field) => {
          if (
            field.id === "proprietor_spouse_name_bn" ||
            field.id === "proprietor_spouse_name"
          )
            return [];
          if (field.id === "transport_license_no")
            return [
              hasExistingLicense,
              {
                ...field,
                visibleWhen: {
                  field: "has_existing_transport_license",
                  equals: true,
                },
              },
            ];
          if (field.id === "transport_license_height")
            return [
              {
                ...field,
                label: t(
                  "উচ্চতা সংখ্যায় (ইংরেজিতে)",
                  field.label.en ?? "Transport license height",
                ),
              },
            ];
          if (field.id === "transport_license_mobile")
            return [
              {
                ...field,
                constraints: { ...field.constraints, required: true },
              },
            ];
          if (field.id === "transport_vehicle_class")
            return [
              {
                ...field,
                options: [
                  ...(field.options ?? []).filter(
                    (option) => option.value !== "other",
                  ),
                  option("motorcycle", "মোটরসাইকেল", "Motorcycle"),
                  option("car", "কার / প্রাইভেট কার", "Car / private car"),
                  ...(field.options ?? []).filter(
                    (option) => option.value === "other",
                  ),
                ],
              },
            ];
          return [field];
        }),
      };
    }),
  });
}

/**
 * Service 47 (§3.47): the miscellaneous certificate's two
 * closing-text fields were labelled only "পরিশেষ" ("in
 * conclusion") — a citizen cannot tell that this is the
 * certificate's closing statement, or what to write in it.
 * Template-first check (certificate-template-v7): the body
 * prints `certificate_details_*` and then the footer verbatim as
 * the document's free-footer — the closing statement is exactly
 * what the field holds. Repairs (form-side only):
 * (a) both footer fields are relabelled "সনদের সমাপনী বক্তব্য"
 *     (certificate closing statement) and gain guidance saying
 *     what the line is, giving an example, and noting the
 *     certificate is issued without it (they stay optional);
 * Two findings needed no change and are recorded in the evidence
 * note: the fields already sit as adjacent BN/EN pairs in the
 * published schema (the language-grouped layout the QA saw was
 * the r8 build), and "নেওয়ার" in the reason label is already
 * spelled with the decomposed য় (U+09AF U+09BC) — both
 * probe-verified.
 */
function buildQaFix9Miscellaneous(previous: FormSchema): FormSchema {
  const closingGuidance = t(
    "সনদের একদম শেষে ছাপা হবে এমন সমাপনী লাইন — যেমন শুভেচ্ছা বা ধন্যবাদ জানিয়ে একটি বাক্য। না লিখলেও সনদ তৈরি হবে।",
    "A closing line printed at the very end of the certificate — for example a sentence of good wishes or thanks. The certificate is still issued if you leave it empty.",
  );
  return deepFreeze({
    ...previous,
    version: previous.version + 1,
    evidence: {
      ...previous.evidence,
      limitation: `${previous.evidence.limitation} Version ${previous.version + 1} (QAFIX-09) renames the closing-text fields to say plainly that they hold the certificate's closing statement and explains what to write; they remain optional.`,
    },
    sections: previous.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => {
        if (field.id === "certificate_footer_bn")
          return {
            ...field,
            label: t(
              "সনদের সমাপনী বক্তব্য (বাংলায়)",
              "Certificate closing statement (Bangla)",
            ),
            description: closingGuidance,
          };
        if (field.id === "certificate_footer_en")
          return {
            ...field,
            label: t(
              "সনদের সমাপনী বক্তব্য (ইংরেজিতে)",
              "Certificate closing statement (English)",
            ),
            description: closingGuidance,
          };
        return field;
      }),
    })),
  });
}

/** QAFIX-09: publish the repair version of a service's current schema. */
export function buildQaFix9Version(previous: FormSchema): FormSchema {
  switch (previous.serviceNo) {
    case 43:
      return buildQaFix9VoterListInclusion(previous);
    case 44:
      return buildQaFix9NonRemarriage(previous);
    case 45:
      return buildQaFix9PermanentResident(previous);
    case 46:
      return buildQaFix9VehicleLicence(previous);
    case 47:
      return buildQaFix9Miscellaneous(previous);
    default:
      throw new RangeError(
        `Service ${previous.serviceNo} has no QAFIX-09 version.`,
      );
  }
}

/** An example fixture builder. Optional uploads are omitted because only the API can create authorized handles. */
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
      else if (field.type === "geography")
        result[field.id] = { ...syntheticGeography };
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
            ? "উদাহরণ তথ্য"
            : field.id === "correct_info"
              ? "Corrected information"
              : "Sample information"
        ).slice(0, field.constraints?.maxLength ?? 200);
    }
    return result;
  }
  return build(flattenFields(schema));
}
