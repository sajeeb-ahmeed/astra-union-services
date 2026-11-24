import { ApiError } from "./models.js";
import { certificateAssetsBundle } from "./template-assets.js";

/**
 * CERT-REFINE-01 issuance gates. All three apply in OFFICIAL mode only —
 * demo tenants are a sandbox and keep the pre-refinement behaviour.
 *
 * 1. SIGNATURE_MISSING — the QA found every production certificate printing
 *    an empty signature line (G5). When no chairman signature asset is
 *    configured for the office (profile upload or legacy drop-in), the
 *    approval is recorded but issuance blocks until one is uploaded.
 * 2. AMOUNTS_REQUIRED — money documents never issue blank (A10): service 1
 *    needs its order snapshot; services 41/42 need fee components captured
 *    on the application or an order snapshot. A zero total is data; a
 *    missing total is not.
 * 3. LANGUAGE_VALUE_MISSING — every value slot renders from a BN/EN pair
 *    (A9). When exactly one side of a pair is present, the other language's
 *    document would print a fallback or leak the wrong language, so
 *    issuance blocks naming the missing field.
 */
const present = (v: unknown) =>
  v !== undefined && v !== null && String(v).trim() !== "";

/** [banglaKey, englishKey] pairs per service (CERT-REFINE-01 A9). */
const LANGUAGE_PAIRS: Record<number, [string, string][]> = {
  10: [["last_occupation", "last_occupation_en"]],
  // Service 11 has no pair: QAFIX-03 made the declared nationality a
  // single bilingual select, and both language documents render the
  // chosen value from the certificate's label map (NATIONALITY_LABELS).
  16: [["deceased_spouse_name", "deceased_spouse_name_en"]],
  // 18 removed by QAFIX-04 (the community-name pair collapsed into the
  // single bilingual select; the value now comes from the certificate's
  // label map, COMMUNITY_LABELS).
  20: [
    [
      "freedom_fighter_service_narrative_bn",
      "freedom_fighter_service_narrative_en",
    ],
  ],
  21: [["farming_activity", "farming_activity_en"]],
  24: [
    ["orphan_father_name_bn", "orphan_father_name_en"],
    ["orphan_mother_name_bn", "orphan_mother_name_en"],
    ["orphan_guardian_name_bn", "orphan_guardian_name_en"],
  ],
  25: [
    ["marriage_info_spouse_father_name_bn", "marriage_info_spouse_father_name_en"],
    ["marriage_info_spouse_mother_name_bn", "marriage_info_spouse_mother_name_en"],
    ["marriage_info_spouse_address_bn", "marriage_info_spouse_address_en"],
  ],
  26: [
    ["marriage_info_spouse_father_name_bn", "marriage_info_spouse_father_name_en"],
    ["marriage_info_spouse_mother_name_bn", "marriage_info_spouse_mother_name_en"],
    ["marriage_info_spouse_address_bn", "marriage_info_spouse_address_en"],
  ],
  30: [["financial_basis", "financial_basis_en"]],
  32: [["earner_occupation_bn", "earner_occupation_en"]],
  36: [
    ["noc_role_bn", "noc_role_en"],
    ["noc_activity_bn", "noc_activity_en"],
  ],
  37: [["previous_voter_area", "previous_voter_area_en"]],
  38: [["support_needs", "support_needs_en"]],
  39: [
    ["spi_name_bn", "spi_name_en"],
    ["spi_name_2_bn", "spi_name_2_en"],
  ],
  43: [["omission_details", "omission_details_en"]],
  44: [["previous_spouse_name", "previous_spouse_name_en"]],
};

const TRADE_FEE_KEYS = [
  "trade_fee_new",
  "trade_fee_renewal",
  "trade_fee_arrear",
  "trade_fee_surcharge",
  "trade_fee_amendment",
  "trade_fee_signboard",
  "trade_fee_profession_tax",
  "trade_fee_vat",
];

export function assertCertificateGates(prepared: any): void {
  if (process.env.ISSUANCE_MODE !== "official") return;
  const serviceNo = Number(
    prepared?.service?.service_no ?? prepared?.r?.service_no ?? 0,
  );
  const payload: Record<string, unknown> = prepared?.payload ?? {};
  const order = prepared?.pdfExtras?.order ?? null;

  // 1 — signature asset gate.
  const bundle = certificateAssetsBundle(
    prepared?.tenant?.id,
    prepared?.pdfExtras?.assets,
    prepared?.pdfExtras?.issuer,
  );
  if (!bundle.signature) {
    throw new ApiError(
      422,
      "SIGNATURE_MISSING",
      "স্বাক্ষর আপলোড করা হয়নি — no chairman signature is configured for this office. Upload the signature under the office certificate assets, then complete the issuance.",
    );
  }

  // 2 — mandatory money data for the money documents.
  if (serviceNo === 1 && !order) {
    throw new ApiError(
      422,
      "AMOUNTS_REQUIRED",
      "The holding-tax receipt cannot be issued without its order amounts.",
    );
  }
  if (
    serviceNo === 41 &&
    !present(payload.premises_fee_licence) &&
    !present(payload.premises_fee_vat) &&
    !order
  ) {
    throw new ApiError(
      422,
      "AMOUNTS_REQUIRED",
      "The premises licence cannot be issued with a blank fee block: capture the licence fee/VAT on the application or complete its order.",
    );
  }
  if (
    serviceNo === 42 &&
    !TRADE_FEE_KEYS.some((key) => present(payload[key])) &&
    !order
  ) {
    throw new ApiError(
      422,
      "AMOUNTS_REQUIRED",
      "The trade licence cannot be issued with a blank fee block: capture the fee components on the application or complete its order.",
    );
  }

  // 3 — BN/EN pair completeness.
  const missing: string[] = [];
  for (const [bnKey, enKey] of LANGUAGE_PAIRS[serviceNo] ?? []) {
    const b = present(payload[bnKey]);
    const e = present(payload[enKey]);
    if (b && !e) missing.push(enKey);
    else if (e && !b) missing.push(bnKey);
  }
  if (serviceNo === 1) {
    // The receipt reads property_description_bn/en, each falling back to
    // the legacy single field; the legacy value covers both languages.
    const legacy = present(payload.property_description);
    const b = present(payload.property_description_bn);
    const e = present(payload.property_description_en);
    if (!legacy && b !== e) missing.push(b ? "property_description_en" : "property_description_bn");
  }
  if (missing.length) {
    throw new ApiError(
      422,
      "LANGUAGE_VALUE_MISSING",
      `Issuance is blocked: the application is missing the paired-language value(s): ${missing.join(", ")}. Both language versions of the certificate must render from their own values.`,
      { missing },
    );
  }
}
