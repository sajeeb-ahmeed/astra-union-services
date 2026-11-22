/**
 * CERTNO-01: Asia/Dhaka-pinned date helpers.
 *
 * Certificate numbers embed the issue date (YYYYMMDD) and references embed the
 * registration/submission date. The office operates in Bangladesh, so those
 * dates must be the Dhaka calendar date regardless of the host's timezone —
 * a server running UTC would otherwise mint the previous day's date for the
 * first six hours of every Dhaka day.
 */
const dhakaDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Dhaka",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date in Asia/Dhaka as YYYYMMDD (8 ASCII digits). */
export function dhakaDateStamp(at: Date = new Date()): string {
  // en-CA renders YYYY-MM-DD; strip the separators.
  return dhakaDate.format(at).replace(/-/g, "");
}

/** The calendar date in Asia/Dhaka as YYYY-MM-DD. */
export function dhakaDateIso(at: Date = new Date()): string {
  return dhakaDate.format(at);
}
