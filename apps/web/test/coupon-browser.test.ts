import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { chromium, type Browser } from "playwright";
import { workspacePage, goToWorkspacePage } from "./fixtures/workspace-nav.js";
const origin = "http://127.0.0.1:5173";
async function browserInstance(): Promise<Browser> {
  const local = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const executable =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (fs.existsSync(local)
      ? fs
          .readdirSync(local)
          .filter((name) => /^chromium-/.test(name))
          .sort()
          .reverse()
          .map((name) => path.join(local, name, "chrome-win64", "chrome.exe"))
          .find((filename) => fs.existsSync(filename))
      : undefined);
  return chromium.launch({ headless: true, executablePath: executable });
}

test(
  "coupon browser: an office admin creates a coupon, sees it listed and switches it off",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    // A separate office keeps the shared demo offices free of test coupons.
    const slug = `coupon-browser-${Date.now()}`;
    const adminPassword = randomBytes(18).toString("base64url");
    const owner = await browser.newContext();
    const login = await owner.request.post(`${origin}/api/v1/auth/login`, {
      data: { email: "owner@astra.demo.test", password: "Demo-Phase1!" },
    });
    const created = await owner.request.post(`${origin}/api/v1/owner/tenants`, {
      headers: { "X-CSRF-Token": (await login.json()).csrfToken },
      data: {
        slug,
        nameBn: "কুপন ব্রাউজার অফিস",
        nameEn: "Coupon Browser Office",
        division: "Test Division",
        district: "Test District",
        upazila: "Test Upazila",
        officeType: "UNION",
        adminEmail: `admin@${slug}.test`,
        adminName: "Synthetic coupon admin",
        adminPassword,
      },
    });
    assert.equal(created.status(), 201, await created.text());
    await owner.close();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    try {
      await page.goto(`${origin}/login`);
      await page.getByLabel("Email", { exact: true }).fill(`admin@${slug}.test`);
      await page.getByLabel("Password", { exact: true }).fill(adminPassword);
      await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
      await goToWorkspacePage(page, "Office administration");
      await page.getByRole("tab", { name: "Coupons", exact: true }).click();
      await page.getByLabel("Code", { exact: true }).fill("welcome10");
      await page.getByLabel("Discount (%)", { exact: true }).fill("10");
      await page.getByLabel("Maximum uses (optional)", { exact: true }).fill("5");
      await page.getByRole("button", { name: "Create coupon", exact: true }).click();
      await page.getByText("Coupon created.", { exact: true }).waitFor();
      const row = page.locator(".coupon-settings tbody tr", { hasText: "WELCOME10" });
      assert.deepEqual(await row.locator("td").allInnerTexts().then((cells) => cells.slice(0, 2)), ["10%", "0 / 5"]);
      await row.getByRole("button", { name: "Switch off: WELCOME10", exact: true }).click();
      await page.getByText("Coupon switched off.", { exact: true }).waitFor();
      await row.getByRole("button", { name: "Switch on: WELCOME10", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    } finally {
      await browser.close();
    }
  },
);
