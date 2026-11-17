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
  "geography form browser: NOC v3 cascades to union only for a union address and clears a stale union",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    try {
      await page.goto(`${origin}/login`);
      await page
        .getByLabel("Email", { exact: true })
        .fill("staff@alpha.demo.test");
      await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
      await page
        .locator(".login-form")
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
      // Anonymous session probes before sign-in are expected 401s; only form interaction errors count.
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await workspacePage(page, "services").click();
      await page
        .locator("#applicant option:not([value=''])")
        .first()
        .waitFor({ state: "attached" });
      await page.locator("#applicant").selectOption({ index: 1 });
      await page.locator("button.service", { hasText: /^36/ }).click();
      const form = page.getByTestId("service-application-form");
      await form.waitFor();
      const kind = form.locator("[data-field-path='noc_org_add_type']");
      const selects = form.locator(".geography-picker select");
      await kind.selectOption("union");
      assert.equal(await selects.count(), 4);
      const pick = async (index: number, label: RegExp) => {
        const option = selects.nth(index).locator("option", { hasText: label }).first();
        await option.waitFor({ state: "attached" });
        await selects.nth(index).selectOption((await option.getAttribute("value"))!);
      };
      await pick(0, /Chattogram/);
      await pick(1, /Cumilla/);
      await pick(2, /Debidwar/);
      await pick(3, /Subil/);
      assert.equal(await selects.nth(3).inputValue(), "uni-0001");
      // Urban address: union level disappears and its stored code is dropped.
      await kind.selectOption("municipality");
      assert.equal(await selects.count(), 3);
      assert.equal(await selects.nth(2).inputValue(), "upa-089");
      await kind.selectOption("union");
      assert.equal(await selects.count(), 4);
      assert.equal(await selects.nth(3).inputValue(), "");
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
