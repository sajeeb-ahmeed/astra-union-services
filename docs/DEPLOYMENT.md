# Deployment and reproducibility

Updated for **0.5 live deployment · 19 October 2026**. Windows/Node 24/PostgreSQL 17.11 is the local development path. [Release 0.5](RELEASE_0_5.md) records local verification, 192 passing Linux CI tests, Docker build, hosted migration, exact deployment and 18 passing hosted API regression groups; live Bangla/English and mobile browser checks also passed. [HOSTED_DEPLOYMENT.md](HOSTED_DEPLOYMENT.md) records the current runtime and preserved 0.4/0.3 history. Certificate documents retain DEMO / NOT OFFICIAL semantics.

## Local Windows

Follow README. Runtime setup initializes only `.runtime/postgres-data`, uses SCRAM, separate administrator/application credentials and verifies authentication before readiness. Existing data is preserved. Migrations run transactionally per file; seed checks immutable schema hashes.

For the built website without Vite, stop the existing API, then:

```powershell
npm run build
$env:SERVE_WEB='true'
$env:PUBLIC_ORIGIN='http://127.0.0.1:3001'
npm start
```

Reset those variables before returning to Vite. Built frontend/API share one origin. Hashed assets use immutable caching and Brotli/gzip; HTML, API and private documents use no-store.

## Controlled hosted demonstration

Requirements: domain/server you control, Docker Engine+Compose, HTTPS reverse proxy, persistent private DB storage, unique credentials and backup/key custody. This is not an official-production readiness claim.

1. Copy `.env.example` to `.env`. Generate distinct random administrator/app DB passwords and HMAC key. Hexadecimal DB passwords avoid URI escaping. Choose a unique owner email/password (minimum 16 characters), and exact HTTPS `PUBLIC_ORIGIN` without trailing slash. Do not use fixture credentials.
2. Run:

```sh
docker compose build
docker compose up -d db
docker compose --profile tools run --rm setup
docker compose up -d app
docker compose ps
```

3. Configure HTTPS. `deployment/Caddyfile` is an example using `ASTRA_DOMAIN`; route DNS and configure Caddy log-directory permissions. It proxies to loopback 3001 and strips URI/cookie/auth/CSRF values from structured logs. Compose uses the named network `astra_private`, subnet `172.29.250.0/24`, gateway `172.29.250.1`; the app trusts only that exact gateway as the expected host-to-container proxy peer. If this subnet conflicts with an existing network, change both `ASTRA_PROXY_SUBNET` and `ASTRA_PROXY_GATEWAY` in `.env` before creating the network. The latter also supplies the app's `TRUST_PROXY_IP`; never replace it with the whole subnet. Caddy installation/TLS issuance and Docker forwarding are not executed here. In staging, verify the actual immediate proxy address and that different real clients receive separate rate-limit buckets before inviting users. Equivalent provider-managed HTTPS requires configuring its exact immediate proxy peer.
4. Sign in as the unique owner and create an office/administrator. New offices have zero credits and an expired subscription. Administrators may settle a **local sandbox SaaS subscription**, provision staff and record explicit demo service grants. That SaaS fixture collects no money and confers no legal appointment. Citizen-fee bKash checkout is separately disabled by default.
5. Verify the full tenant-isolated journey in staging before additional users.

Setup receives administrator credentials for role creation/migrations/initialization; the running app receives restricted `astra_app` credentials only. The database port is not published. Bootstrap refuses a privileged application role. `initialize.ts` creates the 47-service catalog/demo plan/one owner without sample citizens or offices; repeated initialization preserves passwords and rejects changes under immutable schema versions. This was executed twice against an empty local DB.

The container installs the locked Playwright package's matching Chromium plus Noto fonts, runs as `node`, uses an init process and 256 MiB shared memory. Renderer HTML is application-owned/escaped; remote resources are blocked and concurrent jobs bounded. Container sandbox policies require staging validation. [Official Playwright Docker guidance](https://playwright.dev/docs/docker) explains version matching and runtime requirements.

Compose fails for missing required variables. See [Docker interpolation documentation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/). `.env` is ignored by Git/package/Docker context; it is not a managed secret store. Protect it and plan rotation. Changing `.env` does not change an existing PostgreSQL role password.

## Native Linux

Install Node 24, PostgreSQL 17, Chromium dependencies and a licensed Bangla font. Create `astra`; supply `DATABASE_ADMIN_URL`, `ASTRA_APP_PASSWORD`, `OWNER_EMAIL`, `OWNER_PASSWORD` to `npm run db:initialize`. Supply restricted `DATABASE_URL`, HTTPS `PUBLIC_ORIGIN`, unique 32+ character `DEMO_WEBHOOK_SECRET`, `NODE_ENV=production`, and appropriate `HOST` to the app service. Run `npm ci`, `npx playwright install --with-deps chromium`, `npm run build`, `npm start`. Separate service/migration credential scopes. This path has not been executed here.

Production-mode startup rejects missing secrets, insecure/malformed origins and broad proxy trust. `TRUST_PROXY_IP` accepts one literal IPv4/IPv6 host address and rejects hostnames, lists, CIDRs and unspecified addresses. `TRUST_PROXY=loopback` optionally adds local loopback proxies; it does not trust Docker bridge peers by itself. Leave both unset for direct access without a proxy. Only the trusted immediate peer's forwarded chain can identify clients; an untrusted peer's forwarding headers are ignored. The public port remains bound to 127.0.0.1 and the DB remains unpublished. Multiple replicas need a shared limiter. Cookies are HttpOnly/SameSiteStrict and Secure in production mode.

## Online payment deployment gate

Migration `012_gateway_payments.sql` adds the restricted gateway token/intent/event/confirmation/receipt/reconciliation tables. Apply migrations using the separate administrator role after backup/readback preparation, then deploy the compatible runtime. Preserve existing assessment snapshots, SaaS balances, certificates and stored PDF bytes. A source migration file is not evidence it ran on the hosted database.

The current Render instance applied 012 with all 66 recorded domain fingerprints unchanged and a successful idempotent replay. External database access was verified closed before deploying `b86908b9a4654cc31cd1b517fc5e8ad3ae086878` as `dep-dbaob6s9v7es739a8j30`. Hosted API checks and entry-asset hashes passed; see the [deployment record](HOSTED_DEPLOYMENT.md) for exact evidence. Future deployments require their own migration and verification results.

Keep `BKASH_ENVIRONMENT=disabled` while the approved merchant account and provider credentials are absent. The deployed UI must show **bKash setup required**, and checkout must refuse before saving a new intent. **Nagad is not integrated.** There is no manual cash substitute or mark-paid control. The local provider test adapter is available only in the test environment and is not a public route.

Activation requires the server-only configuration documented in [GATEWAY_PAYMENTS.md](GATEWAY_PAYMENTS.md): explicit tenant binding, provider-issued credentials, expected receiving merchant, independent token-encryption key and exact HTTPS origin. Live mode additionally requires `BKASH_LIVE_ENABLED=true`. This initial configuration supports one merchant-bound office per deployment; it does not silently share a merchant across unions. Do not place secrets in source, frontend bundles, chat or screenshot evidence.

Verify the registered bKash v2 callback, sandbox environment, receiving merchant and actual provider transaction before live activation. The public callback's token and signature are credentials; keep URI/query parameters out of operational logs. Authenticated read/status routes and receipt downloads still require the user session. A redirect alone never establishes payment. Unknown creation/execution outcomes must recover against the original intent; do not delete/reset the row or issue a replacement payment to bypass uncertainty.

Preserve original merchant configuration and encryption-key custody while attempts remain unresolved. Later gateway mismatch can hold new certificate issuance without modifying the historical receipt. Query/search reconciliation is distinct from bank payout settlement, which remains `NOT_CONNECTED`. Refunds, disputes, recovery resets and automatic replacement checkout are not implemented. Local mock-provider tests and a disabled hosted deployment cannot substitute for genuine provider acceptance.

## Updates and recovery

- Back up and verify restore before migrations. Migrations are forward-only; rollback needs a database-compatible prior app release. Never rewrite issued PDFs/published schemas.
- Preserve volume `astra_database`; destructive `docker compose down -v` is not part of deployment.
- Local AES-256-GCM recovery uses consistent pg_dump and verifies table hashes, balances, PDFs, RLS, triggers and grants in a new DB. It is deliberately restricted to the known local database. See OPERATIONS.md for development-only key custody.
- Hosted backup retention, offsite storage, separate keys, monitoring, incident procedures and restore objectives need operational configuration/acceptance.
- Monitor HTTPS `/api/v1/health` and a synthetic authorized journey without logging tokens/PII. Local tests do not establish an uptime SLA.

## CI

`.github/workflows/qa.yml` provisions PostgreSQL 17, creates the restricted role, migrates/seeds, installs Chromium/fonts, builds, runs tests and audits dependencies. CI passwords are disposable isolated fixtures. Final 0.5 candidate `b86908b9a4654cc31cd1b517fc5e8ad3ae086878` passed [run 39125266096](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39125266096): all 192 tests (72 forms, 89 API, 31 web), production build, separate Docker build and zero reported dependency vulnerabilities. See [metadata](../execution/payments-ci-qa.json) and [summary](../execution/payments-ci-summary.log). The historical 0.4 run remains separately recorded in [RELEASE_0_4.md](RELEASE_0_4.md). Gateway mock tests verify application behavior, not merchant/provider acceptance or a hosted deployment.

The log-filter example follows [Caddy's field-filter documentation](https://caddyserver.com/docs/caddyfile/directives/log#filter), which supports deleting nested request fields. Runtime validation of the supplied Caddy configuration remains part of staging acceptance.
