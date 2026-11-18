import fs from "node:fs";
import { createHmac, randomInt } from "node:crypto";
import { randomToken } from "./security.js";
import { citizenDataAvailable, decryptNumber } from "./citizen-data.js";
import type { DB } from "./db.js";

/**
 * Phase 5 (5C): public reference numbers for citizens and applications (owner decision, 18 Nov 2026).
 *
 * Format: 18 digits in three groups of six, displayed hyphenated — `dddddd-dddddd-dddddd` —
 * the hyphen grouping follows the certificate-number convention already used on paper documents.
 * - Segment 1: six digits derived from an HMAC of the citizen's date of birth.
 * - Segment 2: six digits derived from an HMAC of the citizen's NID when one is on file;
 *   otherwise from an HMAC of the citizen record's own id (see the fallback note below).
 * - Segment 3: six random digits, checked for uniqueness in the database with retries.
 *
 * Privacy: the segments are HMAC-SHA-256 output keyed with the platform identifier secret, so the
 * printed number contains no raw DOB or NID digits, and the small DOB/NID search spaces cannot be
 * brute-forced back from a segment without the server key. The same citizen always derives the
 * same first two segments; a reference, once minted, is stored and never recomputed or rewritten.
 *
 * Fallback (segment 2): a citizen reference is minted at registration, before any NID is normally
 * on file, and staff-created citizens may have neither an NID nor a login account. The stable
 * per-citizen attribute that always exists is the citizen row's own id, so segment 2 falls back to
 * an HMAC of that id. Registration and application creation never block on a missing NID or DOB
 * (date_of_birth is a NOT NULL column, so segment 1 always has its input).
 *
 * Legacy records keep their existing references (`REF-<uuid>` citizen references, UUID application
 * ids): lookups accept both the legacy forms and this format (see parseReferenceInput and the
 * /track + /applications/lookup handlers). Nothing already issued is renumbered.
 */

const secretFile = ".runtime/reference-secret";
let cachedSecret: string | null = null;
function referenceSecret(): string {
  if (cachedSecret) return cachedSecret;
  const configured = process.env.IDENTIFIER_SECRET;
  if (configured && configured.length >= 32) return (cachedSecret = configured);
  // Same safety net as identifiers.ts / citizen-data.ts: outside production a key file is kept so
  // local and test runs are stable across restarts. In production IDENTIFIER_SECRET is the
  // documented configuration (the identifier sign-in features already require it).
  try {
    if (!fs.existsSync(secretFile)) {
      fs.mkdirSync(".runtime", { recursive: true });
      fs.writeFileSync(secretFile, randomToken(), { mode: 0o600 });
    }
    return (cachedSecret = fs.readFileSync(secretFile, "utf8").trim());
  } catch {
    // Last resort (read-only filesystem without the env secret): references still mint, but the
    // derived segments change across restarts. Stored references are unaffected.
    return (cachedSecret = randomToken());
  }
}

const asciiDigits = (value: string) =>
  value.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));

/** Digits only (Bengali digits folded to ASCII, separators dropped). */
export const referenceDigits = (raw: unknown): string =>
  asciiDigits(String(raw ?? "")).replace(/\D/g, "");

/** `dddddd-dddddd-dddddd` for an 18-digit string. */
export const formatReference = (digits: string): string =>
  `${digits.slice(0, 6)}-${digits.slice(6, 12)}-${digits.slice(12, 18)}`;

/**
 * Canonical grouped form of a user-supplied reference, or null when the input is not an
 * 18-digit reference. Accepts the grouped form, plain digits and Bengali digits.
 */
export function parseReferenceInput(raw: unknown): string | null {
  const digits = referenceDigits(raw);
  return digits.length === 18 ? formatReference(digits) : null;
}

function hashSegment(namespace: string, value: string): string {
  const hex = createHmac("sha256", referenceSecret())
    .update(`astra-reference:${namespace}:${value}`)
    .digest("hex");
  return String(Number(BigInt(`0x${hex.slice(0, 12)}`) % 1_000_000n)).padStart(6, "0");
}

/** The two citizen-derived segments: [dobSegment, identitySegment]. */
export function referenceSegments(input: {
  dateOfBirth: string;
  nid?: string | null;
  citizenId: string;
}): [string, string] {
  return [
    hashSegment("dob", input.dateOfBirth),
    input.nid
      ? hashSegment("nid", input.nid)
      : hashSegment("citizen", input.citizenId),
  ];
}

/** node-pg returns `date` columns as Date objects; the ISO day is the derivation input either way. */
export const isoDate = (value: unknown): string =>
  typeof value === "string" ? value.slice(0, 10) : (value as Date).toISOString().slice(0, 10);

/**
 * The citizen's NID for segment derivation, when one is stored and the citizen-data key is
 * available to read it. Any failure (key unavailable, unreadable value) falls back to null —
 * minting a reference must never block on identity data.
 */
export function citizenNidForReference(citizen: any, tenantId: string): string | null {
  if (!citizen?.nid_cipher || !citizenDataAvailable()) return null;
  try {
    return decryptNumber(citizen.nid_cipher, tenantId, "nid");
  } catch {
    return null;
  }
}

/**
 * Mint a unique reference for a citizen: segments 1–2 derived from the citizen, segment 3 random
 * and checked through `exists` (scoped by the caller: per-tenant for citizens, global for
 * applications, whose references the public tracking page resolves without a tenant). After the
 * retry budget a final unchecked candidate is returned — the UNIQUE constraint remains the
 * backstop, and a collision there fails the request rather than issuing a duplicate.
 */
export async function mintReference(
  input: { dateOfBirth: string; nid?: string | null; citizenId: string },
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const [first, second] = referenceSegments(input);
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = formatReference(
      first + second + String(randomInt(0, 1_000_000)).padStart(6, "0"),
    );
    if (!(await exists(candidate))) return candidate;
  }
  return formatReference(
    first + second + String(randomInt(0, 1_000_000)).padStart(6, "0"),
  );
}

/** Existence check for a citizen reference inside one tenant (citizens.synthetic_reference scope). */
export const citizenReferenceExists =
  (db: DB, tenantId: string) => async (candidate: string) =>
    Boolean(
      (
        await db.query(
          "SELECT 1 FROM citizens WHERE tenant_id=$1 AND synthetic_reference=$2",
          [tenantId, candidate],
        )
      ).rowCount,
    );

/** Existence check for an application reference (globally unique: public tracking has no tenant). */
export const applicationReferenceExists =
  (db: DB) => async (candidate: string) =>
    Boolean(
      (await db.query("SELECT 1 FROM applications WHERE reference=$1", [candidate]))
        .rowCount,
    );
