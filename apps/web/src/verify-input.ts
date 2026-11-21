/** Accepts a full QR link (…/verify/<token>) or the bare token. */
export function verificationToken(input: string): string | null {
  const value = input.trim();
  const fromUrl = value.match(/\/verify\/([^/?#\s]+)/)?.[1];
  const token = fromUrl ?? value;
  return /^[A-Za-z0-9_-]{8,128}$/.test(token) ? token : null;
}

/**
 * Phase Y: official-format documents print the certificate number as the
 * verification key (/verify?searchText={no}). Accepts the number as printed —
 * Bangla digits included — and returns it normalised for the by-number lookup.
 */
export function certificateNumberInput(input: string): string | null {
  const value = input
    .trim()
    .replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)));
  const fromUrl = value.match(/[?&]searchText=([^&#\s]+)/)?.[1];
  const number = (fromUrl ? decodeURIComponent(fromUrl) : value).toUpperCase();
  if (/^[A-F0-9]{64}$/.test(number)) return null; // that is a QR token, not a number
  if (/^\d{16}$/.test(number)) return number; // official format: dashless 16 digits
  return /^[A-Z0-9][A-Z0-9-]{3,79}$/.test(number) && number.includes("-")
    ? number
    : null;
}
