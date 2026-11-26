import type { FormSchema } from "@astra/shared-schemas";

/**
 * PORTAL-B: form fields that ask again for what the citizen record already
 * holds. The form opens with these filled (still editable), so nobody types
 * the same address or parents' names twice.
 * QAFIX-01 (live QA §4 item 1): the map now covers every field id that asks
 * for the APPLICANT's own facts across the catalogue — the household head
 * (service 2), the proprietor (36/41/42/46) and the same-person subject
 * (39) are the applicant themselves. Fields that belong to OTHER people
 * (the deceased on warish/death forms, heirs, the spouse on marriage
 * forms, delegates, the related person on 39) are deliberately absent:
 * pre-filling them with the applicant's data would write wrong facts.
 * The citizen's NID is never in this map: the record the client holds
 * carries only a masked hint. WS-C (Md's decision): a self-applying
 * citizen's own NID is fetched through the audited reveal endpoint
 * (GET /citizens/:id/identity) inside ServiceFlow and filled from there —
 * never from the list/detail payload, and never for another person.
 * WS-C cleanup: dead entries father_name_*, mother_name_* and
 * spouse_name_* were deleted — no operational schema carries those bare
 * ids (schemas use prefixed ids). The mapping-existence test
 * (apps/web/test/citizen-prefill.test.ts) now pins every id below to a
 * real schema field so dead entries cannot creep back.
 */
export const CITIZEN_FIELD_SOURCES: Record<string, string> = {
  permanent_address_bn: "addressBn",
  permanent_address_en: "addressEn",
  date_of_birth: "dateOfBirth",
  // The applicant under another title: household head (2), proprietor
  // (36/41/42/46), the person both names belong to (39).
  household_name_bn: "nameBn",
  household_name_en: "nameEn",
  proprietor_name_bn: "nameBn",
  proprietor_name_en: "nameEn",
  proprietor_father_name_bn: "fatherNameBn",
  proprietor_father_name: "fatherNameEn",
  proprietor_mother_name_bn: "motherNameBn",
  proprietor_mother_name: "motherNameEn",
  proprietor_spouse_name_bn: "spouseNameBn",
  proprietor_spouse_name: "spouseNameEn",
  // QAFIX-07 (service 34): the childless attestation concerns the
  // applicant couple, so its spouse pair is the applicant's own.
  childless_spouse_name_bn: "spouseNameBn",
  childless_spouse_name: "spouseNameEn",
  noc_proprietor_bn: "nameBn",
  noc_proprietor: "nameEn",
  noc_mobile: "contactMobile",
  primises_license_proprietor_bn: "nameBn",
  primises_license_proprietor: "nameEn",
  transport_license_proprietor_bn: "nameBn",
  transport_license_proprietor: "nameEn",
  transport_license_mobile: "contactMobile",
  mobile: "contactMobile",
  spi_name_bn: "nameBn",
  spi_name_en: "nameEn",
  // WS-C (service 13, remarriage certificate): the schema label is
  // "স্বামী / স্ত্রীর নাম" (Husband/Wife name) and the certificate template
  // renders it as the person the applicant has remarried to
  // ("তিনি X এর সহিত … পুনরায় বিবাহ বন্ধনে আবদ্ধ হয়েছেন") — i.e. the
  // applicant's CURRENT spouse, which is exactly what the profile's one
  // spouse pair holds. Verified against the schema label and
  // certificate-template-v7 service 13 before mapping.
  application_husband_name_bn: "spouseNameBn",
  application_husband_name: "spouseNameEn",
};

/**
 * Field ids whose meaning depends on the service: on service 2 the
 * warish_info block describes the household head (the applicant), so the
 * head's parents and spouse are the applicant's own. On services 3/4 the
 * same ids describe the DECEASED — never prefilled there.
 */
export const CITIZEN_FIELD_SOURCES_BY_SERVICE: Record<
  number,
  Record<string, string>
> = {
  2: {
    warish_info_father_name_bn: "fatherNameBn",
    warish_info_father_name: "fatherNameEn",
    warish_info_mother_name_bn: "motherNameBn",
    warish_info_mother_name: "motherNameEn",
    warish_info_spouse_name_bn: "spouseNameBn",
    warish_info_spouse_name: "spouseNameEn",
  },
};

/**
 * WS-C: values derived from the citizen record rather than copied from
 * one key. Explicit functions, never magic: each entry names the field
 * it fills and computes it from named record keys. Number fields are
 * the only non-string defaults (DynamicForm stores real numbers).
 */
export const CITIZEN_COMPUTED_SOURCES: Record<
  string,
  (citizen: any) => string | number | undefined
> = {
  // Service 15 (voter certificate) asks the applicant's age in years;
  // the record holds the date of birth, so the age is derived from it.
  voter_age: (citizen) => {
    const dob = typeof citizen?.dateOfBirth === "string" ? citizen.dateOfBirth : "";
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
    if (!match) return undefined;
    const birth = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    const now = new Date();
    let age = now.getUTCFullYear() - birth.getUTCFullYear();
    const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate()))
      age -= 1;
    return age >= 0 && age <= 120 ? age : undefined;
  },
};

/** Starting values for a new application: top-level text/date/number fields only. */
export function citizenFormDefaults(
  schema: FormSchema,
  citizen: any,
): Record<string, string | number> {
  const defaults: Record<string, string | number> = {};
  if (!citizen) return defaults;
  const sources = {
    ...CITIZEN_FIELD_SOURCES,
    ...(CITIZEN_FIELD_SOURCES_BY_SERVICE[schema.serviceNo] ?? {}),
  };
  for (const section of schema.sections)
    for (const field of section.fields) {
      const computed = CITIZEN_COMPUTED_SOURCES[field.id];
      if (computed && field.type === "number") {
        const value = computed(citizen);
        if (value !== undefined) defaults[field.id] = value;
        continue;
      }
      const source = sources[field.id];
      if (!source || !["text", "textarea", "date"].includes(field.type)) continue;
      const value = citizen[source];
      if (typeof value === "string" && value.trim()) defaults[field.id] = value.trim();
    }
  return defaults;
}
