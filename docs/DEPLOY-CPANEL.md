# Deploying DigitalUnion on cPanel (single-role track)

This runbook deploys DigitalUnion to shared cPanel hosting (the owner's Hostever
panel) using the **single-role** database track. It assumes the bundle was
assembled with `node scripts/package-cpanel.mjs` (output: `dist-cpanel/`).

## How this track differs from the standard deployment

Standard deployments use two PostgreSQL roles: a migration owner and the
restricted runtime role `astra_app`. cPanel's PostgreSQL tooling creates
exactly **one** user per database and cannot create roles, so this track
runs everything as that one user:

- `ASTRA_DB_SINGLE_ROLE=1` is set, and both `DATABASE_URL` and
  `DATABASE_ADMIN_URL` name the same cPanel database user.
- Database setup uses `db:bootstrap-cpanel` + `db:migrate-cpanel` +
  `db:initialize-cpanel` instead of the canonical scripts. The canonical
  migrations in `db/migrations/` are **never edited**; the cPanel runner
  transforms them in memory (role-name substitution, neutralising the
  two-role separation guards and the runtime-role REVOKEs). The transform
  is documented at the top of `scripts/migrate-cpanel.ts`.
- **What is kept:** row-level security stays enabled and FORCED, with the
  same tenant-isolation policies; immutable-record triggers and
  SECURITY DEFINER functions are unchanged.
- **What is traded away** (owner-approved): the privilege separation
  between migration owner and runtime role. The application user owns the
  tables, so database-level least-privilege against the app itself is not
  enforceable in this mode. Protect the database accordingly: never expose
  the PostgreSQL port publicly, and keep the environment values secret.

## 1. Prerequisites

- A cPanel account with **Setup Node.js App** and **PostgreSQL Databases**
  (both present on the owner's Hostever panel).
- Node.js 22 or 24 selected in the panel (the codebase runs on Node 24;
  22 is the minimum sensible choice).
- **Chromium for certificate PDFs** — settled by the owner's capability
  probe of the panel:
  - If the probe found a system Chromium/Chrome binary, set
    `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its path in the app environment.
  - Otherwise install Playwright's Chromium into the application
    directory after upload (step 5) and leave the variable unset.
  - Without any Chromium the site works, but certificate issuance fails
    with a 500 when the PDF is generated. `PDF_MAX_CONCURRENCY=1` is
    already set in the env template — keep it on shared hosting.

## 2. Create the database and its one user

1. cPanel → **PostgreSQL Databases** → create a database (e.g.
   `user_astra`).
2. Create a user with a strong password and add it to the database with
   **ALL PRIVILEGES**. This single user is all this track needs — do not
   look for a way to create a second role; cPanel cannot.
3. Build the connection string (URL-encode the password if it contains
   characters such as `@ : / #`):
   `postgres://USER:PASSWORD@127.0.0.1:5432/DATABASE`

## 2b. Entry points — which `app.js` is which (A-019)

The repository has two `app.js` files and neither is a stray stub:

- **Repo-root `app.js`** is the live cPanel / LiteSpeed (lsnode) entry
  point. lsnode loads it with `require()` from CommonJS, which rejects
  modules whose graph contains top-level await, so it registers `tsx`
  and loads the server through a plain dynamic `import()` of
  `./apps/api/src/server.ts` — the real server entry point. Do not delete
  it: the Node app's startup file is `app.js` (§4).
- **`dist-cpanel/app.js`** is the packaged variant produced by
  `node scripts/package-cpanel.mjs`: it loads the pre-compiled server
  (`./apps/api/dist/server.js`, no tsx registration).
- **`dist-cpanel/`** (tracked, ~176 files) is the assembled release
  bundle, regenerated per release by `package-cpanel.mjs` (P-005). It is
  kept in the branch deliberately as the deployable artifact — do not
  treat it as build output to delete, and do not hand-edit it; regenerate
  it instead. A stale bundle is a release-process failure, not a reason to
  remove the directory.

## 3. Upload the bundle

1. On your own machine, from the repository root:
   `node scripts/package-cpanel.mjs`
2. Upload the **contents** of `dist-cpanel/` to the application directory
   on the server (e.g. `~/astra-app/`) via File Manager or FTP. The
   directory must contain `app.js`, `package.json`, `node_modules/`,
   `apps/`, `db/`, `data/`, `scripts/` at its top level.
3. Keep the uploaded directory **outside the public web root**
   (`public_html`) if the panel allows it; the Node app serves everything
   itself.

## 4. Create the Node.js application

cPanel → **Setup Node.js App** → Create Application:

- Node.js version: 24 (or the newest available ≥ 22)
- Application mode: Production
- Application root: the directory from step 3 (e.g. `astra-app`)
- Application URL: your domain or subdomain
- Startup file: `app.js`

Then open the application's **Environment variables** editor and add every
variable from `.env.cpanel.example`, generating fresh secrets as the
template instructs. The critical ones:

- `ASTRA_DB_SINGLE_ROLE=1`
- `DATABASE_URL` and `DATABASE_ADMIN_URL` — identical, from step 2
- `NODE_ENV=production`, `PUBLIC_ORIGIN=https://your-domain` (exact
  origin, no trailing slash — browser sign-in fails with 403 otherwise)
- `TRUST_PROXY=loopback` — LiteSpeed reaches the app over loopback; without
  it Express cannot see the original scheme/client address, and the HTTPS
  redirect in step 6 cannot fire (SEC-HTTPS)
- `PDF_MAX_CONCURRENCY=1`
- `IDENTIFIER_SECRET`, `CITIZEN_DATA_KEY`, `MERCHANT_SECRET_KEY` — the
  last two **exactly 64 hex characters**; the server treats unset/invalid
  keys as "feature not enabled" (503), so double-check them here.
- `OTP_PROVIDER` — **leave this unset in production** (Security Audit 01,
  F1). An unset `OTP_PROVIDER` disables mobile OTP entirely: the OTP
  endpoints answer `503 OTP_UNAVAILABLE` and citizens cannot verify a mobile
  number at sign-up. Never set `OTP_PROVIDER=log` here: `log` is a
  local-development provider that delivers no SMS to any handset. Set a real
  provider value when a real SMS provider is integrated. The server prints a
  boot warning while any log provider is active in production.
- `EMAIL_PROVIDER=smtp` — set this with the `SMTP_*` values for real
  delivery through the owner's mail account. In production an unset
  `EMAIL_PROVIDER` disables email entirely: registration completes without a
  verification message and no issuance/rejection email is sent
  (`/api/v1/auth/email/status` reports `available:false`; health reports
  `emailDelivery:false`). Never set `EMAIL_PROVIDER=log` in production
  (Audit 01, F1): the log provider delivers nothing.

## 5. Initialise the database (after EVERY deploy, not just once)

> **MUST — never skip.** Every bundle deploy ends with this step, even
> when the bundle contains no new migration. Schema versions live in the
> `service_versions` DB table and reach it ONLY through this publish
> step. Skipping it after the r9 deploy (24 Nov 2026) broke live
> applications with 422 `SCHEMA_UNAVAILABLE` ("Operational schema
> version is unavailable") until it was run.

Open cPanel **Terminal** (or SSH), go to the application directory, put
the same variables into the shell (a `.env` file in the app directory,
`chmod 600`, loaded with `set -a; . ./.env; set +a` works), then:

```sh
npm run db:initialize-cpanel
```

Expected output ends with the single-role migration totals and
"Published catalog and standard plan initialized". This creates the service
catalog (47 services) and the platform owner account from `OWNER_EMAIL` /
`OWNER_PASSWORD`, and publishes every schema version the bundle's code
defines.

If `initialize` throws `Service N version V is immutable; publish a new
schema version`, do NOT edit `initialize.ts` and do NOT re-run it hoping
it passes. Generate a reconcile publish migration from the DEPLOYED
bundle's code (pattern: migrations 054 and 057 — update differing known
`(service_no, version)` rows to canonical, insert missing rows, raise
only on unknown keys or newer-than-canonical versions), drop the file
into `db/migrations/`, run `db:migrate-cpanel`, then re-run
`db:initialize-cpanel`. Verify the initialize output before calling the
deploy done.

Do **not** run `npm run db:seed` in production: it loads synthetic demo
tenants, and it expects a bypass-RLS admin connection that single-role
mode deliberately does not have.

If no system Chromium exists (step 1), install the bundled one now:

```sh
npx playwright install chromium
```

(≈150 MB in `~/.cache/ms-playwright`; if the home directory is not
writable/persistent on your plan, set `PLAYWRIGHT_BROWSERS_PATH` to a
folder inside the application directory before running it.)

## 6. Start and verify

Restart the application in **Setup Node.js App**, then run the post-deployment
gate — a deployment is **not signed off** until it passes. The gate runs the
database checks and then the live checks in one command, reading the expected
commit/package from the bundle's own `release.json` so nothing is hand-copied
(P-012, Phase 4 Stage 3). It catches incomplete deployments, in particular
the `SCHEMA_UNAVAILABLE` recurrence: after the r9 deploy (24 Nov 2026) live
applications failed with 422 `SCHEMA_UNAVAILABLE` because step 5
(`db:initialize-cpanel`) had been skipped, so the service versions the
bundle's code defines were never published. The checks verify applied
migrations and published service versions directly.

On the server (in the application directory, with the app environment loaded):

```sh
npm run verify:gate -- --live https://your-domain
```

Expected: `P-012 gate: PASS — database and live readiness both passed.`
The database half reports `Deployment readiness PASS: 5/5 checks passed`
(every migration file applied; every canonical schema version published with
matching hashes; 47 services; an owner account exists; tenant isolation —
RLS + FORCE RLS on the tenant tables with scope-gated policies). The live half reports
`Deployment readiness PASS: 8/8 checks passed` — health reports the deployed
commit/package and the latest migration, the homepage returns the real app
shell, the services list has 47 entries, service 1's schema resolves (a 422
here is the `SCHEMA_UNAVAILABLE` recurrence: run `db:initialize-cpanel` on
the server and re-check), and plain HTTP does not serve the app (see below).

If a half fails, fix it and re-run the whole gate — do not sign off on a
partial pass. If `migrations-applied` fails, run `npm run db:migrate-cpanel`
and re-check. If `service-versions-published` fails, run
`npm run db:initialize-cpanel` and re-check (see the reconcile note in step 5
if initialize itself throws).

The two halves can also be run individually for diagnosis (same script the
gate calls; `--expect-commit` / `--expect-package` come from the bundle's
`release.json`):

```sh
node --import tsx scripts/verify-deployment-readiness.ts --db
node --import tsx scripts/verify-deployment-readiness.ts --live https://your-domain \
  --expect-commit <full commit sha from release.json> \
  --expect-package <packageId from release.json>
```

Before packaging a release, run the performance smoke locally
(`npm run verify:performance`) — it boots the built frontend + API on
loopback, checks both desktop and mobile viewports for overflow/page
errors, and measures the public directory at concurrency 10. It is a
pre-packaging check, not part of the post-deploy gate: it needs a local
database and the build's `apps/web/dist/asset-sizes.json` (the committed
`execution/asset-sizes.json` is the stable reference), which do not travel
in the bundle.

Then check:

- [ ] `https://your-domain/api/v1/health` returns
      `{"status":"ok","database":"PostgreSQL","mode":"DEMO_ONLY", ...}`
      with `features` all `true` (mode flips to `OFFICIAL` only when the
      owner later sets `ISSUANCE_MODE=official`) and a `release` object whose
      `commit` and `packageId` match the bundle just uploaded (`release.json`
      at the bundle root) and whose `migrationVersion` is the latest file in
      `db/migrations/`.
- [ ] **HTTPS is forced (SEC-HTTPS).** From any terminal, run:
      `curl -sI http://digitalunion.com.bd/` — it MUST answer
      `HTTP/1.1 301 Moved Permanently` with
      `Location: https://digitalunion.com.bd/`. A `200 OK` here means
      plain HTTP still serves the site: first confirm the deployed bundle
      contains the `enforceHttps` redirect (the app log shows no error and
      `TRUST_PROXY=loopback` is set in the app environment — step 4), then
      fall back to the LiteSpeed layer: paste
      `deployment/htaccess-https-redirect.txt` at the very top of
      `public_html/.htaccess`, above cPanel's Node.js proxy rules, and
      re-run the curl check. Do not onboard real users while `http://`
      still returns 200. Also confirm `curl -sI https://digitalunion.com.bd/`
      returns 200 and carries `Strict-Transport-Security: max-age=31536000`.
- [ ] The public homepage loads at `https://your-domain/`.
- [ ] Strict HTTPS mode (S-008) is OFF by default because LiteSpeed may omit
      `X-Forwarded-Proto`. Set `HTTPS_STRICT=true` only after confirming every
      proxied request carries the header; with it on, a request without the
      header gets `421 HTTPS_REQUIRED` instead of being served.
- [ ] Sign in with the owner account created in step 5.
- [ ] Open the services list — it shows the 47-service catalog.
- [ ] Issue one test certificate for a test citizen and download the PDF.
      A 500 here almost always means Chromium is missing (step 1/5) —
      check the application log.
- [ ] Restart the app once more and confirm it comes back cleanly.

## 7. Nightly backup (cron)

cPanel → **Cron Jobs** → add a nightly job (adjust paths and the
connection string; keep the file private):

```sh
pg_dump "postgres://USER:PASSWORD@127.0.0.1:5432/DATABASE" | gzip > ~/backups/astra-$(date +\%F).sql.gz
```

Keep at least 14 nights locally and copy backups off the server
regularly — an offsite copy is the owner's responsibility; a backup that
only exists on the same server is not a backup. The repository also ships
a managed backup tool (`node scripts/backup/backup.mjs backup`, driven by
`DATABASE_ADMIN_URL`) if you prefer its layout.

## 8. Updating and rollback

- **Update:** rebuild the bundle (`node scripts/package-cpanel.mjs` — it writes
  a fresh `release.json` with the new package id, commit, build time and asset
  manifest), upload over the app directory, run `npm run db:migrate-cpanel`
  from a terminal (it applies only migrations that are not yet recorded), then
  run `npm run db:initialize-cpanel` (step 5 — never skip, even with no new
  migration), restart the app, run the step-6 gate
  (`npm run verify:gate -- --live https://your-domain`), and record the new
  bundle→commit mapping in the
  [hosted deployment record](HOSTED_DEPLOYMENT.md) before calling the deploy done.
- **Rollback:** the previous bundle is the rollback unit — keep the last
  known-good upload (e.g. `astra-app-prev/`, **including its `release.json`**,
  so health keeps reporting the rolled-back release truthfully) and point the
  Node.js app's root back to it, then restart. Before rolling back, take a
  fresh `pg_dump` (step 7) so the pre-rollback state is recoverable.
  Database changes from migrations are additive and are **not** undone by a
  bundle rollback: if a rollback must also undo data, restore the latest
  nightly `pg_dump` into a fresh database and repoint the two `DATABASE_*_URL`
  variables — never hand-edit the live database to "unapply" a migration.
  After a rollback, run the step-6 gate again
  (`npm run verify:gate -- --live https://your-domain`) with the previous
  bundle's expectations (the gate reads them from that bundle's `release.json`)
  and record the rollback in the hosted deployment
  record. Never edit files inside `db/migrations/` — merged migrations
  are immutable; fixes ship as new migrations.

## 9. Going official

Owner decision (23 Nov 2026, PORTAL-E): production is official, and
`.env.cpanel.example` now sets `ISSUANCE_MODE=official`. Two steps make a
running server official:

1. Set `ISSUANCE_MODE=official` in the app environment, then restart.
   New certificates get plain 16-digit numbers (no `DEMO-` prefix) and the
   emblem artwork; health reports `OFFICIAL`. Certificate PDFs carry no demo
   wording in either mode (since 17 Nov 2026).
2. Mark each office that is really live as non-demo. Public verification
   reads the office's flag (`tenants.demo`, migration 041); while it is
   `true`, that office's certificates verify as a demo certificate. There is
   no owner screen for it — after a backup, run per office:
   `UPDATE tenants SET demo = false WHERE slug = '<office-slug>';`

Certificates already issued are never rewritten: their stored PDFs and
numbers stay as they are, so a `DEMO-` number keeps verifying as demo.
