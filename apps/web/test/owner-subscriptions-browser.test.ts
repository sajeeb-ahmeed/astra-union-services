import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright";
import { goToWorkspacePage } from "./fixtures/workspace-nav.js";
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
async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email or mobile number", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}

test(
  "owner subscriptions browser: badge, panel activation and manual order settlement from the owner page",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const stamp = Date.now();
    const slug = `sub-browser-${stamp}`;
    const officeName = `Subscription Browser Office ${stamp}`;
    const adminPassword = randomBytes(12).toString("base64url");
    // Arrange through the API: a fresh office (subscription EXPIRED) with one PENDING subscription order.
    const owner = await browser.newContext();
    const login = await owner.request.post(`${origin}/api/v1/auth/login`, {
      data: { email: "owner@astra.demo.test", password: "Demo-Phase1!" },
    });
    assert.equal(login.status(), 200, await login.text());
    const csrf = (await login.json()).csrfToken;
    const created = await owner.request.post(`${origin}/api/v1/owner/tenants`, {
      headers: { "X-CSRF-Token": csrf },
      data: {
        slug,
        nameBn: "সাবস্ক্রিপশন ব্রাউজার অফিস",
        nameEn: officeName,
        division: "Test Division",
        district: "Test District",
        upazila: "Test Upazila",
        officeType: "UNION",
        adminEmail: `admin@${slug}.test`,
        adminName: "Subscription Browser Admin",
        adminPassword,
      },
    });
    assert.equal(created.status(), 201, await created.text());
    const office = await created.json();
    const adminLogin = await owner.request.post(`${origin}/api/v1/auth/login`, {
      data: { email: `admin@${slug}.test`, password: adminPassword },
    });
    assert.equal(adminLogin.status(), 200, await adminLogin.text());
    const adminCsrf = (await adminLogin.json()).csrfToken;
    // The office-admin login replaced the owner session in this context's cookie jar;
    // billing calls use the admin session, owner assertions re-login afterwards.
    const orderResponse = await owner.request.post(`${origin}/api/v1/billing/orders`, {
      headers: { "X-CSRF-Token": adminCsrf },
      data: { kind: "subscription", planId: "standard-monthly" },
    });
    assert.equal(orderResponse.status(), 201, await orderResponse.text());
    const order = await orderResponse.json();

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => {
      if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en");
    });
    try {
      await signIn(page, "owner@astra.demo.test", "Demo-Phase1!");
      await goToWorkspacePage(page, "Platform management");
      // OWNER-REDESIGN-01: onboarding + office cards live in the Offices section.
      await page.locator('.owner-nav a[href="#owner-offices"]').click();
      // The onboarding form offers activation on approval.
      await page.getByLabel("Activate subscription now", { exact: true }).waitFor();
      // The office card shows the expired badge; the panel activates it.
      const card = page
        .locator(".tenant-card")
        .filter({ hasText: officeName })
        .filter({ has: page.locator(".subscription-panel") });
      await card.locator(".subscription-badge").getByText("Expired").waitFor();
      const panel = card.locator(".subscription-panel");
      await panel.getByLabel("Subscription reason", { exact: true }).fill("Browser test activation");
      await panel.getByRole("button", { name: "Activate", exact: true }).click();
      await card.locator(".subscription-badge").getByText("Active").waitFor();
      await panel.getByText("Subscription updated.").waitFor();
      // The pending order is listed with the office name; settle it from the page.
      // OWNER-REDESIGN-01: payment orders live in the Subscriptions section.
      await page.locator('.owner-nav a[href="#owner-subscriptions"]').click();
      const ordersSection = page
        .locator("section.panel")
        .filter({ has: page.getByRole("heading", { name: "Payment orders", exact: true }) });
      const orderCard = ordersSection.locator(".tenant-card").filter({ hasText: officeName });
      await orderCard.getByText("standard-monthly").waitFor();
      await orderCard.getByLabel("Order reason", { exact: true }).fill("Browser test settlement");
      await orderCard.getByRole("button", { name: "Settle", exact: true }).click();
      await orderCard.waitFor({ state: "detached" });
      // Server state agrees: order SETTLED, subscription ACTIVE, wallet holds both grants (20 + 20).
      const relogin = await owner.request.post(`${origin}/api/v1/auth/login`, {
        data: { email: "owner@astra.demo.test", password: "Demo-Phase1!" },
      });
      assert.equal(relogin.status(), 200, await relogin.text());
      const tenants = await (await owner.request.get(`${origin}/api/v1/owner/tenants`)).json();
      const mine = tenants.items.find((t: any) => t.id === office.id);
      assert.equal(mine.subscription.status, "ACTIVE");
      assert.equal(mine.balance, 40);
      const settled = await (
        await owner.request.get(`${origin}/api/v1/owner/payment-orders?status=SETTLED`)
      ).json();
      assert.ok(
        settled.items.some((o: any) => o.id === order.id),
        "the settled order is listed as SETTLED for the owner",
      );
    } finally {
      await browser.close();
    }
  },
);
