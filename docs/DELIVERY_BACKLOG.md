# Delivery backlog after release 0.5

**Recorded 19 October 2026.** Start with the Bangla [status and next steps](STATUS_AND_NEXT_STEPS.md) when resuming work. This backlog records the remaining work; it does not authorize account purchases, provider activation or official issuance.

## Completed and verified

- Independently implemented frontend, API and PostgreSQL system: tenant isolation, roles, separate authorized approval, versioned service forms, application history, DEMO PDFs/QR verification and exactly-once issuance credit deduction. All 47 service schemas are represented; complete reference-process equivalence is not established.
- Public discovery, office directory, notices, tracking, renewal, tenant administration, owner provisioning, reports and protected document copies are implemented. SaaS subscription/top-up settlement still uses synthetic zero-money fixtures.
- The supplied Bangladesh geography hierarchy is integrated into registration, profiles, office settings and directory lookup, with server-side parent validation. Rural/urban, ward derivation and service-specific gaps remain documented in [GEOGRAPHY_INTEGRATION.md](GEOGRAPHY_INTEGRATION.md).
- Release 0.4 added citizen-first intake, exact Astra-reference lookup, versioned office fees, fee review/acceptance and immutable order snapshots. Processing/statutory fees and SaaS credits remain separate. See [ORDER_WORKFLOW.md](ORDER_WORKFLOW.md).
- Release 0.5 deployed the bKash v2 adapter, immutable bilingual PDF receipts, protected payment register, transaction reconciliation and CSV export. Hosted collection is **DISABLED / MERCHANT_SETUP_REQUIRED**. There is no configured merchant account, genuine provider-sandbox acceptance or real-money collection. Nagad is **NOT_INTEGRATED**; bank payouts are **NOT_CONNECTED**. Current configuration supports **one explicitly bound office merchant per deployment**.
- GitHub/Linux CI and Docker verification, HTTPS Render deployment, restricted PostgreSQL runtime access and reviewed migrations have actual execution evidence. The 0.5 runtime passed **192/192 CI tests**, **18 hosted API groups** and scoped live Bangla/English/mobile browser checks. Migration preserved existing domain fingerprints; temporary database access was closed. These completed infrastructure steps are not pending initial setup.

Evidence: [release 0.5](RELEASE_0_5.md), [live metadata](../execution/payments-live-release.json), [reference parity and gaps](PROCESS_PARITY.md). Runtime `b86908b9a4654cc31cd1b517fc5e8ad3ae086878` is the tested 0.5 release; later documentation commits do not imply a new deployment.

## Next milestone — merchant readiness and payment recovery

Keep hosted collection disabled until the applicable acceptance gates pass. Local provider mocks and disabled hosted checks are not genuine bKash sandbox tests.

| Priority / work | Owner and dependency | Completion evidence |
| --- | --- | --- |
| P0 · Durable database and recovery | Product owner + operations; current Render Free PostgreSQL expires **12 November 2026** | Approved persistent hosting plan or migration completed before expiry; verified backup, restore drill and documented recovery targets. Do not assume the free database is permanent. |
| P0 · Merchant onboarding | Product owner + bKash; approved organization/representative and collection purpose | Merchant/KYC approval, provider-issued sandbox access, receiving-account identity, written charges/settlement/refund terms and agreement on which office owns collected fees. Confirm the approved API contract. Store credentials only in deployment secrets. |
| P0 · Safe checkout recovery | Engineering + provider guidance; exact provider lifecycle rules | Resolve unknown Create outcomes and cancelled/failed/expired attempts; allow a replacement only after safe final-state confirmation. Audit operator actions, preserve original attempts/receipts, and prove no duplicate collection under timeouts, retries or restarts. Current Query/Search recovery for a known payment ID remains intact. |
| P0 · Provider notifications and operations | Engineering + bKash contract; authenticated provider notification support | Implement provider-supported IPN/notifications, duplicate/out-of-order handling and retry/outbox processing where applicable; document investigation, alerting and escalation. Do not infer a notification contract from the browser callback. |
| P0 · Genuine sandbox acceptance | Engineering + approved merchant access; recovery paths complete | Recorded success/cancel/failure/timeout/replay tests against bKash sandbox, exact invoice/amount/merchant matching, one immutable receipt, mismatch holds, role/tenant restrictions and unchanged SaaS credits. Record sanitized provider evidence separately from mock tests. |
| P0 · Controlled live activation | Product owner + bKash + operations; prior gates passed and live credentials approved | Explicitly authorized small live transaction, receipt and receiving-merchant verification; confirm payout separately, observe errors and document rollback/disable procedure. No normal collection until acceptance is recorded. |

The current adapter permits one payment attempt per application and has no reset, replacement-attempt or refund endpoint. An unknown Create outcome without a payment ID requires provider investigation. Full details: [GATEWAY_PAYMENTS.md](GATEWAY_PAYMENTS.md).

## Milestones after the first gateway acceptance

| Priority / milestone | Owner / dependency | Definition of done |
| --- | --- | --- |
| P1 · Refunds, disputes and bank payout reconciliation | Product owner/accounting + provider; approved financial policies and statement/API access | Track fees, refunds and net payouts with immutable adjustments and evidence-backed matching; exceptions have an authorized resolution trail. Transaction verification alone never marks a bank deposit reconciled. |
| P1 · Multi-office merchants and Nagad | Product owner + each provider + engineering | Approved collection/settlement model per office; isolated credentials/tokens and pending-payment handling across changes; Nagad adapter tested against its merchant-issued contract. Cash collection remains a separate unimplemented option if later selected. |
| P1 · Paid SaaS billing and credit policies | Product owner/accounting + engineering | Approved priced plans, real subscription/top-up settlement, refund/expiry/rollover policies and audited credit-lot operations; no silent balance edits. Citizen-service fees remain separate from SaaS revenue and credits. |
| P0 · Official service and issuing authority | Responsible office/domain owners + engineering | Approve all service schemas, eligibility, tariff versions, document wording/validity, signatory appointment and renewal/amendment rules. Implement and test official configuration without overwriting issued history. Removing DEMO text alone is not acceptance. |
| P0 · Identity, account and file protection | Product owner + approved identity/OTP provider + engineering | Replace `SYNTHETIC_DEMO` identity through approved verification; add MFA/recovery and privileged-access review; implement private storage, malware quarantine/scanning, retention and key separation with acceptance tests. |
| P1 · Service/address parity | Domain owners + engineering; approved reference evidence and geography scope | Add separate present/permanent addresses and parent-validated service geography adapters (including services #36, #41 and #42) through new schema versions. Resolve urban/village/post-office/police-station gaps explicitly; preserve historical data. |
| P1 · Notification delivery and support | Product owner + SMS/email provider + engineering | Contracted delivery, durable retries, delivery receipts, preferences, support procedures and operational alerts. Current in-app updates do not establish external delivery. |
| P1 · Production quality and pilot | Operations + engineering + an authorized pilot office | Measured accessibility/assistive-technology and load/capacity acceptance, pagination and bundle budgets, distributed rate limits, monitoring, incident response and full pilot results. The existing approximately 991 KB entry bundle warning remains an optimization item. |
| P2 · Remaining reference/content decisions | Domain owners + engineering | Resolve common/specialist screen sequences, optional coupons, language-specific fees, amendment/reissue and FAQ/content differences with authorized evidence. Any added order editing, quote expiry or application-create retry deduplication receives its own design and regression tests. |

## Resumption and evidence rules

1. Read [STATUS_AND_NEXT_STEPS.md](STATUS_AND_NEXT_STEPS.md), then the current release, gateway contract and [PROCESS_PARITY.md](PROCESS_PARITY.md). Check existing source/runtime state before changing it. Phase 0 is complete; do not repeat the audit.
2. Obtain the relevant owner/provider decisions before dependent implementation. Merchant access is presently an external dependency; no credentials are stored in this documentation.
3. Implement the selected milestone, run its focused correctness/security checks and required full release checks, and record actual outcomes. Preserve application/PDF/ledger history and tenant isolation through migrations.
4. Record deployment, runtime identity and live checks separately from local tests. Keep provider mocks, genuine sandbox transactions and real-money evidence clearly separated.

All certificates remain **DEMO / NOT OFFICIAL**. The 47-service matrix, observed reference screens and independently implemented code do not prove successful reference-site payment/approval/issuance or statutory correctness. Preserve every **UNVERIFIED / PARTIAL / GAP** label until appropriate evidence resolves it; never publish private citizen records, credentials, seals or signatures as test evidence.
