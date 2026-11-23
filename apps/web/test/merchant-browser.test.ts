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
  "merchant browser: an office admin saves SSLCommerz sandbox credentials; the password is never shown again",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    const slug = `merchant-browser-${Date.now()}`;
    const adminPassword = randomBytes(12).toString("base64url");
    const storePassword = randomBytes(10).toString("hex");
    const owner = await browser.newContext();
    const login = await owner.request.post(`${origin}/api/v1/auth/login`, {
      data: { email: "owner@astra.demo.test", password: "Demo-Phase1!" },
    });
    const created = await owner.request.post(`${origin}/api/v1/owner/tenants`, {
      headers: { "X-CSRF-Token": (await login.json()).csrfToken },
      data: {
        slug,
        nameBn: "মার্চেন্ট ব্রাউজার অফিস",
        nameEn: "Merchant Browser Office",
        division: "Test Division",
        district: "Test District",
        upazila: "Test Upazila",
        officeType: "UNION",
        adminEmail: `admin@${slug}.test`,
        adminName: "Synthetic merchant admin",
        adminPassword,
      },
    });
    assert.equal(created.status(), 201, await created.text());
    await owner.close();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    try {
      await page.goto(`${origin}/login`);
      await page.getByLabel("Email or mobile number", { exact: true }).fill(`admin@${slug}.test`);
      await page.getByLabel("Password", { exact: true }).fill(adminPassword);
      await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
      await goToWorkspacePage(page, "Office administration");
      await page.getByRole("tab", { name: "Online payments", exact: true }).click();
      const panel = page.locator(".sslcommerz-merchant");
      await panel.getByTestId("merchant-status").getByText("Not set up").waitFor();
      await panel.getByLabel("Store ID", { exact: true }).fill("astra-browser-test");
      await panel.getByLabel("Store password", { exact: true }).fill(storePassword);
      await panel.getByRole("button", { name: "Save", exact: true }).click();
      await panel.getByText("Saved.", { exact: true }).waitFor();
      await panel.getByTestId("merchant-status").getByText("Active").waitFor();
      assert.equal(await panel.getByLabel("Store password", { exact: true }).inputValue(), "");
      assert.equal((await page.content()).includes(storePassword), false);
      await page.reload();
      await goToWorkspacePage(page, "Office administration");
      await page.getByRole("tab", { name: "Online payments", exact: true }).click();
      await panel.getByTestId("merchant-status").getByText("Active").waitFor();
      assert.equal(await panel.getByLabel("Store ID", { exact: true }).inputValue(), "astra-browser-test");
      assert.equal((await page.content()).includes(storePassword), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      // The office's own bKash merchant, in the same tab.
      const bkash = page.locator(".bkash-merchant");
      await bkash.getByTestId("bkash-status").getByText("Not set up").waitFor();
      await bkash.getByLabel("Merchant number", { exact: true }).fill("01712345678");
      for (const field of ["App key", "App secret", "Username", "Password"])
        await bkash.getByLabel(field, { exact: true }).fill(`${field.replace(" ", "-")}-${storePassword}`);
      await bkash.getByRole("button", { name: "Save", exact: true }).click();
      await bkash.getByTestId("bkash-status").getByText("Active").waitFor();
      assert.equal((await page.content()).includes(storePassword), false);
      // Phase 5d: the office's refund panel is on the billing page for admin and finance.
      await goToWorkspacePage(page, "Subscription & credits");
      await page.locator(".office-refunds").getByText("No refund requests.", { exact: true }).waitFor();
    } finally {
      await browser.close();
    }
  },
);
