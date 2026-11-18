import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}

test(
  "owner branding browser: section nav, branding edit reaches the workspace brand, the audit history and the public shell",
  { timeout: 120000 },
  async () => {
    const browser = await browserInstance();
    const stamp = Date.now();
    const newName = `Brand Test ${stamp}`;
    const owner = await browser.newContext();
    try {
      const login = await owner.request.post(`${origin}/api/v1/auth/login`, {
        data: { email: "owner@astra.demo.test", password: "Demo-Phase1!" },
      });
      assert.equal(login.status(), 200, await login.text());
      const csrf = (await login.json()).csrfToken;
      const original = await (
        await owner.request.get(`${origin}/api/v1/owner/branding`)
      ).json();
      try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.addInitScript(() => {
          if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en");
        });
        await signIn(page, "owner@astra.demo.test", "Demo-Phase1!");
        await goToWorkspacePage(page, "Platform management");
        // The §3.9 section nav is present with all six sections.
        const nav = page.getByRole("navigation", { name: "Platform management sections" });
        for (const name of ["Overview", "Offices", "Subscriptions", "Pricing", "Permissions", "Audit"])
          await nav.getByRole("link", { name, exact: true }).waitFor();
        await page
          .locator("#owner-overview")
          .getByRole("heading", { name: "Overview", exact: true })
          .waitFor();
        await page
          .locator("#owner-audit")
          .getByRole("heading", { name: "Audit", exact: true })
          .waitFor();
        // Edit the branding from the Overview section.
        const brandingPanel = page
          .locator("#owner-overview")
          .locator("section.panel")
          .filter({ has: page.getByRole("heading", { name: "Branding", exact: true }) });
        await brandingPanel.getByLabel("Platform name", { exact: true }).fill(newName);
        await brandingPanel
          .getByLabel("Tagline (English)", { exact: true })
          .fill("Browser test tagline");
        await brandingPanel.getByLabel("Reason", { exact: true }).fill("Browser branding test");
        await brandingPanel.getByRole("button", { name: "Save branding", exact: true }).click();
        await brandingPanel.getByText("Branding updated.").waitFor();
        // The workspace sidebar brand picks the new name up without a reload.
        await page.locator("aside .brand").getByText(newName).waitFor();
        // After a reload the Audit section's settings history lists the change.
        await page.reload();
        await goToWorkspacePage(page, "Platform management");
        await page.locator("#owner-audit").getByText(newName).first().waitFor();
        // A signed-out visitor sees the new name in the public shell footer.
        const visitor = await browser.newContext();
        const publicPage = await visitor.newPage();
        await publicPage.goto(`${origin}/login`);
        await publicPage.locator(".du-footer-lockup strong", { hasText: newName }).waitFor();
        await visitor.close();
        await context.close();
      } finally {
        // Restore whatever branding was in force before this test, via the API.
        const restored = await owner.request.put(`${origin}/api/v1/owner/branding`, {
          headers: { "X-CSRF-Token": csrf },
          data: { ...original, reason: "Browser branding test restore" },
        });
        assert.equal(restored.status(), 200, await restored.text());
      }
    } finally {
      await browser.close();
    }
  },
);
