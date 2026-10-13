# Delivery backlog after release 0.2

## Delivered

The original resident slice, all 47 operational form/workflow demonstrations, family/trade schema expansion and PDFs, general/trade renewal, public discovery/directory/notices/tracking, synthetic accounts/recovery, tenant administration, owner provisioning, sandbox subscriptions/credits, private copies, reports, feedback and in-app updates are implemented and tested. See DELIVERY_REPORT.md and TEST_MATRIX.md.

## Next milestone — authorized staging

1. Choose an owned deployment destination, HTTPS domain, credential/key store and operational contacts. Run the supplied container/native instructions and CI workflow on that infrastructure; record results rather than treating the files as proof.
2. Review every service schema/template with its responsible office/domain owner. Approve eligibility, necessary identity fields, language/wording, statutory fee schedules, renewals/expiry and signatory authorization. Preserve published histories when revising rules.
3. Contract approved identity/OTP and payment providers. Implement adapter contracts against their actual sandbox documentation, signed callbacks, reconciliation and recovery. Replace synthetic/zero-price semantics only after acceptance.
4. Add private object storage, malware quarantine/scanning, retention/legal-hold procedures, encryption/key separation, offsite backups and restore drills with approved recovery targets.
5. Complete assistive-technology/contrast testing, workload/capacity benchmarks, distributed rate limiting, monitoring/alerting and incident response. Test one authorized pilot office with the full acceptance matrix.

## Subsequent work

| Priority | Work | Definition of done |
|---|---|---|
| P0 | Staging runtime/CI verification | Fresh deployment, health, secrets/TLS, migrations, all tests and rollback/recovery evidence |
| P0 | Official/domain approval | Signed service rules/templates/fees/authority; no accidental activation by removing DEMO text |
| P0 | Identity and file protection | Approved identity state machine, quarantine/scanning, storage/retention/access acceptance |
| P1 | Commercial payments | Approved priced plans, real sandbox settlement/reconciliation, refunds/chargebacks and accounting acceptance |
| P1 | Credit policies | Owner-approved expiry/rollover/credit lots and audited scheduled operations; no silent balance edits |
| P1 | Delivery and support | Contracted SMS/email provider, retries/outbox worker, delivery receipts, notification preferences and alerts |
| P1 | Account operations | MFA, owner/admin recovery, multi-office switching, support controls and privileged access review |
| P1 | Performance/accessibility | Recorded staging budgets, large-data pagination/load, screen-reader/contrast review and repairs |
| P2 | Broader domain data | Approved separate present/permanent addresses, holding assessments, local-office codes and service-specific statutory workflows |

The reference audit's unseen success paths stay UNVERIFIED. Production completion needs infrastructure/provider/domain evidence that cannot be inferred from the observed UI or local synthetic tests.
