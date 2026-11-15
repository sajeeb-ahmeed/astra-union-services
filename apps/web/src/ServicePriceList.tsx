import React from "react";
import { choose, useLanguage } from "./i18n.js";

const bnDigits = (value: string) => value.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
/** Taka from integer minor units, without floating-point arithmetic; Bangla digits in Bangla. */
export function taka(minor: number) {
  const text = `৳${Math.trunc(minor / 100).toLocaleString("en-IN")}${minor % 100 ? `.${String(minor % 100).padStart(2, "0")}` : ""}`;
  return choose({ bn: bnDigits(text), en: text });
}

/**
 * Phase 4a: an office's public service price list, from its current published fee policies. The base fee is
 * the statutory fee plus processing; urgent surcharge, delivery fees and the citizen-charter time are shown
 * where the office offers them. Services without a published policy say so instead of showing a price.
 */
export function ServicePriceList({ services }: { services: any[] }) {
  useLanguage();
  const priced = services.filter((s) => s.enabled !== false);
  if (!priced.length) return null;
  return (
    <section className="price-list" aria-labelledby="price-list-title">
      <h3 id="price-list-title">{choose({ bn: "সেবার মূল্য তালিকা", en: "Service price list" })}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{choose({ bn: "সেবা", en: "Service" })}</th>
              <th scope="col">{choose({ bn: "ফি", en: "Fee" })}</th>
              <th scope="col">{choose({ bn: "জরুরি (অতিরিক্ত)", en: "Urgent (extra)" })}</th>
              <th scope="col">{choose({ bn: "বিতরণ", en: "Delivery" })}</th>
              <th scope="col">{choose({ bn: "সেবা প্রদানের সময়", en: "Service time" })}</th>
            </tr>
          </thead>
          <tbody>
            {priced.map((s) => {
              const name = choose({ bn: s.nameBn ?? s.name_bn, en: s.nameEn ?? s.name_en });
              if (s.policyVersion == null)
                return (
                  <tr key={s.serviceNo}>
                    <th scope="row">{name}</th>
                    <td colSpan={4}>
                      {choose({ bn: "অফিস এখনও ফি প্রকাশ করেনি", en: "Fee not yet published by the office" })}
                    </td>
                  </tr>
                );
              const delivery = (s.deliveryModes as string[])
                .map((mode) =>
                  mode === "office_collection"
                    ? `${choose({ bn: "অফিস থেকে সংগ্রহ", en: "Office collection" })} ${taka(s.officeCollectionFeeMinor)}`
                    : `${choose({ bn: "ডিজিটাল কপি", en: "Digital copy" })} ${taka(s.digitalCopyFeeMinor)}`,
                )
                .join(" · ");
              return (
                <tr key={s.serviceNo}>
                  <th scope="row">{name}</th>
                  <td>{taka(s.statutoryFeeMinor + s.processingFeeMinor)}</td>
                  <td>
                    {(s.urgencies as string[]).includes("urgent")
                      ? taka(s.emergencySurchargeMinor)
                      : choose({ bn: "প্রযোজ্য নয়", en: "Not offered" })}
                  </td>
                  <td>{delivery}</td>
                  <td>
                    {s.charterDays
                      ? choose({ bn: `${bnDigits(String(s.charterDays))} দিন`, en: `${s.charterDays} days` })
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
