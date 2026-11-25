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

Restart the application in **Setup Node.js App**, then check:

- [ ] `https://your-domain/api/v1/health` returns
      `{"status":"ok","database":"PostgreSQL","mode":"DEMO_ONLY", ...}`
      with `features` all `true` (mode flips to `OFFICIAL` only when the
      owner later sets `ISSUANCE_MODE=official`).
- [ ] The public homepage loads at `https://your-domain/`.
- [ ] Plain HTTP redirects to HTTPS:
      `curl -sI http://your-domain/login` must answer `301` with
      `Location: https://your-domain/login`. The app redirects when the
      proxy sends `X-Forwarded-Proto: http`. If the answer is still `200`,
      this LiteSpeed setup does not send that header: turn on
      cPanel → **Domains** → **Force HTTPS Redirect** for the domain and
      check again.
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

- **Update:** rebuild the bundle (`node scripts/package-cpanel.mjs`),
  upload over the app directory, run `npm run db:migrate-cpanel` from a
  terminal (it applies only migrations that are not yet recorded), then
  restart the app and re-check step 6.
- **Rollback:** the previous bundle is the rollback unit — keep the last
  known-good upload (e.g. `astra-app-prev/`) and point the Node.js app's
  root back to it, then restart. Database changes from migrations are
  additive; if a rollback must also undo data, restore the latest nightly
  `pg_dump` into a fresh database and repoint the two `DATABASE_*_URL`
  variables. Never edit files inside `db/migrations/` — merged migrations
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
