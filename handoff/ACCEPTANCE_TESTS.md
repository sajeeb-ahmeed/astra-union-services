# ACCEPTANCE TESTS — Evidence-oriented Definition of Done

Every release must include an executable test + result + logs/screenshot where relevant. Tests use only synthetic citizens.

| ID | Priority | Scenario | Passing condition |
|---|---|---|---|
| TEN-01 | P0 | Tenant A tries accessing tenant B's citizen/application | All attempts denied or return not found; no cross-tenant data |
| TEN-02 | P0 | API request with changed tenant_id/path/query | Server-derived membership wins; no unauthorized access |
| AUTH-01 | P0 | Citizen, UDC, reviewer, approver and owner actions | Unauthorized role blocked on both API and UI |
| AUTH-02 | P0 | Suspended staff/tenant sessions | Sensitive operations denied; records preserved |
| REG-01 | P1 | Citizen creates account and verifies identity via configured lawful flow | Correct registration state and audit trail; no fake API assumptions |
| CIT-01 | P1 | UDC registers and searches citizen | One record created, tenant permission enforced, duplicate handling safe |
| FOR-01 | P0 | Render all 47 entry templates | 47/47 known service forms render with expected named fields |
| FOR-02 | P0 | Validate conditional/repeatable BN/EN fields | Valid rows save; invalid inputs give accessible errors |
| FOR-03 | P1 | Upload malformed/oversize document | Rejected server-side with no public file exposure |
| APP-01 | P0 | Draft → submit → review → correction → resubmit → approve | Correct persistent state transitions and audit |
| APP-02 | P0 | GET preview/application lookup | Does not create or modify records |
| APP-03 | P0 | Attempt to approve outside assigned tenant | Denied with audit event |
| APP-04 | P1 | Return to in-progress application | Form values preserved, versioning consistent |
| CER-01 | P0 | Authorized issuer approves and issues #45 demo certificate | Valid Unicode Bangla PDF, unique number and issuance record |
| CER-02 | P0 | Public QR lookup of issued certificate | Status verifiable, no sensitive ID leakage |
| CER-03 | P0 | Revoke certificate then scan QR | Result clearly REVOKED and audit preserved |
| CER-04 | P0 | Unauthorized staff attempts issuance | Strictly rejected |
| CER-05 | P1 | Renew a previous certificate and trade license | Correct lineage, statuses and versions |
| WAL-01 | P0 | Successful authorized issuance | Exactly one atomic credit debit and issued document |
| WAL-02 | P0 | Double-click/API retry/concurrent issuance | No duplicate certificate charge or ledger entries |
| WAL-03 | P0 | Insufficient wallet credits | No issuance or partial debit, application retained |
| WAL-04 | P0 | Database failure mid-issuance | All issuance and credit operations roll back |
| WAL-05 | P0 | Failed/replayed gateway webhook | No credit granted without verified settlement; no double grant |
| WAL-06 | P1 | Manual adjustment | Compensating entry with owner actor, reason and timestamp |
| BILL-01 | P1 | Plan renewal and top-up | Credited correctly according to configuration; invoice accurate |
| BILL-02 | P0 | Government certificate fee vs SaaS charge | Separate accounting, reports and payment types |
| PUB-01 | P1 | Union directory filter page 2 | Filters stay applied across pagination |
| PUB-02 | P1 | Public verification for invalid token | Safe generic result; no enumeration of identities |
| UX-01 | P1 | Keyboard/mobile screen reader smoke tests | Form labels, modal title, focus and errors accessible |
| OPS-01 | P0 | Run full migration and seed from clean machine | Reproducible dev environment, no production credentials |
| OPS-02 | P0 | Restore encrypted backup | Verified recovery and tenant consistency |
| SEC-01 | P0 | Public repo and application logs scan | No raw audit PII, CSRF tokens, credentials or identity values |
| SEC-02 | P0 | Invalid tenant-scoped reference and IDOR test matrix | No cross-tenant record disclosure |

Milestones cannot pass while related P0 tests are red. Evidence of observed UI is **not** evidence of working API/server behavior.
