import fs from "node:fs";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { fail } from "./models.js";
import { normalizeIdentifier } from "./identifiers.js";

/**
 * Phase 3a: NID and birth-registration numbers on the citizen record are encrypted (AES-256-GCM) so they can be
 * printed, and also stored as a keyed digest for duplicate checks (owner decision). Key: CITIZEN_DATA_KEY,
 * 64 hex characters. Outside production a key file is created automatically; in production without the key
 * the rest of the system works and entering these numbers reports 503.
 */
type NumberKind = "nid" | "birth_reg";
const keyFile = ".runtime/citizen-data-key";
function loadKey(): Buffer | null {
  const configured = process.env.CITIZEN_DATA_KEY;
  if (configured) return /^[a-f0-9]{64}$/i.test(configured) ? Buffer.from(configured, "hex") : null;
  if (process.env.NODE_ENV === "production") return null;
  if (!fs.existsSync(keyFile)) {
    fs.mkdirSync(".runtime", { recursive: true });
    fs.writeFileSync(keyFile, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(keyFile, "utf8").trim(), "hex");
}
const key = loadKey();
const digestKey = key ? createHmac("sha256", key).update("astra-citizen-digest-v1").digest() : null;
export const citizenDataAvailable = () => key !== null;
function requireKey() {
  if (!key)
    fail(503, "CITIZEN_DATA_UNAVAILABLE", "Storing NID or birth registration numbers is not enabled on this server.");
  return key!;
}
const aad = (tenantId: string, kind: NumberKind) => Buffer.from(`astra-citizen-v1:${tenantId}:${kind}`);
export function encryptNumber(value: string, tenantId: string, kind: NumberKind) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", requireKey(), nonce);
  cipher.setAAD(aad(tenantId, kind));
  const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("hex"), cipher.getAuthTag().toString("hex"), bytes.toString("hex")].join(".");
}
export function decryptNumber(value: string, tenantId: string, kind: NumberKind): string {
  const [version, nonce, tag, bytes] = value.split(".");
  if (version !== "v1" || !nonce || !tag || !bytes) fail(500, "CITIZEN_DATA_CORRUPT", "Stored number is unreadable.");
  const decipher = createDecipheriv("aes-256-gcm", requireKey(), Buffer.from(nonce, "hex"));
  decipher.setAAD(aad(tenantId, kind));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(bytes, "hex")), decipher.final()]).toString("utf8");
}
export function numberDigest(value: string, kind: NumberKind) {
  requireKey();
  return createHmac("sha256", digestKey!).update(`${kind}:${value}`).digest("hex");
}
const hint = (value: string) => `${"•".repeat(4)}${value.slice(-3)}`;

const name = z.string().trim().min(2).max(120);
/** Optional personal and identity details; null clears a value. */
export const citizenDetailsInput = z
  .object({
    gender: z.enum(["female", "male", "other"]).nullable(),
    fatherNameBn: name.nullable(),
    fatherNameEn: name.nullable(),
    motherNameBn: name.nullable(),
    motherNameEn: name.nullable(),
    spouseNameBn: name.nullable(),
    spouseNameEn: name.nullable(),
    bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).nullable(),
    nid: z.string().max(40).nullable(),
    birthReg: z.string().max(40).nullable(),
    mobile: z.string().max(40).nullable(),
    noMobile: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => !(v.noMobile === true && v.mobile), {
    message: "Declare either a mobile number or no mobile, not both.",
  });
export type CitizenDetails = z.infer<typeof citizenDetailsInput>;

const plainColumns: [keyof CitizenDetails, string][] = [
  ["gender", "gender"],
  ["fatherNameBn", "father_name_bn"],
  ["fatherNameEn", "father_name_en"],
  ["motherNameBn", "mother_name_bn"],
  ["motherNameEn", "mother_name_en"],
  ["spouseNameBn", "spouse_name_bn"],
  ["spouseNameEn", "spouse_name_en"],
  ["bloodGroup", "blood_group"],
];
/**
 * Column values for the given details, validated and with numbers encrypted. Only keys present in the input
 * are returned, so an update changes exactly what was sent.
 */
export function citizenDetailColumns(details: CitizenDetails, tenantId: string): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  for (const [field, column] of plainColumns) if (field in details) columns[column] = details[field] ?? null;
  for (const [field, kind, prefix] of [
    ["nid", "nid", "nid"],
    ["birthReg", "birth_reg", "birth_reg"],
  ] as const) {
    if (!(field in details)) continue;
    const raw = details[field];
    if (raw === null || raw === "") {
      Object.assign(columns, { [`${prefix}_cipher`]: null, [`${prefix}_digest`]: null, [`${prefix}_hint`]: null });
      continue;
    }
    const value = normalizeIdentifier(kind, raw!);
    if (!value)
      fail(
        422,
        "IDENTIFIER_INVALID",
        kind === "nid" ? "Enter a 10, 13 or 17 digit NID number." : "Enter a 17-digit birth registration number.",
      );
    Object.assign(columns, {
      [`${prefix}_cipher`]: encryptNumber(value, tenantId, kind),
      [`${prefix}_digest`]: numberDigest(value, kind),
      [`${prefix}_hint`]: hint(value),
    });
  }
  if ("mobile" in details) {
    if (details.mobile === null || details.mobile === "") columns.contact_mobile = null;
    else {
      const mobile = normalizeIdentifier("mobile", details.mobile!);
      if (!mobile) fail(422, "IDENTIFIER_INVALID", "Enter an 11-digit Bangladeshi mobile number starting with 01.");
      columns.contact_mobile = mobile;
      columns.no_mobile = false;
    }
  }
  if ("noMobile" in details) {
    columns.no_mobile = details.noMobile;
    if (details.noMobile) columns.contact_mobile = null;
  }
  return columns;
}
/** Readable mapping for the database's duplicate-number index violations. */
export function duplicateNumberError(error: any): never {
  if (error?.code === "23505" && /citizens_(nid|birth_reg)_per_office/.test(error?.constraint ?? ""))
    fail(
      409,
      "CITIZEN_NUMBER_TAKEN",
      error.constraint.includes("nid")
        ? "Another citizen in this office already has this NID number."
        : "Another citizen in this office already has this birth registration number.",
    );
  throw error;
}
