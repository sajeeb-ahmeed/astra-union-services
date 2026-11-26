/**
 * Phase 3b: how complete a citizen profile is, shared by the API (authoritative, used by the issuance gate)
 * and the web app (indicator). Input is the citizen as the API returns it.
 *
 * Required (owner decision, docs/PHASE3_PLAN.md; extended by Md's citizen dashboard+profile
 * decisions, 2026-11-26): Bangla and English name, date of birth, registered (permanent) address
 * in both languages, father's name in both languages, mother's name in both languages, gender,
 * blood group, the present address (the "same as permanent" declaration or both present-address
 * texts), the address area when the office uses structured geography, an NID or birth-registration
 * number, and a mobile number or an explicit "no mobile" declaration. The spouse name and the
 * document image (photo) are optional and do not count.
 */
export type CompletenessItem =
  | "name"
  | "dateOfBirth"
  | "address"
  | "fatherName"
  | "motherName"
  | "gender"
  | "bloodGroup"
  | "presentAddress"
  | "geography"
  | "identityNumber"
  | "mobile";
export const completenessLabels: Record<CompletenessItem, { bn: string; en: string }> = {
  name: { bn: "বাংলা ও ইংরেজি নাম", en: "Name in Bangla and English" },
  dateOfBirth: { bn: "জন্ম তারিখ", en: "Date of birth" },
  address: { bn: "স্থায়ী ঠিকানা (বাংলা ও ইংরেজি)", en: "Permanent address in Bangla and English" },
  fatherName: { bn: "পিতার নাম (বাংলা ও ইংরেজি)", en: "Father's name in Bangla and English" },
  motherName: { bn: "মাতার নাম (বাংলা ও ইংরেজি)", en: "Mother's name in Bangla and English" },
  gender: { bn: "লিঙ্গ", en: "Gender" },
  bloodGroup: { bn: "রক্তের গ্রুপ", en: "Blood group" },
  presentAddress: { bn: "বর্তমান ঠিকানা", en: "Present address" },
  geography: { bn: "ঠিকানার এলাকা (বিভাগ থেকে ওয়ার্ড)", en: "Address area (division to ward)" },
  identityNumber: { bn: "জাতীয় পরিচয়পত্র বা জন্ম নিবন্ধন নম্বর", en: "NID or birth registration number" },
  mobile: { bn: "মোবাইল নম্বর বা 'মোবাইল নেই' ঘোষণা", en: "Mobile number or a 'no mobile' declaration" },
};
export type ProfileCompleteness = {
  percent: number;
  complete: boolean;
  missing: CompletenessItem[];
};
const filled = (value: unknown) => typeof value === "string" && value.trim().length > 0;

export function citizenProfileCompleteness(
  citizen: any,
  options: { geographyRequired?: boolean } = {},
): ProfileCompleteness {
  const present = citizen?.presentAddress;
  const checks: [CompletenessItem, boolean][] = [
    ["name", filled(citizen?.nameBn) && filled(citizen?.nameEn)],
    ["dateOfBirth", filled(citizen?.dateOfBirth)],
    ["address", filled(citizen?.addressBn) && filled(citizen?.addressEn)],
    ["fatherName", filled(citizen?.fatherNameBn) && filled(citizen?.fatherNameEn)],
    ["motherName", filled(citizen?.motherNameBn) && filled(citizen?.motherNameEn)],
    ["gender", filled(citizen?.gender)],
    ["bloodGroup", filled(citizen?.bloodGroup)],
    [
      "presentAddress",
      present?.sameAsPermanent === true ||
        (filled(present?.addressBn) && filled(present?.addressEn)),
    ],
    ["identityNumber", filled(citizen?.nidHint) || filled(citizen?.birthRegHint)],
    ["mobile", filled(citizen?.contactMobile) || citizen?.noMobile === true],
  ];
  if (options.geographyRequired) checks.push(["geography", filled(citizen?.geography?.wardCode)]);
  const missing = checks.filter(([, ok]) => !ok).map(([item]) => item);
  const percent = Math.floor(((checks.length - missing.length) / checks.length) * 100);
  return { percent, complete: missing.length === 0, missing };
}

/**
 * REG-UX Phase 1 (design note §2.3): the items the one-screen signup defers — the
 * second-script name, date of birth, permanent address and the citizen's own ward.
 * A new application needs these (every certificate prints them); the NID/birth
 * number and mobile are NOT part of this gate (they stay with the issuance gate for
 * offices that turn require_complete_profile on). Returns the missing items only.
 * Unchanged by the 2026-11-26 required-set extension (Md's decision): the new items
 * count toward 100% and the issuance gate, never toward starting an application.
 */
export const APPLICATION_PROFILE_ITEMS: CompletenessItem[] = ["name", "dateOfBirth", "address", "geography"];
export function applicationProfileGaps(
  citizen: any,
  options: { geographyRequired?: boolean } = {},
): CompletenessItem[] {
  return citizenProfileCompleteness(citizen, options).missing.filter((item) =>
    APPLICATION_PROFILE_ITEMS.includes(item),
  );
}
