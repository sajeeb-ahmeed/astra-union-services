/**
 * ClamAV signature freshness — one rule for the scanner engine check
 * (scripts/scanner/clamd.ts) and the API that accepts scan results
 * (attachments.ts). Owner decision, 28 Nov 2026:
 *
 *   - signatures up to 48 h old are accepted (unchanged);
 *   - older ones are accepted only while the loaded daily database is at
 *     least the version ClamAV currently publishes (its official DNS record
 *     current.cvd.clamav.net, field 3), so a skipped or failed update is
 *     still refused, while a pause in ClamAV's own publishing (no new daily
 *     after 25 Nov 2026) no longer stops every scan;
 *   - never older than 14 days (backstop);
 *   - if the published version cannot be read, the strict 48 h rule applies.
 */
export const FRESH_MS = 48 * 3600_000;
export const BACKSTOP_MS = 14 * 24 * 3600_000;
const FUTURE_SKEW_MS = 5 * 60_000;

export function definitionsAcceptable(
  updatedAtMs: number,
  loadedDaily: number,
  publishedDaily: number | null,
  now = Date.now(),
): boolean {
  if (!Number.isFinite(updatedAtMs) || updatedAtMs > now + FUTURE_SKEW_MS) return false;
  const age = now - updatedAtMs;
  if (age <= FRESH_MS) return true;
  if (age > BACKSTOP_MS) return false;
  // Past 48 h the loaded daily version itself must be known and current.
  if (!Number.isInteger(loadedDaily) || loadedDaily < 1) return false;
  return publishedDaily !== null && Number.isInteger(publishedDaily) && loadedDaily >= publishedDaily;
}

let cache: { value: number; at: number } | null = null;
const CACHE_MS = 10 * 60_000;

/** ClamAV's currently published daily version, or null (cached for 10 minutes). */
export async function publishedDailyVersion(timeoutMs = 5_000): Promise<number | null> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  try {
    const { resolveTxt } = await import("node:dns/promises");
    let timer: NodeJS.Timeout | undefined;
    const records = await Promise.race([
      resolveTxt("current.cvd.clamav.net"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    const daily = Number(records.flat().join("").split(":")[2]);
    if (!Number.isInteger(daily) || daily < 1) return null;
    cache = { value: daily, at: now };
    return daily;
  } catch {
    return null;
  }
}
