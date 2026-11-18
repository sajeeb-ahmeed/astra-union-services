import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

const label = (bn: string, en: string) => choose({ bn, en });
const areaName = (row: any, level: "division" | "district" | "upazila" | "union" | "ward") =>
  choose({ bn: row[`${level}Bn`] ?? row[`${level}Code`] ?? "", en: row[`${level}En`] ?? row[`${level}Code`] ?? "" });
const when = (iso: string) =>
  new Date(iso).toLocaleString(choose({ bn: "bn-BD", en: "en-GB" }));

/**
 * Demand list (billing plan §3.6, owner-approved 18 Nov 08:01): signups the
 * registration gate refused because the citizen's union is not listed yet are
 * captured (name, mobile, claimed geography — what the form collected) so the
 * owner can see which unions to onboard next. Per-union totals first, then
 * every attempt, most recent first. Read-only: onboarding a union happens in
 * the Offices section; a captured row is never edited from here.
 */
export function OwnerDemand() {
  useLanguage();
  const [data, setData] = useState<{ items: any[]; byUnion: any[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/owner/registration-demand")
      .then((r) => setData({ items: r.items ?? [], byUnion: r.byUnion ?? [] }))
      .catch((e) => setError((e as Error).message));
  }, []);
  return (
    <section className="panel">
      <h3>{label("যুক্ত হয়নি এমন ইউনিয়নের চাহিদা", "Demand from unions not yet listed")}</h3>
      <p className="hint">
        {label(
          "যেসব নাগরিকের ইউনিয়ন এখনো DigitalUnion-এ যুক্ত হয়নি, নিবন্ধনের সময় তাদের আবেদন থেমে গেছে — নাম, মোবাইল ও এলাকা এখানে জমা হয়, যাতে কোন ইউনিয়ন আগে যুক্ত করা দরকার তা দেখা যায়। একই মোবাইল থেকে একই ইউনিয়নের পুনরাবৃত্তি একটি সারিতেই গোনা হয়।",
          "Citizens whose union has not joined DigitalUnion yet were stopped at registration — their name, mobile and area are captured here, so it is clear which union to onboard next. Repeat attempts from the same mobile for the same union are counted on a single row.",
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data === null && !error && <p role="status">{label("লোড হচ্ছে…", "Loading…")}</p>}
      {data !== null && data.items.length === 0 && (
        <p>{label("এখনো কোনো চাহিদা জমা হয়নি।", "No registration demand has been captured yet.")}</p>
      )}
      {data !== null && data.byUnion.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{label("ইউনিয়ন", "Union")}</th>
                <th scope="col">{label("উপজেলা · জেলা", "Upazila · District")}</th>
                <th scope="col">{label("মানুষ", "People")}</th>
                <th scope="col">{label("মোট প্রচেষ্টা", "Total attempts")}</th>
                <th scope="col">{label("সর্বশেষ", "Most recent")}</th>
              </tr>
            </thead>
            <tbody>
              {data.byUnion.map((row) => (
                <tr key={`${row.divisionCode}-${row.districtCode}-${row.upazilaCode}-${row.unionCode}`}>
                  <td>{areaName(row, "union")}</td>
                  <td>
                    {areaName(row, "upazila")} · {areaName(row, "district")}
                  </td>
                  <td>{row.people}</td>
                  <td>{row.attempts}</td>
                  <td>{when(row.lastAttemptAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data !== null && data.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{label("নাম", "Name")}</th>
                <th scope="col">{label("মোবাইল", "Mobile")}</th>
                <th scope="col">{label("ইউনিয়ন", "Union")}</th>
                <th scope="col">{label("প্রচেষ্টা", "Attempts")}</th>
                <th scope="col">{label("প্রথম", "First")}</th>
                <th scope="col">{label("সর্বশেষ", "Most recent")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td>{choose({ bn: row.nameBn, en: row.nameEn })}</td>
                  <td>{row.phone ?? "—"}</td>
                  <td>
                    {areaName(row, "union")} · {areaName(row, "upazila")}
                  </td>
                  <td>{row.attempts}</td>
                  <td>{when(row.firstAttemptAt)}</td>
                  <td>{when(row.lastAttemptAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
