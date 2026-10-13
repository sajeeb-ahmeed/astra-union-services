# SOURCE AND TRACEABILITY INDEX

Original: `audit.zip` / `audit/output/Prottoyon Website Feature Audit.pdf`. This curated handoff does not contain unredacted DOM files.

| Topic | Primary evidence in audit.zip | Observation status |
|---|---|---|
| Home/public registration, enrollment, coverage, search, help | `public-summary.json`, `evidence/p-01` to `p-35` | Public UI captured, some interactions tested |
| UDC dashboard/staff workflow | `udc-summary.json`, `evidence/03-dashboard.json` to `24-wallet-transactions.json` | UI/DOM captured, success flows mostly untested |
| 47 initial service pages | `evidence/s-01.json` to `s-47.json`; `service-form-inventory.json` | First-step DOM metadata captured |
| Service field reuse | `service-field-groups.json`, `service-fields-summary.json` | Derived from captured initial forms |
| Form submissions and relevant client AJAX | `api-summary.json`, `api-inventory.json` | Parsed from forms/inline client code; NOT backend API verification |
| Authoritative written audit conclusions | `output/Prottoyon Website Feature Audit.pdf` | Report conclusion, bounded by its declared testing limits |
| User-requested SaaS ownership and wallet model | `SYSTEM_BLUEPRINT.md` | **NEW PRODUCT REQUIREMENT**; not reference evidence |
| Public site security and production compliance | `EVIDENCE_GAPS_AND_SECURITY.md` | **PROPOSED RISK CONTROLS**; not verified reference behavior |

## Source boundary counts

| Source figure | Value | Interpretation |
|---|---:|---|
| Service entries | 47 | All initial entry templates inspected |
| Form elements across service pages | 48 | One additional Trade License verification form |
| Common order/payment service entries | 26 | Template-family metadata |
| Specialist additional-information entries | 21 | Template-family metadata |
| Distinct named nonhidden DATA field names | 217 | Submit buttons intentionally excluded |
| Distinct named hidden field names | 25 | Metadata only, no values |
| Documented reusable field group codes | 39 | Group codes F01–F39; shared C1 referenced separately |
| Distinct inline AJAX endpoint/method pairs | 10 | From client script, zero request success checks |
| Broader distinct form endpoint/method pairs | 81 | Across the captured public/UDC DOM form inventory |

## Caution

Do not equate route names or visible buttons with correct backend responses or official legal issuance rights. All 47 service *final success paths* remain unverified.
