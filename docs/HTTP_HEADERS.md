# HTTP Headers — what the app sets, what it cannot (S-013)

- **Date:** 2026-11-26 (Phase 4 Stage 5 Batch B)
- **Source of truth in code:** `httpHardening` in
  `apps/api/src/http-hardening.ts` (plus `createHttpsRedirect` in the same
  file for the HTTPS redirect / HSTS).

## Headers the app sets (every response)

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Cache-Control` | `no-store` |
| `Content-Security-Policy` | see below |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (production only) |

## Content-Security-Policy

```
default-src 'self'; base-uri 'self'; frame-ancestors 'none';
object-src 'none'; script-src 'self';
style-src-elem 'self' 'sha256-IAdwN3biDCQ3brrgp1m8kBEsPQYyqfREKOEfeoREopc=';
style-src-attr 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'
```

- `style-src` was split in Stage 5 Batch B. The old value
  (`style-src 'self' 'unsafe-inline'`) allowed any injected `<style>`
  element. The new value allows `<style>` elements only from `'self'`
  or matching the hash — and the **only** inline `<style>` block in the
  served app is the F-015 first-paint guard in `apps/web/index.html`
  (`<style>body{margin:0}</style>`), whose SHA-256 hash is the one above.
  **If that block ever changes, recompute the hash** (`printf
  'body{margin:0}' | openssl dgst -sha256 -binary | base64`) and update
  `http-hardening.ts` and its test, or the rule silently un-styles first
  paint (the bundled CSS also sets `body{margin:0}`, so the failure is
  cosmetic-only, a first-paint shift).
- `style-src-attr 'unsafe-inline'` is a **documented residual**, not an
  oversight. React inline styles (`style={{...}}`) are style attributes,
  and CSP hashes/nonces cannot cover attributes — only `unsafe-hashes`
  with a hash per attribute value could, which is infeasible for a React
  app (5 `style=` uses today, but any component may add one). Removing
  it would break rendering. The split still removes the `<style>`-element
  injection surface, which is the part an attacker can exploit without
  touching the component tree.
- `script-src 'self'`: no inline `<script>` exists anywhere in the app,
  so no `unsafe-inline` is needed or allowed for scripts.

## HSTS

- `max-age=31536000; includeSubDomains`, production only (browsers ignore
  HSTS over plain HTTP, and the redirect in `createHttpsRedirect` refuses
  to serve the app over unverified transport instead — see S-008).
- `includeSubDomains` was already present (Stage 1, S-008) and is covered
  by a test in `apps/api/test/http-hardening.test.ts`.
- **Preload: OWNER DECISION REQUIRED, not enabled.** Preload commits the
  apex domain *and every subdomain* to HTTPS-only in browsers, with no
  quick undo (removal takes months to propagate). It must only be enabled
  after confirming every subdomain serves HTTPS. That confirmation needs
  hosting access and has not been done; do not enable preload blindly.

## The edge-layer divergence (live P-003 fold)

The headers above are what the **app** sets. Live browsers do not
receive them: a `curl -sI` pass on 2026-11-25 showed the live site
serving `X-Frame-Options: SAMEORIGIN` (code: `DENY`),
`Referrer-Policy: strict-origin-when-cross-origin` (code: `no-referrer`),
a nonce-only CSP, no HSTS, and no `Permissions-Policy` /
`Cross-Origin-Resource-Policy`. The live header policy is owned by an
undocumented edge layer (LiteSpeed / hosting), not by this code.

Consequences:

- Fixing headers in `http-hardening.ts` hardens the app when it serves
  responses itself (local `SERVE_WEB`, any future direct-Node deploy),
  but **does not change what live browsers receive today**.
- Aligning the live headers means changing the edge configuration
  (hosting panel / server config), which needs hosting access this batch
  does not have. That work belongs with the hosting remediation (M-001):
  decide which layer owns headers, configure it once, and verify in a
  real browser — do not maintain two divergent policies and assume the
  app's is the live one.
- Live verification of any header change requires a clean-profile browser
  check from an unchallenged IP (the edge bot-challenge, M-001, replaces
  responses for non-browser clients).
