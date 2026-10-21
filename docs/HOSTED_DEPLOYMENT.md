# Hosted deployment record

**Verified 21 October 2026: release 0.7.0 is live and post-deploy checks passed.** It makes daily tasks, application progress, search, validation and mobile navigation easier to use. Payment gateway work remains deferred. Collection is disabled; Nagad and bank payout reconciliation are not integrated. No genuine provider transaction or official issuing authority is claimed. Certificates remain **DEMO / NOT OFFICIAL**. See [0.7 release evidence](RELEASE_0_7.md).

## Current 0.7 deployment and verification

| Component | Verified result |
| --- | --- |
| Live URL | [astra-union-services.onrender.com](https://astra-union-services.onrender.com/) |
| Runtime commit | `56fb7f56bd77cfde2887a52384d3a9b4706a421e` |
| Render deployment | `dep-dbc596mi0phs73aeldug`, status `live`; completed `2026-10-21T06:01:21.514444Z` (12:01:21 Asia/Dhaka) |
| CI | [Run 39552222856](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39552222856): **223/223 tests**, production/Docker builds and zero-vulnerability audit passed |
| Live usability | **8/8 groups passed**: public task shortcuts, Bangla service-number search, selected-service focus/return, password visibility, role tasks, mobile page picker, empty search reset, fee-hold guidance, BN/EN retention and logout/privacy checks |
| Live API regression | **22/22 groups passed**: 4 account security, 7 payment controls, 6 historical readback, 5 geography |
| Preserved records | Original PDF byte-for-byte identical; original wallet 24 credits, one three-credit issuance debit and five application events; QR/tracking remain minimal |
| Frontend assets | All **8 JS/CSS assets** match tested local SHA-256 hashes and immutable cache headers |
| Public entry | 355,788 raw bytes; 99,454 gzip bytes; remains below the 400 KB raw budget |
| Database | No schema change or external access opening; database available with empty external IP allowlist |
| Hosting | Same Free Singapore service `srv-db6tvpou01pc73bjkpr0`; Auto-Deploy Off; Free PostgreSQL expiry **12 November 2026** |

Evidence: [consolidated release](../execution/usability-live-release.json), [Render](../execution/usability-render-deploy.json), [CI](../execution/usability-ci-qa.json), [live browser](../execution/usability-live-browser-qa.json), [security](../execution/usability-hosted-security.json), [payment](../execution/usability-hosted-payments.json), [historical readback](../execution/usability-hosted-readback.json), [geography](../execution/usability-hosted-geography.json), [assets](../execution/usability-live-assets.json), [database metadata](../execution/usability-network-qa.json).

The live UI used existing synthetic QA accounts and records; login/logout were its only writes. The separate session-security test revoked only another synthetic QA session and recorded its security audit. No citizen/financial records, tariffs, passwords or certificates changed. The browser finished signed out with blank credentials, zero page errors and zero unintended mutations. No migration or database firewall opening was required. Later documentation commits do not change the deployed runtime because Auto-Deploy is off.

Screenshots: [English daily tasks](../execution/usability-live-workspace-home-en.png), [Bangla next-step guidance](../execution/usability-live-guidance-bn.png), [public shortcuts](../execution/usability-live-public-tasks.png). Hosted full backup, independent key custody/restore and durable hosting before database expiry remain open.

## Release 0.6 history — 19 October deployment, 21 October verification

The following preserves the previous runtime and its acceptance evidence. The current runtime and results are recorded above.

| Component | Verified result |
| --- | --- |
| Live URL | [astra-union-services.onrender.com](https://astra-union-services.onrender.com/) |
| Runtime commit | `402903fb113799f5d7e5ec8d62307ba88f625318` |
| Render deployment | `dep-dbappb8m7kps739q5ivg`, status `live`; completed `2026-10-19T04:31:36.05317Z` (10:31:36 Asia/Dhaka), reconfirmed 21 October |
| CI | [Run 39199410740](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39199410740): **210/210 tests**, production/Docker builds and zero-vulnerability audit passed |
| Database | No migration required; existing eleven migration files unchanged; DB available, external IP allowlist empty, no external access opened for this release |
| Hosted account/session safety | **4/4 groups passed**: self-session aggregate, CSRF/wrong-password denial, other-session revocation and current/other-account preservation |
| Payment regression | **7/7 groups passed**; collection stays disabled and no payments or receipts are fabricated |
| Historical readback | **6/6 groups passed**; original PDF, 24-credit wallet, one three-credit issuance debit, five application events and minimal public QR/tracking preserved |
| Geography regression | **5/5 read-only groups passed** |
| Live frontend assets | All **7 JavaScript/CSS files** have SHA-256 hashes matching the tested build and immutable cache headers |
| Live browser | **5/5 groups passed**: public chunk loading, English profile, Bangla 390 × 844 layout, Account security navigation and clean sign-out; zero page errors |
| Local recovery | **17 checks passed** on a real encrypted dump/isolated restore of synthetic local PostgreSQL; this is not a hosted backup |
| Public loading | Entry JavaScript 990,769 → 352,929 raw bytes (**64.4% reduction**); gzip 143,977 → 96,575 bytes (**32.9% reduction**) |
| Hosting | Same Free Singapore service `srv-db6tvpou01pc73bjkpr0`; Auto-Deploy Off; Free PostgreSQL expiry **12 November 2026** |

Evidence: [release summary](../execution/security-live-release.json), [Render deployment](../execution/security-render-deploy.json), [CI](../execution/security-ci-qa.json), [database network metadata](../execution/security-network-qa.json), [account/session API](../execution/security-hosted-qa.json), [payment API](../execution/security-hosted-payments.json), [readback](../execution/security-hosted-readback.json), [geography](../execution/security-hosted-geography.json), [live browser](../execution/security-live-browser-qa.json), [asset hashes](../execution/security-live-assets.json), [local recovery](../execution/security-backup-qa.json). Screenshots: [English session panel](../execution/security-live-account-en.png), [Bangla mobile session panel](../execution/security-live-account-bn.png).

The live checks used existing synthetic accounts. Only login/logout, session revocation and their security audit were mutated; no citizen/financial records, account passwords, actual provider payments or new certificates were created. Empty database allowlist was read through Render; no fresh external connection probe was needed or performed for 0.6. Documentation-only commits may be newer than the deployed runtime because Auto-Deploy is off.

Hosted full export, independent offsite backup/key custody and cross-host restore remain the next operational priority, followed by durable hosting before database expiry. MFA, privileged recovery and private file scanning remain open; the local recovery drill does not close those items.

## Release 0.5 history — 19 October 2026

The following is preserved historical deployment evidence. The current runtime and latest post-deploy results are recorded above.

| Component | Verified result |
| --- | --- |
| Live URL | [astra-union-services.onrender.com](https://astra-union-services.onrender.com/) |
| Runtime commit | `b86908b9a4654cc31cd1b517fc5e8ad3ae086878` |
| Render deployment | `dep-dbaob6s9v7es739a8j30`, status `live`; completed `2026-10-19T02:53:25.665787Z` (08:53:25 Asia/Dhaka) |
| CI | [Run 39125266096](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39125266096): **192/192 tests**, production/Docker builds and zero-vulnerability audit passed |
| Database migration | `012_gateway_payments.sql` committed; eleven migration files installed; forced RLS/runtime privileges and idempotent replay passed |
| Preservation | All 66 recorded domain fingerprints across three offices unchanged; counts remain 3 offices, 12 users and 2 certificates |
| External database access | Empty database IP allowlist and blocked fresh connection verified on 19 October; application health HTTP 200 |
| Hosted payment API | **7/7 groups passed** using existing synthetic records; checkout disabled before intent creation, no invented payments/receipts, role restrictions enforced |
| Historical readback | **6/6 groups passed**; original PDF, 24-credit wallet, one three-credit issuance debit and five application events preserved |
| Geography regression | **5/5 read-only groups passed** |
| Frontend assets | Entry JavaScript and CSS hashes match the tested local build; immutable cache headers present |
| Live UI browser inspection | Bangla/English register, reconciliation and disabled payment card passed; 390 × 844 layout has no horizontal overflow; zero console warnings/errors |
| Hosting | Same Free Singapore service `srv-db6tvpou01pc73bjkpr0`; Auto-Deploy Off; Free PostgreSQL expiry **12 November 2026** |

Evidence: [consolidated release metadata](../execution/payments-live-release.json), [deployment](../execution/payments-render-deploy.json), [CI](../execution/payments-ci-qa.json), [migration](../execution/payments-hosted-migration.json), [network closure](../execution/payments-network-qa.json), [database dashboard](../execution/payments-database-private.png), [payment checks](../execution/payments-hosted-qa.json), [historical readback](../execution/payments-hosted-readback.json), [geography](../execution/payments-hosted-geography.json) and [asset hashes](../execution/payments-live-assets.json).

[Live browser verification](../execution/payments-live-browser-qa.json) passed for English/Bangla registers, reconciliation, setup messages and the approved BDT 152.10 application's disabled checkout/no-receipt state. Mobile inspection at 390 × 844 showed no horizontal overflow; console warning/error counts were zero. The browser ended signed out with blank login inputs and its viewport restored. Screenshots: [English reconciliation](../execution/payments-live-reconciliation-en.png), [Bangla mobile reconciliation](../execution/payments-live-reconciliation-mobile-bn.png), [Bangla mobile payment card](../execution/payments-live-application-mobile-bn.png), [final homepage](../execution/payments-live-home-bn.png).

Migration completed on 18 October at 12:20:40.723 UTC and changed only schema 012 plus its migration marker. It created no tariff, account, application, payment or ledger records. Its preservation report covers every existing tenant dynamically and records matching before/after fingerprints. Token-cache and narrow intent-state updates are permitted; payment history remains immutable. Replaying migration skipped the SQL and retained the marker and domain fingerprints. Network closure was separately verified on 19 October before the runtime deployment.

Hosted payment checks confirmed `DISABLED`/`MERCHANT_SETUP_REQUIRED`, Nagad `NOT_INTEGRATED`, and bank payouts `NOT_CONNECTED`. The existing BDT 152.10 approved application remained unpaid without an attempt or receipt. Checkout returned `503 GATEWAY_NOT_CONFIGURED`; register, reconciliation and CSV totals remained empty. Forged callbacks, nonexistent receipt access and unauthenticated requests were rejected. Existing PDFs, application history and balances stayed unchanged. All API test sessions were logged out; no provider mock or live payment was created online.

The 0.5 readback and geography results use separate `payments-` filenames. Earlier shared 0.4 evidence was restored and remains preserved below. Documentation/evidence-only commits may be newer than the deployed runtime SHA because Auto-Deploy is off. Merchant acceptance and official issuing authority remain separate gates; this deployment does not establish either.

## Release 0.4 history — 17 October 2026

The following record preserves the previous deployment. Citizen assessments were uncollected and positive totals blocked issuance; SaaS billing QA used zero-money sandbox settlement. These are historical 0.4 results, not the current runtime identifiers or test counts. See [0.4 release evidence](RELEASE_0_4.md).

| Component | Verified result |
| --- | --- |
| Live URL | [astra-union-services.onrender.com](https://astra-union-services.onrender.com/) |
| Runtime commit | `de8a0c335aa2315e8ff03faf2e9100fcf7492622` |
| Render deployment | `dep-db9jt9m1egvs73fi5bbg`, status `live`; completed `2026-10-17T09:26:11.236745Z` (15:26:11 Asia/Dhaka) |
| CI | [Run 39020055573](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39020055573): Docker build and **162 tests** passed; zero audit vulnerabilities |
| Database migration | `011_application_orders.sql` committed after preservation checks; 10 migration files installed; runtime privileges/RLS and idempotent replay passed |
| Existing data | At migration, two offices, eight users and one certificate preserved; recorded domain fingerprints, original PDF, 24-credit wallet, one debit and five fixture events unchanged |
| External database access | Temporary approved single-IP rule removed; empty allowlist and fresh blocked connection probe, while app health remained HTTP 200 |
| New order workflow | **9/9 hosted groups passed** in one new synthetic QA office; existing-office policies untouched |
| Historical readback | **6/6 groups passed** after deployment; original PDF byte-for-byte unchanged |
| Geography regression | **5/5 read-only hosted groups passed** |
| Frontend assets | Entry JavaScript and CSS hashes match the tested local production build; immutable cache headers present |
| Live UI browser inspection | Passed bilingual fee retention, 390 × 844 layout, blank citizen-first intake and quote/acceptance gating; no console warnings/errors |
| Hosting | Same Free Singapore service `srv-db6tvpou01pc73bjkpr0`; Auto-Deploy Off; Free PostgreSQL expiry **12 November 2026** |

Evidence: [deployment](../execution/orders-render-deploy.json), [CI](../execution/orders-ci-qa.json), [migration](../execution/orders-hosted-migration.json), [network](../execution/orders-network-qa.json), [closed database access](../execution/orders-database-private.png), [order QA](../execution/hosted-orders-qa.json), [readback](../execution/hosted-redeploy-qa.json), [geography](../execution/geography-hosted-qa.json), [asset hashes](../execution/orders-live-assets.json).

[Live browser inspection](../execution/orders-live-browser-qa.json) retained the synthetic policy amounts across Bangla/English, showed no horizontal overflow at 390 × 844, hid service facts until citizen selection, then opened blank fields without hosted sample insertion. English/digital/urgent options calculated BDT 152.10, displayed the uncollected-payment warning and kept Save draft disabled while acceptance was unchecked. No domain records were added through the UI and console warning/error logs were empty. The browser ended signed out, login inputs cleared and viewport restored on the Bangla homepage. See [English admin](../execution/orders-live-admin-en.png), [Bangla mobile admin](../execution/orders-live-admin-mobile-bn.png), [mobile quote](../execution/orders-live-quote-mobile-en.png), [final homepage](../execution/orders-live-home-bn.png) and [consolidated release metadata](../execution/orders-live-release.json).

The first migration preflight stopped before changes because an older expected count was seven users; fresh read-only review confirmed eight existing users and preserved all eight. Only the private runner's preflight expectation changed; the CI-tested migration SQL did not. The bounded TLS-verified migration created schema/marker changes only, with no new tariff, payment or application records. Replay skipped migration SQL and kept its marker/domain fingerprints unchanged. Initial [preflight report](../execution/orders-hosted-migration-preflight.json) and [log](../execution/orders-hosted-migration-preflight.log) remain as evidence.

The new nine-group QA run deliberately created one dedicated synthetic office, four separate role accounts, one citizen, two policy versions, two applications and one DEMO certificate. Sandbox credits started at 20; concurrent zero-fee issuance and retry deducted three credits exactly once, leaving 17. The second approved application had an uncollected BDT 152.10 assessment and was blocked with `402 ORDER_PAYMENT_REQUIRED`, without a document or debit. All API QA sessions were logged out; immutable test records are retained. No existing office was assigned a fee policy by migration or this test. These synthetic test tariffs are not defaults or legal schedules.

Original-fixture readback finished `2026-10-17T09:27:10.583Z`: its 114,286-byte PDF/hash, 24-credit balance, one three-credit debit and five events persisted. The separate geography regression used only unauthenticated GETs. These checks establish the exercised paths at that time, not an uptime commitment or full reference-site parity. Later evidence-only commits may differ from the deployed runtime SHA above.

## Release 0.3 history — 13 October 2026

The following table and 13 October narrative retain the preceding deployment's evidence. They are not the current runtime identifiers or test counts. The shared readback/geography evidence files preserve the 17 October 0.4 rerun; current 0.5 results use separate `payments-` files. Original 0.3 aggregate metadata remains in [geography-live-release.json](../execution/geography-live-release.json).

| Component | Verified status |
| --- | --- |
| Source repository | [sajeeb-ahmeed/astra-union-services](https://github.com/sajeeb-ahmeed/astra-union-services), public with the owner's explicit approval |
| Deployment branch | `codex/initial-deployment` |
| Final release CI | [Astra verification run 38371905308](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/38371905308): application verification and Docker build both passed |
| Deployed release commit | `6b949baa7738b038a60ef41c4c30f4a0f5e6acb3` |
| Automated CI tests | **142 passed**: 72 form tests, 47 API/security tests, 23 web tests; zero failures |
| Dependency audit | Zero reported vulnerabilities in the final CI run |
| Hosted database | Render Free PostgreSQL 17, Singapore; initialized and connection/privilege checks passed |
| Database expiry | **12 November 2026** according to the provisioned Free database |
| Web service | Live as `srv-db6tvpou01pc73bjkpr0` |
| Current deployment | `dep-db6v2g6k1f9s73bm31vg` succeeded, deploying the final release commit above |
| Web resources | Singapore, Free instance: 0.1 CPU and 512 MB RAM |
| Deployment trigger | Public Git repository URL; Auto-Deploy explicitly Off |
| Public URL | [astra-union-services.onrender.com](https://astra-union-services.onrender.com), live |
| Health check | `/api/v1/health` returned HTTP 200 with `database: PostgreSQL` and `mode: DEMO_ONLY` |
| Initial hosted workflow | **15 of 15 groups passed** on commit `72acccd5329e76bd29834eac39835adbab869c5b`, zero failures, at 07:43 UTC on 13 October 2026 |
| Final release durability | **6 of 6 readback groups passed** after the final deployment, with existing records and PDF bytes unchanged |
| Browser checks | English/Bangla public UI, registration cascade, retained draft name, language persistence, owner workspace and mobile layout verified |
| Hosted geography | **5 of 5 groups passed**: source counts/names, parents, all eight division paths, invalid parents, coverage gap and office filters |

The repository and new Astra hosting resources are the deployment scope. Existing unrelated services are outside this scope.

Release 0.3 CI, Render and live verification metadata are recorded in [current release evidence](../execution/geography-live-release.json). The [earlier hosted CI evidence](../execution/hosted-ci-qa.json) records the preceding release.

## Build validation

The first Render Docker build failed because the Dockerfile attempted to copy a nonexistent `apps/api/package.json`. API dependencies are managed by the root workspace package. Commit `72acccd5329e76bd29834eac39835adbab869c5b` removes that invalid copy instruction. Its replacement deployment succeeded and the public API health check passed.

Commit `121a5960e286f430c6e68a356a81e1b2df224534` added a separate Docker build job to GitHub CI, so later CI runs check the container recipe as well as the application tests. The preceding release `a398af0fe7fb0805d5077f522ebf98a9102dbf43` passed both jobs and contains the logout credential-clearing correction inherited by release 0.3.

## Database initialization and isolation

Release 0.3 migration `010_bangladesh_geography.sql` imported the supplied **46,427 geography records** on 13 October 2026 through a certificate-verified TLS connection. Before and after counts remained two offices, seven users and one certificate. The restricted application role can read the reference tables but cannot modify them; an unscoped citizen query returned zero rows, and replaying the migration made no changes. See [migration evidence](../execution/geography-hosted-migration.json).

The authorized single-host maintenance rule was removed immediately afterward. At `2026-10-13T08:31:32.454Z`, a new external database connection was blocked while the public application's internal connection remained healthy. See [network evidence](../execution/hosted-network-qa.json) and [private database setting](../execution/geography-database-private.png).

The hosted database was initialized through a certificate-verified external TLS connection. At initialization it contained one unique owner account, zero offices, the 47-service catalog, and eight applied migrations. These are initialization counts, not a permanent expectation after onboarding or QA.

The migration account is neither a PostgreSQL superuser nor a role with `BYPASSRLS`. The runtime application role is also `NOCREATEDB` and `NOCREATEROLE`; unscoped citizen reads returned zero rows. The public report contains no connection strings or passwords. See [hosted database evidence](../execution/render-database-qa.json).

Migration `009_managed_public_read.sql` supports managed PostgreSQL without removing forced row-level security. It adds SELECT policies for the exact migration owner on only the four tables used by bounded public verification, tracking, notice, and recovery functions. The application role cannot be or inherit that owner. Existing tenant policies remain in place.

An isolated local regression executed these migrations with a non-superuser, non-bypass migration owner. Ten grouped checks passed, including public-function filtering, denied unscoped and cross-tenant reads/writes, denied owner-role assumption, protected wallet updates, the ledger lock/trigger, and read-only geography access. See [managed PostgreSQL regression evidence](../execution/managed-postgres-qa.json).

After setup, the new Astra database's external inbound IP allowlist was closed. Render settings showed that all internet traffic was blocked; a fresh external database connection failed while the live application's health check remained HTTP 200 through its internal database connection. See [hosted network evidence](../execution/hosted-network-qa.json). This change applies only to the new Astra database.

For a future administrator migration or export from outside Render, temporarily allow only the administrator's current public IP as a single-host rule. Use a certificate-verified TLS connection, complete and verify the authorized maintenance, then immediately remove that temporary rule. Confirm that a fresh external connection is blocked again and the public app remains healthy. Do not reopen access to all addresses for routine maintenance.

## Web service configuration

The deployment uses the repository's Dockerfile for the React frontend, Express API, and Chromium PDF renderer. It installs the locked browser version and Bangla-capable fonts. The browser-facing app and API share one HTTPS origin.

Configure the new web service with:

| Setting | Required value or rule |
| --- | --- |
| Runtime | Docker, using the repository root Dockerfile |
| Compute plan | Free; no paid plan has been approved |
| Region | Singapore, matching the database |
| Host | `0.0.0.0` |
| Port | The port selected for the Render service; the server reads `PORT` |
| Health check | `/api/v1/health` |
| `NODE_ENV` | `production` |
| `PUBLIC_ORIGIN` | The exact generated HTTPS origin, without a trailing slash |
| `DATABASE_URL` | Restricted application-role connection to the hosted database |
| `DEMO_WEBHOOK_SECRET` | A unique secret of at least 32 characters |
| `PDF_MAX_CONCURRENCY` | `1`, to constrain renderer memory use on the Free service |
| Proxy trust | Leave unset until a specific trusted ingress peer has been verified; never broadly trust caller-supplied forwarding headers |

Administrator database credentials and the initial owner password belong only to setup and private credential custody. They are not required by the running app. Do not seed the public deployment with the documented local fixture accounts.

Free web services do not provide pre-deploy commands, one-off jobs, or SSH shell access. Database setup therefore runs separately before deploying the app. Subsequent schema changes also require a separate controlled migration step. [Render deployment documentation](https://render.com/docs/deploys#pre-deploy-command) describes these restrictions.

## Releasing updates

Auto-Deploy is **Off**. Pushing a commit to GitHub does not publish that commit to this service. For each release:

1. Push the intended changes to `codex/initial-deployment` and wait for the corresponding GitHub verification run to pass.
2. If the release changes the database schema, perform the separate controlled migration and verify it before switching application versions.
3. In the new Astra Render service, use **Manual Deploy**, selecting the verified commit where available. Confirm the deployment log's commit matches the passing CI run.
4. Wait for the service to become healthy, then rerun the relevant hosted checks and record the deployed commit, URL, and results.

The 0.3 deployment's CI run and Render build passed. Its initial 15-group hosted workflow was followed by six durability checks and the login/logout browser regression. Release 0.4 was explicitly deployed using the exact CI-verified commit recorded above. Public-URL services require explicit deployment; see [Render's deployment guidance](https://render.com/docs/deploys).

## Historical initial hosted verification — 13 October 2026

[The hosted workflow runner](../scripts/verify-hosted.ts) completed successfully against the confirmed HTTPS origin on commit `72acccd5329e76bd29834eac39835adbab869c5b`, using privately stored owner credentials. The runner created dedicated synthetic offices and accounts and retained their immutable ledger/audit evidence. All 15 check groups passed. It exercised:

- HTTPS health, frontend delivery, security headers, catalog, and all 47 operational schema endpoints.
- Owner office onboarding, separate staff roles, citizen signup, and persisted profile changes.
- Schema validation, CSRF rejection, private access denial, and tenant isolation.
- Submission, review, explicit service approval grants, and final approval.
- Inactive subscription denial, sandbox subscription/top-up settlement, and replay handling.
- Concurrent certificate issuance and retry with exactly one credit debit.
- Private PDF authorization, visible DEMO watermark, decoded QR verification, and minimal public tracking.

The hosted issuance race returned the same certificate for both concurrent requests and its later retry. Exactly one three-credit debit was recorded, reducing the QA wallet from 27 to 24. The isolation office remained at zero credits. The downloaded certificate was a one-page PDF with a DEMO watermark and a decoded QR matching its public verification URL. Anonymous and other-tenant PDF requests were denied.

Evidence: [hosted test report](../execution/hosted-qa.json), [downloaded demo certificate](../execution/hosted-demo-certificate.pdf), and [rendered certificate](../execution/hosted-demo-certificate.png). The PDF was 114,286 bytes with SHA-256 `c45948f0e9df74073010820258ccd60b1ce35f2d49ca8f4956c7f2a11668a0fb`.

The live run completed at `2026-10-13T07:43:01.051Z`; these results establish the tested synthetic journey at that time, not an uptime guarantee. After an ambiguous network failure, inspect the saved run before starting another mutation sequence.

Separate browser inspection passed for the desktop homepage and a 390 by 844 mobile viewport, including catalog search and service details without overall horizontal overflow. Owner sign-in displayed the two QA offices and their 24/0 credit balances, and logout completed. The actual QR URL displayed only public certificate metadata and the DEMO notice. Browser error and warning logs were empty. Evidence: [browser check report](../execution/hosted-browser-qa.json), [desktop homepage](../execution/hosted-home-desktop.png), [mobile homepage](../execution/hosted-home-mobile.png), [mobile service details](../execution/hosted-service-mobile.png), [owner workspace](../execution/hosted-owner-workspace.png), and [public verification](../execution/hosted-public-verification.png).

The initial inspection found a masked password value remaining in React state after logout. The preceding release corrected this and clears both sign-in fields on logout. Browser testing performed login and logout without navigation on deployment `dep-db6u4dnf3r2c73chvk5g` and confirmed `emailEmpty=true` and `passwordEmpty=true`, with no warning or error logs. Those screenshots document the preceding release. A browser password manager may independently refill a login form; the application does not control that user preference.

[The readback runner](../scripts/verify-hosted-readback.ts) passed all six groups again on release 0.3 at `2026-10-13T08:53:53.185Z`, recorded in [0.3 aggregate evidence](../execution/geography-live-release.json). Only login/logout session state changed. The same application, certificate and five audit transitions persisted; the wallet remained at 24 credits with one issuance debit of minus three; the PDF retained the identical SHA-256 above. The [preserved 0.4 durability evidence](../execution/hosted-redeploy-qa.json) now records the successful 17 October rerun against 0.4.

## Release 0.3 geography and interface verification

The 0.3 geography API passed five read-only hosted groups at `2026-10-13T08:53:55.462Z`, recorded in [0.3 aggregate evidence](../execution/geography-live-release.json). The [preserved 0.4 read-only report](../execution/geography-hosted-qa.json) now records the passing 17 October rerun against 0.4. Counts match the supplied 8 divisions, 64 districts, 495 upazilas, 4,586 unions and 41,274 derived wards. All eight divisions and all 64 districts were compared to source names and parents; a complete district/upazila/union/ward route was checked in each division. This is representative hosted route coverage, not an exhaustive request for every row. Missing, wrong-level and unknown parents were rejected, Shaistaganj remained an explicit empty coverage gap, and geography filters did not invent participating offices.

Browser inspection verified the minimal English/Bangla public interface, persisted language after reload, a Dhaka → Dhaka → Savar → Ashulia → Ward 3 cascade, retained selected geography and a draft display name across language changes, and the explicit preview-office fallback. The 390 × 844 registration viewport had no overall horizontal overflow. Owner login, translated navigation and management controls, and sign-out were exercised. Final checks confirmed translated owner metrics and bilingual office names. See [browser evidence](../execution/geography-live-browser-qa.json), [Bangla homepage](../execution/geography-live-home-bn.png), [mobile registration](../execution/geography-live-register-mobile.png) and [deployed Render release](../execution/geography-render-deployed.png).

The final UI patch covers conditional labels, workflow event/order names, fallback labels, translated accessibility prefixes and locale-aware tenant names. It passed the 23-test browser suite locally and the full 142-test CI suite. The deployed entry JavaScript and CSS were also downloaded and matched byte-for-byte against the tested local production build; see [asset verification](../execution/geography-live-assets.json). Source-coverage checks include direct labels, conditional branches and fallback strings. Arbitrary entered data and unknown server diagnostics are not machine-translated; numeric identifiers remain canonical. See [language guide](LANGUAGE_AND_UI.md).

The supplied dataset is community MIT data, not an official current national register; ward labels are derived, and urban wards/boundaries are absent. Legacy QA offices remain explicitly unmapped preview offices. Participating real offices require deliberate enrollment and jurisdiction mapping. See [geography integration](GEOGRAPHY_INTEGRATION.md).

## Owner handoff

Unique hosted credentials are supplied in local ignored files `OWNER_LOGIN.txt` and `DEMO_ROLE_LOGINS.txt` under `.runtime/hosted/`. They are not part of the public source repository or this report. Use the owner login for platform administration; the role logins are synthetic QA accounts for inspecting the demonstrated workflow. Release 0.5 API QA invalidated its sessions, and its live browser inspection ended signed out with cleared login inputs. Keep these handoff files private and rotate credentials through the application's password controls when transferring access.

## Free hosting limits and next operational milestone

The provisioned database expires on **12 November 2026**. Render documents a 14-day upgrade grace period after Free database expiry, followed by deletion if it is not upgraded. Free Postgres has a 1 GB limit and no provider-managed backups. Free web services can sleep after 15 minutes of inactivity and take about a minute to wake. These limits make this a hosted demonstration, not a production availability commitment. [Render Free limits](https://render.com/docs/free)

Before the database expires, choose an authorized migration or paid hosting plan and arrange a verified export/restore and backup-retention process. No upgrade or paid service is authorized by this record. Multi-instance rate limiting, external identity/payment providers, SMS/email delivery, and official certificate authority remain separate implementation and operational work.
