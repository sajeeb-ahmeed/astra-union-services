import React, { useSyncExternalStore, type ReactNode } from "react";
import workspaceBn from "./locales/workspace.bn.json" with { type: "json" };
import workspaceEn from "./locales/workspace.en.json" with { type: "json" };
import publicBn from "./locales/public.bn.json" with { type: "json" };
import publicEn from "./locales/public.en.json" with { type: "json" };

export type Language = "bn" | "en";
const dictionaries: Record<Language, Record<string, string>> = {
  bn: { ...workspaceBn, ...publicBn },
  en: { ...workspaceEn, ...publicEn },
};
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
let language: Language = "en";
try {
  language = localStorage.getItem("astra.language") === "bn" ? "bn" : "en";
} catch {
  /* Storage is optional. */
}
const listeners = new Set<() => void>();
function applyLanguage() {
  if (typeof document !== "undefined") document.documentElement.lang = language;
}
applyLanguage();
export function setLanguage(next: Language) {
  if (next !== "bn" && next !== "en") return;
  language = next;
  try {
    localStorage.setItem("astra.language", next);
  } catch {
    /* Private browsing still supports switching. */
  }
  applyLanguage();
  listeners.forEach((listener) => listener());
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === "astra.language")
      setLanguage(event.newValue === "bn" ? "bn" : "en");
  });
}
export function useLanguage(): [Language, typeof setLanguage] {
  return [
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      () => language,
      () => "en" as Language,
    ),
    setLanguage,
  ];
}
export function choose(value: { bn?: string; en?: string }): string {
  return value[language] || value.en || value.bn || "";
}
export function recordName(value: any): string {
  return (
    choose({
      bn: value?.nameBn || value?.name_bn,
      en: value?.nameEn || value?.name_en,
    }) ||
    value?.name ||
    ""
  );
}
export function t(text: string): string {
  const key = normalize(text);
  const translated = Object.hasOwn(dictionaries[language], key) ? dictionaries[language][key] : undefined;
  const preserveSpacing = (value: string) =>
    (text.match(/^\s*/)?.[0] || "") + value + (text.match(/\s*$/)?.[0] || "");
  if (translated !== undefined) return preserveSpacing(translated);
  // Existing bilingual source labels remain one canonical entry, without guessing place names.
  const parts = key.split(" / ");
  if (parts.length === 2) {
    const bangla = parts.filter((part) => /[\u0980-\u09ff]/.test(part));
    const english = parts.filter(
      (part) => !/[\u0980-\u09ff]/.test(part) && /[a-z]/i.test(part),
    );
    if (bangla.length === 1 && english.length === 1)
      return preserveSpacing(language === "bn" ? bangla[0] : english[0]);
  }
  return text;
}
/** Translate display text only; identifiers, API values, and entered data are never rewritten. */
export function tx(value: ReactNode): ReactNode {
  if (typeof value === "string") return t(value);
  if (Array.isArray(value)) return value.map(tx);
  return value;
}
export function LanguageSwitcher() {
  const [current, change] = useLanguage();
  return (
    <div className="language-switch" role="group" aria-label="Language / ভাষা">
      <button
        type="button"
        lang="bn"
        aria-pressed={current === "bn"}
        onClick={() => change("bn")}
      >
        বাংলা
      </button>
      <button
        type="button"
        lang="en"
        aria-pressed={current === "en"}
        onClick={() => change("en")}
      >
        English
      </button>
    </div>
  );
}
