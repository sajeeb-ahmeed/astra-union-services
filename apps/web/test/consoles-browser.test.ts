import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { goToWorkspacePage } from "./fixtures/workspace-nav.js";

/**
 * PORTAL-D: the office-admin and owner consoles.
 *
 *   office admin: administration opens on the office profile, the tabs follow
 *   the order an office sets itself up in, and the selected tab reads as a
 *   tab (not as the page's loudest gradient button);
 *   owner: every section of the menu is reachable without a hidden inner
 *   scroll, and a waiting-queue figure on the overview opens the panel where
 *   that queue is handled.
 */
const origin = "http://127.0.0.1:5173";

async function launch(): Promise<Browser> {
  const local = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const executable =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (fs.existsSync(local) ? fs.readdirSync(local) : [])
      .filter((n) => /^chromium-/.test(n))
      .sort()
      .reverse()
      .map((n) => path.join(local, n, "chrome-win64", "chrome.exe"))
      .find((p) => fs.existsSync(p));
  return chromium.launch({ headless: true, executablePath: executable });
}

async function signIn(page: Page, email: string) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email or mobile number", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}

test("PORTAL-D consoles: admin tabs in setup order; owner menu complete and queue figures open their panels", { timeout: 120000 }, async () => {
  const browser = await launch();
  const errors: string[] = [];
  try {
    // Office admin.
    const admin = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await admin.addInitScript(() => localStorage.setItem("astra.language", "en"));
    admin.on("pageerror", (e) => errors.push(`admin: ${e.message}`));
    await signIn(admin, "admin@alpha.local.test");
    await goToWorkspacePage(admin, "Office administration");
    const tabs = admin.getByRole("tablist", { name: "Administration sections" }).getByRole("tab");
    await tabs.first().waitFor();
    assert.deepEqual(await tabs.allInnerTexts(), [
      "Office profile",
      "Staff accounts",
      "Approval authority",
      "Service settings",
      "Application fee policies",
      "Online payments",
      "Certificate images",
      "Office notices",
      "Coupons",
    ]);
    assert.equal(await tabs.first().getAttribute("aria-selected"), "true", "opens on the office profile");
    const selectedLook = await tabs.first().evaluate((el) => getComputedStyle(el).backgroundImage);
    assert.equal(selectedLook, "none", "the selected tab is not drawn as a gradient action button");
    await admin.getByRole("tab", { name: "Staff accounts", exact: true }).click();
    assert.equal(await admin.getByRole("tab", { name: "Staff accounts", exact: true }).getAttribute("aria-selected"), "true");
    await admin.close();

    // Owner.
    const owner = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await owner.addInitScript(() => localStorage.setItem("astra.language", "en"));
    owner.on("pageerror", (e) => errors.push(`owner: ${e.message}`));
    await signIn(owner, "owner@astra.demo.test");
    const menu = owner.locator(".owner-nav");
    await menu.waitFor();
    const clipped = await menu.evaluate((nav) => nav.scrollHeight - nav.clientHeight);
    assert.ok(clipped <= 1, `the whole owner menu shows without an inner scroll (hidden ${clipped}px)`);
    const settings = owner.locator('a[href="#owner-settings"]');
    const box = (await settings.boundingBox())!;
    assert.ok(box.y + box.height <= 900, "Settings, the last section, is on screen at 1280×900");

    await owner.locator('a[href="#owner-overview"]').first().click();
    const tile = owner.locator("button.kpi-link", { hasText: "Office inclusion requests" });
    await tile.waitFor();
    await tile.click();
    const panel = owner.locator(".owner-inclusion");
    await panel.waitFor();
    await owner.waitForFunction(() => {
      const el = document.querySelector(".owner-inclusion");
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top < innerHeight && r.bottom > 0;
    });
    assert.equal(
      await owner.evaluate(() => !!document.activeElement?.closest(".owner-inclusion")),
      true,
      "focus moves to the opened panel",
    );
    await owner.close();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
