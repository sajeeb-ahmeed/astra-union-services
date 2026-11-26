import assert from "node:assert/strict";
import type { APIRequestContext } from "playwright";

/**
 * W-002: issuance gates run in every mode. A certificate cannot issue
 * without a chairman signature configured for the office (the seed gives
 * alpha only a SEAL), and a money service (1/41/42) cannot issue without
 * an order snapshot, which needs a published fee policy. Browser tests
 * that issue use the same explicitly identified synthetic fixtures the
 * API suite uses — a 1x1 PNG signature and a zero-fee policy — uploaded
 * through the office APIs with a reason that says they are not real.
 * Both are append-only/versioned, so calling these in a test that runs
 * twice replaces (200) instead of failing; nothing here bypasses a gate,
 * the gates still run and still pass or fail on the data in front of them.
 */
export const SYNTHETIC_SIGNATURE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
export const SYNTHETIC_SIGNATURE_REASON =
  "Synthetic signature fixture for demo-mode issuance regression (W-002); not a real chairman signature";
export const SYNTHETIC_POLICY_REASON =
  "Synthetic zero-fee policy for demo-mode issuance regression (W-002); not a government tariff";

/** Upload (or replace) the synthetic chairman signature for the caller's office. */
export async function ensureSyntheticSignature(
  request: APIRequestContext,
  origin: string,
  csrfToken: string,
): Promise<void> {
  const res = await request.put(
    `${origin}/api/v1/office/certificate-assets/signature`,
    {
      data: {
        mimeType: "image/png",
        base64: SYNTHETIC_SIGNATURE_BASE64,
        reason: SYNTHETIC_SIGNATURE_REASON,
      },
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
    },
  );
  assert.ok([200, 201].includes(res.status()), await res.text());
}

/** Publish a synthetic zero-fee order policy for a service (first version only). */
export async function publishZeroFeePolicy(
  request: APIRequestContext,
  origin: string,
  csrfToken: string,
  serviceNo: number,
): Promise<void> {
  const res = await request.post(
    `${origin}/api/v1/admin/services/${serviceNo}/order-policies`,
    {
      data: {
        expectedVersion: 0,
        reason: SYNTHETIC_POLICY_REASON,
        statutoryFeeMinor: 0,
        processingFeeMinor: 0,
        emergencySurchargeMinor: 0,
        deliveryFeesMinor: { office_collection: 0, digital_copy: 0 },
        deliveryModes: ["office_collection", "digital_copy"],
        urgencies: ["normal"],
      },
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
    },
  );
  assert.equal(res.status(), 201, await res.text());
}
