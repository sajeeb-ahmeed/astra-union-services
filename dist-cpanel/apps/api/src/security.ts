import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
  createHmac,
} from "node:crypto";
export const digest = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
export const randomToken = () => randomBytes(32).toString("hex");
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
/**
 * Security Audit 01, F5: the password policy was length-only, so a 12+ character
 * password that appears in every breach corpus was accepted. This compact blocklist
 * of the most common passwords (exact match, case-insensitive) is enforced at every
 * password set/change point — signup, staff create, office registration, tenant
 * create, recovery consume, password change, and the owner bootstrap. It is a
 * floor, not a strength meter: scrypt storage plus the sign-in lockouts bound the
 * remaining risk. Keep the list small and obviously-common; do not grow it into a
 * dictionary.
 */
const COMMON_PASSWORDS = new Set([
  "password", "123456", "123456789", "qwerty", "letmein", "admin", "iloveyou",
  "football", "monkey", "dragon", "master", "sunshine", "princess", "password1",
  "passw0rd", "changeme", "welcome", "shadow", "superman", "batman", "trustno1",
  "password123", "password1234", "password12345", "password123456",
  "password1234567", "password12345678", "password123456789", "password1234567890",
  "password123!", "password@123", "password@1234", "p@ssw0rd1234", "passw0rd1234",
  "pass123456789", "1234567890", "123456789012", "1234567890123", "12345678901234",
  "1234567890ab", "123456789abc", "abc123456789", "abcd12345678", "a12345678901",
  "qwerty123456", "qwerty1234567", "qwerty12345678", "qwertyuiop123",
  "qwertyuiop12", "1q2w3e4r5t6y", "1qaz2wsx3edc", "qazwsxedcrfv", "zxcvbnm12345",
  "asdfghjkl123", "12345qwerty1", "qwert1234567", "iloveyou1234", "iloveyou12345",
  "admin1234567", "admin12345678", "administrator", "administrator1",
  "letmein123456", "welcome12345", "welcome123456", "welcome@1234",
  "changeme1234", "default12345", "football1234", "baseball1234", "sunshine1234",
  "princess1234", "superman1234", "batman123456", "dragon123456", "master123456",
  "monkey123456", "shadow123456", "michael12345", "jennifer1234", "computer1234",
  "internet1234", "secret123456", "summer123456", "winter123456", "autumn123456",
  "orange123456", "purple123456", "google123456", "facebook1234",
  "bangladesh123", "bangladesh1234", "dhaka1234567", "dhaka12345678",
  "111111111111", "1111111111111", "123123123123", "112233445566", "121212121212",
  "123412341234", "aaaaaaaaaaaa", "abcabcabcabc", "000000000000", "999999999999",
  "starwars1234", "whatever1234", "freedom12345", "hello1234567", "world1234567",
  "lovely123456", "flower123456", "golden123456", "silver123456", "india1234567",
  "london123456", "america123456", "digitalunion1", "digitalunion123",
  "digitalunion1234",
]);
export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}
export function checkPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hex ?? "", "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
export const signature = (body: Buffer | string, secret: string) =>
  createHmac("sha256", secret).update(body).digest("hex");
export function signatureMatches(actual: string | undefined, expected: string) {
  if (!actual || !/^[a-f0-9]{64}$/i.test(actual)) return false;
  return timingSafeEqual(
    Buffer.from(actual, "hex"),
    Buffer.from(expected, "hex"),
  );
}
