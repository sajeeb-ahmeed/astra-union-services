import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
  "record lists browser: staff narrow applications by date range and renewals",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    try {
      await page.goto(`${origin}/login`);
      await page.getByLabel("Email", { exact: true }).fill("staff@alpha.local.test");
      await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
      await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
      await goToWorkspacePage(page, "Applications");
      const count = page.locator(".application-filter-tools [role=status]");
      await count.waitFor();
      const loaded = page.waitForResponse((r) => r.url().includes("/applications?") && r.url().includes("to=2000-01-02"));
      await page.getByLabel("From date", { exact: true }).fill("2000-01-01");
      await page.getByLabel("To date", { exact: true }).fill("2000-01-02");
      await loaded;
      await count.getByText(/^0 applications$/).waitFor();
      const renewals = page.waitForResponse((r) => r.url().includes("renewal=true"));
      await page.getByLabel("From date", { exact: true }).fill("");
      await page.getByLabel("To date", { exact: true }).fill("");
      await page.getByLabel("Renewals only", { exact: true }).check();
      assert.equal((await renewals).status(), 200);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    } finally {
      await browser.close();
    }
  },
);
