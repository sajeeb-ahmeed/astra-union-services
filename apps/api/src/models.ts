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
