# Release 0.7 — easier daily use

This increment follows the owner's request to make Astra easier to use. It changes the existing working frontend; the PostgreSQL schema, tenant authorization, approval workflow, fee rules and exactly-once credit ledger stay in place. Gateway onboarding remains deferred and live collection disabled.

## What changed

| Task | Improved experience |
| --- | --- |
| Start the day | The overview leads with three role-specific tasks. Citizen/counter staff can start an application, find an existing one or view corrections. Reviewers and approvers get the appropriate queues; finance and owners get their permitted tools. No counts are invented from a filtered page. |
| Navigate on a phone | A labelled page picker exposes every permitted destination, alongside the existing navigation. The active page and language are retained. |
| Begin an application | Citizen → service → details/fees/draft steps explain the sequence. A selected-service shortcut goes to its form. All 47 services remain available. |
| Find a service | English/Bangla names and Bangla service numbers work. Result counts, clear search and useful empty states prevent dead ends. Public service selection focuses its details instead of leaving them below 47 cards. |
| Correct a form | Validation lists readable field labels, including nested rows. Focus moves to the error summary after rendering; each error link focuses its actual field. Validation still runs against the canonical schema. |
| Understand progress | A role/state-based “What happens next” panel explains drafts, submission, correction, review, approval, fee holds and issued/revoked certificates. Links go to existing controls; they never change state. |
| Find an application | Localized dates, clear filters and distinct empty/no-match guidance. Cancelled and revoked states are included using the existing API's supported filters. |
| Public tasks and login | Direct tracking/verification shortcuts and an accessible show/hide password control. Submission masks the password; successful login/logout keep existing clearing protections. |

All new interactions have Bangla and English copy. DEMO / NOT OFFICIAL remains visible; detailed reference limitations are available under the overview's expandable information section. Saving a draft is explicitly distinguished from submitting it.

## Verification record

On 21 October 2026, **49/49 local frontend tests** and the production build passed. The 13 new checks comprise three public browser tests, three workspace browser tests and seven role/state guidance render tests. Coverage includes public task routing, search recovery, password visibility, role-specific queues, mobile navigation, real draft/submission, validation focus and fee/authority guidance. [Local evidence](../execution/usability-local-qa.json), [full web test log](../execution/usability-web-tests.log).

GitHub [CI run 39552222856](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39552222856) passed **223/223 tests** (5 backup safety, 72 forms, 97 API, 49 frontend), production and Docker builds, and the dependency audit with zero vulnerabilities. It tested commit `56fb7f56bd77cfde2887a52384d3a9b4706a421e`. [CI evidence](../execution/usability-ci-qa.json).

The same runtime is **live** at [Astra](https://astra-union-services.onrender.com/). Render deployment `dep-dbc596mi0phs73aeldug` finished on **21 October 2026 at 12:01:21 Asia/Dhaka**. No database migration or external database access was needed. [Deployment evidence](../execution/usability-render-deploy.json).

Post-deploy acceptance passed **8 live usability/browser groups** and **22 API groups** (4 security, 7 payment, 6 historical readback and 5 geography). All **8 deployed JavaScript/CSS files** matched the tested local build and immutable cache headers. Live checks retained the original PDF bytes, 24-credit wallet, one three-credit issuance debit and five application events. The browser verified both languages at 390 × 844, logged out, and recorded zero page errors or unintended mutations. Payment collection stayed disabled. [Live browser](../execution/usability-live-browser-qa.json), [live API and preservation summary](../execution/usability-live-release.json), [asset hashes](../execution/usability-live-assets.json), [database metadata](../execution/usability-network-qa.json).

The browser tests use synthetic records and real local PostgreSQL. The guidance render tests cover role/state branches without provider calls. Live acceptance used existing synthetic accounts; only sessions and their security audit changed. It created no payments, citizen/application records or certificates and changed no tariffs or passwords. Screenshots: [live English dashboard](../execution/usability-live-workspace-home-en.png), [live Bangla guidance](../execution/usability-live-guidance-bn.png), [desktop overview](../execution/screenshots/usability-workspace-home-en.png), [mobile Bangla overview](../execution/screenshots/usability-workspace-home-bn.png).

## Remaining limits and next work

- No claim of full accessibility conformance or usability validation with real office staff. Keyboard/focus, both languages and 390px layouts are tested; screen-reader studies and office pilot feedback remain future work.
- Existing unsaved-data behavior is preserved: changing the selected citizen or service clears unsaved intake fields. No autosave or cross-device draft recovery was added.
- Public loading keeps its 400 KB raw entry budget. The larger authenticated schema/workspace chunk remains a future optimization target; bundle sizes are not real-network performance measurements.
- The hosted full backup, independently stored keys and cross-host restore remain open. Durable hosting is needed before the current Free PostgreSQL expiry on **12 November 2026**.
- MFA, verified identity/OTP, privileged recovery, file scanning, real payment-provider acceptance and official issuing authority remain open. Earlier reference-audit evidence limitations are unchanged.

Next operational priority: protected hosted export and independent restore, followed by durable hosting. Next usability priority: observe a responsible office's real daily tasks and validate terminology, forms, accessibility and large-data navigation against that feedback.
