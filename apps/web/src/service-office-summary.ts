import { api, items } from "./api.js";

/**
 * BUNDLE06-R5 C2 / F-011: per-service fee/time summary across
 * participating offices, for the catalog cards. One request to the
 * aggregate endpoint GET /services/summaries — the server aggregates the
 * same published-policy rows the office detail endpoint reads, so the
 * numbers cannot drift from the per-office view. Only offices that have
 * actually published a fee policy for the service contribute — nothing
 * is inferred or filled in. Loaded once per page session and shared by
 * every card grid (portal catalog, home, related services).
 *
 * (Before F-011 this was /offices?pageSize=100 plus one detail request
 * per office, 11+ requests per page load refired on every navigation —
 * the burst that caused QAFIX-01's net::ERR_INSUFFICIENT_RESOURCES.)
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
        for (const row of items(await api("/services/summaries"))) {
          const no = row.serviceNo ?? row.service_no;
          if (!no) continue;
          map.set(no, {
            feeMinMinor: row.feeMinMinor,
            feeMaxMinor: row.feeMaxMinor,
            daysMin: row.daysMin ?? null,
            daysMax: row.daysMax ?? null,
            offices: row.offices,
          });
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
