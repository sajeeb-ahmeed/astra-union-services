/**
 * Phase 1 slice (ii): the UDC (office data-entry) sidebar, in the reference pattern's order, mapped onto
 * Astra's existing workspace pages. Items Astra does not have yet stay visible but disabled with the phase
 * that delivers them, instead of pointing at pages that do not exist.
 */
export type WorkspaceNavItem = {
  key: string;
  bn: string;
  en: string;
  /** Existing workspace page to open, optionally with an application state filter. */
  page?: string;
  state?: string;
  /** Plain link outside the workspace. */
  href?: string;
  /** Not built yet: shown disabled with this note. */
  soon?: { bn: string; en: string };
};

const later = (phase: string) => ({
  bn: `শীঘ্রই (${phase})`,
  en: `Coming in ${phase}`,
});

export const udcNavigation: readonly WorkspaceNavItem[] = [
  { key: "dashboard", bn: "ড্যাশবোর্ড", en: "Dashboard", page: "home" },
  { key: "profile", bn: "প্রোফাইল", en: "Profile", page: "profile" },
  { key: "citizens", bn: "নাগরিক", en: "Citizens", page: "citizens" },
  { key: "applications", bn: "সকল আবেদন", en: "All applications", page: "applications" },
  { key: "new-application", bn: "নতুন আবেদন", en: "New application", page: "services" },
  { key: "renewal", bn: "সনদ নবায়ন", en: "Certificate renewal", page: "applications", state: "ISSUED" },
  { key: "trade-renewal", bn: "ট্রেড লাইসেন্স নবায়ন", en: "Trade licence renewal", page: "applications", state: "ISSUED" },
  { key: "biodata-print", bn: "বায়োডাটা প্রিন্ট", en: "BioData print", soon: later("Phase 6") },
  { key: "biodata-applications", bn: "বায়োডাটা আবেদন", en: "BioData applications", soon: later("Phase 6") },
  { key: "holding-print", bn: "হোল্ডিং প্রিন্ট", en: "Holding print", soon: later("Phase 6") },
  { key: "holding-applications", bn: "হোল্ডিং আবেদন", en: "Holding applications", soon: later("Phase 6") },
  { key: "print-certificate", bn: "সনদ প্রিন্ট", en: "Print certificate", page: "prints" },
  { key: "point-recharge", bn: "পয়েন্ট রিচার্জ", en: "Point recharge", soon: later("Phase 5") },
  { key: "user-guide", bn: "ব্যবহার নির্দেশিকা", en: "User guide", href: "/help" },
];

/** The new UDC shell is opt-in with ?preview=udc until the owner approves the slice. */
export const udcPreviewRequested = () =>
  new URLSearchParams(location.search).get("preview") === "udc";
