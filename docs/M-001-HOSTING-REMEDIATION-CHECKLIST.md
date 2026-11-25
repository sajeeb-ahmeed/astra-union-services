# M-001 — Hosting anti-bot challenge: operator remediation checklist

> **Status: BLOCKED — external dependency (hosting operator / Hostever).** Nothing in this
> document changes the live host, disables any protection, or bypasses the challenge. It is
> the operator-side checklist the hosting owner (or Hostever support) must work through;
> this repo cannot verify any of it. Live parity is unverified — the finding itself blocks
> live probing from non-browser clients (see P-004, merged into M-001).

## 1. What is wrong (recorded evidence, 2026-11-25)

- Live: https://digitalunion.com.bd/ (edge: `Server: openresty/1.31.1.1`, cf-edge-cache).
- The edge bot-challenge replaces **pages AND static assets** with an HTTP **200**
  `text/html` challenge body ("One moment, please..."). Browsers with strict MIME checking
  (`X-Content-Type-Options: nosniff`) block the JS/CSS loads, lazy chunks fail, and the app's
  `AsyncPanel` error boundary shows "এই অংশটি লোড করা যায়নি" with no services.
- Escalation observed in one audit run: 0/11 challenged at 390 px → 1/11 at 768 px →
  11/11 at 1440 px, then IP-wide. 45 console errors (24 MIME-blocked JS/CSS, 15 font
  failures, 6 bare bundle errors); 12 challenge-title loads.
- `curl` proof: `index-DNIMuNwM.js` and `favicon-32.png` return 200 `text/html` challenge
  body. The same requests also block `/`, `/robots.txt`, `/sitemap.xml`, `/api/v1/health`
  from non-browser clients (P-004) — so no curl/API monitoring, no health checks, no
  crawler fetch, and SEO/uptime monitoring is blind.
- Related findings: M-002 (P2, Noto Sans Bengali `.woff2` returns HTTP 415 / download
  failed, 15×), M-003 (P2 suspected, bare bundle errors), M-004 (P3, challenge verification
  beacon `/z0f76a1d14fd21a8fb5fd0d03e0fdc3d3cedae52f?id=...` returns **404**;
  `favicon-32.png` returns 415 in Firefox / challenge HTML with 200 via curl).
- Full evidence: `qa-audit/working/07-mobile-console.md` §2–§4, §10 (rerun blocked by the
  same challenge); `qa-audit/evidence/logs/mobile-public-audit-results.json`;
  screenshots `services-390.png`, `home-1440.png`.

## 2. Required configuration (operator / Hostever)

Work through in order. Do not disable the challenge or the host's security layer — the fix
is scoping it correctly, not removing it.

### 2.1 Challenge for navigation/HTML only

- The challenge must trigger only for navigation requests (HTML documents, `Accept:
  text/html` / top-level navigations). It must **never** be served for a versioned static
  asset URL.
- Pass through (no challenge) or, if the asset genuinely cannot be served, fail with a
  **real error status** (404/403/5xx — never 200 `text/html`):
  - `/assets/*` (all versioned JS/CSS chunks, e.g. `index-DNIMuNwM.js`)
  - font files (`*.woff2`, incl. `noto-sans-bengali-*.woff2`)
  - `/favicon-32.png` and any other favicon/icon
  - `/robots.txt`, `/sitemap.xml`
- Rationale: a 200 `text/html` response for a `.js`/`.css`/font URL is a MIME mismatch the
  browser must reject; the app cannot render at all. A real error status at least lets the
  browser show the correct failure and lets monitoring distinguish "asset missing" from
  "challenge active".

### 2.2 Fix the challenge beacon (M-004)

- The verification beacon path
  `/z0f76a1d14fd21a8fb5fd0d03e0fdc3d3cedae52f?id=...` currently returns **404**. A 404
  beacon means the verification round-trip cannot complete reliably — the visitor may be
  challenged repeatedly or stuck on the interstitial.
- Confirm the beacon endpoint is reachable and returns 200 (or the status the challenge
  provider specifies) from a normal browser session, and that completing the challenge
  once lets the same session load subsequent pages without re-challenging.

### 2.3 Correct content types for JS/CSS/fonts

- `.js` → `text/javascript` (or `application/javascript`), `.css` → `text/css`,
  `.woff2` → `font/woff2`, `.png` favicon → `image/png`.
- Confirm these are served correctly **under all states** — including while a challenge is
  active for the same IP and for font `Accept` headers (M-002 fired on pages that otherwise
  rendered, so the font failure may not be challenge-only).
- Confirm `X-Content-Type-Options: nosniff` stays on (the app relies on it); the fix is
  the correct MIME type, not dropping the header.

### 2.4 Allowlist monitoring + crawlers

- Allowlist the operator's monitoring/health-check sources (uptime monitor, deploy
  verification, `GET /api/v1/health` polling) so they are never challenged; otherwise the
  readiness checks in `scripts/verify-deployment-readiness.ts --live` cannot run against
  production at all.
- Allowlist search-engine crawlers (Googlebot, Bingbot) for `/`, `/robots.txt`,
  `/sitemap.xml` and the public pages; a challenged crawler means the site is effectively
  invisible to search.
- Record the allowlist (what was added, by whom, on what date) in
  `docs/HOSTED_DEPLOYMENT.md` — the allowlist itself is operational detail and must not
  contain secrets.

### 2.5 Rate / sensitivity tuning

- The challenge escalated with request rate inside a single audit run (0/11 → 11/11).
  Ask the provider to confirm the sensitivity/threshold for this domain and whether
  shared/CGNAT/VPN egress IPs are being scored as a group — any visitor behind a shared IP
  or navigating fast currently gets error screens instead of the app.
- Do not "fix" this by exempting all traffic; the goal is that a legitimate visitor on a
  shared IP can still load the app, and a challenged visitor sees a clean "verifying"
  state, not error screens.

## 3. Validation steps (run after the configuration changes)

Run from a **clean IP** (an egress IP that has not been challenged) and slowly
(≥30 s between loads — the audit script `qa-audit/automated-tests/mobile-public-audit.mjs`
documents this pace; rapid loading re-triggers the challenge and invalidates the test).

1. **Clean-IP load test** — from a clean IP, in a clean browser profile, load the homepage
   and the Services page at 390 px, 768 px and 1440 px. Record: challenge shown? (expected:
   none for ordinary navigation), app shell rendered?, services listed?
2. **Asset content-type checks** — `curl -I` (from an unchallenged IP) for one versioned
   `.js`, one `.css`, one `.woff2`, `/favicon-32.png`: record status + `Content-Type` for
   each (expected: 200 with the correct MIME type from §2.3, never `text/html` for an asset).
3. **Forced-challenge pass** — trigger the challenge deliberately (the provider's test
   method, or a flagged IP/VPN), then confirm: the challenge page is shown for the HTML
   navigation, **and** the versioned `/assets/*`, fonts and favicon still load (or fail with
   a real error status), so the app can render once verification completes.
4. **Beacon check** — while challenged, confirm the verification beacon returns its expected
   status (not 404) and that completing it lets the session continue without re-challenging.
5. **Monitoring + crawler check** — `curl` `/`, `/robots.txt`, `/sitemap.xml`,
   `/api/v1/health` from the allowlisted monitoring source (expected: real responses, no
   challenge body); confirm a search-engine crawler fetch (Search Console / Bing
   Webmaster Tools URL inspection) returns the real page.
6. **Zero challenge-related MIME errors** — repeat the mobile audit
   (`qa-audit/automated-tests/mobile-public-audit.mjs`, slowly, from a clean IP) and confirm
   the console-error count attributable to the challenge is **0** (no MIME-blocked JS/CSS,
   no font download failures, no error-boundary renders).

## 4. Exact evidence that closes the finding

M-001 closes only when **all** of the following are recorded (attach to the fragment /
bug-register entry, do not claim closure on any subset):

- [ ] Clean-IP load test (3 widths): no challenge for ordinary navigation; app shell and
      services render at every width.
- [ ] Asset content-type table: `.js` / `.css` / `.woff2` / favicon each return 200 with
      the correct `Content-Type` (from an unchallenged IP); none returns `text/html`.
- [ ] Forced-challenge pass: challenge shown for HTML only; assets still load (or fail
      with a real error status); verification completes and the session continues.
- [ ] Beacon check: verification beacon no longer 404s; favicon serves normally (M-004
      closed with it).
- [ ] Monitoring/crawler check: `curl` of `/`, `/robots.txt`, `/sitemap.xml`,
      `/api/v1/health` from the allowlisted source returns real responses; a crawler fetch
      returns the real page.
- [ ] Repeat mobile audit from a clean IP, slowly: **0 challenge-related console errors**
      (no MIME-blocked JS/CSS, no font failures, no "এই অংশটি লোড করা যায়নি" renders).
- [ ] The allowlist and the configuration change (what was changed, by whom, date) are
      recorded in `docs/HOSTED_DEPLOYMENT.md`.

## 5. What this repo cannot do (why it stays BLOCKED)

- No hosting access exists for this agent or for the repo: no cPanel, Hostever, or edge
  (Cloudflare/openresty) admin access, and no credentials.
- No bypass of the challenge was attempted and none is authorised; no hosting security
  setting was changed; no live probe was run beyond what the Phase 3 audit already
  recorded (a rerun attempt on 2026-11-25 was itself blocked by the challenge — see
  `qa-audit/working/07-mobile-console.md` §10).
- The finding stays **BLOCKED** until the operator completes §2 and the evidence in §4 is
  recorded. A-002's readiness script (`scripts/verify-deployment-readiness.ts --live`)
  will keep failing against the live origin while the challenge blocks non-browser clients
  — that failure is itself the signal that M-001 is still open.
