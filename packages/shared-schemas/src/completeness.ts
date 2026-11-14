/**
 * Phase 3b: how complete a citizen profile is, shared by the API (authoritative, used by the issuance gate)
 * and the web app (indicator). Input is the citizen as the API returns it.
 *
 * Required (owner decision, docs/PHASE3_PLAN.md): Bangla and English name, date of birth, registered address
 * in both languages, the address area when the office uses structured geography, an NID or birth-registration
 * number, and a mobile number or an explicit "no mobile" declaration. Gender, parents, spouse, blood group and
 * the document image are optional and do not count.
 */
export type CompletenessItem =
  | "name"
  | "dateOfBirth"
  | "address"
  | "geography"
  | "identityNumber"
  | "mobile";
export const completenessLabels: Record<CompletenessItem, { bn: string; en: string }> = {
  name: { bn: "বাংলা ও ইংরেজি নাম", en: "Name in Bangla and English" },
  dateOfBirth: { bn: "জন্ম তারিখ", en: "Date of birth" },
  address: { bn: "স্থায়ী ঠিকানা (বাংলা ও ইংরেজি)", en: "Permanent address in Bangla and English" },
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
  const checks: [CompletenessItem, boolean][] = [
    ["name", filled(citizen?.nameBn) && filled(citizen?.nameEn)],
    ["dateOfBirth", filled(citizen?.dateOfBirth)],
    ["address", filled(citizen?.addressBn) && filled(citizen?.addressEn)],
    ["identityNumber", filled(citizen?.nidHint) || filled(citizen?.birthRegHint)],
    ["mobile", filled(citizen?.contactMobile) || citizen?.noMobile === true],
  ];
  if (options.geographyRequired) checks.push(["geography", filled(citizen?.geography?.wardCode)]);
  const missing = checks.filter(([, ok]) => !ok).map(([item]) => item);
  const percent = Math.floor(((checks.length - missing.length) / checks.length) * 100);
  return { percent, complete: missing.length === 0, missing };
}
