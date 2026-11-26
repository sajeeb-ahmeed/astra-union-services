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
  "Account settings": "security",
  "অ্যাকাউন্ট সেটিংস": "security",
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

/**
 * Navigate to a workspace page in either layout: on wide screens the sidebar entry is clicked; on phone
 * widths the sidebar is hidden by design and the bottom tab bar is the navigation (FULL-UIUX-01 B27
 * deleted the #workspace-jump select). The tab bar carries the role's primary destinations as direct
 * tabs (data-tab); every visible page is also listed in the "More" sheet (data-page).
 */
export async function goToWorkspacePage(page: Page, nameOrLabel: string | RegExp) {
  const key =
    typeof nameOrLabel === "string"
      ? (pageByLabel[nameOrLabel] ?? nameOrLabel)
      : Object.entries(pageByLabel).find(([label]) => nameOrLabel.test(label))?.[1];
  // The layout switch is a pure function of viewport width (767px band), so decide from the
  // viewport rather than racing element visibility while the shell mounts.
  const width = page.viewportSize()?.width ?? 1280;
  if (width <= 767) {
    const sheetEntry = page.locator(`.ws-tab-sheet button[data-page="${key}"]`);
    if (await sheetEntry.isVisible().catch(() => false)) {
      await sheetEntry.click();
      return;
    }
    const directTab = page.locator(`.ws-tabbar button[data-tab="${key}"]`);
    if (await directTab.count()) {
      await directTab.click();
      return;
    }
    await page.locator('.ws-tabbar button[data-tab="more"]').click();
    await sheetEntry.click();
    return;
  }
  const entry = workspacePage(page, nameOrLabel);
  if (!(await entry.isVisible().catch(() => false))) {
    // FULL-UIUX-01: on the owner console page the workspace sidebar
    // collapses to the brand strip (`.shell-owner` sets the aside nav to
    // display:none), so its entries are present but hidden. The platform
    // owner lands on that page at sign-in — when the target entry is
    // already the current page, navigation is a no-op.
    // The check must go through a plain CSS locator: role queries exclude
    // display:none subtrees from the accessibility tree, so the
    // role-scoped `entry` can never resolve in owner mode (its
    // getAttribute would just burn the full timeout).
    const plain = page.locator(`[data-page="${key}"]`);
    // Step 0 (b): a detail sub-view (e.g. #/applications/<id>) is NOT the
    // list page — the Applications entry carries aria-current="page" on the
    // detail view too. Right after a reload on a detail view the entry is
    // not yet in the DOM, the poll below sees aria-current and returns
    // early, and the detail stays open forever (browser.test.ts test 1
    // timed out at openById for exactly this reason). A detail-open URL
    // therefore disables the no-op: fall through to the click, whose
    // handler closes the detail (setDetail(null)) and shows the list.
    const detailOpen =
      key === "applications" && /#\/applications\/[^/?#]+/.test(page.url());
    // Poll briefly: right after a reload the shell may not have rendered
    // the nav yet, so a single immediate check can miss the marker.
    for (let attempt = 0; attempt < 40; attempt++) {
      const total = await plain.count();
      let isCurrent = false;
      for (let i = 0; i < total; i++) {
        if (
          (await plain
            .nth(i)
            .getAttribute("aria-current")
            .catch(() => null)) === "page"
        ) {
          isCurrent = true;
          break;
        }
      }
      if (isCurrent && !detailOpen) return;
      if (await entry.isVisible().catch(() => false)) break;
      await page.waitForTimeout(250);
    }
  }
  await entry.click();
}
