import React, { useState } from "react";
import { choose, useLanguage } from "./i18n.js";
import { CivicIcon } from "./PublicPortal.js";
import { EmptyState, StatCard } from "./ui/kit.js";
import "./workspace-dashboard.css";

const count = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : choose({ bn: value.toLocaleString("bn-BD"), en: value.toLocaleString("en-GB") });

/**
 * Phase 1 slice (ii): UDC dashboard. Three figures and every enabled service as a tile; a tile opens the
 * new-application form for that service. The office credit balance shows only to roles the API lets read
 * it; the UDC's own points wallet arrives in Phase 5.
 */
export function WorkspaceDashboard({
  services,
  citizenTotal,
  applicationTotal,
  creditBalance,
  onStartService,
  onOpenCitizens,
  onOpenApplications,
}: {
  services: readonly { service_no: number; name_bn: string; name_en: string; enabled?: boolean }[];
  citizenTotal: number | null;
  applicationTotal: number | null;
  /** null when this role may not read the office balance. */
  creditBalance: number | null;
  onStartService: (serviceNo: number) => void;
  onOpenCitizens: () => void;
  onOpenApplications: () => void;
}) {
  useLanguage();
  const [query, setQuery] = useState("");
  const normalized = query
    .trim()
    .replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)))
    .toLowerCase();
  const shown = services.filter((s) =>
    `${s.service_no} ${s.name_bn} ${s.name_en}`.toLowerCase().includes(normalized),
  );
  return (
    <div className="ax-dashboard">
      <div className="ax-dashboard-stats">
        <StatCard
          value={creditBalance === null ? "—" : count(creditBalance)}
          label={
            creditBalance === null
              ? choose({
                  bn: "পয়েন্ট ব্যালেন্স (পয়েন্ট ওয়ালেট শীঘ্রই, Phase 5)",
                  en: "Points balance (points wallet coming in Phase 5)",
                })
              : choose({ bn: "অফিসের ক্রেডিট ব্যালেন্স", en: "Office credit balance" })
          }
        />
        <button type="button" className="ax-stat-button" onClick={onOpenCitizens}>
          <StatCard
            value={count(citizenTotal)}
            label={choose({ bn: "নিবন্ধিত নাগরিক", en: "Registered citizens" })}
          />
        </button>
        <button type="button" className="ax-stat-button" onClick={onOpenApplications}>
          <StatCard
            value={count(applicationTotal)}
            label={choose({ bn: "মোট আবেদন", en: "Total applications" })}
          />
        </button>
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
          <div className="ax-dashboard-grid">
            {shown.map((s) => (
              <button
                key={s.service_no}
                type="button"
                className="ax-tile"
                data-service={s.service_no}
                onClick={() => onStartService(s.service_no)}
              >
                <span className="ax-tile-number" aria-hidden="true">
                  {s.service_no}
                </span>
                <span className="ax-tile-icon">
                  <CivicIcon index={s.service_no} />
                </span>
                <span className="ax-tile-name">{choose({ bn: s.name_bn, en: s.name_en })}</span>
              </button>
            ))}
          </div>
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
