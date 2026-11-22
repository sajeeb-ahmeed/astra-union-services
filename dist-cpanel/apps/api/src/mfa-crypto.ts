import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { fail } from "./models.js";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newTotpSecret() {
  let bits = 0,
    value = 0,
    output = "";
  for (const byte of randomBytes(20)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits -= 5)) & 31];
    }
  }
  return output;
}
function decodeBase32(value: string) {
  if (!/^[A-Z2-7]{32}$/.test(value))
    throw new Error("Invalid authenticator secret.");
  let bits = 0,
    buffer = 0;
  const bytes: number[] = [];
  for (const char of value) {
    buffer = (buffer << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) bytes.push((buffer >>> (bits -= 8)) & 255);
  }
  return Buffer.from(bytes);
}
/** RFC 6238 SHA-1, six digits, 30 seconds; no user-supplied clock. */
export function totpCode(secret: string, counter: number) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac("sha1", decodeBase32(secret))
    .update(message)
    .digest();
  const offset = hash[hash.length - 1]! & 15;
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}
export function matchTotp(
  secret: string,
  code: string,
  now: number,
  lastCounter: number,
) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30_000);
  // Check every allowed counter using constant-time equality. Accept only an
  // unused counter; user-row serialization makes replay rejection atomic.
  let matched: number | null = null;
  for (const counter of [current - 1, current, current + 1]) {
    if (counter < 0) continue;
    const equal = timingSafeEqual(
      Buffer.from(code),
      Buffer.from(totpCode(secret, counter)),
    );
    if (equal && counter > lastCounter) matched = counter;
  }
  return matched;
}
export function mfaAvailable() {
  return /^[a-f0-9]{64}$/i.test(process.env.MFA_ENCRYPTION_KEY ?? "");
}
function encryptionKey() {
  if (!mfaAvailable())
    fail(
      503,
      "MFA_UNAVAILABLE",
      "Authenticator protection is temporarily unavailable. Contact the operator.",
    );
  return Buffer.from(process.env.MFA_ENCRYPTION_KEY!, "hex");
}
export function encryptMfaSecret(secret: string, userId: string) {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  cipher.setAAD(Buffer.from(`astra-mfa-v1:${userId}`));
  const bytes = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [
    "v1",
    nonce.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    bytes.toString("hex"),
  ].join(".");
}
export function decryptMfaSecret(value: string, userId: string) {
  const key = encryptionKey();
  try {
    if (!/^v1\.[a-f0-9]{24}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value))
      throw new Error("Invalid format");
    const [, nonce, tag, ciphertext] = value.split(".");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(nonce!, "hex"),
    );
    decipher.setAAD(Buffer.from(`astra-mfa-v1:${userId}`));
    decipher.setAuthTag(Buffer.from(tag!, "hex"));
    const secret = Buffer.concat([
      decipher.update(Buffer.from(ciphertext!, "hex")),
      decipher.final(),
    ]).toString("utf8");
    decodeBase32(secret);
    return secret;
  } catch {
    fail(
      503,
      "MFA_UNAVAILABLE",
      "Authenticator protection is temporarily unavailable. Contact the operator.",
    );
  }
}
