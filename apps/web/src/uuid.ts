/**
 * A UUID v4 for idempotency keys and similar client-generated identifiers.
 *
 * `crypto.randomUUID()` exists only in secure contexts (HTTPS or
 * localhost) — on a plain-HTTP non-localhost origin (e.g. the intake
 * browser test's `http://astra-intake.test` reverse-proxy host, or any
 * HTTP deployment) it is `undefined`, and calling it throws inside a
 * React state initializer, which unmounts the whole section behind the
 * error boundary ("This section could not load"). `crypto.getRandomValues`
 * is available in every context, so the fallback builds the same v4 shape
 * from it. The value is only an idempotency key, never a secret.
 */
export function randomUUID(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}
