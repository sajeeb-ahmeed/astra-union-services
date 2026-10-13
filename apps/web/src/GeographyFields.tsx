import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, t, useLanguage, tx } from "./i18n.js";

export type GeographyValue = {
  divisionCode: string;
  districtCode: string;
  upazilaCode: string;
  unionCode: string;
  wardCode: string;
};
export const emptyGeography = (): GeographyValue => ({
  divisionCode: "",
  districtCode: "",
  upazilaCode: "",
  unionCode: "",
  wardCode: "",
});
export function geographyPayload(
  value: GeographyValue,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter(([, code]) => code !== ""),
  );
}
export function readGeography(
  value: Partial<GeographyValue> | null | undefined,
): GeographyValue {
  return Object.fromEntries(
    Object.keys(emptyGeography()).map((key) => [
      key,
      value?.[key as keyof GeographyValue] || "",
    ]),
  ) as GeographyValue;
}
type Place = {
  code: string;
  nameEn: string;
  nameBn: string;
  parentCode?: string;
};
const levels = [
  {
    key: "divisionCode",
    endpoint: "divisions",
    id: "division",
    label: "বিভাগ / Division",
  },
  {
    key: "districtCode",
    endpoint: "districts",
    id: "district",
    label: "জেলা / District",
  },
  {
    key: "upazilaCode",
    endpoint: "upazilas",
    id: "upazila",
    label: "উপজেলা / Upazila",
  },
  {
    key: "unionCode",
    endpoint: "unions",
    id: "union",
    label: "ইউনিয়ন / Union",
  },
  { key: "wardCode", endpoint: "wards", id: "ward", label: "ওয়ার্ড / Ward" },
] as const;
const lookupCache = new Map<string, Promise<Place[]>>();
function lookup(path: string): Promise<Place[]> {
  let promise = lookupCache.get(path);
  if (!promise) {
    if (lookupCache.size >= 384)
      lookupCache.delete(lookupCache.keys().next().value!);
    promise = api<{ items: Place[] }>(path)
      .then((response) => response.items)
      .catch((error) => {
        lookupCache.delete(path);
        throw error;
      });
    lookupCache.set(path, promise);
  }
  return promise;
}
function GeographySelect({
  level,
  parentCode,
  value,
  onChange,
  prefix,
  required,
  disabled,
}: {
  level: (typeof levels)[number];
  parentCode: string | undefined;
  value: string;
  onChange: (code: string) => void;
  prefix: string;
  required: boolean;
  disabled: boolean;
}) {
  const path =
    parentCode === ""
      ? ""
      : `/geography/${level.endpoint}${parentCode ? `?parentCode=${encodeURIComponent(parentCode)}` : ""}`;
  const [request, setRequest] = useState({
    path: "",
    items: [] as Place[],
    error: "",
    pending: false,
  });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!path) return;
    let active = true;
    setRequest({ path, items: [], error: "", pending: true });
    lookup(path)
      .then((items) => {
        if (active) setRequest({ path, items, error: "", pending: false });
      })
      .catch((error) => {
        if (active)
          setRequest({ path, items: [], error: error.message, pending: false });
      });
    return () => {
      active = false;
    };
  }, [path, retry]);
  const current =
    request.path === path ? request : { items: [], error: "", pending: !!path };
  const id = `${prefix}-${level.id}`;
  const empty =
    !!path && !current.pending && !current.error && current.items.length === 0;
  return (
    <div className="geography-field">
      <label htmlFor={id}>
        {tx(level.label)}
        {tx(required && <span aria-hidden="true">{t(" *")}</span>)}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        disabled={
          disabled || !path || current.pending || !!current.error || empty
        }
        aria-busy={current.pending}
        aria-describedby={empty || current.error ? `${id}-help` : undefined}
      >
        <option value="">
          {tx(
            current.pending
              ? "লোড হচ্ছে / Loading…"
              : !path
                ? "আগের ধাপ বেছে নিন / Select parent first"
                : empty
                  ? "তথ্য নেই / No records available"
                  : "বেছে নিন / Select",
          )}
        </option>
        {tx(
          current.items.map((place) => (
            <option key={place.code} value={place.code}>
              {choose({ bn: place.nameBn, en: place.nameEn })}
            </option>
          )),
        )}
      </select>
      {tx(
        current.error && (
          <div id={`${id}-help`} className="geography-error" role="alert">
            {t("Locations could not be loaded.")}
            {tx(" ")}
            <button
              type="button"
              className="text-button"
              onClick={() => setRetry((v) => v + 1)}
            >
              {t("Retry ")}
              {tx(level.id)}
            </button>
          </div>
        ),
      )}
      {tx(
        empty && (
          <small id={`${id}-help`} className="hint">
            {t("This dataset has no ")}
            {tx(level.id)}
            {t(
              " records for the selected area. Contact the office to confirm coverage. ",
            )}
          </small>
        ),
      )}
    </div>
  );
}
export function GeographyFields({
  value,
  onChange,
  prefix,
  through = "ward",
  required = false,
  disabled = false,
  legend = "ঠিকানা নির্বাচন / Administrative area",
  showCoverage = false,
}: {
  value: GeographyValue;
  onChange: (value: GeographyValue) => void;
  prefix: string;
  through?: "upazila" | "union" | "ward";
  required?: boolean;
  disabled?: boolean;
  legend?: string;
  showCoverage?: boolean;
}) {
  useLanguage();
  const count = through === "ward" ? 5 : through === "union" ? 4 : 3;
  return (
    <fieldset className="geography-fields" disabled={disabled}>
      <legend>{t(legend)}</legend>
      <div className="geography-grid">
        {tx(
          levels.slice(0, count).map((level, index) => (
            <GeographySelect
              key={level.key}
              level={level}
              parentCode={
                index === 0 ? undefined : value[levels[index - 1].key]
              }
              value={value[level.key]}
              prefix={prefix}
              required={required}
              disabled={disabled}
              onChange={(code) => {
                const next = { ...value, [level.key]: code };
                levels.slice(index + 1).forEach((child) => {
                  next[child.key] = "";
                });
                onChange(next);
              }}
            />
          )),
        )}
      </div>
      {tx(
        showCoverage && (
          <p className="hint geography-coverage">
            {t(
              "বাংলাদেশের গ্রামীণ প্রশাসনিক এলাকা নির্বাচন করুন। Urban municipalities and city wards are not included. Ward numbers 1–9 are derived for each union; confirm your ward with the office. ",
            )}
          </p>
        ),
      )}
    </fieldset>
  );
}
