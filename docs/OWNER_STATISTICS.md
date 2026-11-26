# Owner statistics — counting rules (W-012)

`GET /api/v1/owner/statistics` and `GET /owner/statistics/export`
(System Owner only) report platform scale as counts. No personal data
is returned: no names, numbers, addresses or application contents —
only office slugs/names and counts.

## What is counted

| Figure | Rule |
| --- | --- |
| Citizens | Rows in `citizens` **created** in the range. |
| Applications | Rows in `applications` **created** in the range. |
| Certificates | Rows in `certificates` **issued** (`issued_at`) in the range. A revoked certificate still counts as issued — it was issued; `certificatesByState` splits ISSUED vs REVOKED. |
| Applications by state | The **current** state of the applications created in the range (not the state at creation). All ten states are always present, zero where empty, so the ten numbers add up to the applications total. |
| Per-office breakdown | The same range and the same rules, grouped by office, ordered by applications descending. The office rows add up to the totals. |

## Date range

- `from` / `to` are UTC calendar days (`YYYY-MM-DD`).
- The range is **from 00:00 UTC on `from`** (inclusive) to **00:00 UTC
  the day after `to`** (exclusive).
- A missing bound is unbounded. `from` after `to` is rejected (422).
- All timestamps in the product are stored as `timestamptz`; the
  comparison is done in UTC, so the same query returns the same
  numbers regardless of the viewer's timezone.

## Office scope

- `tenantId` narrows the totals and the breakdown to one office.
  An unknown office id is 404.
- Without `tenantId` the breakdown lists every office (including
  offices with zero rows in the range).

## Export

`GET /owner/statistics/export?format=csv` returns one row per office
plus a `TOTAL` row, with the same range and scope as the JSON body.
`format=json` returns the same body as `GET /owner/statistics`.

## Implementation

The aggregation is `owner_statistics(from date, to date, tenant uuid)`
(migration 068), a `SECURITY DEFINER` function: the application role
cannot read across tenants (FORCE RLS), so the function runs as the
migration owner. The API allows it to the owner role only.
