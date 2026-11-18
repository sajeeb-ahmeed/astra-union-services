import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

const label = (bn: string, en: string) => choose({ bn, en });

const KEY_LABELS: Record<string, { bn: string; en: string }> = {
  application_fee_payer: { bn: "আবেদন ফি প্রদানকারী", en: "Application fee payer" },
  platform_name: { bn: "প্ল্যাটফর্মের নাম", en: "Platform name" },
  platform_tagline_bn: { bn: "স্লোগান (বাংলা)", en: "Tagline (Bangla)" },
  platform_tagline_en: { bn: "স্লোগান (ইংরেজি)", en: "Tagline (English)" },
};

function displayValue(key: string, value: string) {
  if (key === "application_fee_payer")
    return value === "citizen" ? label("নাগরিক", "Citizen") : label("অফিসের ওয়ালেট", "Office wallet");
  return value;
}

/**
 * Phase 3D: the owner dashboard's Audit section — the platform settings change
 * history (application fee payer + branding), newest first, each with its new
 * value, mandatory reason, author and time. Per-service price versions and plan
 * changes keep their own histories inside the Pricing and Subscriptions sections;
 * office-level audit events stay inside each office (they are tenant-scoped).
 */
export function OwnerAudit() {
  useLanguage();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/owner/setting-changes")
      .then((r) => setRows(r.items))
      .catch((e) => setError((e as Error).message));
  }, []);
  return (
    <section className="panel">
      <h3>{label("প্ল্যাটফর্ম সেটিংসের ইতিহাস", "Platform settings history")}</h3>
      <p className="hint">
        {label(
          "ফি প্রদানকারী ও ব্র্যান্ডিংয়ের প্রতিটি পরিবর্তন — নতুন মান, কারণ, কে করেছেন এবং কখন। সেবার মূল্যের ইতিহাস মূল্য নির্ধারণ অংশে এবং প্ল্যানের ইতিহাস সাবস্ক্রিপশন অংশে থাকে।",
          "Every fee-payer and branding change — the new value, the reason, who made it and when. Price history lives in the Pricing section and plan history in the Subscriptions section.",
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {rows === null && !error && <p role="status">{label("লোড হচ্ছে…", "Loading…")}</p>}
      {rows !== null && rows.length === 0 && (
        <p>{label("এখনো কোনো প্ল্যাটফর্ম সেটিংস পরিবর্তন হয়নি।", "No platform settings have been changed yet.")}</p>
      )}
      {rows !== null && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{label("সময়", "Time")}</th>
                <th scope="col">{label("সেটিং", "Setting")}</th>
                <th scope="col">{label("নতুন মান", "New value")}</th>
                <th scope="col">{label("কারণ", "Reason")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.createdAt}-${index}`}>
                  <td>
                    {new Date(row.createdAt).toLocaleString(
                      choose({ bn: "bn-BD", en: "en-GB" }),
                    )}
                  </td>
                  <td>
                    {KEY_LABELS[row.key]
                      ? label(KEY_LABELS[row.key].bn, KEY_LABELS[row.key].en)
                      : row.key}
                  </td>
                  <td>{displayValue(row.key, row.value)}</td>
                  <td>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
