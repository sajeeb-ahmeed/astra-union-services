# Phase D — owner and office-admin consoles (PORTAL-D)

**Date:** 23 Nov 2026 · **Branch:** `feat/redesign-d-consoles`, stacked on Phase C (`feat/redesign-c-office`, PR #63) · PR into `codex/initial-deployment` after #61, #62 and #63.
**Scope:** web only — no API, schema, migration or package change. Production untouched.

Method: by script, every owner-console section (10) and every office-administration tab (9) was opened and screenshotted at 1280px and 390px, recording page errors and horizontal overflow. **None of the 19 screens had a page error or a horizontal scroll at either width.** What follows is what still got in the way.

## What the owner and the office admin notice

| Before | Now |
|---|---|
| Office administration opened on **Application fee policies** — the most complex form — and the tabs were in no particular order (fees, profile, images, staff, services, authority, notices, coupons, payments). | Tabs follow the order an office sets itself up in, and it opens on the first: **Office profile → Staff accounts → Approval authority → Service settings → Application fee policies → Online payments → Certificate images → Office notices → Coupons**. The intro line says so (it used to name 4 of the 9 sections). |
| The selected tab was a full **gradient primary button** — the loudest thing on the page — and the other tabs looked like secondary actions. | Every workspace tab list uses the segmented style the payments workspace already had: a tinted strip, the selected tab raised in white. |
| **Owner menu:** `.shell nav { max-height: 60vh; overflow: auto }` (the workspace sidebar's rule) also caught the owner console's menu. At 1280×900 the menu was 540px for 591px of items, so **"Settings", the last section, was scrolled out of sight inside the menu**. | The owner menu uses the window's height (`calc(100vh − 32px)`) and scrolls only on a genuinely short window. At 900px the whole menu shows. |
| The owner's overview showed waiting queues (recharge requests, office account requests, office inclusion requests) as **figures only** — the requests themselves sit at the bottom of the long Offices section (or in Permissions), with nothing pointing there. | Those three figures are buttons ("· Open →") that open the section handling the queue, scroll its panel into view and move focus to its heading. Scanner and refund figures stay plain (no owner screen handles them). |

Files: `AdminWorkspace.tsx`, `OwnerOperations.tsx`, `WorkspaceApp.tsx` (overview → panel), `du-workspace.css` (tabs), `owner-console.css` (menu height, queue tiles).

A correction made during the work: I first concluded that office inclusion requests had **no** owner screen and started building one. They do — `OfficeInclusion.tsx` renders `OwnerInclusionRequests` in the Offices section; my search was case-sensitive and missed it. The duplicate was removed before commit; the real issue was only that the overview did not lead to it, which is what the clickable figures fix.

## New end-to-end test

`apps/web/test/consoles-browser.test.ts`:
- office admin: the tab list is exactly the setup order, opens on "Office profile" (`aria-selected`), the selected tab has no gradient (`background-image: none`), switching tabs works;
- owner: the menu has no hidden inner scroll (`scrollHeight − clientHeight ≤ 1`) and "Settings" is on screen at 1280×900; the "Office inclusion requests" figure opens the Offices section with the inclusion panel in view and focus inside it. No page errors.

(It does not create inclusion requests: that public form is limited to 5 per hour per address, and `public-content-browser` already sends one.)

## Tests (local, actual log counts)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `npm run build` (incl. SEO prerender) | passes |
| Console walk, 10 owner sections + 9 admin tabs, at 1280px and 390px | no page errors, no horizontal overflow |
| Web suite, full run | **111 / 112** — the one failure is the staff-registration test's `409 DUPLICATE` on a non-fresh database (known since the Phase 1 report). |
| New `consoles-browser.test.ts` | passes |

## NOT VERIFIED / left for later

- The owner's narrow left rail (logo + "Sign out" only) beside the console's own menu was left as is.
- Fee-policy wording ("Online collection is not connected…") was not changed: it describes the owner's business state, which only the owner can confirm (SSLCommerz is sandbox-only per the Release 1.0 notes).
- No human walkthrough by the owner or an office admin.
