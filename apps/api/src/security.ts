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
