import { geographyRow, presentAddressRow } from "./geography.js";
export const camelRow = (row: any) =>
  row
    ? Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
          v,
        ]),
      )
    : null;
export const citizenRow = (r: any) =>
  r
    ? {
        id: r.id,
        tenantId: r.tenant_id,
        userId: r.user_id,
        nameBn: r.full_name_bn,
        nameEn: r.full_name_en,
        dateOfBirth:
          typeof r.date_of_birth === "string"
            ? r.date_of_birth
            : r.date_of_birth?.toISOString().slice(0, 10),
        addressBn: r.address_bn,
        addressEn: r.address_en,
        syntheticReference: r.synthetic_reference,
        verificationState: r.verification_state,
        geography: geographyRow(r),
        presentAddress: presentAddressRow(r),
        // Phase 3a details. NID/birth-registration numbers appear only as masked hints here;
        // the full numbers come from GET /citizens/:id/identity, which is audited.
        gender: r.gender ?? null,
        fatherNameBn: r.father_name_bn ?? null,
        fatherNameEn: r.father_name_en ?? null,
        motherNameBn: r.mother_name_bn ?? null,
        motherNameEn: r.mother_name_en ?? null,
        spouseNameBn: r.spouse_name_bn ?? null,
        spouseNameEn: r.spouse_name_en ?? null,
        bloodGroup: r.blood_group ?? null,
        nidHint: r.nid_hint ?? null,
        birthRegHint: r.birth_reg_hint ?? null,
        contactMobile: r.contact_mobile ?? null,
        noMobile: r.no_mobile ?? false,
        createdAt: r.created_at,
      }
    : null;
/**
 * The plaintext verification token is never stored (migration 017), so `verificationUrl` is only
 * present in the issuance response that created the certificate; later reads return null.
 */
export const certificateRow = (r: any, verificationUrl: string | null = null) =>
  r
    ? {
        id: r.id,
        applicationId: r.application_id,
        number: r.number,
        serviceNo: r.service_no,
        templateVersion: r.template_version,
        status: r.status,
        issuedAt: r.issued_at,
        revokedAt: r.revoked_at,
        verificationUrl,
        pdfUrl: `/api/v1/certificates/${r.id}/pdf`,
        demo: true,
      }
    : null;
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues?: any,
  ) {
    super(message);
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}
