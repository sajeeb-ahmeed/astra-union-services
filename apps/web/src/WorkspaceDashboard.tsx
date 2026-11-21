import React, { useState } from "react";
import { choose, useLanguage } from "./i18n.js";
import { EmptyState, ServiceCard, StatCard } from "./ui/kit.js";
import { NavIcon } from "./ui/nav-icons.js";
import "./workspace-dashboard.css";

const count = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : choose({ bn: value.toLocaleString("bn-BD"), en: value.toLocaleString("en-GB") });

/**
 * UDC dashboard.
 * FULL-UIUX-01 (B17): the day's task cards (citizens, applications, credit)
 * sit above the service catalog, and the catalog uses the one ServiceCard
 * system. The points placeholder stat is GONE — when the role may not read
 * the balance, no stat renders at all (never a "(Phase 5)" promise).
 */
/** REFINEMENT-02 P1-8: the frequent-services row (same popularity order
 * as the public home grid). */
const FREQUENT = [12, 2, 42, 1, 3, 8, 45, 35];

export function WorkspaceDashboard({
  services,
  citizenTotal,
  applicationTotal,
  pendingTotal,
  creditBalance,
  onStartService,
  onOpenCitizens,
  onOpenApplications,
}: {
  services: readonly {
    service_no: number;
    name_bn: string;
    name_en: string;
    category_en?: string;
    categoryEn?: string;
    category?: string;
    enabled?: boolean;
  }[];
  citizenTotal: number | null;
  applicationTotal: number | null;
  /** REFINEMENT-02 P1-8: applications awaiting review or issuance. */
  pendingTotal?: number | null;
  /** null when this role may not read the office balance. */
  creditBalance: number | null;
  onStartService: (serviceNo: number) => void;
  onOpenCitizens: () => void;
  onOpenApplications: () => void;
}) {
  useLanguage();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const normalized = query
    .trim()
    .replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)))
    .toLowerCase()
    .normalize("NFC");
  const shown = services.filter((s) =>
    `${s.service_no} ${s.name_bn} ${s.name_en}`.toLowerCase().normalize("NFC").includes(normalized),
  );
  /* P1-8: without a search the catalogue collapses to the frequent row;
     the full grid is one expander away (and lives in full on the
     services page). Searching always searches everything. */
  const visible =
    normalized || expanded
      ? shown
      : FREQUENT.map((no) => shown.find((s) => s.service_no === no)).filter(
          Boolean,
        );
  return (
    <div className="ax-dashboard">
      <div className="ax-dashboard-stats">
        {/* P1-8: the pending queue is the first, emphasised stat. */}
        <button
          type="button"
          className="ax-stat-button ax-stat-emphasis"
          onClick={onOpenApplications}
        >
          <StatCard
            value={count(pendingTotal ?? null)}
            label={choose({ bn: "অপেক্ষমাণ আবেদন", en: "Pending applications" })}
            icon={<NavIcon name="pending" />}
            context={choose({ bn: "যাচাই ও ইস্যুর অপেক্ষায়", en: "Awaiting review or issuance" })}
          />
        </button>
        <button type="button" className="ax-stat-button" onClick={onOpenCitizens}>
          <StatCard
            value={count(citizenTotal)}
            label={choose({ bn: "নিবন্ধিত নাগরিক", en: "Registered citizens" })}
            icon={<NavIcon name="citizens" />}
            context={choose({ bn: "তালিকা ও বিবরণ দেখুন", en: "View the register" })}
          />
        </button>
        <button type="button" className="ax-stat-button" onClick={onOpenApplications}>
          <StatCard
            value={count(applicationTotal)}
            label={choose({ bn: "মোট আবেদন", en: "Total applications" })}
            icon={<NavIcon name="applications" />}
            context={choose({ bn: "সব আবেদন দেখুন", en: "View all applications" })}
          />
        </button>
        {creditBalance !== null && (
          <StatCard
            value={count(creditBalance)}
            label={choose({ bn: "অফিসের ক্রেডিট ব্যালেন্স", en: "Office credit balance" })}
            icon={<NavIcon name="billing" />}
          />
        )}
      </div>
      <section
        className="ax-dashboard-services"
        aria-labelledby="ax-dashboard-services-heading"
      >
        <div className="ax-dashboard-services-head">
          <h2 id="ax-dashboard-services-heading">
            {choose({ bn: "নতুন আবেদন শুরু করুন", en: "Start a new application" })}
          </h2>
          <label className="ax-dashboard-search">
            <span>{choose({ bn: "সেবা খুঁজুন", en: "Search services" })}</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={choose({ bn: "নাম বা নম্বর", en: "Name or number" })}
            />
          </label>
        </div>
        {shown.length ? (
          <>
            <div className="ax-dashboard-grid">
              {(visible as typeof shown).map((s) => (
                <ServiceCard
                  key={s.service_no}
                  serviceNo={s.service_no}
                  name={choose({ bn: s.name_bn, en: s.name_en })}
                  category={s.category_en ?? s.categoryEn ?? s.category ?? "Miscellaneous"}
                  onClick={() => onStartService(s.service_no)}
                />
              ))}
            </div>
            {!normalized && !expanded && shown.length > visible.length && (
              <button
                type="button"
                className="secondary ax-dashboard-expand"
                onClick={() => setExpanded(true)}
              >
                {choose({
                  bn: `সব ${count(shown.length)}টি সেবা দেখুন`,
                  en: `See all ${shown.length} services`,
                })}
              </button>
            )}
            {!normalized && expanded && (
              <button
                type="button"
                className="secondary ax-dashboard-expand"
                onClick={() => setExpanded(false)}
              >
                {choose({ bn: "কম দেখুন", en: "Show less" })}
              </button>
            )}
          </>
        ) : (
          <EmptyState
            title={choose({
              bn: "এই নামে কোনো সেবা নেই।",
              en: "No service matches.",
            })}
            hint={choose({
              bn: "নাম বা নম্বরের অংশ দিয়ে খুঁজুন।",
              en: "Try part of the name or number.",
            })}
          />
        )}
      </section>
    </div>
  );
}
