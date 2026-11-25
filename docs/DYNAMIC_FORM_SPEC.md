# Dynamic service forms — release 0.2 contract

> **Historical document.** This describes release 0.2 and is kept for the record. Current behaviour is described in [System architecture](SYSTEM_ARCHITECTURE.md), the phase plans (`PHASE2_PLAN.md`–`PHASE6_PLAN.md`) and [Parity status](PARITY_STATUS.md). The version claims in the "Immutable versions" section below are superseded by the generated table in that section (W-019, Phase 4 Stage 3) — the live catalogue is the contract, this document is not.
>
> **Billing-model note (Batch C / W-003, 25 Nov 2026 — the 0.2 text below is NOT rewritten).** The statements in this document about "one credit deduction for every service", an issuance debit, and "47 issuance debits" describe the **pre-044 issuance-charge model** (release 0.2 era). Since migration 044 (18 Nov 2026) the platform fee settles **once, at the application's first successful submit** (`settleApplicationFee`, `apps/api/src/billing.ts`), and issuance charges nothing — no credit debit, no point deduction, and the `SUBSCRIPTION_INACTIVE` / `INSUFFICIENT_CREDITS` / `POINTS_INSUFFICIENT` issuance gates are gone. Pre-044 `credit_ledger` rows keep kind `ISSUANCE`; post-044 platform-fee rows are kind `APPLICATION_FEE`, linked to the application, with `fee_method` (`CREDIT` | `ALLOWANCE` | `FREE`) recorded on the application. See [Billing and ledger](BILLING_AND_LEDGER.md).

All 47 services have executable, independently authored demonstration schemas. The frontend and backend share the same validation contract, and the PostgreSQL workflow has executed creation, submission, review, authorized approval, PDF issuance, public verification and one credit deduction for every service. These local results do not establish the original website's successful submission paths or official issuing authority.

## Reference evidence and operational coverage

The curated handoff contains 47 service entries, 48 initial forms, 26 common order/payment entry types, 21 specialist entry types, 39 groups F01–F39 plus C1, 217 distinct named nonhidden data fields and 25 distinct hidden field names. All safe field attributes remain in `packages/shared-schemas/src/reference-catalog.json` and `docs/REFERENCE_PARITY.csv`. Phase 0 is complete; the implementation did not repeat the reference audit.

| Layer | Current status | Meaning |
|---|---|---|
| All 47 entries and 48 captured initial forms | OBSERVED metadata | Captured labels, names, types, HTML required flags, maximum lengths and repeatable markers |
| Original form routes and inline AJAX | INFERRED client contracts | Route presence does not prove the original backend's behavior |
| Separate reference preview for every service | Implemented, read-only | Captured nonhidden controls remain inspectable, including repeated radio names and Trade License's second form |
| All 47 operational service schemas | Independent DEMO implementation | Shared validation, versioned persistence and tested application-to-certificate workflows |
| Original successful submission, approval, payment and issuance | UNVERIFIED | Local execution never upgrades reference evidence |

Current schemas map all **340 observed service-specific field occurrences**, covering **206 distinct names**. The other **11 of the original 217 distinct names** are common checkout/address controls handled through the new tenant, application, language and billing flow. This is field-purpose coverage, not an assertion that source dropdown choices, required rules, payment behavior or downstream forms match.

For example, service #45's source contains a common checkout form with no service-specific resident fields; its resident profile is proposed product design. Family #2 preserves the observed deceased/heir metadata separately and maps the 20 observed field purposes into its independent household/member model. Trade #42 maps all 37 observed service-specific fields, with its old verification form retained as a reference preview and actual renewal handled through the new authorized workflow. Domain owners still need to approve official wording and eligibility rules.

## Immutable versions and application pinning

`FormSchema` carries the service number, integer version, bilingual title, stage, sections and evidence provenance. `getServiceSchema(serviceNo)` returns the latest published operational schema; an explicit second argument selects an exact historical version. Unknown services or versions fail instead of silently selecting another profile.

<!-- SCHEMA-VERSIONS:BEGIN -->
> Generated 2026-11-25 from the schema catalogue — do not hand-edit. Regenerate with `npx tsx scripts/generate-schema-version-table.ts`.

The catalogue holds **47 operational schemas** (one latest version per service) and **220 retained versions** in total. An application is pinned to the version current at creation; older versions stay valid for pinned applications only.

| Service | Latest version | Versions retained |
| --- | --- | --- |
| 1 | v4 | 1, 2, 3, 4 |
| 2 | v5 | 1, 2, 3, 4, 5 |
| 3 | v5 | 1, 2, 3, 4, 5 |
| 4 | v6 | 1, 2, 3, 4, 5, 6 |
| 5 | v5 | 1, 2, 3, 4, 5 |
| 6 | v4 | 1, 2, 3, 4 |
| 7 | v5 | 1, 2, 3, 4, 5 |
| 8 | v4 | 1, 2, 3, 4 |
| 9 | v4 | 1, 2, 3, 4 |
| 10 | v5 | 1, 2, 3, 4, 5 |
| 11 | v5 | 1, 2, 3, 4, 5 |
| 12 | v4 | 1, 2, 3, 4 |
| 13 | v4 | 1, 2, 3, 4 |
| 14 | v4 | 1, 2, 3, 4 |
| 15 | v3 | 1, 2, 3 |
| 16 | v5 | 1, 2, 3, 4, 5 |
| 17 | v4 | 1, 2, 3, 4 |
| 18 | v5 | 1, 2, 3, 4, 5 |
| 19 | v5 | 1, 2, 3, 4, 5 |
| 20 | v5 | 1, 2, 3, 4, 5 |
| 21 | v5 | 1, 2, 3, 4, 5 |
| 22 | v4 | 1, 2, 3, 4 |
| 23 | v5 | 1, 2, 3, 4, 5 |
| 24 | v5 | 1, 2, 3, 4, 5 |
| 25 | v5 | 1, 2, 3, 4, 5 |
| 26 | v5 | 1, 2, 3, 4, 5 |
| 27 | v4 | 1, 2, 3, 4 |
| 28 | v4 | 1, 2, 3, 4 |
| 29 | v5 | 1, 2, 3, 4, 5 |
| 30 | v5 | 1, 2, 3, 4, 5 |
| 31 | v5 | 1, 2, 3, 4, 5 |
| 32 | v5 | 1, 2, 3, 4, 5 |
| 33 | v4 | 1, 2, 3, 4 |
| 34 | v4 | 1, 2, 3, 4 |
| 35 | v4 | 1, 2, 3, 4 |
| 36 | v6 | 1, 2, 3, 4, 5, 6 |
| 37 | v5 | 1, 2, 3, 4, 5 |
| 38 | v5 | 1, 2, 3, 4, 5 |
| 39 | v5 | 1, 2, 3, 4, 5 |
| 40 | v5 | 1, 2, 3, 4, 5 |
| 41 | v6 | 1, 2, 3, 4, 5, 6 |
| 42 | v6 | 1, 2, 3, 4, 5, 6 |
| 43 | v5 | 1, 2, 3, 4, 5 |
| 44 | v5 | 1, 2, 3, 4, 5 |
| 45 | v3 | 1, 2, 3 |
| 46 | v5 | 1, 2, 3, 4, 5 |
| 47 | v4 | 1, 2, 3, 4 |
<!-- SCHEMA-VERSIONS:END -->

The database also stores 47 read-only reference previews. Preview version **0** cannot be submitted as an operational application. Published v1 contracts remain preserved, including the earlier expanded-service v1 snapshots in `expanded-v1-schemas.json`. `schema-release.json` records each canonical hash and the release sentinel.

Applications pin their service number, schema version, canonical SHA-256 hash and schema snapshot. Payload revisions validate against that pinned version. Editing an existing application does not change its rules, and publishing a later schema cannot rewrite old applications or issued certificate bytes. Registries and fixtures are recursively frozen. Tenant administrators can enable services and configure credit costs; this release does not expose an arbitrary schema or certificate-template editor.

## Shared TypeScript API

```ts
import {
  getCatalogPreviewSchema, getServiceSchema, getDemoPayload,
  validateServicePayload, stableSchemaJson,
} from '@astra/shared-schemas';

const schema = getServiceSchema(42); // Current v2 profile.
const payload = getDemoPayload(42); // Isolated mutable synthetic sample.
const result = validateServicePayload(42, payload, schema.version);
// result: { valid, issues: [{ path, code, message: { bn, en } }] }
const referenceOnly = getCatalogPreviewSchema(42); // Read-only v0.
```

Supported controls include text, textarea, number, ISO date, select, checkbox, private attachment handles and nested repeatable rows. Citizen identity belongs to a separate tenant-scoped record referenced by the application. Shared validation never grants permission to use a citizen, tenant, attachment, approval or billing account; the backend checks those independently.

## Service models and validation

`SERVICE_IMPLEMENTATION.md` is the per-service field and rule inventory. It covers household/member and heir lists, death and marriage facts, income statements, land and premises descriptions, correction rows, conditional identity information, license details, vehicle measurements, declarations and supporting documents. Common language/purpose/declaration controls are independently designed. Synthetic samples use no captured citizen values or fabricated upload handles.

`visibleWhen` and `requiredWhen` use declarative predicates such as `{ field, equals }`, `{ field, present }`, `{ all: [...] }` and `{ any: [...] }`; no scripts are evaluated. Row predicates inspect the local row. A minor's guardian is required for that row, and changing a license address category requires clearing fields from the previous branch. Inactive values are rejected instead of being silently retained.

Unknown keys fail at every object depth. Select values must match explicit independent enums. Dates reject invalid calendar days, including rolled-over dates such as February 30. Strings use Unicode-aware lengths. Numbers must be finite and satisfy declared bounds; holding years and wards enforce integer rules. Booleans must be real booleans, and declarations use `mustBeTrue`. Repeatables enforce row types, order and minimum/maximum counts. Correction categories cannot repeat, and a correction must differ from the prior value after trimming. These are new product rules, not verified source-server behavior.

All operational controls have Bangla and English labels. The React renderer provides associated labels, stable IDs, linked error messages, `aria-invalid` and `aria-describedby`, repeatable fieldsets, keyboard-accessible row controls and error focus. Error paths identify nested fields, for example `members[1].attachments[0].file`. Source `required_html=false` metadata remains unchanged even if a captured label displayed an asterisk. An unlabeled reference control uses its exact technical name in the separate preview.

## Connected private uploads

The browser uploads through the authenticated private API, which checks the applicant's tenant/ownership, declared MIME type, actual byte length, file signature and end marker. Files are stored privately in PostgreSQL; downloads require authorization and use attachment disposition. Integration tests exercise malformed uploads, size/type constraints and cross-user/tenant rejection.

Operational payloads accept only `{ attachmentId, mimeType, byteLength }` handles returned by this service. Supporting-document arrays allow at most five rows; each supplied row requires its description/type and file handle. Accepted types are PDF, PNG and JPEG, with a 2 MiB maximum. URLs, extra claims such as `malwareClean`, unknown handles and mismatched metadata are rejected. The separate `scanState` response field must not be copied into the three-key handle.

**Uploads are quarantined until a malware scan passes (since release 0.9).** Signature checks are not malware scanning; the separate scanner worker decides, and only a CLEAN result releases a file for download, submission, approval or issuance (see [attachment scanner runtime](ATTACHMENT_SCANNER_RUNTIME.md)). The schema alone cannot establish file safety, ownership or official evidentiary validity.

## Workflow, renewal and charges

Tenant service enablement and per-service credit cost are server-controlled. Applicant payloads never supply tenant authority, approval, certificate numbers or authoritative prices. The backend enforces review and assigned approval authority before issuance, checks the subscription and wallet, and commits certificate persistence and its unique credit debit atomically. The separate reference hidden fee controls are evidence only.

Renewal creates a new application linked to an issued certificate for the same tenant, citizen and service. It must follow the normal review/approval/issuance path and incur its own single configured debit. The backend prevents concurrent active successors and rejects unsuitable or revoked sources; trade renewal pins the previous certificate number. Issued documents retain their original data and template version. These are independent demo renewal rules requiring jurisdiction review for official use.

## Verification and remaining domain work

`npm run test:forms` passes **72 tests**: the original 14 engine regressions, 47 individual service cases and 11 focused cross-service cases. They verify exact sanitized metadata, all mapping counts, bilingual labels, 93 immutable version identities, retained v1 hashes, valid isolated samples and rejection of invalid types, values, inactive branches, unknown authority claims and attachment metadata. Results are recorded in `execution/forms-current.log`.

The API suite's `ALL47-01` scenario separately creates, persists, submits, reviews, approves and issues every service, downloads its real PDF, checks public verification and reconciles 47 issuance debits. `execution/all-services-qa.json` records each synthetic application and certificate. `execution/clean-bootstrap.log` verifies all 140 persisted schema hashes. Browser and PDF QA provide additional evidence described in `EXECUTION_RESULTS.md`; schema unit tests are never counted as end-to-end tests.

The next domain milestone is jurisdiction-approved eligibility, certificate wording, geography, statutory fees, retention and attachment policy. Identity databases, official registers, government signing, inheritance calculations, tax assessment and live payment providers are not inferred or implemented from captured controls. Publish approved changes as new versions while preserving existing application and certificate history.
