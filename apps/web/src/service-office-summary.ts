import { api, items } from "./api.js";

/**
 * BUNDLE06-R5 C2: per-service fee/time summary across participating
 * offices, for the catalog cards. Built from the public offices API
 * (directory + each office's published price list). Only offices that
 * have actually published a fee policy for the service contribute —
 * nothing is inferred or filled in. Loaded once per page session and
 * shared by every card grid (portal catalog, home, related services).
 */
export interface ServiceOfficeSummary {
  feeMinMinor: number;
  feeMaxMinor: number;
  daysMin: number | null;
  daysMax: number | null;
  /** Offices that published a policy for this service. */
  offices: number;
}

let cache: Promise<Map<number, ServiceOfficeSummary>> | null = null;

export function loadServiceOfficeSummaries(): Promise<
  Map<number, ServiceOfficeSummary>
> {
  if (!cache) {
    cache = (async () => {
      const map = new Map<number, ServiceOfficeSummary>();
      try {
        const offices = items(await api("/offices?pageSize=100"));
        // QAFIX-01 (web 4× timeout root cause): the detail fetch used to
        // fire one request per office in a single Promise.all burst. With
        // every test-created tenant in the directory that burst landed at
        // the same moment as the page's lazy chunk, fonts and CSS, and the
        // headless browser's network service failed the chunk import with
        // net::ERR_INSUFFICIENT_RESOURCES — the public home then showed
        // its load-error panel and every home wait timed out. The
        // summaries are an enhancement, so they are fetched three at a
        // time now: complete, just not all at once. (Observed 24 Nov:
        // 11 offices → 11 parallel detail requests on every public page
        // load, refired on each navigation because the cache is per
        // document.)
        const details: any[] = [];
        const CONCURRENCY = 3;
        let next = 0;
        const worker = async () => {
          while (next < offices.length) {
            const office = offices[next++] as any;
            try {
              details.push(await api(`/offices/${office.slug}`));
            } catch {
              details.push(null);
            }
          }
        };
        await Promise.all(
          Array.from(
            { length: Math.min(CONCURRENCY, offices.length) },
            () => worker(),
          ),
        );
        for (const detail of details) {
          if (!detail) continue;
          for (const service of items(detail.services)) {
            if (service.policyVersion == null) continue;
            const no = service.serviceNo || service.service_no;
            if (!no) continue;
            const fee =
              (service.statutoryFeeMinor ?? 0) +
              (service.processingFeeMinor ?? 0);
            const days =
              typeof service.charterDays === "number"
                ? service.charterDays
                : null;
            const current = map.get(no);
            if (!current) {
              map.set(no, {
                feeMinMinor: fee,
                feeMaxMinor: fee,
                daysMin: days,
                daysMax: days,
                offices: 1,
              });
            } else {
              current.feeMinMinor = Math.min(current.feeMinMinor, fee);
              current.feeMaxMinor = Math.max(current.feeMaxMinor, fee);
              if (days != null) {
                current.daysMin =
                  current.daysMin == null
                    ? days
                    : Math.min(current.daysMin, days);
                current.daysMax =
                  current.daysMax == null
                    ? days
                    : Math.max(current.daysMax, days);
              }
              current.offices += 1;
            }
          }
        }
      } catch {
        /* Summaries are an enhancement: on any failure the cards fall
           back to the honest "not yet published" line. */
      }
      return map;
    })();
  }
  return cache;
}
