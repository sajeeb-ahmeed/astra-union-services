import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { workspacePage } from "./fixtures/workspace-nav.js";
import { chromium, type Browser } from "playwright";
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
  "Phase 2a account types: an office admin creates an account by post and sees its role",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    try {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem("astra.language", "en"));
      await page.goto(`${origin}/login`);
      await page.getByLabel("Email", { exact: true }).fill("admin@alpha.demo.test");
      await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
      await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
      await workspacePage(page, "Office administration").click();

      const post = page.getByLabel("Office post", { exact: true });
      await post.locator("option", { hasText: "UP Secretary" }).waitFor({ state: "attached" });
      // Only posts that exist in this (union) office are offered.
      assert.equal(await post.locator("option", { hasText: "Municipality Mayor" }).count(), 0);
      assert.equal(await page.getByLabel("Staff role", { exact: true }).count(), 1);
      await post.selectOption("up_secretary");
      assert.equal(await page.getByLabel("Staff role", { exact: true }).count(), 0, "a post fixes the role");

      const email = `secretary-${Date.now()}@alpha.demo.test`;
      await page.getByLabel("Staff email", { exact: false }).fill(email);
      await page.getByLabel("Staff display name", { exact: false }).fill("Synthetic UP Secretary");
      await page.getByLabel("Initial password", { exact: false }).fill("Synthetic-Pass-2026!");
      const created = page.waitForResponse(
        (r) => r.url().endsWith("/admin/users") && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Create staff account" }).click();
      const response = await created;
      assert.equal(response.status(), 201);
      assert.deepEqual(
        { role: (await response.json()).role, accountType: (await response.json()).accountType },
        { role: "reviewer", accountType: "up_secretary" },
      );
      const rowPost = page.getByLabel(`Office post: ${email}`, { exact: true });
      await rowPost.waitFor();
      assert.equal(await rowPost.inputValue(), "up_secretary");
      assert.equal(await page.getByLabel(`Role for ${email}`, { exact: true }).inputValue(), "reviewer");
      fs.mkdirSync("execution/screenshots", { recursive: true });
      await page.screenshot({ path: "execution/screenshots/phase2a-account-types.png", fullPage: true });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
