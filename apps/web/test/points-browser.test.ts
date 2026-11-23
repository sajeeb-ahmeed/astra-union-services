import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { workspacePage, goToWorkspacePage } from "./fixtures/workspace-nav.js";
import { signOut } from "./fixtures/session.js";
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
async function signIn(page: Page, email: string) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email or mobile number", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}

test(
  "pricing browser: the owner publishes a credit price and adjusts an office's points; the office sees its points wallet",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    // Service 47's credit price is global: the test restores it to the default (1) before finishing.
    try {
      await signIn(page, "owner@astra.demo.test");
      await goToWorkspacePage(page, "Platform management");
      // OWNER-REDESIGN-01: the pricing table lives in the Pricing section.
      await page.locator('.owner-nav a[href="#owner-pricing"]').click();
      const prices = page.locator(".owner-pricing");
      await prices.waitFor();
      const row = prices.locator("tbody tr").nth(46);
      await row.getByLabel("New price", { exact: true }).fill("3");
      await row.getByLabel("Reason for the change", { exact: true }).fill("Synthetic browser test price");
      await row.getByRole("button", { name: "Publish", exact: true }).click();
      await prices.getByText("Credit price published.", { exact: true }).waitFor();
      await row.getByLabel("New price", { exact: true }).fill("1");
      await row.getByLabel("Reason for the change", { exact: true }).fill("Restore the default price");
      await row.getByRole("button", { name: "Publish", exact: true }).click();
      await prices.getByText("Credit price published.", { exact: true }).waitFor();
      await page.waitForFunction(
        () => (document.querySelectorAll(".owner-pricing tbody tr")[46]?.querySelector("input") as HTMLInputElement)?.value === "1",
      );

      // OWNER-REDESIGN-01: office cards live in the Offices section.
      await page.locator('.owner-nav a[href="#owner-offices"]').click();
      const card = page.locator(".tenant-card", { hasText: "Alpha Union" }).first();
      await card.locator("summary", { hasText: "Points wallet" }).click();
      const form = card.locator(".points-adjust");
      await form.getByText(/Current balance: \d/).waitFor();
      await form.getByLabel("Points", { exact: true }).fill("1.25");
      await form.getByLabel("Reason", { exact: true }).fill("Synthetic browser test credit");
      await form.getByRole("button", { name: "Adjust", exact: true }).click();
      await form.getByText("Points adjusted.", { exact: true }).waitFor();
      await signOut(page);

      await signIn(page, "admin@alpha.local.test");
      await goToWorkspacePage(page, "Subscription & credits");
      const wallet = page.locator(".points-wallet");
      await wallet.getByRole("heading", { name: "Points wallet", exact: true }).waitFor();
      await wallet.getByText("Adjustment", { exact: true }).first().waitFor();
      assert.match(await wallet.getByTestId("points-balance").innerText(), /^\d+\.\d{2}$/);
      await signOut(page);

      // Take the test credit back out so the shared demo office is unchanged.
      await signIn(page, "owner@astra.demo.test");
      await goToWorkspacePage(page, "Platform management");
      await page.locator('.owner-nav a[href="#owner-offices"]').click();
      const again = page.locator(".tenant-card", { hasText: "Alpha Union" }).first();
      await again.locator("summary", { hasText: "Points wallet" }).click();
      const back = again.locator(".points-adjust");
      await back.getByText(/Current balance: \d/).waitFor();
      await back.getByLabel("Direction", { exact: true }).selectOption("debit");
      await back.getByLabel("Points", { exact: true }).fill("1.25");
      await back.getByLabel("Reason", { exact: true }).fill("Reverse synthetic browser test credit");
      await back.getByRole("button", { name: "Adjust", exact: true }).click();
      await back.getByText("Points adjusted.", { exact: true }).waitFor();
    } finally {
      await browser.close();
    }
  },
);
