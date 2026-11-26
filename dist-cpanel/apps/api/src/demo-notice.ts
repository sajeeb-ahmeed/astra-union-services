/**
 * W-001 (Phase 4 Stage 1, P1) — every newly generated DEMO certificate
 * carries clear unofficial/demo wording, in Bengali AND English.
 *
 * One wording, shared by every render engine (template 6 HTML, template 7
 * HTML, react-pdf) so downloads, previews and re-renders can never drift
 * apart: a banner + a "this is not an official certificate" line, plus a
 * faint DEMO watermark. Official mode prints none of it.
 *
 * Demo is decided by the ONE global switch the rest of issuance already
 * uses (ISSUANCE_MODE === "official" is official; anything else is demo)
 * — the same switch as the DEMO- certificate-number prefix and the
 * emblem. The public verify page reports the per-tenant demo flag
 * (tenants.demo); in any correctly configured deployment the two agree
 * (demo deployments run non-official mode with demo tenants; official
 * deployments run official mode with demo=false tenants).
 *
 * Historical certificates are NOT modified by this change: a PDF already
 * issued keeps the bytes it was issued with. Whether previously generated
 * demo certificates should be reissued or invalidated is an OWNER
 * DECISION (see the batch-A W-001 fragment).
 */
export const DEMO_BANNER_BN = "নমুনা সনদ — এটি সরকারি সনদ নয়";
export const DEMO_BANNER_EN = "DEMO CERTIFICATE — This is not an official certificate";
export const DEMO_NOTICE_BN = "এটি পরীক্ষার জন্য তৈরি একটি নমুনা সনদ; দাপ্তরিক কাজে এটি বৈধ নয়।";
export const DEMO_NOTICE_EN =
  "This is a demo certificate made for testing only. It is not valid for official use.";

export const isDemoIssuance = () => process.env.ISSUANCE_MODE !== "official";
