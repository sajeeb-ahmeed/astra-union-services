/**
 * The UDC (office data-entry) sidebar, in the reference pattern's order, mapped onto
 * Astra's existing workspace pages.
 * FULL-UIUX-01: unbuilt destinations are ABSENT — the former "soon (Phase N)"
 * placeholders are removed entirely; a nav item exists only when its page does.
 */
export type WorkspaceNavItem = {
  key: string;
  bn: string;
  en: string;
  /** Existing workspace page to open, optionally with an application state filter. */
  page?: string;
  state?: string;
  /** Optional service-number filter (trade-licence renewal = service 42). */
  serviceNo?: string;
  /** Plain link outside the workspace. */
  href?: string;
};

export const udcNavigation: readonly WorkspaceNavItem[] = [
  { key: "dashboard", bn: "ড্যাশবোর্ড", en: "Dashboard", page: "home" },
  { key: "profile", bn: "প্রোফাইল", en: "Profile", page: "profile" },
  { key: "citizens", bn: "নাগরিক", en: "Citizens", page: "citizens" },
  { key: "applications", bn: "সকল আবেদন", en: "All applications", page: "applications" },
  { key: "pending", bn: "অপেক্ষমাণ আবেদন", en: "Pending applications", page: "pending" },
  { key: "new-application", bn: "নতুন আবেদন", en: "New application", page: "services" },
  { key: "renewal", bn: "সনদ নবায়ন", en: "Certificate renewal", page: "applications", state: "ISSUED" },
  { key: "trade-renewal", bn: "ট্রেড লাইসেন্স নবায়ন", en: "Trade licence renewal", page: "applications", state: "ISSUED", serviceNo: "42" },
  { key: "print-certificate", bn: "সনদ প্রিন্ট", en: "Print certificate", page: "prints" },
  // Astra pages the reference list does not have; kept so staff lose nothing.
  { key: "payments", bn: "পেমেন্ট ও রসিদ", en: "Payments and receipts", page: "payments" },
  { key: "notifications", bn: "নোটিফিকেশন", en: "Notifications", page: "notifications" },
  { key: "security", bn: "অ্যাকাউন্ট সেটিংস", en: "Account settings", page: "security" },
  { key: "user-guide", bn: "ব্যবহার নির্দেশিকা", en: "User guide", page: "guide" },
];

/** Approved: the UDC sidebar is the default for the office data-entry (staff) role. */
export const usesUdcNavigation = (role: string) => role === "staff";
