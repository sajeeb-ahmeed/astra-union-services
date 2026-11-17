import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
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
async function signIn(page: Page, email: string, password: string) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}

test(
  "recharge browser: an office sends a deposit slip, the owner rejects it with a reason, and the office sees why",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const stamp = Date.now();
    const slug = `recharge-browser-${stamp}`;
    const bank = `browser-bank-${stamp}`;
    const adminPassword = randomBytes(18).toString("base64url");
    const owner = await browser.newContext();
    const login = await owner.request.post(`${origin}/api/v1/auth/login`, {
      data: { email: "owner@astra.demo.test", password: "Demo-Phase1!" },
    });
    const csrf = (await login.json()).csrfToken;
    const created = await owner.request.post(`${origin}/api/v1/owner/tenants`, {
      headers: { "X-CSRF-Token": csrf },
      data: {
        slug,
        nameBn: "রিচার্জ ব্রাউজার অফিস",
        nameEn: `Recharge Browser Office ${stamp}`,
        division: "Test Division",
        district: "Test District",
        upazila: "Test Upazila",
        officeType: "UNION",
        adminEmail: `admin@${slug}.test`,
        adminName: "Synthetic recharge admin",
        adminPassword,
      },
    });
    assert.equal(created.status(), 201, await created.text());
    const added = await owner.request.put(`${origin}/api/v1/owner/recharge-banks/${bank}`, {
      headers: { "X-CSRF-Token": csrf },
      data: { nameBn: "ব্রাউজার পরীক্ষা ব্যাংক", nameEn: `Browser Test Bank ${stamp}`, accountName: "Astra Demo", accountNumber: "9999 8888", active: true },
    });
    assert.equal(added.status(), 200, await added.text());
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    try {
      await signIn(page, `admin@${slug}.test`, adminPassword);
      await goToWorkspacePage(page, "Subscription & credits");
      const recharge = page.locator(".recharge");
      await recharge.getByLabel("Deposit account", { exact: true }).selectOption(bank);
      await recharge.getByText("9999 8888").waitFor();
      await recharge.getByLabel("Amount deposited (BDT)", { exact: true }).fill("500");
      await recharge.getByLabel("Deposit reference", { exact: true }).fill(`TXN-${stamp}`);
      const jpeg = Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.alloc(64, 3), Buffer.from([255, 217])]);
      await recharge.getByLabel("Deposit slip", { exact: true }).setInputFiles({ name: "slip.jpg", mimeType: "image/jpeg", buffer: jpeg });
      await recharge.getByRole("button", { name: "Send recharge request", exact: true }).click();
      await recharge.getByText(/Request sent\./).waitFor();
      const row = recharge.locator("tbody tr", { hasText: `TXN-${stamp}` });
      await row.getByText("Waiting for confirmation").waitFor();
      assert.match(await row.innerText(), /500\.00/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await signOut(page);

      await signIn(page, "owner@astra.demo.test", "Demo-Phase1!");
      await goToWorkspacePage(page, "Platform management");
      const item = page.locator(".owner-recharges .recharge-item", { hasText: `TXN-${stamp}` });
      await item.waitFor();
      // Rejecting without a reason is refused by the server.
      await item.getByRole("button", { name: "Reject", exact: true }).click();
      await page.locator(".owner-recharges [role=status]").first().waitFor();
      await item.locator("input").fill("Deposit not on the statement");
      await item.getByRole("button", { name: "Reject", exact: true }).click();
      await page.getByText("Rejected.", { exact: true }).waitFor();
      await item.waitFor({ state: "detached" });
      await signOut(page);

      await signIn(page, `admin@${slug}.test`, adminPassword);
      await goToWorkspacePage(page, "Subscription & credits");
      await page
        .locator(".recharge tbody tr", { hasText: `TXN-${stamp}` })
        .getByText("Rejected · Deposit not on the statement")
        .waitFor();
    } finally {
      await owner.request.put(`${origin}/api/v1/owner/recharge-banks/${bank}`, {
        headers: { "X-CSRF-Token": csrf },
        data: { nameBn: "ব্রাউজার পরীক্ষা ব্যাংক", nameEn: `Browser Test Bank ${stamp}`, accountName: "Astra Demo", accountNumber: "9999 8888", active: false },
      });
      await owner.close();
      await browser.close();
    }
  },
);
