# PDF Rendering — Chromium sandbox & throughput (P-013)

- **Date:** 2026-11-26 (Phase 4 Stage 5 Batch B)
- **Code:** `apps/api/src/pdf.ts`
  (`pdfChromiumSandboxEnabled`, `pdfLightLaunchArgs`),
  `apps/api/test/pdf-sandbox.test.ts`.

## Sandbox

- Chromium runs with `--no-sandbox` **by default**. That is deliberate:
  the cPanel / shared-hosting environment was never verified to allow the
  sandbox, and changing the default would break issuance there.
- `PDF_CHROMIUM_SANDBOX=1` opts into the sandbox where the host allows
  it: the launch then requests `chromiumSandbox: true` and light mode
  drops its `--no-sandbox` argument (passing both would defeat the
  sandbox again). Enable it only after the host proves Chromium starts
  with the sandbox on (see `.env.cpanel.example`, which documents the
  flag as commented-out).
- The renderer's other defences apply either way: server-escaped HTML,
  and every non-`data:` request aborted.

## Throughput — the 1-concurrency limit (owner note)

Certificate PDFs render through a single shared Chromium browser with a
semaphore:

- `PDF_MAX_CONCURRENCY` (default 4, hard cap 4) bounds concurrent
  renders; the queue holds 32 waiters and then returns `503 PDF_BUSY`.
- **On the cPanel track the limit is 1**: `.env.cpanel.example` sets
  `PDF_MAX_CONCURRENCY=1` and `PDF_LIGHT_MODE=1`, and light mode forces
  the limit to 1 regardless (a single-process Chromium dies under
  concurrent page creation, so each render launches — and closes — its
  own browser).
- Practical effect: on shared hosting, **one certificate PDF renders at
  a time**. A second issuance waits behind the first; a burst of
  approvals serialises instead of parallelising. That is the price of
  the LVE resource profile and is by design, not a bug — but the owner
  should plan issuance bursts accordingly (approve steadily rather than
  all at once) and expect `PDF_BUSY` only under a sustained burst of
  more than 32 queued renders.
- Raising the limit on shared hosting requires proving the host tolerates
  concurrent Chromium processes (and, separately, enabling the sandbox
  above). Both are deploy-time decisions, not code changes.
