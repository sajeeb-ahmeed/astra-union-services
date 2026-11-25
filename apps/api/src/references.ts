import { randomInt } from "node:crypto";
import { dhakaDateStamp } from "./dhaka.js";
import type { DB } from "./db.js";

/**
 * Public reference numbers.
 *
 * CERTNO-01 (owner-approved 18 Nov 2026) replaces the Phase 5 format: a
 * reference is now 16 consecutive digits — the Asia/Dhaka calendar date of
 * registration/submission (YYYYMMDD) followed by 8 random digits — the same
 * pattern as the certificate number. It is stored plain (no hyphens) and is
 * uniqueness-checked at mint time exactly like before.
 *
 * Phase 5 references (18 digits in three hyphenated groups of six, derived
 * from keyed hashes of the citizen's DOB and NID) remain stored on records
 * created before this change and keep resolving: the input parser still
 * canonicalises them. Legacy citizen references (REF-<uuid>) and application
 * UUIDs are untouched by this module and resolve through their own paths.
 */

const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Digits only (Bengali digits folded to ASCII, separators dropped). */
export function referenceDigits(value: unknown): string {
  return String(value ?? "")
    .replace(/[০-৯]/g, (d) => String(BENGALI_DIGITS.indexOf(d)))
    .replace(/\D/g, "");
}

/** Eight cryptographically random digits, zero-padded. */
export function randomEightDigits(): string {
  return String(randomInt(0, 100_000_000)).padStart(8, "0");
}

/**
 * Ten cryptographically random digits, zero-padded — the random part of
 * the certificate number since CERTNO-DDMM (owner order, 25 Nov 2026:
 * DDMM + 10 random digits = 14 digits, never duplicated). Uses the same
 * node:crypto source as randomEightDigits (never Math.random).
 */
export function randomTenDigits(): string {
  return String(randomInt(0, 10_000_000_000)).padStart(10, "0");
}

/**
 * Mint a fresh 16-digit reference: Dhaka date + 8 random digits. `exists`
 * reports whether a candidate is already taken in the caller's scope; the
 * mint retries on collision and gives up after a bounded number of attempts
 * (the same contract the Phase 5 mint had).
 */
export async function mintReference(
  exists: (candidate: string) => Promise<boolean>,
  at: Date = new Date(),
): Promise<string> {
  const prefix = dhakaDateStamp(at);
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = `${prefix}${randomEightDigits()}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error("REFERENCE_GENERATION_FAILED");
}

/**
 * Display grouping for a stored reference: CERTNO-01 references group by four
 * (dddd-dddd-dddd-dddd); legacy Phase 5 references keep their groups of six.
 * Display only — storage is always the plain digit string (16) or the legacy
 * hyphenated form (18) exactly as minted.
 */
export function formatReference(digits: string): string {
  const plain = referenceDigits(digits).replace(/\D/g, "");
  if (plain.length === 18) return plain.replace(/(\d{6})(\d{6})(\d{6})/, "$1-$2-$3");
  if (plain.length === 16) return plain.replace(/(\d{4})(\d{4})(\d{4})(\d{4})/, "$1-$2-$3-$4");
  return digits;
}

/**
 * Canonicalise a typed/pasted reference to its stored form, or null when the
 * input is not a reference at all. Accepts, for both generations:
 *  - plain digits (16 or 18), with or without hyphen/space grouping;
 *  - Bengali digits.
 * CERTNO-01 references canonicalise to the plain 16 digits; Phase 5
 * references canonicalise to the hyphenated 18-digit stored form.
 */
export function parseReferenceInput(raw: unknown): string | null {
  const digits = referenceDigits(raw);
  if (digits.length === 16) return digits;
  if (digits.length === 18) return formatReference(digits);
  return null;
}

/** Existence check for a citizen reference (unique per tenant). */
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
