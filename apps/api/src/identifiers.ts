import fs from "node:fs";
import { createHmac } from "node:crypto";
import { randomToken } from "./security.js";

/**
 * Phase 2b: sign-in identifiers other than email. Mobile, NID and birth-registration numbers are stored only
 * as an HMAC-SHA-256 digest keyed with IDENTIFIER_SECRET, so a database copy alone cannot reveal them.
 * Rotating the secret makes every stored identifier unmatchable; it must never change without a re-entry plan.
 */
export type IdentifierKind = "mobile" | "nid" | "birth_reg";
export type SignInKind = IdentifierKind | "email";
export const identifierKinds: readonly IdentifierKind[] = ["mobile", "nid", "birth_reg"];

const secretFile = ".runtime/identifier-secret";
function loadSecret(): string | null {
  const configured = process.env.IDENTIFIER_SECRET;
  if (configured) return configured.length >= 32 ? configured : null;
  // Production without the secret keeps email sign-in working; other identifiers report unavailable.
  if (process.env.NODE_ENV === "production") return null;
  if (!fs.existsSync(secretFile)) {
    fs.mkdirSync(".runtime", { recursive: true });
    fs.writeFileSync(secretFile, randomToken(), { mode: 0o600 });
  }
  return fs.readFileSync(secretFile, "utf8").trim();
}
const secret = loadSecret();
export const identifiersAvailable = () => secret !== null;

const asciiDigits = (value: string) =>
  value.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6));

/** Canonical form, or null when the value is not a valid identifier of that kind. */
export function normalizeIdentifier(kind: SignInKind, raw: string): string | null {
  const value = asciiDigits(String(raw ?? "")).trim();
  if (kind === "email") {
    const email = value.toLowerCase();
    return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email) ? email : null;
  }
  const digits = value.replace(/[\s\-()]/g, "");
  if (kind === "mobile") {
    const local = digits.replace(/^\+?88(?=01)/, "");
    return /^01[3-9]\d{8}$/.test(local) ? local : null;
  }
  if (kind === "nid") return /^(\d{10}|\d{13}|\d{17})$/.test(digits) ? digits : null;
  return /^\d{17}$/.test(digits) ? digits : null;
}

export function identifierDigest(kind: IdentifierKind, normalized: string): string {
  if (!secret) throw new Error("Identifier secret is not configured.");
  return createHmac("sha256", secret).update(`${kind}:${normalized}`).digest("hex");
}

/** What the owner sees in their own settings: enough to recognise the number, not to recover it. */
export function identifierHint(kind: IdentifierKind, normalized: string): string {
  if (kind === "mobile") return `${normalized.slice(0, 3)}******${normalized.slice(-2)}`;
  return `${"•".repeat(4)}${normalized.slice(-3)}`;
}
