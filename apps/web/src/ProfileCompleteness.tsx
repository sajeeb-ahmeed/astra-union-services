import React from "react";
import {
  completenessLabels,
  type ProfileCompleteness as Completeness,
} from "@astra/shared-schemas";
import { t, useLanguage } from "./i18n.js";

/**
 * Phase 3b: profile completeness for a citizen. In an office that enforces the gate an incomplete profile blocks
 * issuance; elsewhere it is a warning only.
 */
export function ProfileCompleteness({
  completeness,
  enforced = false,
  context = "profile",
}: {
  completeness: Completeness;
  enforced?: boolean;
  context?: "profile" | "application";
}) {
  const [language] = useLanguage();
  const lang = language === "bn" ? "bn" : "en";
  if (completeness.complete)
    return (
      <p className="completeness complete" role="status" data-testid="profile-completeness">
        <strong>{t("প্রোফাইল সম্পূর্ণ / Profile complete")}</strong> <span>100%</span>
      </p>
    );
  const blocking = enforced && context === "application";
  return (
    <div
      className={`completeness ${blocking ? "blocking" : "warning"}`}
      role={blocking ? "alert" : "status"}
      data-testid="profile-completeness"
    >
      <p>
        <strong>{t("প্রোফাইল অসম্পূর্ণ / Profile incomplete")}</strong>{" "}
        <span>{completeness.percent}%</span>
      </p>
      <meter min={0} max={100} value={completeness.percent} aria-label={t("Profile completeness")} />
      <p>{t("Missing:")}</p>
      <ul>
        {completeness.missing.map((item) => (
          <li key={item}>{completenessLabels[item][lang]}</li>
        ))}
      </ul>
      <p className="hint">
        {t(
          blocking
            ? "This office requires a complete profile: the certificate cannot be issued until these are added."
            : enforced
              ? "This office requires a complete profile before a certificate is issued."
              : "Certificates can still be issued, but the office may require a complete profile later.",
        )}
      </p>
    </div>
  );
}
