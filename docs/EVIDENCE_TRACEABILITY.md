# Release 0.2 evidence traceability

Phase 0 was completed on 13 October 2026. This release consumes the provided curated handoff and existing audit conclusions; it does not repeat reference navigation or claim new verification of Prottoyon's backend. The implementation is independently authored and uses new application/API contracts. All 47 catalog services now have locally tested demonstration workflows, while the reference site's final success paths remain unverified.

## Curated handoff sources

| File | Use and trust boundary |
|---|---|
| `handoff/README.md` | Validated handoff counts and private original-archive boundary |
| `handoff/ASTRA_NEXT_EXECUTION_PROMPT.md` | Owner-requested implementation sequence and required artifacts; consistent with the user's Phase 1 request |
| `handoff/SYSTEM_BLUEPRINT.md` | Proposed product, tenant, roles, workflow, ledger and certificate architecture; new product requirements rather than old-site evidence |
| `handoff/SERVICE_COVERAGE_MATRIX.csv` | All 47 service names/categories, form families, group links and source captures |
| `handoff/SANITIZED_SERVICE_FORM_SCHEMAS.json` | Entire JSON parsed; every service, form and field metadata reconciled and whitelisted into the source catalog |
| `handoff/REFERENCE_AJAX_INVENTORY.json` | Ten client-derived method/endpoint pairs and inferred parameter purposes; zero successful requests established |
| `handoff/ACCEPTANCE_TESTS.md` | Executable acceptance targets; a requirement is never counted as a passed test without execution evidence |
| `handoff/EVIDENCE_TRACEABILITY.md` | Capture provenance and counts; source UI is not backend proof |
| `handoff/EVIDENCE_GAPS_AND_SECURITY.md` | Preserved unknowns and observed design pitfalls; private evidence handling |

## Reference-to-build mapping

`docs/REFERENCE_PARITY.csv` and `packages/shared-schemas/src/reference-catalog.json` preserve all 47 entries and all 48 captured first-step forms, including exact safe field attributes. Each entry links to `audit/evidence/s-01.json` through `s-47.json`. The field map is derived from the sanitized source, not a fresh raw-audit inspection. The CSV keeps reference evidence, original success status and limitations in their own columns, then adds the current independent schema version/hash and local workflow result. A local `CURRENT_DEMO_WORKFLOW_VERIFIED` result never changes its `reference_success_path=UNVERIFIED` value.

| Boundary | Reconciled value | Evidence interpretation |
|---|---:|---|
| Distinct services | 47 | Observed initial service selectors/pages |
| Forms | 48 | Trade License #42 has its additional verification form |
| Common / specialist entries | 26 / 21 | Captured initial template families |
| Reusable group codes | 39 | F01–F39; common C1 counted separately |
| Distinct named nonhidden data fields | 217 | Named submit/button controls excluded |
| Distinct hidden field names | 25 | Metadata names only; no captured values |
| Inline AJAX method/endpoint pairs | 10 | Client code inference only |
| Broader form method/endpoint pairs | 81 | Reported by curated source; not independently reproduced in Phase 1 |

Automated tests compare every safe original field attribute in every initial form against the derived catalog. Frontend rendering tests use the actual React renderer and check the 47 previews, 48 section counts, 217-name union, associated labels, disabled preview controls and operational conditional/nested/checkbox semantics. Those tests prove our renderer, not original form submission behavior.

## Independent implementation evidence

| Artifact or test | Executed result and boundary |
|---|---|
| `packages/shared-schemas/schema-release.json` | Service #45 uses v1; the other 46 services use v2. All 93 immutable operational versions and their hashes are recorded. |
| `execution/forms-current.log` | 72 passing schema tests. All 340 observed service-specific field occurrences map to operational purposes, representing 206 distinct names. The other 11 common checkout/address names belong to the new application and billing workflow. |
| `execution/all-services-qa.json` and API `ALL47-01` | All 47 synthetic service workflows created, persisted, submitted, reviewed, approved by an authorized role and issued real DEMO PDFs; verification returned the correct service and 47 issuance ledger entries reconciled. |
| `execution/clean-bootstrap.log` | Empty-database migrations and repeatable seeding verified 140 persisted definitions: 93 operational versions plus 47 reference previews, with matching immutable hashes. |
| API upload integration tests | Real private uploads, actual byte/signature checks, applicant ownership and authorized downloads are tested. Files remain `UNSCANNED`; no malware-scanner result is claimed. |
| `docs/EXECUTION_RESULTS.md` | Consolidated executed backend, browser, document, deployment-bootstrap and recovery evidence, with limitations. |

These tests use synthetic records in the new application. They do not prove original APIs, government eligibility checks, legally valid certificates, official signing, real payment settlement, messaging delivery or malware scanning. Provider adapters and official policies require their own approval and execution evidence.

## Evidence status vocabulary

- **OBSERVED:** Captured initial UI/DOM metadata and report observations.
- **INFERRED:** A purpose or contract suggested by a visible route, field grouping or inline client call. No backend guarantee follows.
- **PROPOSED:** Independently authored product requirements, validators, RBAC, tenant isolation, subscription model, ledger, approval state machine, demo PDF and QR controls.
- **UNVERIFIED:** Original success paths and capabilities outside audited role coverage. Execution of our software does not upgrade the reference status.
- **TESTED:** A new implementation scenario actually executed with a recorded result. Untested production integrations remain explicitly limited.

## Preserved reference limitations

The audit covered public screens and one authenticated UDC role. Other administrative/official roles, citizen dashboard, OTP delivery, account recovery, secure provisioning, successful 47-form submission, backend validation, final approval, official certificate issue/signing/PDF, transaction settlement, debit/refund handling and complete renewal were not established. External JavaScript retrieval failed; client parameter metadata is not an official REST schema. Full mobile/accessibility/security/backend/database inspection was not established. No NID/Birth Registration access, legal authority, regulated fees or gateway contract is inferred.

The reference's old UDC points interface is distinct from the new per-tenant SaaS subscription and prepaid credit model. Official signatory authority and citizen-data obligations remain separate from software ownership.

## Independent corrections to observed pitfalls

| Source observation | New implementation requirement |
|---|---|
| Existing-application GET showed preliminary-save messaging | GET must never create or alter application/credit/certificate records |
| Directory filter lost during pagination | Public directory serializes filters in the URL and preserves them across pagination; browser tests exercise the new flow |
| Missing/inconsistent labels and modal titles | Explicit associated labels, accurate legends/titles, focusable errors; test rendered controls |
| Low contrast headings | Independent high-contrast design and visible keyboard focus; browser QA before accessibility claims |
| CSRF token in query strings | Keep CSRF tokens in request headers, never URL parameters |
| Reused deceased/heir fields for unrelated services | Preserve reference metadata separately; domain-review new operational models |
| Wallet range/no-result and notice freshness inconsistencies | New wallet, report and notice responses derive from persisted records; directory and notice filters run before pagination |

## Privacy and ownership boundary

The original `audit.zip` remains private and may contain identity-like strings or record-specific URLs. Derivation never copies raw captured values, account information, tokens, cookies or screenshots into implementation fixtures or source. Generated fixtures are explicitly synthetic and certificates carry DEMO / NOT OFFICIAL markings without government seals or signatures. Safe public descriptors, field metadata and placeholder route patterns are retained for traceability. All new source code is independently authored for the owner's requested software; tenant subscription rights do not grant access to source code or official issuing authority.
