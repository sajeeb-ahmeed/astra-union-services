# Phase B — citizen journey (PORTAL-B)

**Date:** 23 Nov 2026 · **Branch:** `feat/redesign-b-citizen`, stacked on Phase A (`feat/redesign-a-public-site`, PR #61) · PR into `codex/initial-deployment` after #61.
**Scope:** web only — no API, schema, migration or package change. Production untouched.

Method: a brand-new citizen was walked through the whole journey by script (register → apply → submit → issued → download → verify), screenshotting every screen at 1280px and 390px, and each point of friction was fixed. The same journey is now a permanent browser test.

## What a citizen notices

| Before | Now |
|---|---|
| After "Create account": an "Account created" page, then "Go to sign in", then the mobile number and password typed again. | Signup signs the citizen in with the password just typed and opens their workspace. If that sign-in cannot happen (e.g. a rate limit), the old "Account created → sign in" hand-over still appears, so the account is never stranded. |
| Sign-in opened on "Sign in with: **Email**". A citizen who registered with a mobile only (the pilot default) had to find and change the dropdown first. | The default field is **"ইমেইল বা মোবাইল নম্বর / Email or mobile number"**. A Bangladeshi mobile typed there (Bengali or ASCII digits, spaces/dashes, `+88`/`88` prefix) signs in as a mobile; anything else as an email. NID and birth-registration sign-in stay in the dropdown. The field is now `type="text"` — `type="email"` made the browser reject a mobile number. |
| The citizen's dashboard said "Start an application — **choose a citizen** and service" and "View correction requests" (staff wording). | Citizen tasks: **Apply for a certificate** · **My applications** · **Fix and resubmit**. |
| The sidebar filed the citizen's print copies under **Office**. | For citizens that group is **More services**. |
| The permanent address entered on the "a few details before you apply" card had to be typed again in the form (and parents' names, date of birth where a form asks). | When a citizen applies for themselves, the form opens with those fields filled from their own record — still editable. Mapped: permanent address BN/EN, father's, mother's and spouse's names BN/EN, date of birth (top-level text/date fields only). Staff intake for another citizen still starts blank, as decided in Release 0.4. |
| **Phone bug:** on the review step the sticky action bar sat at the bottom of the screen *under* the workspace tab bar — **"Submit application" was covered** (measured at 390×844: button y 784–832, tab bar on top). | The action bar sticks just above the tab bar (`57px + safe-area inset`). The journey test asserts the Submit button is the element on top at its centre. |
| **Accuracy bug:** "My applications" kept the list loaded at sign-in; an application the Chairman had issued still showed **Submitted / Just submitted** until a reload. | Opening Applications (sidebar, phone tab bar or a dashboard task) or the dashboard re-reads the list. |
| The done screen offered "Another application **for this citizen**". | For citizens: "Another application for this service" (it restarts the same service, so the label says exactly that). |
| Portal forms (`/tracking`, `/login`, `/register`, service pages) used a legacy flat dark-green button; the rest of the site used the PP-1 gradient. | One button style everywhere: the legacy `.public-site button` colour/radius rule tied on specificity with the theme rule and won by load order — removed. |

Files: `ShortSignup.tsx`, `main.tsx` (sign-in field), `WorkspaceWelcome.tsx`, `WorkspaceApp.tsx` (group label, list refresh), `ServiceFlow.tsx` (prefill, done label), `service-flow.css`, `public-portal.css`.

## New end-to-end test

`apps/web/test/citizen-journey-browser.test.ts` — **at 390px**, a brand-new citizen: registers (3 fields) → lands signed in → "Apply for a certificate" → the deferred details once → the form shows them prefilled → submits (Submit asserted not covered) → the Chairman approves (API) → "My applications" shows **Certificate issued** without a reload → the PDF downloads (`%PDF`) → a visitor verifies it from the public home page's verify box. No page errors allowed.

`short-signup-browser.test.ts` now also signs back in by typing the mobile as `+88` + Bengali digits into the default field.

## Tests (local, actual log counts)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `npm run build` (incl. SEO prerender, 52 pages) | passes |
| Web suite, first full run | 104 / 110. Two were mine and are fixed: one test file spelled the login label in a form my rename missed; and the prefill also applied to **staff** intake, which deliberately starts blank (Release 0.4) — prefill is now for a citizen applying for themselves only. Two (merchant settings, finance payments register) passed when re-run on their own. |
| Web suite, second full run (after the fixes and a rebuild) | **109 / 110**. The one failure is the staff-registration test's `409 DUPLICATE`, which happens on any re-run against a non-fresh database (known since the Phase 1 report). |
| New `citizen-journey-browser.test.ts` | passes |

## NOT VERIFIED / left for later phases

- Bangla-only walkthrough by a person; the scripted walk ran in English, Bangla labels were checked by screenshot only.
- The fee step with a real office fee policy and online payment (SSLCommerz sandbox) was not walked in this phase; the existing order/payment browser tests cover it and still pass.
- Office-side screens (Phase C) and owner/admin (Phase D).
