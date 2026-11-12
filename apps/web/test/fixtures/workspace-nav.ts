import type { Page } from "playwright";

/**
 * Phase 1: staff now have the UDC sidebar with different labels, so tests open workspace pages by their
 * stable page name (data-page), which the legacy and UDC sidebars share. Legacy labels are mapped here.
 */
const pageByLabel: Record<string, string> = {
  Overview: "home",
  "সেবার সারসংক্ষেপ": "home",
  "Service catalog": "services",
  "সেবার তালিকা": "services",
  Citizens: "citizens",
  "নাগরিক": "citizens",
  Applications: "applications",
  "আবেদন": "applications",
  "My profile": "profile",
  "আমার প্রোফাইল": "profile",
  "Print requests": "prints",
  "প্রিন্ট অনুরোধ": "prints",
  "Payments and receipts": "payments",
  "পেমেন্ট ও রসিদ": "payments",
  Notifications: "notifications",
  "নোটিফিকেশন": "notifications",
  "Account security": "security",
  "অ্যাকাউন্ট নিরাপত্তা": "security",
  "Subscription & credits": "billing",
  "সাবস্ক্রিপশন ও ক্রেডিট": "billing",
  Reports: "reports",
  "প্রতিবেদন": "reports",
  "Office administration": "admin",
  "অফিস ব্যবস্থাপনা": "admin",
  "Platform management": "owner",
  "প্ল্যাটফর্ম ব্যবস্থাপনা": "owner",
  "Support inbox": "support",
  "সহায়তা ইনবক্স": "support",
};

/** The sidebar entry for a workspace page, given its page name or a legacy label (string or RegExp). */
export function workspacePage(page: Page, nameOrLabel: string | RegExp) {
  const navigation = page.getByRole("navigation", { name: /Workspace navigation|কর্মক্ষেত্র/ });
  const key =
    typeof nameOrLabel === "string"
      ? (pageByLabel[nameOrLabel] ?? nameOrLabel)
      : Object.entries(pageByLabel).find(([label]) => nameOrLabel.test(label))?.[1];
  return navigation.locator(`[data-page="${key}"]`);
}
