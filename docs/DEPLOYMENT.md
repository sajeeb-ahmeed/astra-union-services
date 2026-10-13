# Deployment and reproducibility

Release 0.2 · 13 October 2026. Windows/Node 24/PostgreSQL 17.11 is the executed development path. Docker and a deployment destination are unavailable here, so container/hosted execution is unverified. All environments retain DEMO/synthetic semantics.

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
4. Sign in as the unique owner and create an office/administrator. New offices have zero credits and an expired subscription. Administrators may settle a **local sandbox** subscription, provision staff and record explicit demo service grants. No money is collected and no legal appointment is inferred.
5. Verify the full tenant-isolated journey in staging before additional users.

Setup receives administrator credentials for role creation/migrations/initialization; the running app receives restricted `astra_app` credentials only. The database port is not published. Bootstrap refuses a privileged application role. `initialize.ts` creates the 47-service catalog/demo plan/one owner without sample citizens or offices; repeated initialization preserves passwords and rejects changes under immutable schema versions. This was executed twice against an empty local DB.

The container installs the locked Playwright package's matching Chromium plus Noto fonts, runs as `node`, uses an init process and 256 MiB shared memory. Renderer HTML is application-owned/escaped; remote resources are blocked and concurrent jobs bounded. Container sandbox policies require staging validation. [Official Playwright Docker guidance](https://playwright.dev/docs/docker) explains version matching and runtime requirements.

Compose fails for missing required variables. See [Docker interpolation documentation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/). `.env` is ignored by Git/package/Docker context; it is not a managed secret store. Protect it and plan rotation. Changing `.env` does not change an existing PostgreSQL role password.

## Native Linux

Install Node 24, PostgreSQL 17, Chromium dependencies and a licensed Bangla font. Create `astra`; supply `DATABASE_ADMIN_URL`, `ASTRA_APP_PASSWORD`, `OWNER_EMAIL`, `OWNER_PASSWORD` to `npm run db:initialize`. Supply restricted `DATABASE_URL`, HTTPS `PUBLIC_ORIGIN`, unique 32+ character `DEMO_WEBHOOK_SECRET`, `NODE_ENV=production`, and appropriate `HOST` to the app service. Run `npm ci`, `npx playwright install --with-deps chromium`, `npm run build`, `npm start`. Separate service/migration credential scopes. This path has not been executed here.

Production-mode startup rejects missing secrets, insecure/malformed origins and broad proxy trust. `TRUST_PROXY_IP` accepts one literal IPv4/IPv6 host address and rejects hostnames, lists, CIDRs and unspecified addresses. `TRUST_PROXY=loopback` optionally adds local loopback proxies; it does not trust Docker bridge peers by itself. Leave both unset for direct access without a proxy. Only the trusted immediate peer's forwarded chain can identify clients; an untrusted peer's forwarding headers are ignored. The public port remains bound to 127.0.0.1 and the DB remains unpublished. Multiple replicas need a shared limiter. Cookies are HttpOnly/SameSiteStrict and Secure in production mode.

## Updates and recovery

- Back up and verify restore before migrations. Migrations are forward-only; rollback needs a database-compatible prior app release. Never rewrite issued PDFs/published schemas.
- Preserve volume `astra_database`; destructive `docker compose down -v` is not part of deployment.
- Local AES-256-GCM recovery uses consistent pg_dump and verifies table hashes, balances, PDFs, RLS, triggers and grants in a new DB. It is deliberately restricted to the known local database. See OPERATIONS.md for development-only key custody.
- Hosted backup retention, offsite storage, separate keys, monitoring, incident procedures and restore objectives need operational configuration/acceptance.
- Monitor HTTPS `/api/v1/health` and a synthetic authorized journey without logging tokens/PII. Local tests do not establish an uptime SLA.

## CI

`.github/workflows/qa.yml` provisions PostgreSQL 17, creates restricted role, migrates/seeds, installs Chromium/fonts, builds, runs tests and audits dependencies. CI passwords are disposable isolated fixtures. The workflow was not pushed or executed on GitHub; executed local evidence is under `execution/`.

The log-filter example follows [Caddy's field-filter documentation](https://caddyserver.com/docs/caddyfile/directives/log#filter), which supports deleting nested request fields. Runtime validation of the supplied Caddy configuration remains part of staging acceptance.
