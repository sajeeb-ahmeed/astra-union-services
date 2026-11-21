import { useLanguage, type Language } from "../i18n.js";

/**
 * FULL-UIUX-01 locale lock (checklist B21 / programme 14–15): in the Bangla
 * UI every rendered number, date and timestamp uses Bengali digits and the
 * Bengali long form; in the English UI, Latin digits and en-GB forms. Raw
 * ISO strings and US-format timestamps never reach the screen.
 */
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

export function localDigits(value: string | number, language: Language): string {
  const text = String(value);
  return language === "bn"
    ? text.replace(/\d/g, (d) => BN_DIGITS[Number(d)])
    : text;
}

export function formatDate(iso: string | null | undefined, language: Language): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(language === "bn" ? "bn-BD" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined, language: Language): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const rendered = date.toLocaleString(language === "bn" ? "bn-BD" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  // B21 locale lock: some ICU builds render the bn-BD day period in Latin
  // letters ("AM"/"PM"). The Bangla UI never shows a Latin day period.
  if (language === "bn")
    return rendered
      .replace(/\bAM\b/g, "পূর্বাহ্ণ")
      .replace(/\bPM\b/g, "অপরাহ্ণ");
  return rendered;
}

/** Hook form for components: re-renders with the language and binds it in. */
export function useFormatters() {
  const [language] = useLanguage();
  return {
    language,
    digits: (value: string | number) => localDigits(value, language),
    date: (iso: string | null | undefined) => formatDate(iso, language),
    dateTime: (iso: string | null | undefined) => formatDateTime(iso, language),
  };
}
