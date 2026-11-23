# Phase C — office journey (PORTAL-C)

**Date:** 23 Nov 2026 · **Branch:** `feat/redesign-c-office`, stacked on Phase B (`feat/redesign-b-citizen`, PR #62) · PR into `codex/initial-deployment` after #61 and #62.
**Scope:** web only — no API, schema, migration or package change. Production untouched.

Method: by script, office staff (desktop) took a walk-in citizen's application and the Chairman (phone, 390px) reviewed and issued it, screenshotting every screen; each point of friction was fixed and the journey became a permanent browser test.

## What the office notices

| Before | Now |
|---|---|
| **Chairman on a phone:** the decision panel (reason, Approve / Correction / Ask to come / Reject) came **first**, the application's details far below it — he could approve before seeing what he approved. | Whoever decides reads first: on narrow screens the rail holding the decision-reason box comes **after** the application details. Citizens and other viewers keep the status-first order (their rail has no decision box). |
| After issuing, the biggest button on the rail was **"Retry issuance safely"** (gradient primary); "Download PDF" was a small button lower down. "Retry" reads as "something failed". | Once issued, "Retry issuance safely" is a secondary button — it is a safe recovery that returns the same certificate, not the next step. "Issue certificate" stays primary while issuance is still pending. |
| The 16-digit reference **broke across two lines** in every phone card ("202611233242 / 7216"), on the very screen where it is read out and compared. | References never wrap; the status pill moves to the next row instead. |
| On phones, anything the browser scrolled into view (keyboard focus, an anchor) could land **under the fixed bottom tab bar** (found when the Chairman's last pending card's "Open" was covered). | `scroll-padding-bottom` reserves the tab bar (and, inside a service flow, the sticky actions above it). |
| After signing in, the address bar kept **`/login#/home`** — bookmarks and shared links said "login". | Signing in on `/login` or `/register` replaces the path with `/`; the workspace's `#/…` route is kept. When the session ends (sign-out here, or a sign-in/sign-out in another tab), the same place shows the sign-in form again, in place, as before. |
| Staff searching for a walk-in: "Find a citizen (name or reference)" — but the search already matched the mobile number (Phase 5B), the number a walk-in knows. | "Find a citizen (name, **mobile** or reference)". |

Files: `WorkspaceApp.tsx` (secondary retry), `ServiceFlow.tsx` (search label), `main.tsx` (address after sign-in and after the session ends), `du-workspace.css` (rail order, scroll padding), `workspace-usability.css` (card head wraps), `ui/kit.css` (reference never wraps).

Checked and left as is: the staff citizen step (search + list + "Register a new citizen"), the Chairman's Pending queue (oldest first, one card each, counts), the one confirmation before an irreversible approval, the issued view's PDF and QR links.

## New end-to-end test

`apps/web/test/office-journey-browser.test.ts`:
- staff (1280px) signs in (address is `/`), finds a walk-in **by mobile** (exactly one match), the staff form starts **blank**, fills and submits;
- the Chairman (390px) signs in onto `#/pending`, the card's reference is on one line, opens it, the **details are above the decision box**, approves with **one** confirmation, sees "Approved — the certificate has been issued", **Retry is `secondary`**, the PDF is `%PDF`, no horizontal scroll, no page errors.

## Tests (local, actual log counts)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `npm run build` (incl. SEO prerender) | passes |
| Web suite, first full run | 105 / 111 — **caught my own regression**: with the workspace at `/`, signing out showed the public home instead of the sign-in form (5 tests: sign-out clears the form in place, session switch in another tab, performance logout). Fixed by returning `/` to `/login` in place when the session ends. The 6th was the known `409 DUPLICATE`. |
| Web suite, second full run (after the fix and a rebuild) | **110 / 111** — the one failure is the staff-registration test's `409 DUPLICATE` on a non-fresh database (known since the Phase 1 report). |
| New `office-journey-browser.test.ts` | passes |

## NOT VERIFIED / left for later

- Printing on paper and the wet signature (the certificate PDF itself is unchanged by this phase).
- Secretary (view-only), finance and office-admin screens were not re-walked here; their existing browser tests pass. Owner / admin consoles are Phase D.
- No human walkthrough with a Chairman.
