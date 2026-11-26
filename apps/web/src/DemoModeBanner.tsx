import React from "react";
import { choose } from "./i18n.js";
import { useIssuanceMode, type IssuanceMode } from "./mode.js";

/**
 * F-008: the mode honesty system was dead code — IssuanceModeProvider
 * wrapped the app but nothing read the mode. The banner renders only
 * when the deployment is proven to be a demonstration (mode === "DEMO"):
 * nothing in OFFICIAL mode, nothing while the mode is unknown (a
 * production deployment must never flash demo text, and a demo must
 * never hide its notices once the mode is known — see mode.tsx).
 *
 * Wording follows the Stage 1 demo wording (demo-notice.ts): the same
 * "not an official certificate" line the certificates carry, scoped to
 * the site. This is NOT the F-009 "not a government website" footer
 * statement — that wording and placement is an owner decision.
 */
export function DemoBanner({ mode }: { mode: IssuanceMode }) {
  if (mode !== "DEMO") return null;
  return (
    <div className="du-demo-banner" role="note">
      {choose({
        bn: "নমুনা সংস্করণ — এখানে ইস্যু করা সনদ সরকারি নয়।",
        en: "Demonstration — certificates issued here are not official.",
      })}
    </div>
  );
}

export function DemoModeBanner() {
  return <DemoBanner mode={useIssuanceMode()} />;
}
