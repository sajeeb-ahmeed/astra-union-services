# Hosted deployment record

Updated 13 October 2026. Astra remains a synthetic DEMO application: certificate output is marked **DEMO / NOT OFFICIAL**, and billing uses zero-money sandbox settlement.

## Current status

| Component | Verified status |
| --- | --- |
| Source repository | [sajeeb-ahmeed/astra-union-services](https://github.com/sajeeb-ahmeed/astra-union-services), public with the owner's explicit approval |
| Deployment branch | `codex/initial-deployment` |
| Final release CI | [Astra verification run 38364753145](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/38364753145): application verification and Docker build both passed |
| Deployed release commit | `a398af0fe7fb0805d5077f522ebf98a9102dbf43` |
| Automated CI tests | **129 passed**: 72 form tests, 40 API/security tests, 17 web tests; zero failures |
| Dependency audit | Zero reported vulnerabilities in the final CI run |
| Hosted database | Render Free PostgreSQL 17, Singapore; initialized and connection/privilege checks passed |
| Database expiry | **12 November 2026** according to the provisioned Free database |
| Web service | Live as `srv-db6tvpou01pc73bjkpr0` |
| Current deployment | `dep-db6u4dnf3r2c73chvk5g` succeeded, deploying the final release commit above |
| Web resources | Singapore, Free instance: 0.1 CPU and 512 MB RAM |
| Deployment trigger | Public Git repository URL; Auto-Deploy explicitly Off |
| Public URL | [astra-union-services.onrender.com](https://astra-union-services.onrender.com), live |
| Health check | `/api/v1/health` returned HTTP 200 with `database: PostgreSQL` and `mode: DEMO_ONLY` |
| Initial hosted workflow | **15 of 15 groups passed** on commit `72acccd5329e76bd29834eac39835adbab869c5b`, zero failures, at 07:43 UTC on 13 October 2026 |
| Final release durability | **6 of 6 readback groups passed** after the final deployment, with existing records and PDF bytes unchanged |
| Browser checks | Desktop/mobile smoke checks and final login/logout credential-clearing regression passed |

The repository and new Astra hosting resources are the deployment scope. Existing unrelated services are outside this scope.

The final CI and Render release metadata are recorded in [hosted CI evidence](../execution/hosted-ci-qa.json).

## Build validation

The first Render Docker build failed because the Dockerfile attempted to copy a nonexistent `apps/api/package.json`. API dependencies are managed by the root workspace package. Commit `72acccd5329e76bd29834eac39835adbab869c5b` removes that invalid copy instruction. Its replacement deployment succeeded and the public API health check passed.

Commit `121a5960e286f430c6e68a356a81e1b2df224534` added a separate Docker build job to GitHub CI, so later CI runs check the container recipe as well as the application tests. The final deployed commit `a398af0fe7fb0805d5077f522ebf98a9102dbf43` passed both jobs and also contains the verified logout credential-clearing correction.

## Database initialization and isolation

The hosted database was initialized through a certificate-verified external TLS connection. At initialization it contained one unique owner account, zero offices, the 47-service catalog, and eight applied migrations. These are initialization counts, not a permanent expectation after onboarding or QA.

The migration account is neither a PostgreSQL superuser nor a role with `BYPASSRLS`. The runtime application role is also `NOCREATEDB` and `NOCREATEROLE`; unscoped citizen reads returned zero rows. The public report contains no connection strings or passwords. See [hosted database evidence](../execution/render-database-qa.json).

Migration `009_managed_public_read.sql` supports managed PostgreSQL without removing forced row-level security. It adds SELECT policies for the exact migration owner on only the four tables used by bounded public verification, tracking, notice, and recovery functions. The application role cannot be or inherit that owner. Existing tenant policies remain in place.

An isolated local regression executed these migrations with a non-superuser, non-bypass migration owner. Nine grouped checks passed, including public-function filtering, denied unscoped and cross-tenant reads/writes, denied owner-role assumption, protected wallet updates, and the ledger lock/trigger. See [managed PostgreSQL regression evidence](../execution/managed-postgres-qa.json).

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

The final deployed commit's CI run and Render build passed. The initial 15-group hosted workflow was followed by six durability checks and the login/logout browser regression on the final release. Public-URL services require manual deployment; see [Render's deployment guidance](https://render.com/docs/deploys).

## Hosted verification results

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

The initial inspection found a masked password value remaining in React state after logout. The final release clears both sign-in fields on logout. Browser testing performed login and logout without navigation on deployment `dep-db6u4dnf3r2c73chvk5g` and confirmed `emailEmpty=true` and `passwordEmpty=true`, with no warning or error logs. Earlier screenshots document the original smoke inspection; the browser report separately identifies the final regression and its verified commit.

[The readback runner](../scripts/verify-hosted-readback.ts) then passed all six groups against the final release at `2026-10-13T07:50:00.324Z`. It created only login/logout sessions and did not create additional offices or modify existing domain records. The same application remained issued with five audit transitions, the same certificate persisted, the wallet retained 24 credits and one issuance debit of minus three, and the downloaded PDF retained the identical SHA-256 above. Public verification/tracking remained minimal. See [final release readback evidence](../execution/hosted-redeploy-qa.json).

## Owner handoff

Unique hosted credentials are supplied in local ignored files `OWNER_LOGIN.txt` and `DEMO_ROLE_LOGINS.txt` under `.runtime/hosted/`. They are not part of the public source repository or this report. Use the owner login for platform administration; the role logins are synthetic QA accounts for inspecting the demonstrated workflow. The browser was left signed out after verification. Keep these handoff files private and rotate credentials through the application's password controls when transferring access.

## Free hosting limits and next operational milestone

The provisioned database expires on **12 November 2026**. Render documents a 14-day upgrade grace period after Free database expiry, followed by deletion if it is not upgraded. Free Postgres has a 1 GB limit and no provider-managed backups. Free web services can sleep after 15 minutes of inactivity and take about a minute to wake. These limits make this a hosted demonstration, not a production availability commitment. [Render Free limits](https://render.com/docs/free)

Before the database expires, choose an authorized migration or paid hosting plan and arrange a verified export/restore and backup-retention process. No upgrade or paid service is authorized by this record. Multi-instance rate limiting, external identity/payment providers, SMS/email delivery, and official certificate authority remain separate implementation and operational work.
