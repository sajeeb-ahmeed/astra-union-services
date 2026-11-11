import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
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
async function openProfile(page: Page) {
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: "My profile", exact: true })
    .click();
  await page.locator("#profile-present-same").waitFor();
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByText(/Profile saved/).first().waitFor();
}

test(
  "present address browser: citizen profile saves a separate present address with area and can revert",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.goto(`${origin}/login`);
      await page
        .getByLabel("Email", { exact: true })
        .fill("citizen@alpha.demo.test");
      await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
      await page
        .locator(".login-form")
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
      // Anonymous session probes before sign-in are expected 401s; only profile errors count.
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await openProfile(page);
      const same = page.locator("#profile-present-same");
      if (!(await same.isChecked())) {
        await same.check();
        await save(page);
      }
      assert.equal(await page.locator("#profile-present-bn").count(), 0);
      await same.uncheck();
      await page.locator("#profile-present-bn").fill("ভাড়া বাসা, পরীক্ষা");
      await page.locator("#profile-present-en").fill("Rented flat, demo");
      const area = page.locator(".present-address .geography-fields select");
      for (const index of [0, 1, 2]) {
        await area
          .nth(index)
          .locator("option:not([value=''])")
          .first()
          .waitFor({ state: "attached" });
        await area.nth(index).selectOption({ index: 1 });
      }
      const upazila = await area.nth(2).inputValue();
      assert.ok(upazila);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      await save(page);
      // Persisted: a fresh load shows the saved values.
      await page.reload();
      await openProfile(page);
      assert.equal(await same.isChecked(), false);
      assert.equal(
        await page.locator("#profile-present-en").inputValue(),
        "Rented flat, demo",
      );
      await area.nth(2).locator(`option[value="${upazila}"]`).waitFor({
        state: "attached",
      });
      assert.equal(await area.nth(2).inputValue(), upazila);
      // Revert keeps the shared demo account unchanged for other tests.
      await same.check();
      assert.equal(await page.locator("#profile-present-bn").count(), 0);
      await save(page);
      await page.reload();
      await openProfile(page);
      assert.equal(await same.isChecked(), true);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
