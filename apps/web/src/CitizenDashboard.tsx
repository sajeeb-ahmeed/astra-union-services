import React, { useEffect, useState } from "react";
import {
  citizenProfileCompleteness,
  completenessLabels,
} from "@astra/shared-schemas";
import { api } from "./api.js";
import { choose, recordName, tx, useLanguage } from "./i18n.js";
import { ApplicationStatus, RefChip, StatCard } from "./ui/kit.js";
import { formatDate, localDigits } from "./ui/fmt.js";
import { NavIcon } from "./ui/nav-icons.js";
import "./citizen-dashboard.css";

/**
 * Citizen dashboard (Md's approved desktop/mobile demos, 2026-11-26): greeting
 * with name + Asia/Dhaka date, profile-completeness card (ring on desktop,
 * bar on phone), four stat cards, recent applications and quick actions.
 * Counts come from the citizen-scoped GET /applications/counts (WS-A) and the
 * print-requests total; both load async with a "—" fallback so first paint
 * never waits on them. The correction-needed and draft-continue cards keep
 * their previous behaviour.
 */
export function CitizenDashboard({
  citizen,
  applications,
  catalog,
  geographyRequired,
  displayName,
  loaded,
  displayReference,
  onNavigate,
  onOpenTask,
  onOpenApplication,
}: {
  citizen: any;
  applications: any[];
  catalog: any[];
  geographyRequired: boolean;
  displayName: string;
  loaded: boolean;
  displayReference: (a: any) => string;
  onNavigate: (page: string) => void;
  onOpenTask: (state?: string) => void;
  onOpenApplication: (id: string) => void;
}) {
  const [language] = useLanguage();
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [printTotal, setPrintTotal] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await api("/applications/counts");
        if (active) setCounts(r?.counts ?? {});
      } catch {
        if (active) setCounts({});
      }
      try {
        const r = await api("/print-requests");
        if (active) setPrintTotal(typeof r?.total === "number" ? r.total : null);
      } catch {
        if (active) setPrintTotal(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [applications.length]);

  const name =
    (language === "bn" ? citizen?.nameBn : citizen?.nameEn) ||
    citizen?.nameBn ||
    citizen?.nameEn ||
    displayName ||
    "";
  const today = new Date().toLocaleDateString(
    language === "bn" ? "bn-BD" : "en-GB",
    {
      timeZone: "Asia/Dhaka",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    },
  );
  const completeness = citizenProfileCompleteness(citizen ?? {}, {
    geographyRequired,
  });
  const percent = completeness.percent;
  const ringR = 34;
  const ringC = 2 * Math.PI * ringR;
  const total =
    counts === null
      ? null
      : Object.values(counts).reduce((sum, n) => sum + (n || 0), 0);
  const pending =
    counts === null
      ? null
      : (counts.SUBMITTED ?? 0) +
        (counts.UNDER_REVIEW ?? 0) +
        (counts.RESUBMITTED ?? 0) +
        (counts.APPROVED ?? 0) +
        (counts.ISSUANCE_PENDING ?? 0);
  const num = (v: number | null) =>
    v === null ? "—" : localDigits(String(v), language);
  const draft = applications.find((a) => (a.state || a.status) === "DRAFT");
  const serviceName = (a: any) =>
    recordName(
      catalog.find((s) => s.service_no === (a.serviceNo || a.service_no)),
    );

  return (
    <section
      className="citizen-dashboard"
      aria-label={choose({ bn: "আমার ড্যাশবোর্ড", en: "My dashboard" })}
    >
      <div className="cd-greeting">
        <h2>
          {choose({ bn: "স্বাগতম", en: "Welcome" })}
          {name ? `, ${name}` : ""}
        </h2>
        <p>
          {choose({ bn: "আজ", en: "Today" })} {tx(today)}
        </p>
      </div>

      {counts && (counts.CORRECTION_REQUIRED ?? 0) > 0 && (
        <div className="citizen-correction-card">
          <div>
            <strong>
              {choose({ bn: "সংশোধন প্রয়োজন", en: "Correction needed" })}
              {" · "}
              {localDigits(String(counts.CORRECTION_REQUIRED), language)}
            </strong>
            <p>
              {choose({
                bn: "অফিস একটি আবেদনে সংশোধন চেয়েছে। কারণ পড়ে ঠিক করে আবার জমা দিন।",
                en: "The office asked for a correction on an application. Read the reason, fix it and resubmit.",
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenTask("CORRECTION_REQUIRED")}
          >
            {choose({ bn: "আবেদনগুলো দেখুন", en: "View applications" })}
          </button>
        </div>
      )}

      <div className="cd-completeness" data-testid="dashboard-completeness">
        <div className="cd-ring" aria-hidden="true">
          <svg viewBox="0 0 84 84" width="84" height="84">
            <circle
              cx="42"
              cy="42"
              r={ringR}
              fill="none"
              stroke="var(--du-line, #d9e2dc)"
              strokeWidth="8"
            />
            <circle
              cx="42"
              cy="42"
              r={ringR}
              fill="none"
              stroke="var(--du-green-600, #0a7a4b)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={ringC}
              strokeDashoffset={ringC - (ringC * percent) / 100}
              transform="rotate(-90 42 42)"
            />
          </svg>
          <span className="cd-ring-value">
            {localDigits(String(percent), language)}%
          </span>
        </div>
        <div className="cd-completeness-body">
          <h3>
            {completeness.complete
              ? choose({ bn: "প্রোফাইল সম্পূর্ণ", en: "Profile complete" })
              : choose({
                  bn: "প্রোফাইল সম্পূর্ণ করুন",
                  en: "Complete your profile",
                })}
          </h3>
          <p>
            {choose({
              bn: `আপনার প্রোফাইল ${localDigits(String(percent), "bn")}% সম্পূর্ণ হয়েছে`,
              en: `Your profile is ${percent}% complete`,
            })}
            {!completeness.complete &&
              choose({
                bn: "। বাকি তথ্য পূরণ করে পূর্ণ অ্যাক্সেস পান।",
                en: ". Fill in the rest to get full access.",
              })}
          </p>
          <div
            className="cd-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={choose({
              bn: "প্রোফাইলের পূর্ণতা",
              en: "Profile completeness",
            })}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          {!completeness.complete && (
            <ul className="cd-missing">
              {completeness.missing.map((item) => (
                <li key={item}>{completenessLabels[item][language]}</li>
              ))}
            </ul>
          )}
        </div>
        {!completeness.complete && (
          <button
            type="button"
            className="cd-complete-btn"
            onClick={() => onNavigate("profile")}
          >
            {choose({ bn: "সম্পূর্ণ করুন", en: "Complete now" })} →
          </button>
        )}
      </div>

      <div className="cd-stats">
        <button
          type="button"
          className="ax-stat-button"
          onClick={() => onOpenTask("")}
        >
          <StatCard
            value={num(total)}
            label={choose({ bn: "মোট আবেদন", en: "Total applications" })}
            icon={<NavIcon name="applications" />}
            context={choose({ bn: "সব আবেদন", en: "All applications" })}
          />
        </button>
        <button
          type="button"
          className="ax-stat-button"
          onClick={() => onOpenTask("")}
        >
          <StatCard
            value={num(pending)}
            label={choose({ bn: "অপেক্ষমাণ", en: "Pending" })}
            icon={<NavIcon name="pending" />}
            context={choose({ bn: "অবস্থা দেখুন", en: "Check status" })}
          />
        </button>
        <button
          type="button"
          className="ax-stat-button"
          onClick={() => onOpenTask("ISSUED")}
        >
          <StatCard
            value={num(counts === null ? null : (counts.ISSUED ?? 0))}
            label={choose({ bn: "ইস্যুকৃত সনদ", en: "Issued certificates" })}
            icon={<NavIcon name="print-certificate" />}
            context={choose({ bn: "সনদ ডাউনলোড", en: "Download certificates" })}
          />
        </button>
        <button
          type="button"
          className="ax-stat-button"
          onClick={() => onNavigate("prints")}
        >
          <StatCard
            value={num(printTotal)}
            label={choose({ bn: "প্রিন্ট অনুরোধ", en: "Print requests" })}
            icon={<NavIcon name="prints" />}
            context={choose({ bn: "কপি দেখুন", en: "View copies" })}
          />
        </button>
      </div>

      {draft && (
        <div className="citizen-draft-card">
          <div>
            <strong>
              {choose({ bn: "খসড়া চালিয়ে যান: ", en: "Continue your draft: " })}
              {tx(serviceName(draft))}
            </strong>
            <RefChip value={draft.reference || draft.id} />
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() => onOpenApplication(draft.id)}
          >
            {choose({ bn: "খুলুন", en: "Open" })}
          </button>
        </div>
      )}

      <div className="cd-main">
        <div className="cd-recent">
          <div className="cd-recent-head">
            <h3>
              {choose({ bn: "সাম্প্রতিক আবেদনসমূহ", en: "Recent applications" })}
            </h3>
            <button
              type="button"
              className="text-button"
              onClick={() => onOpenTask("")}
            >
              {choose({ bn: "সবগুলো দেখুন", en: "View all" })} →
            </button>
          </div>
          {!loaded ? (
            <p role="status" className="hint">
              {choose({ bn: "লোড হচ্ছে…", en: "Loading…" })}
            </p>
          ) : applications.length === 0 ? (
            <p className="hint">
              {choose({
                bn: "এখনো কোনো আবেদন নেই। নতুন আবেদন শুরু করুন।",
                en: "No applications yet. Start a new application.",
              })}
            </p>
          ) : (
            <div className="cd-recent-table" role="table">
              <div className="cd-recent-row cd-recent-headrow" role="row">
                <span role="columnheader">
                  {choose({ bn: "সেবা", en: "Service" })}
                </span>
                <span role="columnheader">
                  {choose({ bn: "রেফারেন্স", en: "Reference" })}
                </span>
                <span role="columnheader">
                  {choose({ bn: "তারিখ", en: "Date" })}
                </span>
                <span role="columnheader">
                  {choose({ bn: "অবস্থা", en: "Status" })}
                </span>
                <span role="columnheader" aria-label={choose({ bn: "খুলুন", en: "Open" })} />
              </div>
              {applications.slice(0, 5).map((a) => (
                <div className="cd-recent-row" role="row" key={a.id}>
                  <span className="cd-recent-service">{tx(serviceName(a))}</span>
                  <span>
                    <RefChip value={displayReference(a)} />
                  </span>
                  <span>{formatDate(a.createdAt || a.created_at, language)}</span>
                  <span>
                    <ApplicationStatus
                      state={String(a.state || a.status || "")}
                    />
                  </span>
                  <span>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => onOpenApplication(a.id)}
                    >
                      {choose({ bn: "খুলুন", en: "Open" })}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="cd-quick">
          <h3>{choose({ bn: "দ্রুত ব্যবস্থা", en: "Quick actions" })}</h3>
          <button
            type="button"
            className="cd-quick-primary"
            onClick={() => onNavigate("services")}
          >
            + {choose({ bn: "নতুন আবেদন", en: "New application" })}
          </button>
          <a className="button secondary cd-quick-link" href="/verify">
            {choose({ bn: "সনদ যাচাই", en: "Verify certificate" })}
          </a>
          <button
            type="button"
            className="secondary"
            onClick={() => onNavigate("prints")}
          >
            {choose({ bn: "প্রিন্ট অনুরোধ", en: "Print requests" })}
          </button>
        </div>
      </div>
    </section>
  );
}
